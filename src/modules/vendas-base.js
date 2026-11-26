// Peças comuns da venda presencial (balcão): datas no fuso da loja, configuração, caixa aberto e visibilidade.
import { conflito, naoEncontrado } from '../util.js';

export const FORMAS = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];
/** Teto de uma venda (R$ 100 milhões): evita estouro de número por erro de digitação. */
export const VALOR_MAXIMO = 100_000_000_00;
/** Troco máximo aceito (R$ 2.000). Acima disso quase sempre é um código de barras lido dentro do campo do dinheiro. */
export const TROCO_MAXIMO = 2_000_00;

const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
/** Data AAAA-MM-DD na loja (fuso de São Paulo). */
export const diaDaLoja = (ms) => FMT_DIA.format(new Date(ms));
/** Meia-noite (fuso de São Paulo, sem horário de verão desde 2019) do dia AAAA-MM-DD, em ms. */
export const inicioDoDia = (dia) => Date.parse(`${dia}T00:00:00-03:00`);
export const somarDias = (ms, dias) => diaDaLoja(ms + dias * 86_400_000);

const PADRAO = { pix_chave: null, pix_nome: null, pix_cidade: null, desconto_max_pct: 0, validade_orcamento_dias: 7, cupom_rodape: null };
export const lerConfig = async (db) => ({ ...PADRAO, ...((await db.get('SELECT * FROM config_vendas WHERE id = 1')) ?? {}) });

export const caixaAberto = async (db, userId) => (await db.get("SELECT * FROM caixas WHERE aberto_por = ? AND status = 'ABERTO'", userId)) ?? null;

/**
 * Trava o caixa até o fim da transação (venda, sangria, cancelamento e fechamento não correm juntos) e o devolve relido.
 * Sempre ANTES de travar produtos: a ordem fixa evita impasse entre duas operações.
 */
export async function travarCaixa(db, caixaId) {
  await db.travar(`caixa|${caixaId}`);
  const c = await db.get('SELECT * FROM caixas WHERE id = ?', caixaId);
  if (!c) throw naoEncontrado('Caixa');
  return c;
}

export async function exigirCaixaAberto(db, userId) {
  const meu = await caixaAberto(db, userId);
  const c = meu && (await travarCaixa(db, meu.id));
  if (!c || c.status !== 'ABERTO') throw conflito('CAIXA_FECHADO', 'Abra o seu caixa antes de continuar.');
  return c;
}

/** Totais de um caixa. Dinheiro esperado na gaveta = abertura + vendas em dinheiro + suprimentos - sangrias - estornos. */
export async function resumoCaixa(db, caixa) {
  const porForma = { DINHEIRO: 0, PIX: 0, DEBITO: 0, CREDITO: 0 };
  for (const l of await db.all("SELECT p.forma, SUM(p.valor_centavos) AS v FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id WHERE v.caixa_id = ? AND v.status = 'CONCLUIDA' GROUP BY p.forma", caixa.id)) porForma[l.forma] = Number(l.v);
  const mov = { SUPRIMENTO: 0, SANGRIA: 0, ESTORNO: 0 };
  for (const l of await db.all('SELECT tipo, SUM(valor_centavos) AS v FROM caixa_movimentos WHERE caixa_id = ? GROUP BY tipo', caixa.id)) mov[l.tipo] = Number(l.v);
  const vendas = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(valor_centavos),0) AS v FROM vendas WHERE caixa_id = ? AND status = 'CONCLUIDA'", caixa.id);
  return {
    vendas: Number(vendas.n), vendido_centavos: Number(vendas.v), por_forma: porForma,
    abertura_centavos: caixa.abertura_centavos, suprimentos_centavos: mov.SUPRIMENTO, sangrias_centavos: mov.SANGRIA, estornos_centavos: mov.ESTORNO,
    esperado_centavos: caixa.abertura_centavos + porForma.DINHEIRO + mov.SUPRIMENTO - mov.SANGRIA - mov.ESTORNO,
  };
}

/** Dados da loja para o cabeçalho do cupom (quem vende não precisa da permissão de ver o cadastro completo da empresa). */
export async function dadosDaLoja(db) {
  const e = (await db.get('SELECT nome_fantasia, razao_social, cnpj, inscricao_estadual, endereco, cidade, uf, cep FROM empresa WHERE id = 1')) ?? {};
  return { nome: e.nome_fantasia || e.razao_social || null, razao_social: e.razao_social || null, cnpj: e.cnpj ?? null, inscricao_estadual: e.inscricao_estadual ?? null, endereco: e.endereco ?? null, cidade: e.cidade ?? null, uf: e.uf ?? null, cep: e.cep ?? null };
}

/** Quem marca "cliente levou na hora": quem expede, quem gerencia o balcão ou quem fez a própria venda. */
export const podeMarcarRetirada = (ctx, venda) => ctx.pode('expedicao.operar') || ctx.pode('vendas.gerenciar') || (ctx.pode('vendas.registrar') && venda.vendedor_id === ctx.user.id);

// Pedidos da internet na expedição (a tabela `pedidos` com o apelido "p").
export const PEDIDO_EXPEDIDO = "EXISTS (SELECT 1 FROM pedido_etapas e WHERE e.pedido_id = p.id AND e.etapa = 'EXPEDICAO')";
/** Na fila: pago, sem problema e com a reserva de todos os itens ainda ativa (o marcado como enviado à mão fica de fora). */
export const PEDIDO_NA_FILA = `p.status = 'PAGO' AND NOT EXISTS (SELECT 1 FROM pedido_itens i LEFT JOIN reservas r ON r.pedido_item_id = i.id WHERE i.pedido_id = p.id AND (r.id IS NULL OR r.status <> 'ATIVA')) AND NOT ${PEDIDO_EXPEDIDO}`;
