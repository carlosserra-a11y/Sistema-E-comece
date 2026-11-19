import { tx } from '../db.js';
import { conflito, erro, invalido, naoEncontrado, paginar } from '../util.js';
import { B, E, I, ID, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { mover, saldoDe } from './estoque.js';

const ultimoMov = (db) => db.prepare('SELECT COALESCE(MAX(id),0) m FROM movimentacoes_estoque').get().m;

function carregar(db, id, { aberto = false } = {}) {
  const inv = db.prepare('SELECT * FROM inventarios WHERE id = ?').get(id);
  if (!inv) throw naoEncontrado('Inventário');
  if (aberto && inv.status !== 'ABERTO') throw conflito('INVENTARIO_FECHADO', `Este inventário está ${inv.status.toLowerCase()}.`);
  return inv;
}

export function criarInventario(db, ctx, bruto) {
  const d = validar(bruto, { tipo: E(['CICLICO', 'GERAL', 'ENDERECOS'], { obrig: true }), nome: T({ max: 80 }), limite: I({ min: 1, max: 200, padrao: 10 }) });
  const ids = Array.isArray(bruto?.enderecos) ? [...new Set(bruto.enderecos.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  return tx(db, () => {
    const livres = `e.ativo = 1 AND NOT EXISTS (SELECT 1 FROM inventario_enderecos ie JOIN inventarios i ON i.id = ie.inventario_id WHERE ie.endereco_id = e.id AND i.status = 'ABERTO')`;
    const interessa = `(EXISTS (SELECT 1 FROM saldos_por_endereco s WHERE s.endereco_id = e.id AND s.qtd > 0) OR EXISTS (SELECT 1 FROM produto_picking pk WHERE pk.endereco_id = e.id))`;
    let alvo;
    if (d.tipo === 'ENDERECOS') {
      if (!ids.length || ids.length > 2000) throw invalido({ enderecos: 'Escolha de 1 a 2000 endereços.' });
      alvo = ids.map((id) => {
        const e = db.prepare(`SELECT e.id, e.codigo, (${livres}) AS livre FROM enderecos e WHERE e.id = ?`).get(id);
        if (!e) throw naoEncontrado(`Endereço ${id}`);
        if (!e.livre) throw conflito('ENDERECO_EM_INVENTARIO', `O endereço ${e.codigo} está inativo ou já está em outro inventário aberto.`);
        return e.id;
      });
    } else {
      alvo = db.prepare(`SELECT e.id FROM enderecos e WHERE ${livres} AND ${interessa} ORDER BY e.ultima_contagem_em IS NOT NULL, e.ultima_contagem_em, e.id LIMIT ?`).all(d.tipo === 'GERAL' ? 2000 : d.limite).map((r) => r.id);
    }
    if (!alvo.length) throw conflito('SEM_ENDERECOS', 'Nenhum endereço disponível para contar.');
    const r = db.prepare('INSERT INTO inventarios (nome, tipo, criado_em, criado_por) VALUES (?,?,?,?)').run(d.nome ?? `${d.tipo === 'CICLICO' ? 'Cíclico' : d.tipo === 'GERAL' ? 'Geral' : 'Por endereços'} ${new Date(ctx.agora()).toISOString().slice(0, 10)}`, d.tipo, ctx.agora(), ctx.user.id);
    const invId = Number(r.lastInsertRowid);
    for (const eid of alvo) {
      db.prepare('INSERT INTO inventario_enderecos (inventario_id, endereco_id) VALUES (?,?)').run(invId, eid);
      db.prepare('INSERT INTO inventario_itens (inventario_id, endereco_id, produto_id, lote_id, qtd_sistema) SELECT ?, endereco_id, produto_id, lote_id, qtd FROM saldos_por_endereco WHERE endereco_id = ? AND qtd > 0').run(invId, eid);
    }
    auditar(db, ctx, 'INVENTARIO_CRIADO', 'inventario', invId, { tipo: d.tipo, enderecos: alvo.length });
    return invId;
  });
}

export function contar(db, ctx, invId, bruto) {
  const d = validar(bruto, { endereco_id: ID({ obrig: true }), produto_id: ID({ obrig: true }), lote_id: I({ min: 0 }), qtd: I({ obrig: true, min: 0, max: 1_000_000 }) });
  return tx(db, () => {
    carregar(db, invId, { aberto: true });
    if (!db.prepare('SELECT 1 FROM inventario_enderecos WHERE inventario_id = ? AND endereco_id = ?').get(invId, d.endereco_id)) throw invalido({ endereco_id: 'Este endereço não faz parte do inventário.' });
    if (!db.prepare('SELECT 1 FROM produtos WHERE id = ?').get(d.produto_id)) throw naoEncontrado('Produto');
    let loteId = d.lote_id;
    if (loteId === undefined) {
      const itens = db.prepare('SELECT lote_id FROM inventario_itens WHERE inventario_id = ? AND endereco_id = ? AND produto_id = ?').all(invId, d.endereco_id, d.produto_id);
      if (itens.length > 1) throw invalido({ lote_id: 'Este produto tem mais de um lote no endereço: escolha o lote.' });
      loteId = itens[0]?.lote_id ?? 0;
    }
    const existe = db.prepare('SELECT id FROM inventario_itens WHERE inventario_id = ? AND endereco_id = ? AND produto_id = ? AND lote_id = ?').get(invId, d.endereco_id, d.produto_id, loteId);
    if (!existe) db.prepare('INSERT INTO inventario_itens (inventario_id, endereco_id, produto_id, lote_id, qtd_sistema) VALUES (?,?,?,?,?)').run(invId, d.endereco_id, d.produto_id, loteId, saldoDe(db, d.produto_id, d.endereco_id, loteId));
    db.prepare('UPDATE inventario_itens SET qtd_contada = ?, contagens = contagens + 1, mov_base = ?, contado_em = ? WHERE inventario_id = ? AND endereco_id = ? AND produto_id = ? AND lote_id = ?')
      .run(d.qtd, ultimoMov(db), ctx.agora(), invId, d.endereco_id, d.produto_id, loteId);
    db.prepare('UPDATE inventario_enderecos SET concluido = 0 WHERE inventario_id = ? AND endereco_id = ?').run(invId, d.endereco_id);
    const it = db.prepare('SELECT * FROM inventario_itens WHERE inventario_id = ? AND endereco_id = ? AND produto_id = ? AND lote_id = ?').get(invId, d.endereco_id, d.produto_id, loteId);
    return { ...it, diferenca: it.qtd_contada - it.qtd_sistema };
  });
}

function detalhe(db, invId) {
  const inv = carregar(db, invId);
  const fechado = inv.status !== 'ABERTO';
  const enderecos = db.prepare(`SELECT ie.endereco_id, e.codigo, ie.concluido,
    (SELECT COUNT(*) FROM inventario_itens i WHERE i.inventario_id = ie.inventario_id AND i.endereco_id = ie.endereco_id) AS itens,
    (SELECT COUNT(*) FROM inventario_itens i WHERE i.inventario_id = ie.inventario_id AND i.endereco_id = ie.endereco_id AND i.qtd_contada IS NOT NULL) AS contados
    FROM inventario_enderecos ie JOIN enderecos e ON e.id = ie.endereco_id WHERE ie.inventario_id = ? ORDER BY e.codigo`).all(invId);
  // Contagem cega: o saldo do sistema só aparece depois que o item foi contado.
  const itens = db.prepare(`SELECT i.id, i.endereco_id, e.codigo AS endereco, i.produto_id, p.sku, p.nome, i.lote_id, l.codigo AS lote, i.contagens, i.qtd_contada,
      CASE WHEN i.qtd_contada IS NOT NULL OR ? = 1 THEN i.qtd_sistema END AS qtd_sistema,
      CASE WHEN i.qtd_contada IS NOT NULL THEN i.qtd_contada - i.qtd_sistema END AS diferenca
    FROM inventario_itens i JOIN enderecos e ON e.id = i.endereco_id JOIN produtos p ON p.id = i.produto_id LEFT JOIN lotes l ON l.id = i.lote_id
    WHERE i.inventario_id = ? ORDER BY e.codigo, p.nome`).all(fechado ? 1 : 0, invId);
  const contados = itens.filter((i) => i.qtd_contada !== null);
  return {
    ...inv, enderecos, itens,
    resumo: { itens: itens.length, contados: contados.length, pendentes: itens.length - contados.length, divergentes: contados.filter((i) => i.diferenca !== 0).length, diferenca_abs: contados.reduce((a, i) => a + Math.abs(i.diferenca), 0) },
  };
}

export function aprovar(db, ctx, invId, { ignorarPendentes = false } = {}) {
  return tx(db, () => {
    const inv = carregar(db, invId, { aberto: true });
    const itens = db.prepare('SELECT * FROM inventario_itens WHERE inventario_id = ?').all(invId);
    const pendentes = itens.filter((i) => i.qtd_contada === null);
    if (pendentes.length && !ignorarPendentes) throw conflito('PENDENTES', `Faltam ${pendentes.length} item(ns) a contar. Conte tudo ou aprove ignorando os pendentes.`);
    const contados = itens.filter((i) => i.qtd_contada !== null);
    const conflitos = contados.filter((i) => db.prepare('SELECT 1 FROM movimentacoes_estoque WHERE id > ? AND produto_id = ? AND endereco_id = ? AND lote_id = ? LIMIT 1').get(i.mov_base, i.produto_id, i.endereco_id, i.lote_id));
    if (conflitos.length) {
      const nomes = conflitos.slice(0, 5).map((i) => db.prepare('SELECT p.sku || \' em \' || e.codigo AS n FROM produtos p, enderecos e WHERE p.id = ? AND e.id = ?').get(i.produto_id, i.endereco_id).n);
      throw conflito('MOVIMENTO_APOS_CONTAGEM', `Houve movimentação depois da contagem (${nomes.join('; ')}). Conte esses itens de novo.`);
    }
    let ajustes = 0; let diferencaAbs = 0;
    for (const i of contados) {
      const atual = saldoDe(db, i.produto_id, i.endereco_id, i.lote_id);
      const delta = i.qtd_contada - atual;
      if (delta === 0) continue;
      mover(db, ctx, { tipo: 'INVENTARIO', produto_id: i.produto_id, endereco_id: i.endereco_id, lote_id: i.lote_id, delta, motivo: `Inventário #${invId}`, inventario_id: invId });
      db.prepare('UPDATE inventario_itens SET ajuste_em = ? WHERE id = ?').run(ctx.agora(), i.id);
      ajustes++; diferencaAbs += Math.abs(delta);
    }
    const totaisPorEndereco = new Map();
    for (const i of itens) { const x = totaisPorEndereco.get(i.endereco_id) ?? { total: 0, contados: 0 }; x.total++; if (i.qtd_contada !== null) x.contados++; totaisPorEndereco.set(i.endereco_id, x); }
    for (const e of db.prepare('SELECT endereco_id, concluido FROM inventario_enderecos WHERE inventario_id = ?').all(invId)) {
      const x = totaisPorEndereco.get(e.endereco_id) ?? { total: 0, contados: 0 };
      if (e.concluido || (x.total > 0 && x.total === x.contados)) db.prepare('UPDATE enderecos SET ultima_contagem_em = ? WHERE id = ?').run(ctx.agora(), e.endereco_id);
    }
    db.prepare("UPDATE inventarios SET status = 'APROVADO', fechado_em = ?, aprovado_por = ? WHERE id = ?").run(ctx.agora(), ctx.user.id, invId);
    auditar(db, ctx, 'INVENTARIO_APROVADO', 'inventario', invId, { itens: contados.length, ajustes, diferenca_abs: diferencaAbs, auto_aprovacao: inv.criado_por === ctx.user.id });
    return { ajustes, diferenca_abs: diferencaAbs, ignorados: pendentes.length };
  });
}

export function registrarInventario(app, { db }) {
  const { rota } = app;
  rota('GET', '/api/inventarios', (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 20);
    return {
      total: db.prepare('SELECT COUNT(*) c FROM inventarios').get().c, pagina, por_pagina: por,
      itens: db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM inventario_enderecos ie WHERE ie.inventario_id = i.id) AS enderecos FROM inventarios i ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(por, offset),
    };
  });
  rota('POST', '/api/inventarios', (ctx) => { const id = criarInventario(db, ctx, ctx.corpo); ctx.status = 201; return detalhe(db, id); });
  rota('GET', '/api/inventarios/:id', (ctx) => detalhe(db, Number(ctx.params.id)));
  rota('POST', '/api/inventarios/:id/contar', (ctx) => contar(db, ctx, Number(ctx.params.id), ctx.corpo));
  rota('POST', '/api/inventarios/:id/vazio', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    carregar(db, id, { aberto: true });
    const { endereco_id: eid } = validar(ctx.corpo, { endereco_id: ID({ obrig: true }) });
    if (!db.prepare('SELECT 1 FROM inventario_enderecos WHERE inventario_id = ? AND endereco_id = ?').get(id, eid)) throw invalido({ endereco_id: 'Endereço fora do inventário.' });
    const r = db.prepare('UPDATE inventario_itens SET qtd_contada = 0, contagens = contagens + 1, mov_base = ?, contado_em = ? WHERE inventario_id = ? AND endereco_id = ? AND qtd_contada IS NULL').run(ultimoMov(db), ctx.agora(), id, eid);
    db.prepare('UPDATE inventario_enderecos SET concluido = 1 WHERE inventario_id = ? AND endereco_id = ?').run(id, eid);
    auditar(db, ctx, 'INVENTARIO_ENDERECO_VAZIO', 'inventario', id, { endereco_id: eid, itens: r.changes });
    return { zerados: r.changes };
  }));
  rota('POST', '/api/inventarios/:id/concluir-endereco', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    carregar(db, id, { aberto: true });
    const { endereco_id: eid } = validar(ctx.corpo, { endereco_id: ID({ obrig: true }) });
    const pend = db.prepare('SELECT COUNT(*) c FROM inventario_itens WHERE inventario_id = ? AND endereco_id = ? AND qtd_contada IS NULL').get(id, eid).c;
    if (pend) throw conflito('PENDENTES', `Faltam ${pend} item(ns) neste endereço. Conte-os ou marque o endereço como vazio.`);
    const r = db.prepare('UPDATE inventario_enderecos SET concluido = 1 WHERE inventario_id = ? AND endereco_id = ?').run(id, eid);
    if (!r.changes) throw invalido({ endereco_id: 'Endereço fora do inventário.' });
    return { concluido: true };
  }));
  rota('POST', '/api/inventarios/:id/aprovar', { reauth: true }, (ctx) => {
    const { ignorar_pendentes: ig } = validar(ctx.corpo, { ignorar_pendentes: B({ padrao: 0 }) });
    return aprovar(db, ctx, Number(ctx.params.id), { ignorarPendentes: !!ig });
  });
  rota('POST', '/api/inventarios/:id/cancelar', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    carregar(db, id, { aberto: true });
    db.prepare("UPDATE inventarios SET status = 'CANCELADO', fechado_em = ? WHERE id = ?").run(ctx.agora(), id);
    auditar(db, ctx, 'INVENTARIO_CANCELADO', 'inventario', id);
    return { cancelado: true };
  }));
}
