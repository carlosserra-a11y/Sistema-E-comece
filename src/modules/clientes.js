// Clientes do balcão. CPF/CNPJ guardado cifrado (como nos fornecedores); a lista mostra só os 2 últimos dígitos.
import { tx } from '../db.js';
import { conflito, escaparLike, invalido, naoEncontrado, normalizarTexto, paginar } from '../util.js';
import { I, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { cifrar, hmacHex } from '../security/crypto.js';
import { cpfCnpjValido } from './catalogo.js';

const ESPEC = {
  nome: T({ obrig: true, min: 2, max: 160 }), documento: T({ max: 20 }),
  telefone: T({ max: 30, regex: /^[0-9()+\-\s]{8,30}$/, msg: 'Telefone inválido (use DDD + número).' }),
  email: T({ max: 160, regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'E-mail inválido.' }),
  endereco: T({ max: 200 }), observacoes: T({ max: 1000 }),
};
const publico = (c) => { const { documento_enc, documento_hmac, busca, ...resto } = c; return resto; };

export function registrarClientes(app, { cfg, db }) {
  const { rota } = app;
  const um = async (db, id) => {
    const c = await db.get('SELECT * FROM clientes WHERE id = ?', id);
    if (!c) throw naoEncontrado('Cliente');
    return c;
  };

  async function gravar(ctx, id) {
    const d = validar(ctx.corpo, id ? { ...ESPEC, versao: I({ obrig: true, min: 1 }) } : ESPEC);
    let doc = null; let hmac = null;
    if (d.documento) {
      doc = d.documento.replace(/\D/g, '');
      if (!cpfCnpjValido(doc)) throw invalido({ documento: 'CPF/CNPJ inválido.' });
      hmac = hmacHex(cfg.hmacKey, `cliente|${doc}`);
    }
    const t = ctx.agora();
    return await tx(db, async (db) => {
      if (hmac && (await db.get('SELECT id FROM clientes WHERE documento_hmac = ? AND id IS DISTINCT FROM ?', hmac, id ?? null))) throw conflito('DOCUMENTO_DUPLICADO', 'Já existe um cliente com este CPF/CNPJ.');
      const atual = id ? await um(db, id) : null; // campo de documento em branco na edição mantém o que já estava
      const busca = normalizarTexto(`${d.nome} ${(d.telefone ?? '').replace(/\D/g, '')}`);
      const campos = [d.nome, busca, doc ? cifrar(cfg.fieldKey, doc) : atual?.documento_enc ?? null, doc ? hmac : atual?.documento_hmac ?? null, doc ? '*'.repeat(doc.length - 2) + doc.slice(-2) : atual?.documento_mascarado ?? null, d.telefone ?? null, d.email ?? null, d.endereco ?? null, d.observacoes ?? null];
      if (!id) {
        const novo = await db.insert('INSERT INTO clientes (nome, busca, documento_enc, documento_hmac, documento_mascarado, telefone, email, endereco, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...campos, t, t);
        await auditar(db, ctx, 'CLIENTE_CRIADO', 'cliente', novo);
        return novo;
      }
      const r = await db.run('UPDATE clientes SET nome=?, busca=?, documento_enc=?, documento_hmac=?, documento_mascarado=?, telefone=?, email=?, endereco=?, observacoes=?, versao=versao+1, atualizado_em=? WHERE id=? AND versao=?', ...campos, t, id, d.versao);
      if (!r.changes) throw conflito('VERSAO', 'Este cliente foi alterado em outra tela. Recarregue.');
      await auditar(db, ctx, 'CLIENTE_ALTERADO', 'cliente', id);
      return id;
    });
  }

  rota('GET', '/api/clientes', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query);
    const q = normalizarTexto(ctx.query.q ?? '');
    const onde = ['ativo = ?']; const args = [ctx.query.ativo === '0' ? 0 : 1];
    if (q) {
      const digitos = q.replace(/\D/g, '');
      const porDoc = (digitos.length === 11 || digitos.length === 14) && cpfCnpjValido(digitos) ? hmacHex(cfg.hmacKey, `cliente|${digitos}`) : null;
      onde.push(`(busca LIKE ? ESCAPE '\\'${porDoc ? ' OR documento_hmac = ?' : ''})`); args.push(`%${escaparLike(q)}%`, ...(porDoc ? [porDoc] : []));
    }
    const filtro = onde.join(' AND ');
    return {
      total: (await db.get(`SELECT COUNT(*) c FROM clientes WHERE ${filtro}`, ...args)).c, pagina, por_pagina: por,
      itens: (await db.all(`SELECT * FROM clientes WHERE ${filtro} ORDER BY LOWER(nome), id LIMIT ? OFFSET ?`, ...args, por, offset)).map(publico),
    };
  });
  rota('GET', '/api/clientes/:id', async (ctx) => {
    const c = publico(await um(db, Number(ctx.params.id)));
    const podeVendas = ctx.pode('vendas.gerenciar') || ctx.pode('vendas.registrar');
    const todas = ctx.pode('vendas.gerenciar') || ctx.pode('vendas.cancelar');
    const compras = podeVendas ? await db.all(`SELECT id, status, valor_centavos, concluida_em, criado_em FROM vendas WHERE cliente_id = ? AND status <> 'DESCARTADA'${todas ? '' : " AND (vendedor_id = ? OR status = 'ORCAMENTO')"} ORDER BY id DESC LIMIT 20`, c.id, ...(todas ? [] : [ctx.user.id])) : [];
    return { ...c, compras };
  });
  rota('POST', '/api/clientes', async (ctx) => { const id = await gravar(ctx, null); ctx.status = 201; return publico(await um(db, id)); });
  rota('PUT', '/api/clientes/:id', async (ctx) => publico(await um(db, await gravar(ctx, Number(ctx.params.id)))));
  for (const [acao, ativo] of [['inativar', 0], ['reativar', 1]]) {
    rota('POST', `/api/clientes/:id/${acao}`, async (ctx) => await tx(db, async (db) => {
      const c = await um(db, Number(ctx.params.id));
      await db.run('UPDATE clientes SET ativo = ?, versao = versao + 1, atualizado_em = ? WHERE id = ?', ativo, ctx.agora(), c.id);
      await auditar(db, ctx, ativo ? 'CLIENTE_REATIVADO' : 'CLIENTE_INATIVADO', 'cliente', c.id);
      return { ativo: !!ativo };
    }));
  }
}
