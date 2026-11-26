// Venda presencial e orçamento. Regras principais:
//  - o PREÇO vem sempre do cadastro (servidor); mudar preço ou dar desconto acima do limite exige permissão;
//  - o estoque sai do livro-razão (primeiro o lote que vence antes), nunca de lote vencido, endereço bloqueado ou unidade reservada para a internet;
//  - venda cancelada devolve as unidades aos mesmos endereços; nada é apagado.
import { tx } from '../db.js';
import { conflito, erro, escaparLike, invalido, naoEncontrado, normalizarTexto, paginar } from '../util.js';
import { E, I, ID, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { podeFinanceiro } from '../permissoes.js';
import { ORDEM_ROTA } from './deposito.js';
import { mover } from './estoque.js';
import { disponivelDe } from './pedidos.js';
import { FORMAS, TROCO_MAXIMO, VALOR_MAXIMO, caixaAberto, dadosDaLoja, diaDaLoja, exigirCaixaAberto, inicioDoDia, lerConfig, resumoCaixa, somarDias, travarCaixa } from './vendas-base.js';

const MAX_ITENS = 100;
const grupoDe = (vendaId) => `venda-${vendaId}`;
const emReais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

const ESPEC_ITEM = { tipo: E(['PRODUTO', 'SERVICO'], { padrao: 'PRODUTO' }), id: ID({ obrig: true }), qtd: I({ obrig: true, min: 1, max: 100_000 }), preco_unit_centavos: I({ min: 0, max: VALOR_MAXIMO }) };
const ESPEC_VENDA = { cliente_id: ID(), desconto_centavos: I({ min: 0, max: VALOR_MAXIMO, padrao: 0 }), observacao: T({ max: 300 }), valor_esperado_centavos: I({ obrig: true, min: 1, max: VALOR_MAXIMO }) };

/** Lê os itens do carrinho e completa com o cadastro (nome, preço de tabela, custo). */
async function montarItens(db, ctx, brutos) {
  if (!Array.isArray(brutos) || !brutos.length) throw invalido({ itens: 'O carrinho está vazio.' }, 'O carrinho está vazio.');
  if (brutos.length > MAX_ITENS) throw invalido({ itens: `Máximo de ${MAX_ITENS} itens por venda.` });
  const itens = [];
  for (const [i, bruto] of brutos.entries()) {
    const d = validar(bruto, ESPEC_ITEM);
    const produto = d.tipo === 'PRODUTO';
    const r = produto
      ? await db.get('SELECT p.id, p.sku AS codigo, p.nome, p.unidade, p.ativo, p.preco_centavos AS tabela, p.custo_centavos AS custo FROM produtos p WHERE p.id = ?', d.id)
      : await db.get('SELECT id, nome, ativo, valor_centavos AS tabela FROM servicos WHERE id = ?', d.id);
    if (!r) throw naoEncontrado(produto ? 'Produto' : 'Serviço');
    if (!r.ativo) throw conflito('ITEM_INATIVO', `"${r.nome}" está inativo e não pode ser vendido.`);
    const tabela = Number(r.tabela);
    const preco = d.preco_unit_centavos ?? tabela;
    if (preco !== tabela && !ctx.pode('vendas.desconto')) throw erro(403, 'SEM_PERMISSAO', `Você não tem permissão para mudar o preço de "${r.nome}".`);
    if (preco === 0 && !ctx.pode('vendas.desconto')) throw conflito('SEM_PRECO', `"${r.nome}" está sem preço de venda. Cadastre o preço antes de vender.`);
    itens.push({ posicao: i, tipo: d.tipo, produto_id: produto ? r.id : null, servico_id: produto ? null : r.id, codigo: r.codigo ?? null, descricao: r.nome, unidade: r.unidade ?? 'UN', qtd: d.qtd, preco_tabela_centavos: tabela, preco_unit_centavos: preco, custo_unit_centavos: Number(r.custo ?? 0) });
  }
  return itens;
}

/** Soma o carrinho, confere o limite de desconto e se o total é o mesmo que a pessoa viu na tela. */
async function totalizar(db, ctx, itens, d) {
  const subtotal = itens.reduce((a, i) => a + i.qtd * i.preco_unit_centavos, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > VALOR_MAXIMO) throw invalido({ itens: 'Valor da venda grande demais: confira as quantidades.' });
  const desconto = d.desconto_centavos;
  if (desconto > 0 && !ctx.pode('vendas.desconto')) {
    const { desconto_max_pct: pct } = await lerConfig(db);
    const limite = Math.floor((subtotal * pct) / 100);
    if (desconto > limite) throw erro(403, 'DESCONTO', pct ? `Seu desconto máximo é de ${pct}% (${emReais(limite)}).` : 'Você não tem permissão para dar desconto.');
  }
  const total = subtotal - desconto;
  if (total < 1) throw invalido({ desconto_centavos: 'O total precisa ser maior que zero.' }, 'O total precisa ser maior que zero.');
  if (total !== d.valor_esperado_centavos) throw conflito('PRECO_MUDOU', `O total agora é ${emReais(total)} (na tela estava ${emReais(d.valor_esperado_centavos)}). Atualize o carrinho e confira.`);
  return { subtotal, desconto, total };
}

/** Confere os pagamentos: somam pelo menos o total, e só dinheiro pode passar (vira troco). */
export function conferirPagamentos(brutos, total) {
  if (!Array.isArray(brutos) || !brutos.length) throw invalido({ pagamentos: 'Informe como o cliente pagou.' }, 'Informe como o cliente pagou.');
  if (brutos.length > 8) throw invalido({ pagamentos: 'Máximo de 8 formas de pagamento.' });
  const lista = brutos.map((b) => validar(b, { forma: E(FORMAS, { obrig: true }), valor_centavos: I({ obrig: true, min: 1, max: VALOR_MAXIMO }), parcelas: I({ min: 1, max: 24, padrao: 1 }) }));
  const soma = lista.reduce((a, p) => a + p.valor_centavos, 0);
  const dinheiro = lista.filter((p) => p.forma === 'DINHEIRO').reduce((a, p) => a + p.valor_centavos, 0);
  if (soma < total) throw conflito('PAGAMENTO_INSUFICIENTE', `Faltam ${emReais(total - soma)}.`);
  const troco = soma - total;
  if (troco > 0 && (soma - dinheiro >= total)) throw conflito('PAGAMENTO_EXCEDE', 'Pix e cartão não podem passar do total da venda.');
  if (troco > TROCO_MAXIMO) throw conflito('TROCO_ALTO', `Troco de ${emReais(troco)} é alto demais: confira o valor recebido em dinheiro.`);
  const finais = lista.filter((p) => p.forma !== 'DINHEIRO').map((p) => ({ ...p, parcelas: p.forma === 'CREDITO' ? p.parcelas : 1 }));
  const liquido = dinheiro - troco; // várias entradas em dinheiro viram uma só, já sem o troco
  if (liquido > 0) finais.unshift({ forma: 'DINHEIRO', valor_centavos: liquido, parcelas: 1 });
  return { pagamentos: finais, troco };
}

/** Endereços de onde a venda pode tirar o produto, na ordem: vence antes primeiro; depois o picking designado; depois a rota. */
async function origensDeVenda(db, produtoId, hoje) {
  return await db.all(`SELECT s.endereco_id, s.lote_id, s.qtd, e.codigo
    FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id LEFT JOIN lotes l ON l.id = s.lote_id
    WHERE s.produto_id = ? AND s.qtd > 0 AND z.vendavel = 1 AND e.ativo = 1 AND e.bloqueado = 0 AND (l.validade IS NULL OR l.validade >= ?)
    ORDER BY (l.validade IS NULL), l.validade, (CASE WHEN EXISTS (SELECT 1 FROM produto_picking pp WHERE pp.produto_id = s.produto_id AND pp.endereco_id = e.id) THEN 0 ELSE 1 END), ${ORDEM_ROTA}`, produtoId, hoje);
}

/** Quanto dá para vender agora no balcão: o que está em endereço liberado, sem passar do disponível (descontadas as reservas da internet). */
export async function vendavelAgora(db, produtoId, hoje) {
  const origens = await origensDeVenda(db, produtoId, hoje);
  const liberado = origens.reduce((a, o) => a + o.qtd, 0);
  const { disponivel, reservado } = await disponivelDe(db, produtoId, hoje);
  return { origens, liberado, reservado, maximo: Math.max(0, Math.min(liberado, disponivel)) };
}

/** Tira os produtos do estoque. Trava os produtos em ordem fixa para duas vendas simultâneas não venderem a mesma unidade. */
async function baixarEstoque(db, ctx, vendaId, itens) {
  const hoje = diaDaLoja(ctx.agora());
  const porProduto = new Map();
  for (const i of itens) if (i.tipo === 'PRODUTO') porProduto.set(i.produto_id, (porProduto.get(i.produto_id) ?? 0) + i.qtd);
  const ids = [...porProduto.keys()].sort((a, b) => a - b);
  for (const id of ids) await db.travar(`venda|produto|${id}`);
  for (const id of ids) {
    let falta = porProduto.get(id);
    const { origens, maximo, reservado } = await vendavelAgora(db, id, hoje);
    if (falta > maximo) {
      const nome = itens.find((i) => i.produto_id === id).descricao;
      const guardados = Number((await db.get('SELECT COALESCE(SUM(s.qtd),0) q FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id WHERE s.produto_id = ? AND z.vendavel = 0', id)).q);
      const dicas = [reservado > 0 && `${reservado} reservada(s) para pedidos da internet`, guardados > 0 && `${guardados} fora do picking/reserva (recebimento, avaria...): use "Guardar" antes de vender`].filter(Boolean).join('; ');
      throw conflito('ESTOQUE_INSUFICIENTE', `Estoque insuficiente de "${nome}": pediu ${falta}, pode vender ${maximo}.${dicas ? ` Há ${dicas}.` : ''}`);
    }
    for (const o of origens) {
      if (!falta) break;
      const tira = Math.min(falta, o.qtd);
      await mover(db, ctx, { tipo: 'SAIDA', produto_id: id, endereco_id: o.endereco_id, lote_id: o.lote_id, delta: -tira, grupo: grupoDe(vendaId), documento: `Venda ${vendaId}`, motivo: 'Venda no balcão' });
      falta -= tira;
    }
  }
}

async function clienteValido(db, id) {
  if (id && !(await db.get('SELECT 1 AS ok FROM clientes WHERE id = ? AND ativo = 1', id))) throw invalido({ cliente_id: 'Cliente inexistente ou inativo.' });
  return id ?? null;
}

async function inserirItens(db, vendaId, itens) {
  for (const i of itens) await db.run('INSERT INTO venda_itens (venda_id, tipo, produto_id, servico_id, codigo, descricao, unidade, qtd, preco_tabela_centavos, preco_unit_centavos, custo_unit_centavos) VALUES (?,?,?,?,?,?,?,?,?,?,?)', vendaId, i.tipo, i.produto_id, i.servico_id, i.codigo, i.descricao, i.unidade, i.qtd, i.preco_tabela_centavos, i.preco_unit_centavos, i.custo_unit_centavos);
}
async function inserirPagamentos(db, vendaId, pagamentos) {
  for (const p of pagamentos) await db.run('INSERT INTO venda_pagamentos (venda_id, forma, valor_centavos, parcelas) VALUES (?,?,?,?)', vendaId, p.forma, p.valor_centavos, p.parcelas);
}

export async function vender(db, ctx, corpo) {
  const d = validar(corpo, ESPEC_VENDA);
  return await tx(db, async (db) => {
    const caixa = await exigirCaixaAberto(db, ctx.user.id);
    const clienteId = await clienteValido(db, d.cliente_id);
    const itens = await montarItens(db, ctx, corpo.itens);
    const { subtotal, desconto, total } = await totalizar(db, ctx, itens, d);
    const { pagamentos, troco } = conferirPagamentos(corpo.pagamentos, total);
    const t = ctx.agora();
    const id = await db.insert("INSERT INTO vendas (status, cliente_id, vendedor_id, caixa_id, subtotal_centavos, desconto_centavos, valor_centavos, troco_centavos, observacao, criado_em, concluida_em) VALUES ('CONCLUIDA',?,?,?,?,?,?,?,?,?,?)", clienteId, ctx.user.id, caixa.id, subtotal, desconto, total, troco, d.observacao ?? null, t, t);
    await inserirItens(db, id, itens);
    await inserirPagamentos(db, id, pagamentos);
    await baixarEstoque(db, ctx, id, itens);
    await auditar(db, ctx, 'VENDA_CONCLUIDA', 'venda', id, { valor_centavos: total, desconto_centavos: desconto, itens: itens.length });
    return { id, valor_centavos: total, troco_centavos: troco };
  });
}

export async function criarOrcamento(db, ctx, corpo) {
  const d = validar(corpo, ESPEC_VENDA);
  return await tx(db, async (db) => {
    const clienteId = await clienteValido(db, d.cliente_id);
    const itens = await montarItens(db, ctx, corpo.itens);
    const { subtotal, desconto, total } = await totalizar(db, ctx, itens, d);
    const { validade_orcamento_dias: dias } = await lerConfig(db);
    const validade = somarDias(ctx.agora(), dias);
    const id = await db.insert("INSERT INTO vendas (status, cliente_id, vendedor_id, subtotal_centavos, desconto_centavos, valor_centavos, observacao, validade, criado_em) VALUES ('ORCAMENTO',?,?,?,?,?,?,?,?)", clienteId, ctx.user.id, subtotal, desconto, total, d.observacao ?? null, validade, ctx.agora());
    await inserirItens(db, id, itens);
    await auditar(db, ctx, 'ORCAMENTO_CRIADO', 'venda', id, { valor_centavos: total });
    return { id, valor_centavos: total, validade };
  });
}

async function vendaTravada(db, id) {
  await db.travar(`venda|doc|${id}`);
  const v = await db.get('SELECT * FROM vendas WHERE id = ?', id);
  if (!v) throw naoEncontrado('Venda');
  return v;
}

/** Orçamento vira venda: vale o preço combinado (dentro da validade), baixa o estoque agora. */
export async function concluirOrcamento(db, ctx, id, corpo) {
  return await tx(db, async (db) => {
    const caixa = await exigirCaixaAberto(db, ctx.user.id);
    const v = await vendaTravada(db, id);
    if (v.status !== 'ORCAMENTO') throw conflito('STATUS', 'Este orçamento já foi concluído ou descartado.');
    if (v.validade < diaDaLoja(ctx.agora())) throw conflito('ORCAMENTO_VENCIDO', 'Orçamento vencido: faça um novo com os preços de hoje.');
    const itens = await db.all('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY id', v.id);
    for (const i of itens) {
      const r = i.tipo === 'PRODUTO' ? await db.get('SELECT ativo, custo_centavos FROM produtos WHERE id = ?', i.produto_id) : await db.get('SELECT ativo FROM servicos WHERE id = ?', i.servico_id);
      if (!r?.ativo) throw conflito('ITEM_INATIVO', `"${i.descricao}" foi inativado depois do orçamento.`);
      if (i.tipo === 'PRODUTO') await db.run('UPDATE venda_itens SET custo_unit_centavos = ? WHERE id = ?', r.custo_centavos, i.id);
    }
    const { pagamentos, troco } = conferirPagamentos(corpo.pagamentos, v.valor_centavos);
    await db.run("UPDATE vendas SET status = 'CONCLUIDA', vendedor_id = ?, caixa_id = ?, troco_centavos = ?, concluida_em = ? WHERE id = ?", ctx.user.id, caixa.id, troco, ctx.agora(), v.id);
    await inserirPagamentos(db, v.id, pagamentos);
    await baixarEstoque(db, ctx, v.id, itens);
    await auditar(db, ctx, 'ORCAMENTO_CONCLUIDO', 'venda', v.id, { valor_centavos: v.valor_centavos });
    return { id: v.id, valor_centavos: v.valor_centavos, troco_centavos: troco };
  });
}

export async function descartarOrcamento(db, ctx, id) {
  return await tx(db, async (db) => {
    const v = await vendaTravada(db, id);
    if (v.status !== 'ORCAMENTO') throw conflito('STATUS', 'Só dá para descartar um orçamento em aberto.');
    if (v.vendedor_id !== ctx.user.id && !ctx.pode('vendas.gerenciar')) throw erro(403, 'SEM_PERMISSAO', 'Só quem fez o orçamento ou quem gerencia vendas pode descartá-lo.');
    await db.run("UPDATE vendas SET status = 'DESCARTADA' WHERE id = ?", v.id);
    await auditar(db, ctx, 'ORCAMENTO_DESCARTADO', 'venda', v.id);
    return { id: v.id };
  });
}

/** Cancela uma venda concluída: devolve o estoque e acerta o dinheiro do caixa. */
export async function cancelarVenda(db, ctx, id, corpo) {
  const d = validar(corpo, { motivo: T({ obrig: true, min: 5, max: 200 }) });
  return await tx(db, async (db) => {
    const previa = await db.get('SELECT caixa_id, status FROM vendas WHERE id = ?', id);
    if (!previa) throw naoEncontrado('Venda');
    if (previa.status !== 'CONCLUIDA') throw conflito('STATUS', previa.status === 'CANCELADA' ? 'Esta venda já foi cancelada.' : 'Só dá para cancelar uma venda concluída.');
    // ordem fixa das travas: caixas (menor id primeiro), depois a venda
    const meu = await caixaAberto(db, ctx.user.id);
    for (const c of [...new Set([previa.caixa_id, meu?.id].filter(Boolean))].sort((a, b) => a - b)) await db.travar(`caixa|${c}`);
    const v = await vendaTravada(db, id);
    if (v.status !== 'CONCLUIDA') throw conflito('STATUS', 'Esta venda já foi cancelada.');
    const dinheiro = Number((await db.get("SELECT COALESCE(SUM(valor_centavos),0) q FROM venda_pagamentos WHERE venda_id = ? AND forma = 'DINHEIRO'", v.id)).q);
    const original = await travarCaixa(db, v.caixa_id);
    if (dinheiro > 0) {
      if (original.status === 'ABERTO') {
        const { esperado_centavos: tem } = await resumoCaixa(db, original);
        if (tem < dinheiro) throw conflito('CAIXA_SEM_DINHEIRO', `Não há ${emReais(dinheiro)} na gaveta para devolver: faça um suprimento no caixa da venda.`);
      } else {
        const atual = await exigirCaixaAberto(db, ctx.user.id); // o caixa da venda já fechou: a devolução sai do caixa de quem cancela
        const { esperado_centavos: tem } = await resumoCaixa(db, atual);
        if (tem < dinheiro) throw conflito('CAIXA_SEM_DINHEIRO', `Não há ${emReais(dinheiro)} na sua gaveta para devolver: faça um suprimento antes.`);
        await db.run("INSERT INTO caixa_movimentos (caixa_id, ts, tipo, valor_centavos, motivo, venda_id, user_id) VALUES (?,?,'ESTORNO',?,?,?,?)", atual.id, ctx.agora(), dinheiro, `Cancelamento da venda ${v.id}: ${d.motivo}`, v.id, ctx.user.id);
      }
    }
    const saidas = await db.all("SELECT m.produto_id, m.endereco_id, m.lote_id, m.delta, e.codigo, p.sku FROM movimentacoes_estoque m JOIN enderecos e ON e.id = m.endereco_id JOIN produtos p ON p.id = m.produto_id WHERE m.grupo = ? AND m.tipo = 'SAIDA' ORDER BY m.produto_id, m.id", grupoDe(v.id));
    const devolver = [];
    for (const s of saidas) {
      await mover(db, ctx, { tipo: 'DEVOLUCAO', produto_id: s.produto_id, endereco_id: s.endereco_id, lote_id: s.lote_id, delta: -s.delta, grupo: grupoDe(v.id), documento: `Venda ${v.id}`, motivo: `Cancelamento: ${d.motivo}` });
      // produto inativado depois da venda volta a ficar ativo: não pode existir estoque de produto inativo
      await db.run('UPDATE produtos SET ativo = 1, versao = versao + 1, atualizado_em = ? WHERE id = ? AND ativo = 0', ctx.agora(), s.produto_id);
      devolver.push({ sku: s.sku, endereco: s.codigo, qtd: -s.delta });
    }
    await db.run("UPDATE vendas SET status = 'CANCELADA', cancelada_em = ?, cancelada_por = ?, motivo_cancelamento = ? WHERE id = ?", ctx.agora(), ctx.user.id, d.motivo, v.id);
    await auditar(db, ctx, 'VENDA_CANCELADA', 'venda', v.id, { motivo: d.motivo, valor_centavos: v.valor_centavos });
    const eletronico = await db.all("SELECT forma, valor_centavos FROM venda_pagamentos WHERE venda_id = ? AND forma <> 'DINHEIRO'", v.id);
    return { id: v.id, devolver_dinheiro_centavos: dinheiro, estornar_fora: eletronico, devolver };
  });
}

/** Quem gerencia (ou cancela) vê todas as vendas; os demais veem as próprias e os orçamentos. */
const veTudo = (ctx) => ctx.pode('vendas.gerenciar') || ctx.pode('vendas.cancelar');
const visivel = (ctx, v) => veTudo(ctx) || v.vendedor_id === ctx.user.id || v.status === 'ORCAMENTO';

export async function detalheVenda(db, ctx, id) {
  const v = await db.get(`SELECT v.*, u.nome AS vendedor_nome, uc.nome AS cancelada_por_nome, c.nome AS cliente_nome, c.telefone AS cliente_telefone, c.documento_mascarado AS cliente_documento
    FROM vendas v JOIN users u ON u.id = v.vendedor_id LEFT JOIN users uc ON uc.id = v.cancelada_por LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`, id);
  if (!v || !visivel(ctx, v)) throw naoEncontrado('Venda');
  const itens = await db.all('SELECT id, tipo, produto_id, servico_id, codigo, descricao, unidade, qtd, preco_tabela_centavos, preco_unit_centavos, custo_unit_centavos FROM venda_itens WHERE venda_id = ? ORDER BY id', v.id);
  const fin = podeFinanceiro(ctx);
  return {
    ...v,
    itens: itens.map(({ custo_unit_centavos: custo, ...i }) => ({ ...i, valor_centavos: i.qtd * i.preco_unit_centavos, ...(fin ? { custo_unit_centavos: custo } : {}) })),
    pagamentos: await db.all('SELECT forma, valor_centavos, parcelas FROM venda_pagamentos WHERE venda_id = ? ORDER BY id', v.id),
    loja: await dadosDaLoja(db), cupom_rodape: (await lerConfig(db)).cupom_rodape,
  };
}

export function registrarVendas(app, { db }) {
  const { rota } = app;
  const IDEM = { idempotente: true };

  rota('POST', '/api/vendas', IDEM, async (ctx) => { const r = await vender(ctx.db, ctx, ctx.corpo); ctx.status = 201; app.eventos.emit('estoque'); return r; });
  rota('POST', '/api/orcamentos', IDEM, async (ctx) => { const r = await criarOrcamento(ctx.db, ctx, ctx.corpo); ctx.status = 201; return r; });
  rota('POST', '/api/vendas/:id/concluir', IDEM, async (ctx) => { const r = await concluirOrcamento(ctx.db, ctx, Number(ctx.params.id), ctx.corpo); app.eventos.emit('estoque'); return r; });
  rota('POST', '/api/vendas/:id/descartar', async (ctx) => await descartarOrcamento(db, ctx, Number(ctx.params.id)));
  rota('POST', '/api/vendas/:id/cancelar', { ...IDEM, reauth: true }, async (ctx) => { const r = await cancelarVenda(ctx.db, ctx, Number(ctx.params.id), ctx.corpo); app.eventos.emit('estoque'); return r; });

  rota('GET', '/api/vendas/:id', async (ctx) => await detalheVenda(db, ctx, Number(ctx.params.id)));
  rota('GET', '/api/vendas', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 25);
    const onde = ['1=1']; const args = [];
    const status = ctx.query.status;
    if (['ORCAMENTO', 'CONCLUIDA', 'CANCELADA', 'DESCARTADA'].includes(status)) { onde.push('v.status = ?'); args.push(status); } else onde.push("v.status IN ('CONCLUIDA','CANCELADA')");
    if (!veTudo(ctx)) { onde.push("(v.vendedor_id = ? OR v.status = 'ORCAMENTO')"); args.push(ctx.user.id); }
    for (const [q, op] of [['de', '>='], ['ate', '<']]) {
      const dia = ctx.query[q];
      if (!dia) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(inicioDoDia(dia))) throw invalido({ [q]: 'Data inválida.' });
      onde.push(`COALESCE(v.concluida_em, v.criado_em) ${op} ?`); args.push(inicioDoDia(dia) + (q === 'ate' ? 86_400_000 : 0));
    }
    const busca = String(ctx.query.q ?? '').trim();
    if (/^\d{1,9}$/.test(busca)) { onde.push('v.id = ?'); args.push(Number(busca)); }
    else if (busca) { onde.push("v.cliente_id IN (SELECT id FROM clientes WHERE busca LIKE ? ESCAPE '\\')"); args.push(`%${escaparLike(normalizarTexto(busca))}%`); }
    const from = `FROM vendas v JOIN users u ON u.id = v.vendedor_id LEFT JOIN clientes c ON c.id = v.cliente_id WHERE ${onde.join(' AND ')}`;
    return {
      total: (await db.get(`SELECT COUNT(*) c ${from}`, ...args)).c, pagina, por_pagina: por,
      itens: await db.all(`SELECT v.id, v.status, v.valor_centavos, v.criado_em, v.concluida_em, v.validade, v.vendedor_id, u.nome AS vendedor_nome, c.nome AS cliente_nome,
        (SELECT COALESCE(SUM(qtd),0) FROM venda_itens i WHERE i.venda_id = v.id) AS unidades ${from} ORDER BY v.id DESC LIMIT ? OFFSET ?`, ...args, por, offset),
    };
  });
}
