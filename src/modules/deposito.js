import { tx } from '../db.js';
import { conflito, erro, escaparLike, invalido, naoEncontrado, pad2, paginar } from '../util.js';
import { B, E, I, ID, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';

export const TIPOS_ZONA = ['RECEBIMENTO', 'PICKING', 'RESERVA', 'AVARIA', 'DEVOLUCAO', 'QUARENTENA', 'EXPEDICAO'];
const ZONAS_PADRAO = [
  ['R', 'Recebimento', 'RECEBIMENTO', 0], ['P', 'Picking', 'PICKING', 1], ['V', 'Reserva', 'RESERVA', 1], ['A', 'Avaria', 'AVARIA', 0],
  ['D', 'Devolução', 'DEVOLUCAO', 0], ['Q', 'Quarentena', 'QUARENTENA', 0], ['E', 'Expedição', 'EXPEDICAO', 0],
];
export const codigoEndereco = (dep, zona, rua, predio, nivel, pos) => `${dep}-${zona}-${pad2(rua)}-${pad2(predio)}-${pad2(nivel)}-${pad2(pos)}`;
/** Ordem de percurso em "S": ruas ímpares sobem os prédios, pares descem. */
export const ORDEM_ROTA = 'e.rua, CASE WHEN e.rua % 2 = 1 THEN e.predio ELSE -e.predio END, e.nivel, e.posicao';

export async function criarZonasPadrao(db, depositoId, agora) {
  for (const [codigo, nome, tipo, vendavel] of ZONAS_PADRAO) {
    const z = await db.get('INSERT INTO zonas (deposito_id, codigo, nome, tipo, vendavel) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id', depositoId, codigo, nome, tipo, vendavel);
    if (z && tipo !== 'PICKING' && tipo !== 'RESERVA') {
      const dep = (await db.get('SELECT codigo FROM depositos WHERE id = ?', depositoId)).codigo;
      await db.run('INSERT INTO enderecos (deposito_id, zona_id, codigo, rua, predio, nivel, posicao, criado_em) VALUES (?,?,?,1,1,1,1,?) ON CONFLICT DO NOTHING', depositoId, z.id, codigoEndereco(dep, codigo, 1, 1, 1, 1), agora);
    }
  }
}

/** Primeira execução: cria o depósito D1 com as zonas padrão e um endereço em cada zona de apoio. */
export async function garantirDeposito(db, agora = Date.now()) {
  if (await db.get('SELECT 1 FROM depositos LIMIT 1')) return false;
  await tx(db, async (db) => {
    const id = await db.insert('INSERT INTO depositos (codigo, nome, criado_em) VALUES (?,?,?)', 'D1', 'Depósito principal', agora);
    await criarZonasPadrao(db, id, agora);
  });
  return true;
}

export const SELECT_ENDERECO = `SELECT e.*, z.codigo AS zona, z.nome AS zona_nome, z.tipo AS zona_tipo, z.vendavel,
  COALESCE((SELECT SUM(qtd) FROM saldos_por_endereco s WHERE s.endereco_id = e.id), 0) AS qtd_total,
  (SELECT COUNT(DISTINCT produto_id) FROM saldos_por_endereco s WHERE s.endereco_id = e.id AND s.qtd > 0) AS produtos
  FROM enderecos e JOIN zonas z ON z.id = e.zona_id`;

export function registrarDeposito(app, { db }) {
  const { rota } = app;

  rota('GET', '/api/depositos', async () => {
    const deps = await db.all('SELECT * FROM depositos WHERE ativo = 1 ORDER BY codigo');
    const saida = [];
    for (const d of deps) saida.push({ ...d, zonas: await db.all('SELECT * FROM zonas WHERE deposito_id = ? ORDER BY codigo', d.id) });
    return saida;
  });
  rota('POST', '/api/depositos', async (ctx) => await tx(db, async (db) => {
    const d = validar(ctx.corpo, { codigo: T({ obrig: true, upper: true, max: 4, regex: /^[A-Z0-9]{1,4}$/, msg: 'Use 1 a 4 letras/números.' }), nome: T({ obrig: true, max: 80 }) });
    if (await db.get('SELECT 1 FROM depositos WHERE codigo = ?', d.codigo)) throw conflito('DUPLICADO', 'Já existe um depósito com esse código.');
    const id = await db.insert('INSERT INTO depositos (codigo, nome, criado_em) VALUES (?,?,?)', d.codigo, d.nome, ctx.agora());
    await criarZonasPadrao(db, id, ctx.agora());
    await auditar(db, ctx, 'DEPOSITO_CRIADO', 'deposito', id, { codigo: d.codigo });
    ctx.status = 201;
    return { id };
  }));
  rota('POST', '/api/zonas', async (ctx) => await tx(db, async (db) => {
    const d = validar(ctx.corpo, { deposito_id: ID({ obrig: true }), codigo: T({ obrig: true, upper: true, max: 3, regex: /^[A-Z]{1,3}$/, msg: 'Use 1 a 3 letras.' }), nome: T({ obrig: true, max: 60 }), tipo: E(TIPOS_ZONA, { obrig: true }) });
    if (!await db.get('SELECT 1 FROM depositos WHERE id = ?', d.deposito_id)) throw naoEncontrado('Depósito');
    if (await db.get('SELECT 1 FROM zonas WHERE deposito_id = ? AND codigo = ?', d.deposito_id, d.codigo)) throw conflito('DUPLICADO', 'Já existe uma zona com esse código.');
    const id = await db.insert('INSERT INTO zonas (deposito_id, codigo, nome, tipo, vendavel) VALUES (?,?,?,?,?)', d.deposito_id, d.codigo, d.nome, d.tipo, d.tipo === 'PICKING' || d.tipo === 'RESERVA' ? 1 : 0);
    await auditar(db, ctx, 'ZONA_CRIADA', 'zona', id);
    ctx.status = 201;
    return { id };
  }));

  rota('GET', '/api/enderecos', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 50);
    const onde = ['e.ativo = ?']; const args = [ctx.query.ativo === '0' ? 0 : 1];
    if (ctx.query.zona_id) { onde.push('e.zona_id = ?'); args.push(Number(ctx.query.zona_id)); }
    if (ctx.query.zona_tipo) { onde.push('z.tipo = ?'); args.push(String(ctx.query.zona_tipo)); }
    if (ctx.query.q) { onde.push("e.codigo LIKE ? ESCAPE '\\'"); args.push(`%${escaparLike(String(ctx.query.q).toUpperCase())}%`); }
    const sql = `SELECT * FROM (${SELECT_ENDERECO} WHERE ${onde.join(' AND ')}) AS x `;
    const filtro = ctx.query.status === 'vazio' ? 'WHERE qtd_total = 0 AND bloqueado = 0' : ctx.query.status === 'ocupado' ? 'WHERE qtd_total > 0' : ctx.query.status === 'bloqueado' ? 'WHERE bloqueado = 1' : '';
    const total = (await db.get(`SELECT COUNT(*) c FROM (${sql}${filtro}) AS y`, ...args)).c;
    const itens = await db.all(`${sql}${filtro} ORDER BY codigo LIMIT ? OFFSET ?`, ...args, por, offset);
    return { itens, total, pagina, por_pagina: por };
  });

  rota('GET', '/api/enderecos/:id', async (ctx) => {
    const e = await db.get(`${SELECT_ENDERECO} WHERE e.id = ?`, Number(ctx.params.id));
    if (!e) throw naoEncontrado('Endereço');
    const conteudo = await db.all(`SELECT s.produto_id, p.sku, p.nome, s.lote_id, l.codigo AS lote, l.validade, s.qtd FROM saldos_por_endereco s
      JOIN produtos p ON p.id = s.produto_id LEFT JOIN lotes l ON l.id = s.lote_id WHERE s.endereco_id = ? AND s.qtd > 0 ORDER BY p.nome`, e.id);
    const designado = await db.get('SELECT p.id, p.sku, p.nome FROM produto_picking pp JOIN produtos p ON p.id = pp.produto_id WHERE pp.endereco_id = ?', e.id) ?? null;
    return { ...e, conteudo, produto_designado: designado };
  });

  // Criação em massa: sem `confirmar` devolve só a prévia.
  rota('POST', '/api/enderecos/lote', async (ctx) => {
    const d = validar(ctx.corpo, {
      zona_id: ID({ obrig: true }), rua_de: I({ min: 1, max: 99, obrig: true }), rua_ate: I({ min: 1, max: 99, obrig: true }),
      predio_de: I({ min: 1, max: 99, obrig: true }), predio_ate: I({ min: 1, max: 99, obrig: true }),
      nivel_de: I({ min: 1, max: 99, obrig: true }), nivel_ate: I({ min: 1, max: 99, obrig: true }),
      pos_de: I({ min: 1, max: 99, obrig: true }), pos_ate: I({ min: 1, max: 99, obrig: true }),
      cap_itens: I({ max: 1_000_000, padrao: 0 }), cap_peso_g: I({ max: 100_000_000, padrao: 0 }), confirmar: B({ padrao: 0 }),
    });
    for (const [a, b] of [['rua_de', 'rua_ate'], ['predio_de', 'predio_ate'], ['nivel_de', 'nivel_ate'], ['pos_de', 'pos_ate']]) {
      if (d[a] > d[b]) throw invalido({ [b]: 'O final não pode ser menor que o início.' });
    }
    const total = (d.rua_ate - d.rua_de + 1) * (d.predio_ate - d.predio_de + 1) * (d.nivel_ate - d.nivel_de + 1) * (d.pos_ate - d.pos_de + 1);
    if (total > 10_000) throw invalido({ rua_ate: `Isso geraria ${total} endereços; o máximo por vez é 10.000.` });
    const z = await db.get('SELECT z.*, dp.codigo AS dep FROM zonas z JOIN depositos dp ON dp.id = z.deposito_id WHERE z.id = ?', d.zona_id);
    if (!z) throw naoEncontrado('Zona');
    const lista = [];
    for (let r = d.rua_de; r <= d.rua_ate; r++) for (let p = d.predio_de; p <= d.predio_ate; p++) for (let n = d.nivel_de; n <= d.nivel_ate; n++) for (let s = d.pos_de; s <= d.pos_ate; s++) lista.push([r, p, n, s]);
    const jaExistem = new Set((await db.all('SELECT codigo FROM enderecos WHERE zona_id = ?', z.id)).map((x) => x.codigo));
    const novos = lista.filter(([r, p, n, s]) => !jaExistem.has(codigoEndereco(z.dep, z.codigo, r, p, n, s)));
    const amostra = novos.slice(0, 8).map(([r, p, n, s]) => codigoEndereco(z.dep, z.codigo, r, p, n, s));
    if (!d.confirmar) return { previa: true, total, novos: novos.length, existentes: total - novos.length, amostra };
    await tx(db, async (db) => {
      for (const [r, p, n, s] of novos) await db.run('INSERT INTO enderecos (deposito_id, zona_id, codigo, rua, predio, nivel, posicao, cap_itens, cap_peso_g, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)', z.deposito_id, z.id, codigoEndereco(z.dep, z.codigo, r, p, n, s), r, p, n, s, d.cap_itens, d.cap_peso_g, ctx.agora());
      await auditar(db, ctx, 'ENDERECOS_CRIADOS', 'zona', z.id, { total: novos.length, zona: `${z.dep}-${z.codigo}` });
    });
    return { previa: false, total, criados: novos.length, existentes: total - novos.length, amostra };
  });

  rota('PUT', '/api/enderecos/:id', async (ctx) => await tx(db, async (db) => {
    const id = Number(ctx.params.id);
    const d = validar(ctx.corpo, { cap_itens: I({ max: 1_000_000, padrao: 0 }), cap_peso_g: I({ max: 100_000_000, padrao: 0 }), bloqueado: B({ padrao: 0 }), motivo_bloqueio: T({ max: 200 }) });
    if (d.bloqueado && !d.motivo_bloqueio) throw invalido({ motivo_bloqueio: 'Informe o motivo do bloqueio.' });
    const atual = (await db.get('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE endereco_id = ?', id)).q;
    if (d.cap_itens > 0 && d.cap_itens < atual) throw conflito('CAPACIDADE', `O endereço já tem ${atual} itens; a capacidade não pode ser menor.`);
    const r = await db.run('UPDATE enderecos SET cap_itens = ?, cap_peso_g = ?, bloqueado = ?, motivo_bloqueio = ? WHERE id = ?', d.cap_itens, d.cap_peso_g, d.bloqueado, d.bloqueado ? d.motivo_bloqueio : null, id);
    if (!r.changes) throw naoEncontrado('Endereço');
    await auditar(db, ctx, 'ENDERECO_ALTERADO', 'endereco', id, { bloqueado: d.bloqueado });
    return await db.get(`${SELECT_ENDERECO} WHERE e.id = ?`, id);
  }));
  for (const [acao, ativo] of [['inativar', 0], ['reativar', 1]]) {
    rota('POST', `/api/enderecos/:id/${acao}`, async (ctx) => await tx(db, async (db) => {
      const id = Number(ctx.params.id);
      if (!ativo) {
        const s = (await db.get('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE endereco_id = ?', id)).q;
        if (s > 0) throw conflito('ENDERECO_OCUPADO', `O endereço tem ${s} item(ns). Esvazie antes de inativar.`);
        await db.run('DELETE FROM produto_picking WHERE endereco_id = ?', id);
      }
      const r = await db.run('UPDATE enderecos SET ativo = ? WHERE id = ?', ativo, id);
      if (!r.changes) throw naoEncontrado('Endereço');
      await auditar(db, ctx, ativo ? 'ENDERECO_REATIVADO' : 'ENDERECO_INATIVADO', 'endereco', id);
      return { ativo: !!ativo };
    }));
  }

  rota('PUT', '/api/produtos/:id/picking', async (ctx) => await tx(db, async (db) => {
    const id = Number(ctx.params.id);
    const { endereco_id: eid } = validar(ctx.corpo, { endereco_id: ID() });
    if (!await db.get('SELECT 1 FROM produtos WHERE id = ?', id)) throw naoEncontrado('Produto');
    if (!eid) { await db.run('DELETE FROM produto_picking WHERE produto_id = ?', id); await auditar(db, ctx, 'PICKING_REMOVIDO', 'produto', id); return { picking: null }; }
    const e = await db.get('SELECT e.*, z.tipo FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE e.id = ?', eid);
    if (!e) throw naoEncontrado('Endereço');
    if (e.tipo !== 'PICKING') throw erro(422, 'ZONA_INVALIDA', 'O endereço de picking precisa estar numa zona de picking.');
    if (!e.ativo || e.bloqueado) throw conflito('ENDERECO_INDISPONIVEL', 'Endereço inativo ou bloqueado.');
    const dono = await db.get('SELECT p.sku FROM produto_picking pp JOIN produtos p ON p.id = pp.produto_id WHERE pp.endereco_id = ? AND pp.produto_id <> ?', eid, id);
    if (dono) throw conflito('PICKING_OCUPADO', `Este endereço já é o picking de ${dono.sku}.`);
    await db.run('INSERT INTO produto_picking (produto_id, endereco_id) VALUES (?,?) ON CONFLICT (produto_id) DO UPDATE SET endereco_id = excluded.endereco_id', id, eid);
    await auditar(db, ctx, 'PICKING_DEFINIDO', 'produto', id, { endereco: e.codigo });
    return { picking: { id: e.id, codigo: e.codigo } };
  }));

  rota('GET', '/api/mapa', async (ctx) => {
    const zona = ctx.query.zona_id ? Number(ctx.query.zona_id) : null;
    const itens = await db.all(`SELECT e.id, e.codigo, e.rua, e.predio, e.nivel, e.posicao, e.bloqueado, e.cap_itens, z.tipo AS zona_tipo,
      COALESCE((SELECT SUM(qtd) FROM saldos_por_endereco s WHERE s.endereco_id = e.id), 0) AS qtd
      FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE e.ativo = 1 ${zona ? 'AND e.zona_id = ?' : ''} ORDER BY ${ORDEM_ROTA}`, ...(zona ? [zona] : []));
    return { itens };
  });
}
