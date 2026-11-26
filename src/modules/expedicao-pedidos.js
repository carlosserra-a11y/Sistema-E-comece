// Expedição dos pedidos da internet: as mesmas três etapas da venda do balcão. A diferença é que aqui a baixa no estoque
// acontece no "Expedir" (junto com a reserva): até lá o pedido só segura as unidades.
import { tx } from '../db.js';
import { conflito, naoEncontrado, paginar } from '../util.js';
import { E, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { ETAPAS, NOME, codigosDe, conferirLeituras } from './expedicao.js';
import { mover } from './estoque.js';
import { origensDeVenda } from './vendas.js';
import { PEDIDO_EXPEDIDO, PEDIDO_NA_FILA, diaDaLoja } from './vendas-base.js';

const grupoDe = (pedidoId) => `pedido-${pedidoId}`;
const etapasDe = async (db, pedidoId) => await db.all('SELECT e.etapa, e.ts, e.observacao, e.user_id, u.nome AS quem FROM pedido_etapas e JOIN users u ON u.id = e.user_id WHERE e.pedido_id = ? ORDER BY e.id', pedidoId);
/** Alguém liberou a reserva em Integrações ("marcar como enviado", com a baixa feita à mão): não há mais o que expedir. */
const enviadoAMao = async (db, pedidoId) => !!(await db.get("SELECT 1 AS ok FROM reservas r JOIN pedido_itens i ON i.id = r.pedido_item_id WHERE i.pedido_id = ? AND r.status = 'CONSUMIDA'", pedidoId));
const semReserva = async (db, pedidoId) => Number((await db.get("SELECT COUNT(*) c FROM pedido_itens i LEFT JOIN reservas r ON r.pedido_item_id = i.id WHERE i.pedido_id = ? AND (r.id IS NULL OR r.status <> 'ATIVA')", pedidoId)).c);

/** Produtos do pedido com os códigos de leitura e os endereços: de onde pegar (antes) ou de onde saiu (depois). Sem preços. */
async function itensDe(db, pedidoId, hoje, expedido) {
  const linhas = await db.all('SELECT i.produto_id, MAX(pr.sku) AS sku, MAX(pr.nome) AS descricao, SUM(i.qtd) AS qtd FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id WHERE i.pedido_id = ? GROUP BY i.produto_id ORDER BY i.produto_id', pedidoId);
  const saida = [];
  for (const i of linhas) {
    const qtd = Number(i.qtd);
    let enderecos;
    if (expedido) {
      enderecos = (await db.all("SELECT DISTINCT e.codigo FROM movimentacoes_estoque m JOIN enderecos e ON e.id = m.endereco_id WHERE m.grupo = ? AND m.produto_id = ? AND m.tipo = 'SAIDA'", grupoDe(pedidoId), i.produto_id)).map((e) => e.codigo);
    } else {
      enderecos = []; let falta = qtd;
      for (const o of await origensDeVenda(db, i.produto_id, hoje)) { if (falta <= 0) break; enderecos.push(o.codigo); falta -= Number(o.qtd); }
    }
    saida.push({ ...i, qtd, ...(await codigosDe(db, i.produto_id, i.sku)), enderecos: [...new Set(enderecos)] });
  }
  return saida;
}

/** Baixa as peças (vence antes sai antes, picking primeiro) e consome a reserva. Tudo ou nada. */
async function baixar(db, ctx, pedido, itens) {
  const hoje = diaDaLoja(ctx.agora());
  for (const i of itens) await db.travar(`venda|produto|${i.produto_id}`); // itens em ordem de produto: mesma ordem da venda e da importação
  for (const i of itens) {
    const origens = await origensDeVenda(db, i.produto_id, hoje);
    const tem = origens.reduce((a, o) => a + Number(o.qtd), 0);
    if (tem < i.qtd) throw conflito('ESTOQUE_INSUFICIENTE', `Falta estoque liberado de ${i.sku}: o pedido precisa de ${i.qtd} e há ${tem} em endereço de picking ou reserva. Guarde ou receba a mercadoria e tente de novo.`);
    let falta = i.qtd;
    for (const o of origens) {
      if (!falta) break;
      const tira = Math.min(falta, Number(o.qtd));
      await mover(db, ctx, { tipo: 'SAIDA', produto_id: i.produto_id, endereco_id: o.endereco_id, lote_id: o.lote_id, delta: -tira, grupo: grupoDe(pedido.id), documento: `Pedido ${pedido.canal_pedido_id}`, motivo: 'Pedido da internet' });
      falta -= tira;
    }
  }
  await db.run("UPDATE reservas SET status = 'CONSUMIDA', atualizado_em = ? WHERE status = 'ATIVA' AND pedido_item_id IN (SELECT id FROM pedido_itens WHERE pedido_id = ?)", ctx.agora(), pedido.id);
}

export async function registrarEtapaPedido(db, ctx, pedidoId, corpo) {
  const d = validar(corpo, { etapa: E(ETAPAS, { obrig: true }), observacao: T({ max: 300 }) });
  return await tx(db, async (db) => {
    await db.travar(`pedido|doc|${pedidoId}`); // a mesma trava da importação: um cancelamento não atravessa o envio
    const p = await db.get('SELECT id, canal_pedido_id, status, problema FROM pedidos WHERE id = ?', pedidoId);
    if (!p) throw naoEncontrado('Pedido');
    if (p.status === 'CANCELADO') throw conflito('STATUS', 'Este pedido foi cancelado: não envie. Guarde de volta o que já foi separado.');
    const feitas = (await etapasDe(db, p.id)).map((e) => e.etapa);
    if (feitas.includes(d.etapa)) throw conflito('JA_FEITA', `A ${NOME[d.etapa]} deste pedido já foi registrada.`);
    if (await enviadoAMao(db, p.id)) throw conflito('JA_ENVIADO', 'Este pedido já foi marcado como enviado em Integrações.');
    if (p.status !== 'PAGO') throw conflito('STATUS', p.status === 'NOVO' ? 'Este pedido ainda não foi pago.' : `Pedido com problema (${p.problema ?? 'ver Integrações'}). Resolva em Integrações → Pedidos.`);
    if (await semReserva(db, p.id)) throw conflito('STATUS', 'Este pedido está sem reserva de estoque: reprocesse em Integrações → Pedidos.');
    const anterior = ETAPAS[ETAPAS.indexOf(d.etapa) - 1];
    if (anterior && !feitas.includes(anterior)) throw conflito('FORA_DE_ORDEM', `Faça antes a ${NOME[anterior]}.`);
    const itens = await itensDe(db, p.id, diaDaLoja(ctx.agora()), false);
    if (d.etapa === 'EXPEDICAO') await baixar(db, ctx, p, itens);
    else conferirLeituras(itens, corpo.leituras, { de: 'deste pedido', verbo: 'pedido' });
    await db.run('INSERT INTO pedido_etapas (pedido_id, etapa, user_id, ts, observacao) VALUES (?,?,?,?,?)', p.id, d.etapa, ctx.user.id, ctx.agora(), d.observacao ?? null);
    await auditar(db, ctx, `ETAPA_PEDIDO_${d.etapa}`, 'pedido', p.id);
    return { pedido_id: p.id, etapas: await etapasDe(db, p.id) };
  });
}

export function registrarExpedicaoPedidos(app, { db }) {
  const { rota } = app;

  rota('GET', '/api/expedicao-pedidos', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 25);
    const prontos = ctx.query.situacao === 'expedidas';
    const onde = prontos ? PEDIDO_EXPEDIDO : PEDIDO_NA_FILA;
    const pedidos = await db.all(`SELECT p.id, p.canal_pedido_id, p.data_canal, p.comprador_apelido,
        (SELECT COALESCE(SUM(qtd),0) FROM pedido_itens i WHERE i.pedido_id = p.id) AS unidades
      FROM pedidos p WHERE ${onde} ORDER BY ${prontos ? 'p.id DESC' : 'p.data_canal, p.id'} LIMIT ? OFFSET ?`, por, offset);
    const itens = [];
    for (const p of pedidos) itens.push({ ...p, unidades: Number(p.unidades), etapas: await etapasDe(db, p.id) });
    const contar = async (filtro) => Number((await db.get(`SELECT COUNT(*) c FROM pedidos p WHERE ${filtro}`)).c);
    return {
      total: await contar(onde), pagina, por_pagina: por, itens,
      // pagos que não podem sair ainda (produto sem mapeamento ou falta de estoque)
      com_problema: await contar(`p.status = 'COM_PROBLEMA' AND NOT ${PEDIDO_EXPEDIDO}`),
    };
  });

  rota('GET', '/api/expedicao-pedidos/:id', async (ctx) => {
    const p = await db.get('SELECT id, canal_pedido_id, status, problema, data_canal, comprador_apelido FROM pedidos WHERE id = ?', Number(ctx.params.id));
    if (!p) throw naoEncontrado('Pedido');
    const etapas = await etapasDe(db, p.id);
    const expedido = etapas.some((e) => e.etapa === 'EXPEDICAO');
    return { ...p, etapas, enviado_a_mao: !expedido && await enviadoAMao(db, p.id), itens: await itensDe(db, p.id, diaDaLoja(ctx.agora()), expedido) };
  });

  rota('POST', '/api/expedicao-pedidos/:id/etapa', async (ctx) => {
    const r = await registrarEtapaPedido(db, ctx, Number(ctx.params.id), ctx.corpo);
    if (r.etapas.some((e) => e.etapa === 'EXPEDICAO')) app.eventos.emit('estoque'); // os anúncios recebem o saldo novo
    return r;
  });
}
