// Rastreio da venda: SEPARAÇÃO -> CONFERÊNCIA -> EXPEDIÇÃO. Cada passo grava quem fez e quando (registro imutável).
// Separação e conferência exigem bipar os produtos: as quantidades lidas precisam bater com as vendidas.
import { tx } from '../db.js';
import { conflito, invalido, naoEncontrado, paginar } from '../util.js';
import { E, I, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { variantes } from '../barcode/gtin.js';
import { normalizarLeitura } from './consultas.js';

export const ETAPAS = ['SEPARACAO', 'CONFERENCIA', 'EXPEDICAO'];
const NOME = { SEPARACAO: 'separação', CONFERENCIA: 'conferência', EXPEDICAO: 'expedição' };

const etapasDe = async (db, vendaId) => await db.all('SELECT e.etapa, e.ts, e.observacao, e.user_id, u.nome AS quem FROM etapas e JOIN users u ON u.id = e.user_id WHERE e.venda_id = ? ORDER BY e.id', vendaId);

/** Produtos da venda (serviços não passam pelo estoque), com os códigos que valem na leitura. */
async function itensDe(db, vendaId) {
  const itens = await db.all("SELECT produto_id, MAX(codigo) AS sku, MAX(descricao) AS descricao, SUM(qtd) AS qtd FROM venda_itens WHERE venda_id = ? AND tipo = 'PRODUTO' GROUP BY produto_id ORDER BY produto_id", vendaId);
  const saida = [];
  for (const i of itens) {
    const codigos = (await db.all('SELECT codigo FROM codigos_barras WHERE produto_id = ?', i.produto_id)).map((c) => c.codigo);
    const enderecos = await db.all("SELECT DISTINCT e.codigo FROM movimentacoes_estoque m JOIN enderecos e ON e.id = m.endereco_id WHERE m.grupo = ? AND m.produto_id = ? AND m.tipo = 'SAIDA'", `venda-${vendaId}`, i.produto_id);
    const todos = [...new Set([i.sku, ...codigos].filter(Boolean))];
    // `aceitos`: tudo o que vale como leitura deste item (a tela confere na hora; o servidor confere de novo ao confirmar)
    saida.push({ ...i, qtd: Number(i.qtd), codigos: todos, aceitos: [...new Set(todos.flatMap((c) => variantes(c.toUpperCase())))], enderecos: enderecos.map((e) => e.codigo) });
  }
  return saida;
}

/** Soma as leituras por produto. Código que não é da venda é recusado na hora. */
function conferirLeituras(itens, leituras) {
  if (!Array.isArray(leituras) || !leituras.length) throw invalido({ leituras: 'Bipe os produtos antes de confirmar.' }, 'Bipe os produtos antes de confirmar.');
  if (leituras.length > 500) throw invalido({ leituras: 'Leituras demais.' });
  const porCodigo = new Map();
  for (const i of itens) for (const c of i.aceitos) porCodigo.set(c, i.produto_id);
  const lido = new Map();
  for (const bruto of leituras) {
    const d = validar(bruto, { codigo: T({ obrig: true, max: 80 }), qtd: I({ min: 1, max: 100_000, padrao: 1 }) });
    const codigo = normalizarLeitura(d.codigo).toUpperCase();
    const produto = porCodigo.get(codigo);
    if (!produto) throw conflito('LEITURA_ERRADA', `O código ${codigo} não é de nenhum produto desta venda.`);
    lido.set(produto, (lido.get(produto) ?? 0) + d.qtd);
  }
  const diferencas = itens.filter((i) => (lido.get(i.produto_id) ?? 0) !== i.qtd).map((i) => `${i.sku}: lido ${lido.get(i.produto_id) ?? 0}, vendido ${i.qtd}`);
  if (diferencas.length) throw conflito('QUANTIDADE_DIFERENTE', `A leitura não bate. ${diferencas.slice(0, 5).join('; ')}.`);
}

export async function registrarEtapa(db, ctx, vendaId, corpo) {
  const d = validar(corpo, { etapa: E(ETAPAS, { obrig: true }), observacao: T({ max: 300 }) });
  return await tx(db, async (db) => {
    await db.travar(`venda|doc|${vendaId}`); // a mesma trava do cancelamento: não se expede o que está sendo cancelado
    const v = await db.get('SELECT id, status FROM vendas WHERE id = ?', vendaId);
    if (!v) throw naoEncontrado('Venda');
    if (v.status !== 'CONCLUIDA') throw conflito('STATUS', v.status === 'CANCELADA' ? 'Esta venda foi cancelada.' : 'Só uma venda concluída passa pela expedição.');
    const itens = await itensDe(db, v.id);
    if (!itens.length) throw conflito('SEM_PRODUTOS', 'Esta venda só tem serviços: não há o que separar.');
    const feitas = (await etapasDe(db, v.id)).map((e) => e.etapa);
    if (feitas.includes(d.etapa)) throw conflito('JA_FEITA', `A ${NOME[d.etapa]} desta venda já foi registrada.`);
    const anterior = ETAPAS[ETAPAS.indexOf(d.etapa) - 1];
    if (anterior && !feitas.includes(anterior)) throw conflito('FORA_DE_ORDEM', `Faça antes a ${NOME[anterior]}.`);
    if (d.etapa !== 'EXPEDICAO') conferirLeituras(itens, corpo.leituras);
    await db.run('INSERT INTO etapas (venda_id, etapa, user_id, ts, observacao) VALUES (?,?,?,?,?)', v.id, d.etapa, ctx.user.id, ctx.agora(), d.observacao ?? null);
    await auditar(db, ctx, `ETAPA_${d.etapa}`, 'venda', v.id);
    return { venda_id: v.id, etapas: await etapasDe(db, v.id) };
  });
}

/** Vendas concluídas com produto: pendentes (sem expedição) ou já expedidas. */
export function registrarExpedicao(app, { db }) {
  const { rota } = app;
  const BASE = "v.status = 'CONCLUIDA' AND EXISTS (SELECT 1 FROM venda_itens i WHERE i.venda_id = v.id AND i.tipo = 'PRODUTO')";
  const EXPEDIDA = "EXISTS (SELECT 1 FROM etapas e WHERE e.venda_id = v.id AND e.etapa = 'EXPEDICAO')";

  rota('GET', '/api/expedicao', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 25);
    const prontas = ctx.query.situacao === 'expedidas';
    const onde = `${BASE} AND ${prontas ? '' : 'NOT '}${EXPEDIDA}`;
    const vendas = await db.all(`SELECT v.id, v.concluida_em, u.nome AS vendedor_nome, o.nome AS caixa_de,
        (SELECT COALESCE(SUM(qtd),0) FROM venda_itens i WHERE i.venda_id = v.id AND i.tipo = 'PRODUTO') AS unidades
      FROM vendas v JOIN users u ON u.id = v.vendedor_id JOIN caixas c ON c.id = v.caixa_id JOIN users o ON o.id = c.aberto_por
      WHERE ${onde} ORDER BY v.id ${prontas ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`, por, offset);
    const itens = [];
    for (const v of vendas) itens.push({ ...v, unidades: Number(v.unidades), etapas: await etapasDe(db, v.id) });
    return { total: Number((await db.get(`SELECT COUNT(*) c FROM vendas v WHERE ${onde}`)).c), pagina, por_pagina: por, itens };
  });

  rota('GET', '/api/expedicao/:id', async (ctx) => {
    const v = await db.get(`SELECT v.id, v.status, v.concluida_em, v.observacao, u.nome AS vendedor_nome, o.nome AS caixa_de, v.caixa_id
      FROM vendas v JOIN users u ON u.id = v.vendedor_id LEFT JOIN caixas c ON c.id = v.caixa_id LEFT JOIN users o ON o.id = c.aberto_por WHERE v.id = ?`, Number(ctx.params.id));
    if (!v || !['CONCLUIDA', 'CANCELADA'].includes(v.status)) throw naoEncontrado('Venda');
    return { ...v, itens: await itensDe(db, v.id), etapas: await etapasDe(db, v.id) };
  });

  rota('POST', '/api/expedicao/:id/etapa', async (ctx) => await registrarEtapa(db, ctx, Number(ctx.params.id), ctx.corpo));
}
