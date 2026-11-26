// Pedidos da internet na Expedição: fila, separação e conferência bipando, baixa automática no "Expedir", cancelamento e permissões.
// Roda nos dois bancos (npm test = SQLite; npm run test:pg = PostgreSQL embutido).
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, novoProduto, criarEnderecos } from './helpers.js';
import { importarPedido, disponivelDe } from '../src/modules/pedidos.js';
import { integridade } from '../src/modules/estoque.js';
import { integridadeVendas } from '../src/modules/relatorios.js';
import { verificarCadeia } from '../src/security/audit.js';

const SENHA = 'Lume!Verde#Telhado59';
const ok = (r, status = 200) => { assert.equal(r.status, status, r.texto); return r.data; };
const falha = (r, status, codigo) => { assert.equal(r.status, status, r.texto); if (codigo) assert.equal(r.erro.code, codigo, r.texto); return r.erro; };

async function com(fn) {
  const sis = await criarSistema();
  try {
    const dono = await entrarCompleto(sis);
    const pick = (await criarEnderecos(dono, 'PICKING', { rua: 1 })).filter((e) => e.rua === 1);
    const p = await novoProduto(dono, { preco_centavos: 1000, sku: 'NET-1' });
    ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: pick[0].id, qtd: 5 }), 201);
    const conta = await sis.db.get('SELECT c.* FROM contas_canal c JOIN canais k ON k.id = c.canal_id WHERE k.codigo = ?', 'ML');
    const ctx = { agora: () => sis.relogio.t, user: null, ip: 'ml-teste' };
    let numero = 5000;
    const chegar = async ({ id = ++numero, sku = 'NET-1', qtd = 2, status = 'paid' } = {}) => ({ canal: String(id), ...(await importarPedido(sis.db, ctx, conta, { id, status, total_amount: 20, date_created: new Date(sis.relogio.t).toISOString(), buyer: { id: 9, nickname: 'COMPRADOR_X' }, order_items: [{ item: { id: sku === 'NET-1' ? 'MLB123456789' : 'MLB000000001', seller_sku: sku, title: 'Anúncio de teste' }, quantity: qtd, unit_price: 10 }] })) });
    await fn({ sis, dono, pick, p, chegar });
    assert.equal((await integridade(sis.db)).ok, true, 'estoque = livro-razão');
    assert.deepEqual(await integridadeVendas(sis.db), { ok: true, problemas: [] });
    assert.equal((await verificarCadeia(sis.db)).ok, true);
  } finally { await sis.parar(); }
}
async function contratar(sis, dono, dados) {
  const nova = ok(await dono.post('/api/equipe', dados), 201);
  const c = sis.cliente();
  await c.get('/api/sessao');
  ok(await c.post('/api/login', { login: nova.login, senha: nova.senha_provisoria }));
  ok(await c.post('/api/senha/trocar', { senha_atual: nova.senha_provisoria, senha_nova: SENHA }));
  return c;
}
const passo = (c, id, etapa, qtd = 2, codigo = 'NET-1') => c.post(`/api/expedicao-pedidos/${id}/etapa`, { etapa, leituras: [{ codigo, qtd }] });
const saldo = async (sis, p) => Number((await sis.db.get('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE produto_id = ?', p.id)).q);

test('pedido pago entra na fila, é separado e conferido bipando, e o Expedir dá a baixa e consome a reserva', async () => await com(async ({ sis, dono, p, chegar }) => {
  const ped = await chegar({ qtd: 2 });
  await chegar({ status: 'payment_required', qtd: 1 });
  await chegar({ sku: 'NAO-EXISTE', qtd: 1 });
  const fila = ok(await dono.get('/api/expedicao-pedidos'));
  assert.deepEqual([fila.total, fila.itens[0].canal_pedido_id, fila.itens[0].unidades], [1, ped.canal, 2]);
  const d = ok(await dono.get(`/api/expedicao-pedidos/${ped.id}`));
  assert.deepEqual([d.itens[0].sku, d.itens[0].qtd, d.itens[0].enderecos.length, d.enviado_a_mao], ['NET-1', 2, 1, false]);
  assert.doesNotMatch(JSON.stringify(d), /centavos/);
  assert.equal(ok(await dono.get('/api/painel')).expedicao_pendente, 1);

  const sep = await contratar(sis, dono, { nome: 'Sam Separa', papel: 'operador' });
  falha(await passo(sep, ped.id, 'CONFERENCIA'), 409, 'FORA_DE_ORDEM');
  falha(await passo(sep, ped.id, 'EXPEDICAO'), 409, 'FORA_DE_ORDEM');
  assert.match(falha(await passo(sep, ped.id, 'SEPARACAO', 1), 409, 'QUANTIDADE_DIFERENTE').message, /pedido 2/);
  assert.match(falha(await passo(sep, ped.id, 'SEPARACAO', 2, 'OUTRO'), 409, 'LEITURA_ERRADA').message, /deste pedido/);
  ok(await passo(sep, ped.id, 'SEPARACAO'));
  ok(await passo(sep, ped.id, 'CONFERENCIA'));
  assert.equal(await saldo(sis, p), 5, 'até expedir, o estoque não sai');
  const antes = await disponivelDe(sis.db, p.id);
  const fim = ok(await passo(sep, ped.id, 'EXPEDICAO'));
  assert.deepEqual(fim.etapas.map((e) => [e.etapa, e.quem]), [['SEPARACAO', 'Sam Separa'], ['CONFERENCIA', 'Sam Separa'], ['EXPEDICAO', 'Sam Separa']]);
  assert.equal(await saldo(sis, p), 3);
  const depois = await disponivelDe(sis.db, p.id);
  assert.deepEqual([depois.reservado, depois.disponivel], [antes.reservado - 2, antes.disponivel]);
  const baixas = await sis.db.all('SELECT delta, documento FROM movimentacoes_estoque WHERE grupo = ?', `pedido-${ped.id}`);
  assert.deepEqual([baixas.length, Number(baixas[0].delta), baixas[0].documento], [1, -2, `Pedido ${ped.canal}`]);

  falha(await passo(sep, ped.id, 'EXPEDICAO'), 409, 'JA_FEITA');
  falha(await dono.post(`/api/pedidos/${ped.id}/enviado`), 409, 'SEM_RESERVA');
  await chegar({ id: Number(ped.canal), qtd: 2 }); // o canal avisa de novo: não volta a reservar nem vira problema
  assert.equal((await sis.db.get('SELECT status FROM pedidos WHERE id = ?', ped.id)).status, 'PAGO');
  assert.equal(await saldo(sis, p), 3);
  assert.equal(ok(await dono.get('/api/expedicao-pedidos')).total, 0);
  assert.equal(ok(await dono.get('/api/expedicao-pedidos?situacao=expedidas')).total, 1);
  assert.ok(ok(await dono.get(`/api/expedicao-pedidos/${ped.id}`)).itens[0].enderecos.length, 'mostra de onde saiu');
  for (const sql of ['DELETE FROM pedido_etapas', "UPDATE pedido_etapas SET observacao = 'x'"]) await assert.rejects(async () => await sis.db.run(sql), /imut/i);

  const a = ok(await dono.get('/api/atividade'));
  const sam = a.pessoas.find((x) => x.nome === 'Sam Separa');
  assert.deepEqual([sam.separacoes, sam.conferencias, sam.expedicoes, sam.bipagens], [1, 1, 1, 0], 'a baixa do pedido não conta como bipagem');
  for (const trecho of [/separou o pedido da internet/, /conferiu o pedido da internet/, /expediu o pedido da internet/]) assert.ok(a.linha_do_tempo.some((e) => trecho.test(e.texto)), String(trecho));
}));

test('pedido sem mapeamento aparece como problema; cancelado depois de separado não sai do estoque; enviado à mão não volta', async () => await com(async ({ sis, dono, p, chegar }) => {
  const ruim = await chegar({ sku: 'NAO-EXISTE', qtd: 1 });
  assert.deepEqual([ok(await dono.get('/api/expedicao-pedidos')).com_problema, ok(await dono.get('/api/expedicao-pedidos')).total], [1, 0]);
  assert.match(falha(await passo(dono, ruim.id, 'SEPARACAO'), 409, 'STATUS').message, /problema/);
  const a = await chegar();
  ok(await passo(dono, a.id, 'SEPARACAO'));
  await chegar({ id: Number(a.canal), status: 'cancelled' });
  assert.match(falha(await passo(dono, a.id, 'CONFERENCIA'), 409, 'STATUS').message, /cancelado/);
  assert.equal(ok(await dono.get('/api/expedicao-pedidos')).total, 0);
  assert.equal((await disponivelDe(sis.db, p.id)).reservado, 0);
  const b = await chegar();
  ok(await dono.post(`/api/pedidos/${b.id}/enviado`));
  assert.equal(ok(await dono.get('/api/expedicao-pedidos')).total, 0);
  assert.equal(ok(await dono.get(`/api/expedicao-pedidos/${b.id}`)).enviado_a_mao, true);
  falha(await passo(dono, b.id, 'SEPARACAO'), 409, 'JA_ENVIADO');
  assert.equal(await saldo(sis, p), 5);
}));

test('sem estoque liberado o Expedir não grava nada; dois "Expedir" ao mesmo tempo dão uma baixa só', async () => await com(async ({ sis, dono, pick, p, chegar }) => {
  const a = await chegar();
  ok(await passo(dono, a.id, 'SEPARACAO'));
  ok(await passo(dono, a.id, 'CONFERENCIA'));
  ok(await dono.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: pick[0].id, qtd: 4, motivo: 'uso interno do teste' }), 201);
  assert.match(falha(await passo(dono, a.id, 'EXPEDICAO'), 409, 'ESTOQUE_INSUFICIENTE').message, /precisa de 2 e há 1/);
  assert.equal(await saldo(sis, p), 1);
  assert.equal((await disponivelDe(sis.db, p.id)).reservado, 2, 'a reserva continua');
  assert.equal(ok(await dono.get(`/api/expedicao-pedidos/${a.id}`)).etapas.length, 2);
  ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: pick[0].id, qtd: 3 }), 201);
  const duas = await Promise.all([1, 2].map(() => passo(dono, a.id, 'EXPEDICAO')));
  assert.deepEqual(duas.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await saldo(sis, p), 2);
}));

test('um pedido a mais não trava os anteriores: quem chegou primeiro fica com as unidades', async () => await com(async ({ sis, dono, pick, p, chegar }) => {
  const primeiro = await chegar({ qtd: 3 });
  const segundo = await chegar({ qtd: 3 }); // há 5: faltaria 1 para este
  assert.deepEqual([primeiro.status, segundo.status], ['PAGO', 'COM_PROBLEMA']);
  assert.match(segundo.problema, /faltam 1/);
  assert.equal((await chegar({ id: Number(primeiro.canal), qtd: 3 })).status, 'PAGO', 'o canal avisa de novo e o primeiro continua na fila');
  assert.deepEqual([ok(await dono.get('/api/expedicao-pedidos')).total, ok(await dono.get('/api/expedicao-pedidos')).com_problema], [1, 1]);
  for (const etapa of ['SEPARACAO', 'CONFERENCIA', 'EXPEDICAO']) ok(await passo(dono, primeiro.id, etapa, 3));
  assert.equal(await saldo(sis, p), 2);
  assert.equal((await chegar({ id: Number(segundo.canal), qtd: 3 })).status, 'COM_PROBLEMA');
  ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: pick[0].id, qtd: 1 }), 201);
  assert.equal((await chegar({ id: Number(segundo.canal), qtd: 3 })).status, 'PAGO');
}));

test('permissões e entradas inválidas', async () => await com(async ({ sis, dono, chegar }) => {
  const a = await chegar();
  const olha = await contratar(sis, dono, { nome: 'Olga Olha', papel: 'personalizado', permissoes: ['expedicao.ver'] });
  assert.equal(ok(await olha.get('/api/expedicao-pedidos')).total, 1);
  falha(await passo(olha, a.id, 'SEPARACAO'), 403, 'SEM_PERMISSAO');
  const fora = await contratar(sis, dono, { nome: 'Fora Daqui', papel: 'personalizado', permissoes: ['produtos.ver'] });
  falha(await fora.get('/api/expedicao-pedidos'), 403, 'SEM_PERMISSAO');
  falha(await fora.get(`/api/expedicao-pedidos/${a.id}`), 403, 'SEM_PERMISSAO');
  for (const rota of ['/api/expedicao-pedidos/999999', '/api/expedicao-pedidos/abc']) { const r = await dono.get(rota); assert.ok(r.status >= 400 && r.status < 500, r.texto); }
  for (const corpo of [{}, { etapa: 'X' }, { etapa: 'SEPARACAO', leituras: 'a' }, { etapa: 'SEPARACAO', leituras: [null] }]) { const r = await dono.post(`/api/expedicao-pedidos/${a.id}/etapa`, corpo); assert.ok(r.status >= 400 && r.status < 500, r.texto); }
}));
