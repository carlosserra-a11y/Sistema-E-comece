import { tx } from '../db.js';
import { erro, invalido, naoEncontrado, paginar } from '../util.js';
import { B, E, I, ID, T, validar } from '../validate.js';
import { auditar, verificarCadeia } from '../security/audit.js';
import { validarGtin, variantes } from '../barcode/gtin.js';
import { bitsLinear, SILENCIO } from '../barcode/linear.js';
import { FORMATOS, avisosEtiqueta, esc, etiquetaEndereco, etiquetaLote, etiquetaProduto, svgEtiqueta, zplEtiqueta } from '../barcode/etiqueta.js';
import { ENDERECO_RE, gerarCodigoInterno } from './catalogo.js';
import { integridade, ondeEsta } from './estoque.js';
import { SELECT_ENDERECO } from './deposito.js';

/** Limpa o que leitores e teclados costumam adicionar: CR/LF, prefixo AIM (]E0, ]C1...), travessões "bonitos". */
export function normalizarLeitura(bruto) {
  return String(bruto ?? '')
    .replace(/[\u0000-\u001f\u007f​-‏﻿]/g, '')
    .replace(/[‐-―−﹣－]/g, '-')
    .trim()
    .replace(/^\][A-Za-z][0-9A-Za-z]/, '');
}

export function resolverLeitura(db, bruto) {
  const c = normalizarLeitura(bruto);
  if (!c) return { tipo: 'VAZIO', codigo: '' };
  const maius = c.toUpperCase();
  if (ENDERECO_RE.test(maius)) {
    const e = db.prepare(`${SELECT_ENDERECO} WHERE e.codigo = ?`).get(maius);
    return e ? { tipo: 'ENDERECO', codigo: maius, endereco: e } : { tipo: 'DESCONHECIDO', codigo: maius, dica: 'Endereço não cadastrado.' };
  }
  const lt = /^LT-(\d{6})$/.exec(maius);
  if (lt) {
    const l = db.prepare('SELECT l.*, p.sku, p.nome FROM lotes l JOIN produtos p ON p.id = l.produto_id WHERE l.id = ?').get(Number(lt[1]));
    return l ? { tipo: 'LOTE', codigo: maius, lote: l } : { tipo: 'DESCONHECIDO', codigo: maius, dica: 'Lote não encontrado.' };
  }
  const vs = variantes(maius);
  const achado = db.prepare(`SELECT p.id FROM codigos_barras c JOIN produtos p ON p.id = c.produto_id WHERE c.codigo IN (${vs.map(() => '?').join(',')})`).get(...vs)
    ?? db.prepare('SELECT id FROM produtos WHERE sku = ?').get(maius);
  if (achado) {
    const onde = ondeEsta(db, achado.id);
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(achado.id);
    return { tipo: 'PRODUTO', codigo: maius, produto: p, ...onde, picking: db.prepare('SELECT e.id, e.codigo FROM produto_picking pp JOIN enderecos e ON e.id = pp.endereco_id WHERE pp.produto_id = ?').get(achado.id) ?? null };
  }
  let dica = 'Código não cadastrado.';
  if (/^\d+$/.test(maius)) { const g = validarGtin(maius); if (!g.valido) dica = `Leitura suspeita: ${g.motivo} Tente ler de novo.`; }
  return { tipo: 'DESCONHECIDO', codigo: maius, dica };
}

function modeloDe(db, item, formato) {
  if (item.tipo === 'produto') {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(item.id);
    if (!p) throw naoEncontrado('Produto');
    const cod = item.codigo_id
      ? db.prepare('SELECT codigo, tipo FROM codigos_barras WHERE id = ? AND produto_id = ?').get(item.codigo_id, p.id)
      : db.prepare('SELECT codigo, tipo FROM codigos_barras WHERE produto_id = ? ORDER BY principal DESC, id LIMIT 1').get(p.id);
    if (!cod) throw erro(409, 'SEM_CODIGO', `O produto ${p.sku} ainda não tem código de barras. Gere um código antes de etiquetar.`);
    return etiquetaProduto(p, cod, formato);
  }
  if (item.tipo === 'endereco') {
    const e = db.prepare('SELECT e.*, z.nome AS zona FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE e.id = ?').get(item.id);
    if (!e) throw naoEncontrado('Endereço');
    return etiquetaEndereco(e, formato);
  }
  if (item.tipo === 'lote') {
    const l = db.prepare('SELECT * FROM lotes WHERE id = ?').get(item.id);
    if (!l) throw naoEncontrado('Lote');
    return etiquetaLote(l, db.prepare('SELECT * FROM produtos WHERE id = ?').get(l.produto_id), formato);
  }
  throw invalido({ tipo: 'Use produto, endereco ou lote.' });
}

export function registrarConsultas(app, { db, cfg }) {
  const { rota } = app;
  const FORMATO = E(Object.keys(FORMATOS), { padrao: '50x30' });

  rota('GET', '/api/scan', (ctx) => resolverLeitura(db, ctx.query.codigo));

  rota('GET', '/api/etiquetas/svg', (ctx) => {
    const q = validar({ ...ctx.query, id: ctx.query.id, codigo_id: ctx.query.codigo_id }, { tipo: E(['produto', 'endereco', 'lote'], { obrig: true }), id: ID({ obrig: true }), codigo_id: ID(), formato: FORMATO });
    const modelo = modeloDe(db, q, q.formato);
    return { _raw: true, tipo: 'image/svg+xml; charset=utf-8', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Etiqueta-Avisos': encodeURIComponent(avisosEtiqueta(modelo).join(' ')) }, corpo: svgEtiqueta(modelo) };
  });

  rota('POST', '/api/etiquetas/zpl', (ctx) => {
    const { formato, gerar_codigo: gerar } = validar(ctx.corpo, { formato: FORMATO, gerar_codigo: B({ padrao: 0 }) });
    const itens = Array.isArray(ctx.corpo.itens) ? ctx.corpo.itens.slice(0, 500) : [];
    if (!itens.length) throw invalido({ itens: 'Escolha pelo menos um item.' });
    return tx(db, () => {
      const saida = []; const avisos = new Set(); let total = 0;
      for (const bruto of itens) {
        const it = validar(bruto, { tipo: E(['produto', 'endereco', 'lote'], { obrig: true }), id: ID({ obrig: true }), codigo_id: ID(), copias: I({ min: 1, max: 999, padrao: 1 }) });
        if (it.tipo === 'produto' && gerar && !db.prepare('SELECT 1 FROM codigos_barras WHERE produto_id = ?').get(it.id)) gerarCodigoInterno(db, ctx, it.id);
        const modelo = modeloDe(db, it, formato);
        avisosEtiqueta(modelo).forEach((a) => avisos.add(a));
        saida.push(zplEtiqueta(modelo, it.copias));
        total += it.copias;
      }
      auditar(db, ctx, 'ETIQUETAS_GERADAS', 'etiqueta', null, { itens: itens.length, copias: total, formato });
      return { zpl: saida.join('\n'), etiquetas: total, avisos: [...avisos] };
    });
  });

  // Imagem de código de barras avulsa (ex.: pré-visualização). Só renderiza; não grava nada.
  rota('GET', '/api/barcode.svg', (ctx) => {
    const sim = ['code128', 'ean13', 'ean8', 'upca'].includes(ctx.query.sim) ? ctx.query.sim : 'code128';
    const dados = String(ctx.query.dados ?? '').slice(0, 60);
    let bits;
    try { bits = bitsLinear(sim, dados); } catch (e) { throw invalido({ dados: e.message }); }
    const q = SILENCIO[sim]; const alt = 40;
    let d = '';
    for (let i = 0; i < bits.length;) { if (bits[i] !== '1') { i++; continue; } let j = i; while (j < bits.length && bits[j] === '1') j++; d += `M${i + q} 0h${j - i}v${alt}h-${j - i}z`; i = j; }
    const w = bits.length + 2 * q;
    return { _raw: true, tipo: 'image/svg+xml; charset=utf-8', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
      corpo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${alt + 8}" width="${w * 2}" height="${(alt + 8) * 2}"><rect width="${w}" height="${alt + 8}" fill="#fff"/><path d="${d}" fill="#000" shape-rendering="crispEdges"/><text x="${w / 2}" y="${alt + 6}" font-size="6" font-family="monospace" text-anchor="middle">${esc(dados)}</text></svg>` };
  });

  rota('GET', '/api/painel', (ctx) => {
    const um = (sql, ...a) => db.prepare(sql).get(...a);
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
    const hoje = fmt.format(new Date(ctx.agora()));
    const inicioHoje = Date.parse(`${hoje}T00:00:00-03:00`);
    const base = `SELECT * FROM (SELECT p.id, p.sku, p.nome, p.estoque_min,
      COALESCE((SELECT SUM(s.qtd) FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id WHERE s.produto_id = p.id AND z.vendavel = 1),0) AS vendavel FROM produtos p WHERE p.ativo = 1)`;
    const serie = db.prepare(`SELECT strftime('%Y-%m-%d', (ts - 10800000) / 1000, 'unixepoch') AS dia, COUNT(*) AS n FROM movimentacoes_estoque WHERE ts >= ? GROUP BY dia ORDER BY dia`).all(inicioHoje - 13 * 86400000);
    const mapa = new Map(serie.map((s) => [s.dia, s.n]));
    const dias = Array.from({ length: 14 }, (_, i) => { const dia = fmt.format(new Date(inicioHoje + 12 * 3600000 - (13 - i) * 86400000)); return { dia, n: mapa.get(dia) ?? 0 }; });
    return {
      produtos_ativos: um('SELECT COUNT(*) c FROM produtos WHERE ativo = 1').c,
      sem_codigo: um('SELECT COUNT(*) c FROM produtos WHERE ativo = 1 AND NOT EXISTS (SELECT 1 FROM codigos_barras c WHERE c.produto_id = produtos.id)').c,
      unidades: um('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco').q,
      enderecos: um('SELECT COUNT(*) c FROM enderecos WHERE ativo = 1').c,
      enderecos_ocupados: um('SELECT COUNT(DISTINCT endereco_id) c FROM saldos_por_endereco WHERE qtd > 0').c,
      abaixo_minimo: db.prepare(`${base} WHERE estoque_min > 0 AND vendavel < estoque_min ORDER BY (vendavel * 1.0 / estoque_min) LIMIT 6`).all(),
      abaixo_minimo_total: um(`SELECT COUNT(*) c FROM (${base} WHERE estoque_min > 0 AND vendavel < estoque_min)`).c,
      zerados: um(`SELECT COUNT(*) c FROM (${base} WHERE vendavel = 0)`).c,
      movimentos_hoje: um('SELECT COUNT(*) c FROM movimentacoes_estoque WHERE ts >= ?', inicioHoje).c,
      serie_movimentos: dias,
      inventarios_abertos: um("SELECT COUNT(*) c FROM inventarios WHERE status = 'ABERTO'").c,
      vencendo_30d: um(`SELECT COUNT(DISTINCT l.id) c FROM lotes l JOIN saldos_por_endereco s ON s.lote_id = l.id AND s.qtd > 0 WHERE l.validade IS NOT NULL AND l.validade <= date(?, '+30 day')`, hoje).c,
      integridade: integridade(db).ok,
      atividade: db.prepare('SELECT id, ts, acao, entidade, entidade_id FROM auditoria ORDER BY id DESC LIMIT 8').all(),
    };
  });

  rota('GET', '/api/auditoria', (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 50);
    return {
      total: db.prepare('SELECT COUNT(*) c FROM auditoria').get().c, pagina, por_pagina: por,
      itens: db.prepare('SELECT id, ts, user_id, acao, entidade, entidade_id, detalhes, ip FROM auditoria ORDER BY id DESC LIMIT ? OFFSET ?').all(por, offset),
    };
  });
  rota('GET', '/api/auditoria/verificar', () => verificarCadeia(db));
}
