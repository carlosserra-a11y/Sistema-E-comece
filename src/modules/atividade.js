// "Equipe em ação": quem bipou, quem conferiu, quem expediu e quem estava no caixa, por período, mais a linha do tempo.
import { invalido } from '../util.js';
import { diaDaLoja, inicioDoDia } from './vendas-base.js';

const MAX_DIAS = 92;
const n = (x) => Number(x ?? 0);

function periodo(query, agora) {
  const de = query.de || diaDaLoja(agora); const ate = query.ate || de;
  for (const [campo, dia] of [['de', de], ['ate', ate]]) if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(inicioDoDia(dia))) throw invalido({ [campo]: 'Data inválida.' });
  const ini = inicioDoDia(de); const fim = inicioDoDia(ate) + 86_400_000;
  if (fim <= ini) throw invalido({ ate: 'A data final é anterior à inicial.' });
  if (fim - ini > MAX_DIAS * 86_400_000) throw invalido({ ate: 'Período de no máximo 3 meses.' });
  return { de, ate, ini, fim };
}

// leituras de estoque feitas à mão: fora as baixas automáticas de venda; a transferência conta uma vez (pela entrada)
const BIPAGENS = "m.user_id IS NOT NULL AND (m.grupo IS NULL OR m.grupo NOT LIKE 'venda-%') AND m.tipo <> 'TRANSF_SAIDA'";

export async function atividade(db, ctx, query) {
  const p = periodo(query, ctx.agora());
  const pid = query.pessoa === undefined || query.pessoa === '' ? null : Number(query.pessoa);
  if (pid !== null && (!Number.isInteger(pid) || pid < 1)) throw invalido({ pessoa: 'Pessoa inválida.' });
  const so = (coluna) => (pid ? ` AND ${coluna} = ?` : ''); const arg = pid ? [pid] : []; // filtra a linha do tempo no banco, antes do limite
  const contas = await db.all('SELECT id, nome, dono, ativo, excluido_em FROM users ORDER BY LOWER(nome), id');
  const nomes = new Map(contas.map((u) => [u.id, u.excluido_em ? `${u.nome} (excluída)` : u.nome])); // o histórico mantém o nome
  // todas as contas entram na soma; quem está sem acesso só aparece se fez algo no período ou ainda tem caixa aberto
  const pessoas = new Map(contas.map((u) => [u.id, { id: u.id, nome: nomes.get(u.id), dono: !!u.dono, situacao: u.excluido_em ? 'excluída' : u.ativo ? null : 'desativada', bipagens: 0, unidades: 0, separacoes: 0, conferencias: 0, expedicoes: 0, vendas: 0, valor_centavos: 0, caixa_aberto: null }]));
  const de = (id) => pessoas.get(id);
  for (const l of await db.all(`SELECT m.user_id, COUNT(*) AS c, SUM(ABS(m.delta)) AS u FROM movimentacoes_estoque m WHERE ${BIPAGENS} AND m.ts >= ? AND m.ts < ? GROUP BY m.user_id`, p.ini, p.fim)) if (de(l.user_id)) Object.assign(de(l.user_id), { bipagens: n(l.c), unidades: n(l.u) });
  const campo = { SEPARACAO: 'separacoes', CONFERENCIA: 'conferencias', EXPEDICAO: 'expedicoes' };
  for (const l of await db.all('SELECT user_id, etapa, COUNT(*) AS c FROM etapas WHERE ts >= ? AND ts < ? GROUP BY user_id, etapa', p.ini, p.fim)) if (de(l.user_id)) de(l.user_id)[campo[l.etapa]] = n(l.c);
  for (const l of await db.all("SELECT user_id, COUNT(*) AS c FROM auditoria WHERE acao = 'PEDIDO_ENVIADO' AND ts >= ? AND ts < ? GROUP BY user_id", p.ini, p.fim)) if (de(l.user_id)) de(l.user_id).expedicoes += n(l.c);
  for (const l of await db.all("SELECT vendedor_id, COUNT(*) AS c, SUM(valor_centavos) AS v FROM vendas WHERE status = 'CONCLUIDA' AND concluida_em >= ? AND concluida_em < ? GROUP BY vendedor_id", p.ini, p.fim)) if (de(l.vendedor_id)) Object.assign(de(l.vendedor_id), { vendas: n(l.c), valor_centavos: n(l.v) });
  for (const c of await db.all("SELECT id, aberto_por, aberto_em FROM caixas WHERE status = 'ABERTO'")) if (de(c.aberto_por)) de(c.aberto_por).caixa_aberto = { id: c.id, desde: c.aberto_em };

  const eventos = [];
  const quem = (id) => nomes.get(id) ?? 'Sistema';
  const add = (ts, userId, tipo, texto, link) => { if (!pid || userId === pid) eventos.push({ ts: n(ts), user_id: userId, quem: quem(userId), tipo, texto, link }); };
  const MOV = { ENTRADA: 'recebeu', TRANSF_ENTRADA: 'guardou', SAIDA: 'baixou', AJUSTE: 'ajustou', AVARIA: 'registrou avaria de', DEVOLUCAO: 'devolveu', INVENTARIO: 'corrigiu na contagem' };
  for (const m of await db.all(`SELECT m.ts, m.user_id, m.tipo, m.delta, p.sku, p.id AS produto_id, e.codigo AS endereco FROM movimentacoes_estoque m JOIN produtos p ON p.id = m.produto_id JOIN enderecos e ON e.id = m.endereco_id WHERE ${BIPAGENS} AND m.ts >= ? AND m.ts < ?${so('m.user_id')} ORDER BY m.id DESC LIMIT 60`, p.ini, p.fim, ...arg)) add(m.ts, m.user_id, 'estoque', `${MOV[m.tipo] ?? 'movimentou'} ${Math.abs(m.delta)} × ${m.sku} em ${m.endereco}`, `produtos?abrir=${m.produto_id}`);
  const ETAPA = { SEPARACAO: 'separou', CONFERENCIA: 'conferiu', EXPEDICAO: 'expediu' };
  for (const e of await db.all(`SELECT ts, user_id, etapa, venda_id FROM etapas WHERE ts >= ? AND ts < ?${so('user_id')} ORDER BY id DESC LIMIT 60`, p.ini, p.fim, ...arg)) add(e.ts, e.user_id, e.etapa.toLowerCase(), `${ETAPA[e.etapa]} a venda nº ${e.venda_id}`, `expedicao?venda=${e.venda_id}`);
  // pedidos da internet enviados também são expedição: aparecem na linha do tempo, não só na contagem
  for (const e of await db.all(`SELECT ts, user_id, entidade_id FROM auditoria WHERE acao = 'PEDIDO_ENVIADO' AND ts >= ? AND ts < ?${so('user_id')} ORDER BY id DESC LIMIT 60`, p.ini, p.fim, ...arg)) add(e.ts, e.user_id, 'expedicao', `expediu o pedido da internet nº ${e.entidade_id}`, 'integracoes');
  const comValor = ctx.pode('vendas.gerenciar');
  const emReais = (c) => `R$ ${(n(c) / 100).toFixed(2).replace('.', ',')}`;
  for (const v of await db.all(`SELECT id, vendedor_id, caixa_id, concluida_em, valor_centavos FROM vendas WHERE status IN ('CONCLUIDA','CANCELADA') AND concluida_em >= ? AND concluida_em < ?${so('vendedor_id')} ORDER BY concluida_em DESC, id DESC LIMIT 60`, p.ini, p.fim, ...arg)) add(v.concluida_em, v.vendedor_id, 'venda', `vendeu no caixa nº ${v.caixa_id} (venda nº ${v.id}${comValor ? `, ${emReais(v.valor_centavos)}` : ''})`, 'balcao?aba=vendas');
  for (const v of await db.all(`SELECT id, cancelada_por, cancelada_em FROM vendas WHERE status = 'CANCELADA' AND cancelada_em >= ? AND cancelada_em < ?${so('cancelada_por')} ORDER BY cancelada_em DESC, id DESC LIMIT 30`, p.ini, p.fim, ...arg)) add(v.cancelada_em, v.cancelada_por, 'cancelamento', `cancelou a venda nº ${v.id}`, 'balcao?aba=vendas');
  for (const c of await db.all(`SELECT id, aberto_por, aberto_em, fechado_por, fechado_em FROM caixas WHERE ((aberto_em >= ? AND aberto_em < ?) OR (fechado_em >= ? AND fechado_em < ?))${pid ? ' AND (aberto_por = ? OR fechado_por = ?)' : ''} ORDER BY COALESCE(fechado_em, aberto_em) DESC, id DESC LIMIT 40`, p.ini, p.fim, p.ini, p.fim, ...(pid ? [pid, pid] : []))) {
    if (c.aberto_em >= p.ini && c.aberto_em < p.fim) add(c.aberto_em, c.aberto_por, 'caixa', `abriu o caixa nº ${c.id}`, 'balcao?aba=caixa');
    if (c.fechado_em && c.fechado_em >= p.ini && c.fechado_em < p.fim) add(c.fechado_em, c.fechado_por, 'caixa', `fechou o caixa nº ${c.id}`, 'balcao?aba=caixa');
  }

  const ativo = (x) => x.bipagens + x.separacoes + x.conferencias + x.expedicoes + x.vendas > 0 || x.caixa_aberto;
  const lista = [...pessoas.values()].filter((x) => !x.situacao || ativo(x)).map((x) => (comValor ? x : { ...x, valor_centavos: undefined }));
  lista.sort((a, b) => Number(!!ativo(b)) - Number(!!ativo(a)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { de: p.de, ate: p.ate, pessoas: lista, linha_do_tempo: eventos.sort((a, b) => b.ts - a.ts).slice(0, 60) };
}

export function registrarAtividade(app, { db }) {
  app.rota('GET', '/api/atividade', async (ctx) => await atividade(db, ctx, ctx.query));
}
