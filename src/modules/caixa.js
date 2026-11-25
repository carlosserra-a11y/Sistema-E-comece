// Caixa do balcão: abertura, suprimento, sangria e fechamento com conferência. Um caixa aberto por pessoa.
import { tx } from '../db.js';
import { conflito, erro, naoEncontrado, paginar } from '../util.js';
import { E, I, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { VALOR_MAXIMO, caixaAberto, exigirCaixaAberto, resumoCaixa, travarCaixa } from './vendas-base.js';

const DINHEIRO = (o = {}) => I({ obrig: true, min: 0, max: VALOR_MAXIMO, ...o });

export async function abrirCaixa(db, ctx, bruto) {
  const d = validar(bruto, { abertura_centavos: DINHEIRO() });
  return await tx(db, async (db) => {
    await db.travar(`abrir-caixa|${ctx.user.id}`);
    if (await caixaAberto(db, ctx.user.id)) throw conflito('CAIXA_JA_ABERTO', 'Você já tem um caixa aberto. Feche-o antes de abrir outro.');
    const id = await db.insert('INSERT INTO caixas (aberto_por, aberto_em, abertura_centavos) VALUES (?,?,?)', ctx.user.id, ctx.agora(), d.abertura_centavos);
    await auditar(db, ctx, 'CAIXA_ABERTO', 'caixa', id, { abertura_centavos: d.abertura_centavos });
    return { id };
  });
}

export async function movimentarCaixa(db, ctx, bruto) {
  const d = validar(bruto, { tipo: E(['SUPRIMENTO', 'SANGRIA'], { obrig: true }), valor_centavos: DINHEIRO({ min: 1 }), motivo: T({ obrig: true, min: 5, max: 200 }) });
  return await tx(db, async (db) => {
    const caixa = await exigirCaixaAberto(db, ctx.user.id);
    if (d.tipo === 'SANGRIA') {
      const { esperado_centavos: tem } = await resumoCaixa(db, caixa);
      if (d.valor_centavos > tem) throw conflito('CAIXA_SEM_DINHEIRO', 'A sangria é maior que o dinheiro que deveria estar na gaveta.');
    }
    const id = await db.insert('INSERT INTO caixa_movimentos (caixa_id, ts, tipo, valor_centavos, motivo, user_id) VALUES (?,?,?,?,?,?)', caixa.id, ctx.agora(), d.tipo, d.valor_centavos, d.motivo, ctx.user.id);
    await auditar(db, ctx, `CAIXA_${d.tipo}`, 'caixa', caixa.id, { valor_centavos: d.valor_centavos, motivo: d.motivo });
    return { id, caixa_id: caixa.id };
  });
}

/** Fecha o caixa `caixaId` conferindo o dinheiro contado. A foto dos totais é gravada e não muda mais. */
export async function fecharCaixa(db, ctx, caixaId, bruto) {
  const d = validar(bruto, { contado_centavos: DINHEIRO(), observacao: T({ max: 300 }) });
  return await tx(db, async (db) => {
    const caixa = await travarCaixa(db, caixaId);
    if (caixa.aberto_por !== ctx.user.id && !ctx.pode('vendas.gerenciar')) throw erro(403, 'SEM_PERMISSAO', 'Só o dono do caixa ou quem gerencia vendas pode fechá-lo.');
    if (caixa.status !== 'ABERTO') throw conflito('CAIXA_FECHADO', 'Este caixa já foi fechado.');
    const resumo = await resumoCaixa(db, caixa);
    const diferenca = d.contado_centavos - resumo.esperado_centavos;
    if (diferenca !== 0 && (d.observacao ?? '').length < 5) throw conflito('CAIXA_DIFERENCA', `O dinheiro contado não bate (${diferenca > 0 ? 'sobrou' : 'faltou'} R$ ${(Math.abs(diferenca) / 100).toFixed(2).replace('.', ',')}). Conte de novo ou escreva uma observação explicando.`);
    await db.run("UPDATE caixas SET status = 'FECHADO', fechado_por = ?, fechado_em = ?, contado_centavos = ?, esperado_centavos = ?, resumo = ?, observacao = ? WHERE id = ?", ctx.user.id, ctx.agora(), d.contado_centavos, resumo.esperado_centavos, JSON.stringify(resumo), d.observacao ?? null, caixa.id);
    await auditar(db, ctx, 'CAIXA_FECHADO', 'caixa', caixa.id, { esperado_centavos: resumo.esperado_centavos, contado_centavos: d.contado_centavos, diferenca_centavos: diferenca });
    return { id: caixa.id, contado_centavos: d.contado_centavos, diferenca_centavos: diferenca, ...resumo };
  });
}

/** Caixa para a tela. Com o caixa aberto, quem não gerencia vendas não vê o esperado (conferência cega). */
async function paraTela(db, ctx, caixa) {
  const nome = async (id) => (id ? (await db.get('SELECT nome FROM users WHERE id = ?', id))?.nome ?? null : null);
  const { resumo: foto, ...base } = caixa;
  let resumo = foto ? JSON.parse(foto) : await resumoCaixa(db, caixa);
  const cego = caixa.status === 'ABERTO' && !ctx.pode('vendas.gerenciar');
  if (cego) resumo = { vendas: resumo.vendas, abertura_centavos: resumo.abertura_centavos };
  return {
    ...base, cego, resumo, aberto_por_nome: await nome(caixa.aberto_por), fechado_por_nome: await nome(caixa.fechado_por),
    diferenca_centavos: caixa.status === 'FECHADO' ? caixa.contado_centavos - caixa.esperado_centavos : null,
    movimentos: await db.all('SELECT id, ts, tipo, valor_centavos, motivo, venda_id FROM caixa_movimentos WHERE caixa_id = ? ORDER BY id', caixa.id),
  };
}

export function registrarCaixa(app, { db }) {
  const { rota } = app;
  const IDEM = { idempotente: true };

  rota('GET', '/api/caixa', async (ctx) => {
    const c = await caixaAberto(db, ctx.user.id);
    return { caixa: c ? await paraTela(db, ctx, c) : null };
  });
  rota('POST', '/api/caixa/abrir', IDEM, async (ctx) => { const r = await abrirCaixa(ctx.db, ctx, ctx.corpo); ctx.status = 201; return r; });
  rota('POST', '/api/caixa/movimento', IDEM, async (ctx) => { const r = await movimentarCaixa(ctx.db, ctx, ctx.corpo); ctx.status = 201; return r; });
  rota('POST', '/api/caixas/:id/fechar', IDEM, async (ctx) => await fecharCaixa(ctx.db, ctx, Number(ctx.params.id), ctx.corpo));

  rota('GET', '/api/caixas', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 25);
    return {
      total: (await db.get('SELECT COUNT(*) c FROM caixas')).c, pagina, por_pagina: por,
      itens: await db.all(`SELECT c.id, c.status, c.aberto_em, c.fechado_em, c.abertura_centavos, c.esperado_centavos, c.contado_centavos, u.nome AS aberto_por_nome
        FROM caixas c JOIN users u ON u.id = c.aberto_por ORDER BY c.id DESC LIMIT ? OFFSET ?`, por, offset),
    };
  });
  rota('GET', '/api/caixas/:id', async (ctx) => {
    const c = await db.get('SELECT * FROM caixas WHERE id = ?', Number(ctx.params.id));
    if (!c || (c.aberto_por !== ctx.user.id && !ctx.pode('vendas.gerenciar'))) throw naoEncontrado('Caixa');
    return await paraTela(db, ctx, c);
  });
}
