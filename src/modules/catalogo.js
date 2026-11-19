import { tx } from '../db.js';
import { conflito, erro, escaparLike, invalido, naoEncontrado, normalizarTexto, paginar, celulaCsv } from '../util.js';
import { B, E, I, ID, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { cifrar, hmacHex } from '../security/crypto.js';
import { ean13Interno, validarGtin, variantes } from '../barcode/gtin.js';

export const SKU_RE = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
export const ENDERECO_RE = /^[A-Z0-9]{1,4}-[A-Z]{1,3}-\d{2}-\d{2}-\d{2}-\d{2}$/;
const CODIGO_LIVRE_RE = /^[A-Z0-9][A-Z0-9._-]{2,39}$/;
const sim = (v) => (v ? 1 : 0);

const ESPEC = {
  sku: T({ obrig: true, upper: true, max: 40, regex: SKU_RE, msg: 'Use letras, números, ponto, hífen ou sublinhado (até 40).' }),
  nome: T({ obrig: true, min: 2, max: 160 }),
  descricao: T({ max: 2000 }), marca: T({ max: 80 }), categoria: T({ max: 80 }),
  unidade: E(['UN', 'CX', 'KG', 'PC', 'PAR', 'LT', 'MT'], { padrao: 'UN' }),
  ncm: T({ regex: /^\d{8}$/, msg: 'NCM tem 8 dígitos.' }),
  custo_centavos: I({ max: 100_000_000_00, padrao: 0 }), preco_centavos: I({ max: 100_000_000_00, padrao: 0 }),
  peso_g: I({ max: 1_000_000, padrao: 0 }), comp_mm: I({ max: 100_000, padrao: 0 }), larg_mm: I({ max: 100_000, padrao: 0 }), alt_mm: I({ max: 100_000, padrao: 0 }),
  estoque_min: I({ max: 10_000_000, padrao: 0 }), estoque_max: I({ max: 10_000_000, padrao: 0 }), ponto_pedido: I({ max: 10_000_000, padrao: 0 }),
  controla_lote: B({ padrao: 0 }), controla_validade: B({ padrao: 0 }), fornecedor_id: ID(),
};
const CAMPOS = Object.keys(ESPEC);

export function cpfCnpjValido(d) {
  if (!/^\d+$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (base, pesos) => { const s = [...base].reduce((a, c, i) => a + Number(c) * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  if (d.length === 11) return dv(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[9] && dv(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[10];
  if (d.length === 14) return dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[12] && dv(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[13];
  return false;
}

/** Garante que um identificador (SKU ou código) não é ambíguo com outro produto na hora da leitura. */
export function colisao(db, valor, { ignorarProduto = null, ehSku = false } = {}) {
  const vs = variantes(valor);
  const ph = vs.map(() => '?').join(',');
  const porSku = db.prepare(`SELECT id, sku FROM produtos WHERE sku IN (${ph})`).get(...vs);
  if (porSku && porSku.id !== ignorarProduto && !(ehSku && porSku.sku === valor && porSku.id === ignorarProduto)) return `Já é o SKU do produto ${porSku.sku}.`;
  const porCodigo = db.prepare(`SELECT c.produto_id, p.sku FROM codigos_barras c JOIN produtos p ON p.id = c.produto_id WHERE c.codigo IN (${ph})`).get(...vs);
  if (porCodigo && porCodigo.produto_id !== ignorarProduto) return `Já é um código do produto ${porCodigo.sku}.`;
  return null;
}

function inserirCodigo(db, ctx, produtoId, codigo, origem) {
  let tipo;
  if (/^\d+$/.test(codigo)) {
    const g = validarGtin(codigo);
    if (!g.valido) throw invalido({ codigo: g.motivo }, g.motivo);
    tipo = g.tipo;
  } else {
    if (!CODIGO_LIVRE_RE.test(codigo) || ENDERECO_RE.test(codigo) || codigo.startsWith('LT-')) {
      throw invalido({ codigo: 'Código livre: 3 a 40 caracteres (A–Z, 0–9, . _ -), sem parecer endereço ou lote.' });
    }
    tipo = 'CODE128';
  }
  const col = colisao(db, codigo, { ignorarProduto: produtoId });
  if (col) throw conflito('CODIGO_DUPLICADO', col);
  const tem = db.prepare('SELECT COUNT(*) c FROM codigos_barras WHERE produto_id = ?').get(produtoId).c;
  const r = db.prepare('INSERT INTO codigos_barras (produto_id, codigo, tipo, origem, principal, criado_em) VALUES (?,?,?,?,?,?)')
    .run(produtoId, codigo, tipo, origem, tem === 0 ? 1 : 0, ctx.agora());
  auditar(db, ctx, 'CODIGO_ADICIONADO', 'produto', produtoId, { tipo, origem });
  return { id: Number(r.lastInsertRowid), codigo, tipo, origem, principal: tem === 0 };
}

export function gerarCodigoInterno(db, ctx, produtoId) {
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    db.prepare("INSERT INTO sequencias (nome, valor) VALUES ('ean_interno', 1) ON CONFLICT (nome) DO UPDATE SET valor = valor + 1").run();
    const codigo = ean13Interno(db.prepare("SELECT valor FROM sequencias WHERE nome = 'ean_interno'").get().valor);
    if (!colisao(db, codigo)) return inserirCodigo(db, ctx, produtoId, codigo, 'INTERNO');
  }
  throw erro(500, 'SEQUENCIA', 'Não foi possível gerar um código livre.');
}

const SELECT_PRODUTO = `SELECT p.*,
  (SELECT codigo FROM codigos_barras c WHERE c.produto_id = p.id ORDER BY principal DESC, id LIMIT 1) AS codigo_principal,
  COALESCE((SELECT SUM(s.qtd) FROM saldos_por_endereco s WHERE s.produto_id = p.id), 0) AS saldo_total,
  COALESCE((SELECT SUM(s.qtd) FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id WHERE s.produto_id = p.id AND z.vendavel = 1), 0) AS saldo_vendavel
  FROM produtos p`;

const buscaDe = (d) => normalizarTexto(`${d.sku} ${d.nome} ${d.marca ?? ''} ${d.categoria ?? ''}`);

export function criarProduto(db, ctx, bruto, { gerarCodigo = false, codigo = null } = {}) {
  const d = validar(bruto, ESPEC);
  return tx(db, () => {
    const col = colisao(db, d.sku, { ehSku: true });
    if (col) throw conflito('SKU_DUPLICADO', `SKU em conflito: ${col}`);
    if (d.fornecedor_id && !db.prepare('SELECT 1 FROM fornecedores WHERE id = ? AND ativo = 1').get(d.fornecedor_id)) throw invalido({ fornecedor_id: 'Fornecedor inexistente ou inativo.' });
    if (d.estoque_max && d.estoque_max < d.estoque_min) throw invalido({ estoque_max: 'O máximo não pode ser menor que o mínimo.' });
    const t = ctx.agora();
    const vals = CAMPOS.map((c) => d[c] ?? null);
    const r = db.prepare(`INSERT INTO produtos (${CAMPOS.join(',')}, busca, criado_em, atualizado_em) VALUES (${CAMPOS.map(() => '?').join(',')},?,?,?)`).run(...vals, buscaDe(d), t, t);
    const id = Number(r.lastInsertRowid);
    auditar(db, ctx, 'PRODUTO_CRIADO', 'produto', id, { sku: d.sku });
    if (codigo) inserirCodigo(db, ctx, id, codigo, 'FABRICANTE');
    else if (gerarCodigo) gerarCodigoInterno(db, ctx, id);
    return id;
  });
}

export function registrarCatalogo(app, { cfg, db }) {
  const { rota } = app;

  rota('GET', '/api/produtos', (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query);
    const onde = []; const args = [];
    const q = String(ctx.query.q ?? '').trim();
    if (q) {
      const vs = variantes(q.toUpperCase());
      onde.push(`(p.busca LIKE ? ESCAPE '\\' OR p.sku = ? OR p.id IN (SELECT produto_id FROM codigos_barras WHERE codigo IN (${vs.map(() => '?').join(',')})))`);
      args.push(`%${escaparLike(normalizarTexto(q))}%`, q.toUpperCase(), ...vs);
    }
    if (ctx.query.ativo !== 'todos') { onde.push('p.ativo = ?'); args.push(ctx.query.ativo === '0' ? 0 : 1); }
    if (ctx.query.sem_codigo === '1') onde.push('NOT EXISTS (SELECT 1 FROM codigos_barras c WHERE c.produto_id = p.id)');
    const having = ctx.query.abaixo_minimo === '1' ? 'WHERE saldo_vendavel < estoque_min AND estoque_min > 0' : ctx.query.zerados === '1' ? 'WHERE saldo_vendavel = 0' : '';
    const base = `SELECT * FROM (${SELECT_PRODUTO} ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''}) ${having}`;
    const total = db.prepare(`SELECT COUNT(*) c FROM (${base})`).get(...args).c;
    const itens = db.prepare(`${base} ORDER BY nome COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, por, offset);
    return { itens, total, pagina, por_pagina: por };
  });

  const detalhe = (id) => {
    const p = db.prepare(`${SELECT_PRODUTO} WHERE p.id = ?`).get(id);
    if (!p) throw naoEncontrado('Produto');
    return {
      ...p,
      codigos: db.prepare('SELECT id, codigo, tipo, origem, principal FROM codigos_barras WHERE produto_id = ? ORDER BY principal DESC, id').all(id),
      saldos: db.prepare(`SELECT s.endereco_id, e.codigo AS endereco, z.tipo AS zona_tipo, z.vendavel, s.lote_id, l.codigo AS lote, l.validade, s.qtd
        FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id LEFT JOIN lotes l ON l.id = s.lote_id
        WHERE s.produto_id = ? AND s.qtd > 0 ORDER BY z.tipo, e.codigo`).all(id),
      picking: db.prepare('SELECT e.id, e.codigo FROM produto_picking pp JOIN enderecos e ON e.id = pp.endereco_id WHERE pp.produto_id = ?').get(id) ?? null,
      fornecedor: p.fornecedor_id ? db.prepare('SELECT id, nome FROM fornecedores WHERE id = ?').get(p.fornecedor_id) : null,
    };
  };
  rota('GET', '/api/produtos/:id', (ctx) => detalhe(Number(ctx.params.id)));

  rota('POST', '/api/produtos', (ctx) => {
    const { gerar_codigo: gerar, codigo_barras: codigo } = validar(ctx.corpo, { gerar_codigo: B({ padrao: 0 }), codigo_barras: T({ max: 40, upper: true }) });
    ctx.status = 201;
    return detalhe(criarProduto(db, ctx, ctx.corpo, { gerarCodigo: !!gerar, codigo }));
  });

  rota('PUT', '/api/produtos/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const d = validar(ctx.corpo, { ...ESPEC, versao: I({ obrig: true, min: 1 }) });
    return tx(db, () => {
      const atual = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
      if (!atual) throw naoEncontrado('Produto');
      if (d.sku !== atual.sku) {
        const col = colisao(db, d.sku, { ignorarProduto: id });
        if (col) throw conflito('SKU_DUPLICADO', `SKU em conflito: ${col}`);
      }
      if (d.estoque_max && d.estoque_max < d.estoque_min) throw invalido({ estoque_max: 'O máximo não pode ser menor que o mínimo.' });
      const r = db.prepare(`UPDATE produtos SET ${CAMPOS.map((c) => `${c} = ?`).join(',')}, busca = ?, versao = versao + 1, atualizado_em = ? WHERE id = ? AND versao = ?`)
        .run(...CAMPOS.map((c) => d[c] ?? null), buscaDe(d), ctx.agora(), id, d.versao);
      if (!r.changes) throw conflito('VERSAO', 'Este produto foi alterado em outra tela. Recarregue e tente de novo.');
      auditar(db, ctx, 'PRODUTO_ALTERADO', 'produto', id);
      return detalhe(id);
    });
  });

  for (const [acao, ativo] of [['inativar', 0], ['reativar', 1]]) {
    rota('POST', `/api/produtos/:id/${acao}`, (ctx) => tx(db, () => {
      const id = Number(ctx.params.id);
      if (!ativo) {
        const s = db.prepare('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE produto_id = ?').get(id).q;
        if (s > 0) throw conflito('COM_ESTOQUE', `Há ${s} unidade(s) em estoque. Zere o estoque antes de inativar.`);
      }
      const r = db.prepare('UPDATE produtos SET ativo = ?, versao = versao + 1, atualizado_em = ? WHERE id = ?').run(ativo, ctx.agora(), id);
      if (!r.changes) throw naoEncontrado('Produto');
      auditar(db, ctx, ativo ? 'PRODUTO_REATIVADO' : 'PRODUTO_INATIVADO', 'produto', id);
      return detalhe(id);
    }));
  }

  rota('POST', '/api/produtos/:id/codigos', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    if (!db.prepare('SELECT 1 FROM produtos WHERE id = ?').get(id)) throw naoEncontrado('Produto');
    const { codigo } = validar(ctx.corpo, { codigo: T({ obrig: true, upper: true, max: 40 }) });
    ctx.status = 201;
    return inserirCodigo(db, ctx, id, codigo.replace(/\s+/g, ''), 'FABRICANTE');
  }));
  rota('POST', '/api/produtos/:id/codigos/gerar', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    const p = db.prepare('SELECT id, ativo FROM produtos WHERE id = ?').get(id);
    if (!p) throw naoEncontrado('Produto');
    ctx.status = 201;
    return gerarCodigoInterno(db, ctx, id);
  }));
  rota('POST', '/api/produtos/:id/codigos/:cid/principal', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    if (!db.prepare('SELECT 1 FROM codigos_barras WHERE id = ? AND produto_id = ?').get(Number(ctx.params.cid), id)) throw naoEncontrado('Código');
    db.prepare('UPDATE codigos_barras SET principal = 0 WHERE produto_id = ?').run(id);
    db.prepare('UPDATE codigos_barras SET principal = 1 WHERE id = ?').run(Number(ctx.params.cid));
    auditar(db, ctx, 'CODIGO_PRINCIPAL', 'produto', id);
    return detalhe(id);
  }));
  rota('DELETE', '/api/produtos/:id/codigos/:cid', (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    const c = db.prepare('SELECT * FROM codigos_barras WHERE id = ? AND produto_id = ?').get(Number(ctx.params.cid), id);
    if (!c) throw naoEncontrado('Código');
    db.prepare('DELETE FROM codigos_barras WHERE id = ?').run(c.id);
    if (c.principal) {
      const outro = db.prepare('SELECT id FROM codigos_barras WHERE produto_id = ? ORDER BY id LIMIT 1').get(id);
      if (outro) db.prepare('UPDATE codigos_barras SET principal = 1 WHERE id = ?').run(outro.id);
    }
    auditar(db, ctx, 'CODIGO_REMOVIDO', 'produto', id, { tipo: c.tipo, origem: c.origem });
    return detalhe(id);
  }));

  // Etiquetar tudo que ainda não tem código: prévia e execução.
  rota('POST', '/api/codigos/gerar-faltantes', (ctx) => {
    const { confirmar } = validar(ctx.corpo, { confirmar: B({ padrao: 0 }) });
    return tx(db, () => {
      const faltam = db.prepare('SELECT id, sku, nome FROM produtos WHERE ativo = 1 AND NOT EXISTS (SELECT 1 FROM codigos_barras c WHERE c.produto_id = produtos.id) ORDER BY id LIMIT 500').all();
      if (!confirmar) return { previa: true, total: faltam.length, amostra: faltam.slice(0, 10) };
      const gerados = faltam.map((p) => ({ produto_id: p.id, sku: p.sku, codigo: gerarCodigoInterno(db, ctx, p.id).codigo }));
      return { previa: false, total: gerados.length, gerados };
    });
  });

  // Importação por planilha (CSV ; ou ,) com prévia e validação antes de gravar.
  rota('POST', '/api/produtos/importar', { texto: true, limite: 3 * 1024 * 1024 }, (ctx) => {
    const confirmar = ctx.query.confirmar === '1';
    const linhas = lerCsv(ctx.corpoTexto ?? '');
    if (linhas.length < 2) throw invalido({ arquivo: 'Planilha vazia.' });
    if (linhas.length > 2001) throw invalido({ arquivo: 'Máximo de 2000 linhas por importação.' });
    const cab = linhas[0].map((c) => normalizarTexto(c).replace(/[^a-z0-9]+/g, '_'));
    const resultado = linhas.slice(1).map((cols, i) => {
      const reg = Object.fromEntries(cab.map((c, k) => [c, (cols[k] ?? '').trim()]));
      try {
        const bruto = {
          sku: reg.sku, nome: reg.nome, marca: reg.marca, categoria: reg.categoria, unidade: (reg.unidade || 'UN').toUpperCase(), ncm: reg.ncm,
          custo_centavos: reais(reg.custo), preco_centavos: reais(reg.preco), peso_g: reg.peso_g, estoque_min: reg.estoque_min, estoque_max: reg.estoque_max,
        };
        const d = validar(bruto, ESPEC);
        if (db.prepare('SELECT 1 FROM produtos WHERE sku = ?').get(d.sku)) throw new Error('SKU já cadastrado (linha ignorada).');
        return { linha: i + 2, sku: d.sku, nome: d.nome, ok: true, bruto, codigo: reg.codigo_barras || null };
      } catch (e) {
        return { linha: i + 2, sku: reg.sku, nome: reg.nome, ok: false, erro: e.campos ? Object.values(e.campos).join(' ') : e.message };
      }
    });
    const vistos = new Set();
    for (const r of resultado) if (r.ok) { if (vistos.has(r.sku)) { r.ok = false; r.erro = 'SKU repetido na planilha.'; } vistos.add(r.sku); }
    const validos = resultado.filter((r) => r.ok);
    if (confirmar) {
      tx(db, () => {
        for (const r of validos) criarProduto(db, ctx, r.bruto, { codigo: r.codigo ? r.codigo.toUpperCase() : null });
        auditar(db, ctx, 'PRODUTOS_IMPORTADOS', 'produto', null, { total: validos.length });
      });
    }
    return { gravado: confirmar, validos: validos.length, com_erro: resultado.length - validos.length, linhas: resultado.map(({ bruto, ...resto }) => resto) };
  });

  rota('GET', '/api/produtos-exportar', (ctx) => {
    const cab = ['sku', 'nome', 'marca', 'categoria', 'unidade', 'custo', 'preco', 'peso_g', 'estoque_min', 'estoque_max', 'codigo_barras', 'saldo_total'];
    const linhas = db.prepare(`${SELECT_PRODUTO} WHERE p.ativo = 1 ORDER BY p.sku`).all().map((p) => [p.sku, p.nome, p.marca, p.categoria, p.unidade, (p.custo_centavos / 100).toFixed(2), (p.preco_centavos / 100).toFixed(2), p.peso_g, p.estoque_min, p.estoque_max, p.codigo_principal, p.saldo_total]);
    tx(db, () => auditar(db, ctx, 'PRODUTOS_EXPORTADOS', 'produto', null, { total: linhas.length }));
    return { _raw: true, tipo: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="produtos.csv"' }, corpo: '﻿' + [cab, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n') };
  });

  registrarFornecedores(app, { cfg, db });
}

function reais(v) {
  if (v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Valor monetário inválido: ${v}`);
  return Math.round(n * 100);
}

export function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split(/\r?\n/, 1)[0].match(/;/g) ?? []).length >= (t.split(/\r?\n/, 1)[0].match(/,/g) ?? []).length ? ';' : ',';
  const linhas = []; let linha = []; let campo = ''; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.some((x) => x !== '')) linhas.push(linha); linha = []; }
    else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x !== '')) linhas.push(linha);
  return linhas;
}

function registrarFornecedores(app, { cfg, db }) {
  const { rota } = app;
  const ESPEC_F = {
    nome: T({ obrig: true, min: 2, max: 160 }), documento: T({ max: 20 }), contato: T({ max: 120 }),
    email: T({ max: 160, regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'E-mail inválido.' }), telefone: T({ max: 30, regex: /^[0-9()+\-\s]{8,30}$/, msg: 'Telefone inválido.' }),
    prazo_dias: I({ max: 365, padrao: 0 }), observacoes: T({ max: 1000 }),
  };
  const mascarar = (d) => '*'.repeat(Math.max(0, d.length - 2)) + d.slice(-2);
  const visivel = (f) => { const { documento_enc, documento_hmac, ...resto } = f; return resto; };

  function gravar(ctx, id) {
    const d = validar(ctx.corpo, id ? { ...ESPEC_F, versao: I({ obrig: true, min: 1 }) } : ESPEC_F);
    let doc = null; let hmac = null; let mask = null;
    if (d.documento) {
      doc = d.documento.replace(/\D/g, '');
      if (!cpfCnpjValido(doc)) throw invalido({ documento: 'CPF/CNPJ inválido.' });
      hmac = hmacHex(cfg.hmacKey, `doc|${doc}`); mask = mascarar(doc);
    }
    const t = ctx.agora();
    return tx(db, () => {
      const dup = hmac && db.prepare('SELECT id FROM fornecedores WHERE documento_hmac = ? AND id IS NOT ?').get(hmac, id ?? null);
      if (dup) throw conflito('DOCUMENTO_DUPLICADO', 'Já existe um fornecedor com este CPF/CNPJ.');
      // Edição com o campo em branco mantém o documento já salvo (não apaga sem querer).
      const atual = id && !doc ? db.prepare('SELECT documento_enc, documento_hmac, documento_mascarado FROM fornecedores WHERE id = ?').get(id) : null;
      const campos = [d.nome, normalizarTexto(d.nome), doc ? cifrar(cfg.fieldKey, doc) : atual?.documento_enc ?? null, doc ? hmac : atual?.documento_hmac ?? null, doc ? mask : atual?.documento_mascarado ?? null, d.contato ?? null, d.email ?? null, d.telefone ?? null, d.prazo_dias, d.observacoes ?? null];
      if (!id) {
        const r = db.prepare('INSERT INTO fornecedores (nome, busca, documento_enc, documento_hmac, documento_mascarado, contato, email, telefone, prazo_dias, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...campos, t, t);
        auditar(db, ctx, 'FORNECEDOR_CRIADO', 'fornecedor', r.lastInsertRowid);
        return Number(r.lastInsertRowid);
      }
      const r = db.prepare('UPDATE fornecedores SET nome=?, busca=?, documento_enc=?, documento_hmac=?, documento_mascarado=?, contato=?, email=?, telefone=?, prazo_dias=?, observacoes=?, versao=versao+1, atualizado_em=? WHERE id=? AND versao=?').run(...campos, t, id, d.versao);
      if (!r.changes) throw conflito('VERSAO', 'Fornecedor alterado em outra tela. Recarregue.');
      auditar(db, ctx, 'FORNECEDOR_ALTERADO', 'fornecedor', id);
      return id;
    });
  }
  rota('GET', '/api/fornecedores', (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query);
    const q = normalizarTexto(ctx.query.q ?? '');
    const onde = ['ativo = ?']; const args = [ctx.query.ativo === '0' ? 0 : 1];
    if (q) { onde.push("busca LIKE ? ESCAPE '\\'"); args.push(`%${escaparLike(q)}%`); }
    const total = db.prepare(`SELECT COUNT(*) c FROM fornecedores WHERE ${onde.join(' AND ')}`).get(...args).c;
    const itens = db.prepare(`SELECT * FROM fornecedores WHERE ${onde.join(' AND ')} ORDER BY nome COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, por, offset).map(visivel);
    return { itens, total, pagina, por_pagina: por };
  });
  rota('GET', '/api/fornecedores/:id', (ctx) => {
    const f = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(Number(ctx.params.id));
    if (!f) throw naoEncontrado('Fornecedor');
    return visivel(f);
  });
  rota('POST', '/api/fornecedores', (ctx) => { ctx.status = 201; return visivel(db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(gravar(ctx, null))); });
  rota('PUT', '/api/fornecedores/:id', (ctx) => visivel(db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(gravar(ctx, Number(ctx.params.id)))));
  for (const [acao, ativo] of [['inativar', 0], ['reativar', 1]]) {
    rota('POST', `/api/fornecedores/:id/${acao}`, (ctx) => tx(db, () => {
      const r = db.prepare('UPDATE fornecedores SET ativo = ?, versao = versao + 1, atualizado_em = ? WHERE id = ?').run(ativo, ctx.agora(), Number(ctx.params.id));
      if (!r.changes) throw naoEncontrado('Fornecedor');
      auditar(db, ctx, ativo ? 'FORNECEDOR_REATIVADO' : 'FORNECEDOR_INATIVADO', 'fornecedor', ctx.params.id);
      return { ativo: !!ativo };
    }));
  }
}
