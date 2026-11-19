import crypto from 'node:crypto';
import { tx } from '../db.js';
import { conflito, erro, invalido, naoEncontrado, paginar } from '../util.js';
import { D, I, ID, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { ORDEM_ROTA } from './deposito.js';

const hojeSP = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t));
const QTD = I({ obrig: true, min: 1, max: 1_000_000 });

function endereco(db, id, { entrada = false } = {}) {
  const e = db.prepare('SELECT e.*, z.tipo AS zona_tipo, z.vendavel FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE e.id = ?').get(id);
  if (!e) throw naoEncontrado('Endereço');
  if (entrada && !e.ativo) throw conflito('ENDERECO_INATIVO', `O endereço ${e.codigo} está inativo.`);
  if (entrada && e.bloqueado) throw conflito('ENDERECO_BLOQUEADO', `O endereço ${e.codigo} está bloqueado${e.motivo_bloqueio ? `: ${e.motivo_bloqueio}` : ''}.`);
  return e;
}
function produtoAtivo(db, id) {
  const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
  if (!p) throw naoEncontrado('Produto');
  if (!p.ativo) throw conflito('PRODUTO_INATIVO', `O produto ${p.sku} está inativo.`);
  return p;
}
export const saldoDe = (db, produtoId, enderecoId, loteId = 0) =>
  db.prepare('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE produto_id = ? AND endereco_id = ? AND lote_id = ?').get(produtoId, enderecoId, loteId).q;

function checarCapacidade(db, e, produto, extra) {
  if (extra <= 0) return;
  if (e.cap_itens > 0) {
    const atual = db.prepare('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE endereco_id = ?').get(e.id).q;
    if (atual + extra > e.cap_itens) throw conflito('CAPACIDADE', `Capacidade excedida em ${e.codigo}: comporta ${e.cap_itens}, já tem ${atual} (cabem mais ${Math.max(0, e.cap_itens - atual)}).`);
  }
  if (e.cap_peso_g > 0 && produto.peso_g > 0) {
    const peso = db.prepare('SELECT COALESCE(SUM(s.qtd * p.peso_g),0) q FROM saldos_por_endereco s JOIN produtos p ON p.id = s.produto_id WHERE s.endereco_id = ?').get(e.id).q;
    if (peso + extra * produto.peso_g > e.cap_peso_g) throw conflito('CAPACIDADE_PESO', `Peso máximo excedido em ${e.codigo} (${e.cap_peso_g} g).`);
  }
}

/** Única porta de escrita no estoque: uma linha do livro-razão. O gatilho do banco atualiza o saldo. */
export function mover(db, ctx, m) {
  if (!Number.isInteger(m.delta) || m.delta === 0) throw new Error('delta inválido');
  if (m.delta < 0) {
    const atual = saldoDe(db, m.produto_id, m.endereco_id, m.lote_id ?? 0);
    if (atual + m.delta < 0) {
      const e = db.prepare('SELECT codigo FROM enderecos WHERE id = ?').get(m.endereco_id);
      throw conflito('ESTOQUE_INSUFICIENTE', `Saldo insuficiente em ${e.codigo}: tem ${atual}, pediu ${-m.delta}.`);
    }
  }
  const r = db.prepare('INSERT INTO movimentacoes_estoque (ts, tipo, produto_id, endereco_id, lote_id, delta, grupo, motivo, documento, user_id, inventario_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(ctx.agora(), m.tipo, m.produto_id, m.endereco_id, m.lote_id ?? 0, m.delta, m.grupo ?? null, m.motivo ?? null, m.documento ?? null, ctx.user?.id ?? null, m.inventario_id ?? null);
  return Number(r.lastInsertRowid);
}

function obterOuCriarLote(db, ctx, produto, codigo, validade) {
  if (!codigo) {
    if (produto.controla_lote) throw invalido({ lote: 'Este produto controla lote: informe o lote.' });
    if (produto.controla_validade) throw invalido({ validade: 'Este produto controla validade: informe lote e validade.' });
    return 0;
  }
  if (produto.controla_validade && !validade) throw invalido({ validade: 'Informe a validade do lote.' });
  if (validade && validade < hojeSP(ctx.agora())) throw invalido({ validade: 'Lote vencido: não pode ser recebido.' });
  const l = db.prepare('SELECT * FROM lotes WHERE produto_id = ? AND codigo = ?').get(produto.id, codigo);
  if (l) {
    if ((l.validade ?? null) !== (validade ?? null)) throw conflito('LOTE_VALIDADE', `O lote ${codigo} já existe com validade ${l.validade ?? 'nenhuma'}.`);
    return l.id;
  }
  return Number(db.prepare('INSERT INTO lotes (produto_id, codigo, validade, criado_em) VALUES (?,?,?,?)').run(produto.id, codigo, validade ?? null, ctx.agora()).lastInsertRowid);
}

/** Descobre o lote quando o chamador não informou: único lote com saldo no endereço, senão exige escolha. */
function resolverLote(db, produtoId, enderecoId, loteId) {
  if (loteId !== undefined) return loteId;
  const linhas = db.prepare('SELECT lote_id FROM saldos_por_endereco WHERE produto_id = ? AND endereco_id = ? AND qtd > 0').all(produtoId, enderecoId);
  if (linhas.length > 1) throw invalido({ lote_id: 'Há mais de um lote neste endereço: escolha qual.' });
  return linhas[0]?.lote_id ?? 0;
}

export function receber(db, ctx, bruto) {
  const d = validar(bruto, { produto_id: ID({ obrig: true }), endereco_id: ID({ obrig: true }), qtd: QTD, lote: T({ max: 40, upper: true, regex: /^[A-Z0-9][A-Z0-9._\/-]{0,39}$/, msg: 'Lote: letras, números e . _ / -' }), validade: D(), documento: T({ max: 60 }) });
  const p = produtoAtivo(db, d.produto_id);
  const e = endereco(db, d.endereco_id, { entrada: true });
  const loteId = obterOuCriarLote(db, ctx, p, d.lote, d.validade);
  checarCapacidade(db, e, p, d.qtd);
  const mov = mover(db, ctx, { tipo: 'ENTRADA', produto_id: p.id, endereco_id: e.id, lote_id: loteId, delta: d.qtd, documento: d.documento, motivo: 'Recebimento' });
  auditar(db, ctx, 'ESTOQUE_ENTRADA', 'produto', p.id, { endereco: e.codigo, qtd: d.qtd, lote: d.lote ?? null });
  return { movimentacao_id: mov, produto: p.sku, endereco: e.codigo, qtd: d.qtd, lote_id: loteId, saldo_endereco: saldoDe(db, p.id, e.id, loteId) };
}

export function transferir(db, ctx, bruto) {
  const d = validar(bruto, { produto_id: ID({ obrig: true }), origem_id: ID({ obrig: true }), destino_id: ID({ obrig: true }), qtd: QTD, lote_id: I({ min: 0 }), motivo: T({ max: 200 }) });
  if (d.origem_id === d.destino_id) throw invalido({ destino_id: 'Origem e destino são o mesmo endereço.' });
  const p = produtoAtivo(db, d.produto_id);
  const o = endereco(db, d.origem_id);
  const dest = endereco(db, d.destino_id, { entrada: true });
  const loteId = resolverLote(db, p.id, o.id, d.lote_id);
  checarCapacidade(db, dest, p, d.qtd);
  const grupo = crypto.randomUUID();
  const saida = mover(db, ctx, { tipo: 'TRANSF_SAIDA', produto_id: p.id, endereco_id: o.id, lote_id: loteId, delta: -d.qtd, grupo, motivo: d.motivo });
  const entrada = mover(db, ctx, { tipo: 'TRANSF_ENTRADA', produto_id: p.id, endereco_id: dest.id, lote_id: loteId, delta: d.qtd, grupo, motivo: d.motivo });
  auditar(db, ctx, 'ESTOQUE_TRANSFERENCIA', 'produto', p.id, { de: o.codigo, para: dest.codigo, qtd: d.qtd });
  return { grupo, movimentacoes: [saida, entrada], produto: p.sku, de: o.codigo, para: dest.codigo, qtd: d.qtd };
}

export function ajustar(db, ctx, bruto) {
  const d = validar(bruto, { produto_id: ID({ obrig: true }), endereco_id: ID({ obrig: true }), lote_id: I({ min: 0 }), qtd_nova: I({ obrig: true, min: 0, max: 1_000_000 }), motivo: T({ obrig: true, min: 5, max: 200 }) });
  const p = produtoAtivo(db, d.produto_id);
  const e = endereco(db, d.endereco_id);
  const loteId = resolverLote(db, p.id, e.id, d.lote_id);
  const atual = saldoDe(db, p.id, e.id, loteId);
  const delta = d.qtd_nova - atual;
  if (delta === 0) throw conflito('SEM_ALTERACAO', 'A quantidade informada já é a do sistema.');
  if (delta > 0) { if (!e.ativo || e.bloqueado) throw conflito('ENDERECO_BLOQUEADO', 'Endereço indisponível para entrada.'); checarCapacidade(db, e, p, delta); }
  const mov = mover(db, ctx, { tipo: 'AJUSTE', produto_id: p.id, endereco_id: e.id, lote_id: loteId, delta, motivo: d.motivo });
  auditar(db, ctx, 'ESTOQUE_AJUSTE', 'produto', p.id, { endereco: e.codigo, de: atual, para: d.qtd_nova, motivo: d.motivo });
  return { movimentacao_id: mov, de: atual, para: d.qtd_nova, delta };
}

export function baixar(db, ctx, bruto) {
  const d = validar(bruto, { produto_id: ID({ obrig: true }), endereco_id: ID({ obrig: true }), lote_id: I({ min: 0 }), qtd: QTD, motivo: T({ obrig: true, min: 5, max: 200 }) });
  const p = produtoAtivo(db, d.produto_id);
  const e = endereco(db, d.endereco_id);
  const loteId = resolverLote(db, p.id, e.id, d.lote_id);
  const mov = mover(db, ctx, { tipo: 'SAIDA', produto_id: p.id, endereco_id: e.id, lote_id: loteId, delta: -d.qtd, motivo: d.motivo });
  auditar(db, ctx, 'ESTOQUE_BAIXA', 'produto', p.id, { endereco: e.codigo, qtd: d.qtd, motivo: d.motivo });
  return { movimentacao_id: mov, saldo_endereco: saldoDe(db, p.id, e.id, loteId) };
}

export function avaria(db, ctx, bruto) {
  const d = validar(bruto, { produto_id: ID({ obrig: true }), endereco_id: ID({ obrig: true }), lote_id: I({ min: 0 }), qtd: QTD, motivo: T({ obrig: true, min: 5, max: 200 }), destino_id: ID() });
  if (!d.destino_id) return baixar(db, ctx, { ...d, motivo: `AVARIA: ${d.motivo}` });
  const dest = endereco(db, d.destino_id);
  if (dest.zona_tipo !== 'AVARIA') throw invalido({ destino_id: 'O destino precisa estar numa zona de avaria.' });
  return transferir(db, ctx, { produto_id: d.produto_id, origem_id: d.endereco_id, destino_id: d.destino_id, qtd: d.qtd, lote_id: d.lote_id, motivo: `AVARIA: ${d.motivo}` });
}

export function sugerirGuardar(db, produtoId, qtd = 1) {
  const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produtoId);
  if (!p) throw naoEncontrado('Produto');
  const folga = (e) => (e.cap_itens > 0 ? e.cap_itens - e.atual : null);
  const cabe = (e) => (e.cap_itens === 0 || e.atual + qtd <= e.cap_itens) && (e.cap_peso_g === 0 || p.peso_g === 0 || e.peso + qtd * p.peso_g <= e.cap_peso_g);
  const base = `SELECT e.*, z.tipo AS zona_tipo,
    COALESCE((SELECT SUM(qtd) FROM saldos_por_endereco s WHERE s.endereco_id = e.id),0) AS atual,
    COALESCE((SELECT SUM(s.qtd * pp.peso_g) FROM saldos_por_endereco s JOIN produtos pp ON pp.id = s.produto_id WHERE s.endereco_id = e.id),0) AS peso,
    EXISTS (SELECT 1 FROM saldos_por_endereco s WHERE s.endereco_id = e.id AND s.produto_id = ? AND s.qtd > 0) AS tem_sku,
    (SELECT produto_id FROM produto_picking pk WHERE pk.endereco_id = e.id) AS designado
    FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE e.ativo = 1 AND e.bloqueado = 0 AND z.tipo IN ('PICKING','RESERVA')`;
  const todos = db.prepare(`${base} ORDER BY ${ORDEM_ROTA}`).all(produtoId).filter(cabe);
  const out = [];
  const add = (e, motivo, prioridade) => { if (!out.some((x) => x.endereco_id === e.id)) out.push({ endereco_id: e.id, codigo: e.codigo, zona_tipo: e.zona_tipo, motivo, prioridade, ocupado: e.atual, folga: folga(e) }); };
  for (const e of todos) if (e.designado === produtoId) add(e, 'Endereço de picking deste produto', 1);
  for (const e of todos) if (e.tem_sku) add(e, 'Já guarda este produto', 2);
  for (const e of todos.filter((x) => x.atual === 0 && !x.designado && x.zona_tipo === 'RESERVA')) add(e, 'Reserva vazia mais próxima', 3);
  for (const e of todos.filter((x) => x.atual === 0 && !x.designado && x.zona_tipo === 'PICKING')) add(e, 'Picking livre mais próximo', 4);
  return out.sort((a, b) => a.prioridade - b.prioridade).slice(0, 8);
}

export function ondeEsta(db, produtoId) {
  const p = db.prepare('SELECT id, sku, nome FROM produtos WHERE id = ?').get(produtoId);
  if (!p) throw naoEncontrado('Produto');
  const locais = db.prepare(`SELECT s.endereco_id, e.codigo, z.tipo AS zona_tipo, z.vendavel, s.lote_id, l.codigo AS lote, l.validade, s.qtd
    FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id LEFT JOIN lotes l ON l.id = s.lote_id
    WHERE s.produto_id = ? AND s.qtd > 0 ORDER BY (l.validade IS NULL), l.validade, ${ORDEM_ROTA}`).all(produtoId);
  return { produto: p, total: locais.reduce((a, l) => a + l.qtd, 0), vendavel: locais.filter((l) => l.vendavel).reduce((a, l) => a + l.qtd, 0), locais };
}

/** Confere se o saldo bate com a soma do livro-razão (critério de aceite: sempre). */
export function integridade(db) {
  const div = db.prepare(`SELECT COALESCE(m.produto_id, s.produto_id) AS produto_id, COALESCE(m.endereco_id, s.endereco_id) AS endereco_id, COALESCE(m.lote_id, s.lote_id) AS lote_id,
      COALESCE(m.soma, 0) AS ledger, COALESCE(s.qtd, 0) AS saldo
    FROM (SELECT produto_id, endereco_id, lote_id, SUM(delta) soma FROM movimentacoes_estoque GROUP BY 1,2,3) m
    LEFT JOIN saldos_por_endereco s ON s.produto_id = m.produto_id AND s.endereco_id = m.endereco_id AND s.lote_id = m.lote_id
    UNION
    SELECT s.produto_id, s.endereco_id, s.lote_id, COALESCE(m.soma,0), s.qtd FROM saldos_por_endereco s
    LEFT JOIN (SELECT produto_id, endereco_id, lote_id, SUM(delta) soma FROM movimentacoes_estoque GROUP BY 1,2,3) m
      ON s.produto_id = m.produto_id AND s.endereco_id = m.endereco_id AND s.lote_id = m.lote_id`).all().filter((r) => r.ledger !== r.saldo);
  const negativos = db.prepare('SELECT COUNT(*) c FROM saldos_por_endereco WHERE qtd < 0').get().c;
  return { ok: div.length === 0 && negativos === 0, divergencias: div.slice(0, 50), saldos_negativos: negativos };
}

/** Tarefas de reabastecimento: picking vazio (ou quase) com saldo na reserva. */
export function reposicao(db) {
  const picks = db.prepare(`SELECT pp.produto_id, p.sku, p.nome, e.id AS endereco_id, e.codigo, e.cap_itens,
      COALESCE((SELECT SUM(qtd) FROM saldos_por_endereco s WHERE s.endereco_id = e.id AND s.produto_id = pp.produto_id),0) AS qtd
    FROM produto_picking pp JOIN produtos p ON p.id = pp.produto_id JOIN enderecos e ON e.id = pp.endereco_id WHERE p.ativo = 1 AND e.ativo = 1 AND e.bloqueado = 0`).all();
  const tarefas = [];
  for (const k of picks) {
    if (!(k.qtd === 0 || (k.cap_itens > 0 && k.qtd <= k.cap_itens * 0.25))) continue;
    const origem = db.prepare(`SELECT s.endereco_id, e.codigo, s.lote_id, s.qtd FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id
      LEFT JOIN lotes l ON l.id = s.lote_id WHERE s.produto_id = ? AND s.qtd > 0 AND z.tipo = 'RESERVA' ORDER BY (l.validade IS NULL), l.validade, s.qtd DESC LIMIT 1`).get(k.produto_id);
    if (!origem) continue;
    const quer = k.cap_itens > 0 ? k.cap_itens - k.qtd : origem.qtd;
    tarefas.push({ produto_id: k.produto_id, sku: k.sku, nome: k.nome, destino_id: k.endereco_id, destino: k.codigo, atual: k.qtd, origem_id: origem.endereco_id, origem: origem.codigo, lote_id: origem.lote_id, qtd: Math.min(quer, origem.qtd) });
  }
  return tarefas;
}

export function registrarEstoque(app, { db }) {
  const { rota } = app;
  const IDEM = { idempotente: true };

  for (const [nome, fn] of [['receber', receber], ['transferir', transferir], ['baixar', baixar], ['avaria', avaria]]) {
    rota('POST', `/api/estoque/${nome}`, IDEM, (ctx) => { const r = fn(db, ctx, ctx.corpo); ctx.status = 201; return r; });
  }
  rota('POST', '/api/estoque/ajustar', { ...IDEM, reauth: true }, (ctx) => { const r = ajustar(db, ctx, ctx.corpo); ctx.status = 201; return r; });

  rota('GET', '/api/estoque/onde/:produto_id', (ctx) => ondeEsta(db, Number(ctx.params.produto_id)));
  rota('GET', '/api/estoque/sugestao', (ctx) => sugerirGuardar(db, Number(ctx.query.produto_id), Math.max(1, Number(ctx.query.qtd) || 1)));
  rota('GET', '/api/estoque/integridade', () => integridade(db));
  rota('GET', '/api/reposicao', () => reposicao(db));

  rota('GET', '/api/estoque/saldos', (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 50);
    const onde = ['s.qtd > 0']; const args = [];
    if (ctx.query.produto_id) { onde.push('s.produto_id = ?'); args.push(Number(ctx.query.produto_id)); }
    if (ctx.query.endereco_id) { onde.push('s.endereco_id = ?'); args.push(Number(ctx.query.endereco_id)); }
    if (ctx.query.zona_tipo) { onde.push('z.tipo = ?'); args.push(String(ctx.query.zona_tipo)); }
    const from = `FROM saldos_por_endereco s JOIN produtos p ON p.id = s.produto_id JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id LEFT JOIN lotes l ON l.id = s.lote_id WHERE ${onde.join(' AND ')}`;
    return {
      total: db.prepare(`SELECT COUNT(*) c ${from}`).get(...args).c, pagina, por_pagina: por,
      itens: db.prepare(`SELECT s.produto_id, p.sku, p.nome, s.endereco_id, e.codigo AS endereco, z.tipo AS zona_tipo, s.lote_id, l.codigo AS lote, l.validade, s.qtd ${from} ORDER BY p.nome, e.codigo LIMIT ? OFFSET ?`).all(...args, por, offset),
    };
  });

  rota('GET', '/api/estoque/movimentos', (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 50);
    const onde = ['1=1']; const args = [];
    for (const [q, col] of [['produto_id', 'm.produto_id'], ['endereco_id', 'm.endereco_id'], ['inventario_id', 'm.inventario_id']]) if (ctx.query[q]) { onde.push(`${col} = ?`); args.push(Number(ctx.query[q])); }
    if (ctx.query.tipo) { onde.push('m.tipo = ?'); args.push(String(ctx.query.tipo)); }
    const from = `FROM movimentacoes_estoque m JOIN produtos p ON p.id = m.produto_id JOIN enderecos e ON e.id = m.endereco_id WHERE ${onde.join(' AND ')}`;
    return {
      total: db.prepare(`SELECT COUNT(*) c ${from}`).get(...args).c, pagina, por_pagina: por,
      itens: db.prepare(`SELECT m.id, m.ts, m.tipo, m.delta, m.motivo, m.documento, m.grupo, m.lote_id, p.sku, p.nome, e.codigo AS endereco ${from} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...args, por, offset),
    };
  });
}
