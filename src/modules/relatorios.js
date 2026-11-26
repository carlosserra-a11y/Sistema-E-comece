// Relatórios do balcão (período em dias da loja) e conferência de integridade das vendas.
import { tx } from '../db.js';
import { celulaCsv, invalido } from '../util.js';
import { auditar } from '../security/audit.js';
import { podeFinanceiro } from '../permissoes.js';
import { centavosParaTexto } from '../../public/js/dinheiro.js';
import { diaDaLoja, inicioDoDia } from './vendas-base.js';

const MAX_DIAS = 366;

function periodo(query, agora) {
  const hoje = diaDaLoja(agora);
  const de = query.de || hoje; const ate = query.ate || de;
  for (const [campo, dia] of [['de', de], ['ate', ate]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(inicioDoDia(dia))) throw invalido({ [campo]: 'Data inválida.' });
  }
  const ini = inicioDoDia(de); const fim = inicioDoDia(ate) + 86_400_000;
  if (fim <= ini) throw invalido({ ate: 'A data final é anterior à inicial.' });
  if (fim - ini > MAX_DIAS * 86_400_000) throw invalido({ ate: 'Período de no máximo 1 ano.' });
  return { de, ate, ini, fim };
}

export async function relatorio(db, ctx, query) {
  const p = periodo(query, ctx.agora());
  const onde = "v.status = 'CONCLUIDA' AND v.concluida_em >= ? AND v.concluida_em < ?";
  const n = (x) => Number(x ?? 0);
  const t = await db.get(`SELECT COUNT(*) AS vendas, COALESCE(SUM(v.subtotal_centavos),0) AS subtotal, COALESCE(SUM(v.desconto_centavos),0) AS desconto, COALESCE(SUM(v.valor_centavos),0) AS valor FROM vendas v WHERE ${onde}`, p.ini, p.fim);
  const canceladas = await db.get("SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_centavos),0) AS valor FROM vendas WHERE status = 'CANCELADA' AND cancelada_em >= ? AND cancelada_em < ?", p.ini, p.fim);
  const porForma = await db.all(`SELECT pg.forma, SUM(pg.valor_centavos) AS valor, COUNT(DISTINCT pg.venda_id) AS vendas FROM venda_pagamentos pg JOIN vendas v ON v.id = pg.venda_id WHERE ${onde} GROUP BY pg.forma ORDER BY 2 DESC`, p.ini, p.fim);
  const porVendedor = await db.all(`SELECT u.id, u.nome, COUNT(*) AS vendas, SUM(v.valor_centavos) AS valor FROM vendas v JOIN users u ON u.id = v.vendedor_id WHERE ${onde} GROUP BY u.id, u.nome ORDER BY 4 DESC`, p.ini, p.fim);
  const itens = await db.all(`SELECT i.tipo, i.produto_id, i.servico_id, MAX(i.descricao) AS descricao, SUM(i.qtd) AS qtd, SUM(i.qtd * i.preco_unit_centavos) AS valor, SUM(i.qtd * i.custo_unit_centavos) AS custo
    FROM venda_itens i JOIN vendas v ON v.id = i.venda_id WHERE ${onde} GROUP BY i.tipo, i.produto_id, i.servico_id ORDER BY 6 DESC`, p.ini, p.fim);
  const diaSql = db.dialeto === 'pg' ? "to_char(to_timestamp((v.concluida_em - 10800000) / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')" : "strftime('%Y-%m-%d', (v.concluida_em - 10800000) / 1000, 'unixepoch')";
  const porDia = await db.all(`SELECT ${diaSql} AS dia, COUNT(*) AS vendas, SUM(v.valor_centavos) AS valor FROM vendas v WHERE ${onde} GROUP BY 1 ORDER BY 1`, p.ini, p.fim);
  const vendas = n(t.vendas); const valor = n(t.valor);
  const custo = itens.reduce((a, i) => a + n(i.custo), 0);
  return {
    de: p.de, ate: p.ate, vendas, subtotal_centavos: n(t.subtotal), desconto_centavos: n(t.desconto), valor_centavos: valor,
    ticket_medio_centavos: vendas ? Math.round(valor / vendas) : 0,
    canceladas: { qtd: n(canceladas.qtd), valor_centavos: n(canceladas.valor) },
    por_forma: porForma.map((x) => ({ forma: x.forma, vendas: n(x.vendas), valor_centavos: n(x.valor) })),
    por_vendedor: porVendedor.map((x) => ({ id: x.id, nome: x.nome, vendas: n(x.vendas), valor_centavos: n(x.valor) })),
    mais_vendidos: itens.slice(0, 20).map((x) => ({ tipo: x.tipo, descricao: x.descricao, qtd: n(x.qtd), valor_centavos: n(x.valor) })),
    por_dia: porDia.map((x) => ({ dia: x.dia, vendas: n(x.vendas), valor_centavos: n(x.valor) })),
    // custo e margem só para quem tem o financeiro (o desconto sai da margem)
    ...(podeFinanceiro(ctx) ? { custo_total_centavos: custo, margem_centavos: valor - custo } : {}),
  };
}

/** Confere cada venda: itens somam o subtotal, pagamentos somam o total e o estoque baixado bate com o vendido (zero se cancelada). */
export async function integridadeVendas(db) {
  const problemas = [];
  const add = async (sql, texto) => { for (const l of await db.all(sql)) problemas.push(`venda ${l.id}: ${texto}`); };
  await add("SELECT v.id FROM vendas v LEFT JOIN venda_itens i ON i.venda_id = v.id GROUP BY v.id, v.subtotal_centavos HAVING COALESCE(SUM(i.qtd * i.preco_unit_centavos), 0) <> v.subtotal_centavos", 'itens não somam o subtotal');
  await add("SELECT v.id FROM vendas v LEFT JOIN venda_pagamentos p ON p.venda_id = v.id WHERE v.status IN ('CONCLUIDA','CANCELADA') GROUP BY v.id, v.valor_centavos HAVING COALESCE(SUM(p.valor_centavos), 0) <> v.valor_centavos", 'pagamentos não somam o total');
  await add("SELECT DISTINCT v.id FROM vendas v JOIN venda_pagamentos p ON p.venda_id = v.id WHERE v.status IN ('ORCAMENTO','DESCARTADA')", 'orçamento com pagamento');
  const vendidos = await db.all("SELECT i.venda_id AS id, i.produto_id, v.status, SUM(i.qtd) AS qtd FROM venda_itens i JOIN vendas v ON v.id = i.venda_id WHERE i.tipo = 'PRODUTO' AND v.status IN ('CONCLUIDA','CANCELADA') GROUP BY i.venda_id, i.produto_id, v.status");
  const baixas = await db.all("SELECT grupo, produto_id, SUM(delta) AS soma FROM movimentacoes_estoque WHERE grupo LIKE 'venda-%' GROUP BY grupo, produto_id");
  const mapa = new Map(baixas.map((b) => [`${b.grupo}|${b.produto_id}`, Number(b.soma)]));
  for (const x of vendidos) {
    const esperado = x.status === 'CONCLUIDA' ? -Number(x.qtd) : 0;
    if ((mapa.get(`venda-${x.id}|${x.produto_id}`) ?? 0) !== esperado) problemas.push(`venda ${x.id}: estoque do produto ${x.produto_id} não bate`);
  }
  return { ok: problemas.length === 0, problemas: problemas.slice(0, 50) };
}

export function registrarRelatorios(app, { db }) {
  const { rota } = app;
  rota('GET', '/api/relatorios/vendas', async (ctx) => await relatorio(db, ctx, ctx.query));
  rota('GET', '/api/relatorios/vendas/integridade', async () => await integridadeVendas(db));

  rota('GET', '/api/relatorios/vendas.csv', async (ctx) => {
    const p = periodo(ctx.query, ctx.agora());
    const vendas = await db.all(`SELECT v.id, v.status, v.concluida_em, v.subtotal_centavos, v.desconto_centavos, v.valor_centavos, u.nome AS vendedor, c.nome AS cliente
      FROM vendas v JOIN users u ON u.id = v.vendedor_id LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.status IN ('CONCLUIDA','CANCELADA') AND v.concluida_em >= ? AND v.concluida_em < ? ORDER BY v.id`, p.ini, p.fim);
    const pags = await db.all(`SELECT pg.venda_id, pg.forma, pg.valor_centavos FROM venda_pagamentos pg JOIN vendas v ON v.id = pg.venda_id WHERE v.concluida_em >= ? AND v.concluida_em < ? ORDER BY pg.id`, p.ini, p.fim);
    const formas = new Map();
    for (const x of pags) formas.set(x.venda_id, [...(formas.get(x.venda_id) ?? []), `${x.forma} ${centavosParaTexto(Number(x.valor_centavos))}`]);
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
    const cab = ['venda', 'situacao', 'data', 'vendedor', 'cliente', 'subtotal', 'desconto', 'total', 'pagamentos'];
    const linhas = vendas.map((v) => [v.id, v.status, hora.format(new Date(v.concluida_em)), v.vendedor, ctx.pode('clientes.ver') ? v.cliente : null, centavosParaTexto(Number(v.subtotal_centavos)), centavosParaTexto(Number(v.desconto_centavos)), centavosParaTexto(Number(v.valor_centavos)), (formas.get(v.id) ?? []).join(' + ')]);
    await tx(db, async (db) => await auditar(db, ctx, 'VENDAS_EXPORTADAS', 'venda', null, { de: p.de, ate: p.ate, total: linhas.length }));
    return { _raw: true, tipo: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="vendas-${p.de}-a-${p.ate}.csv"` }, corpo: '﻿' + [cab, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n') };
  });
}
