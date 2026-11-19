import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { criarSistema, entrarCompleto, criarEnderecos, SENHA_FORTE } from './helpers.js';
import { criarMLFalso, APP_ID, APP_SECRET, CODIGO } from './ml-falso.js';
import { criarClienteML, ErroML } from '../src/integracoes/mercadolivre.js';
import { loadConfig } from '../src/config.js';
import { verificarCadeia } from '../src/security/audit.js';

async function com(fn) {
  const ml = await criarMLFalso();
  const sis = await criarSistema({ ml });
  sis.cfg.sessao.ociosoMs = 1e12; sis.cfg.sessao.absolutaMs = 1e12; // estes testes avançam o relógio por horas (vencimento de token)
  try { const c = await entrarCompleto(sis); await fn({ sis, c, ml }); } finally { await sis.parar(); await ml.fechar(); }
}
const callback = (sis, state, code = CODIGO) => fetch(`${sis.base}/api/integracoes/ml/callback?${new URLSearchParams({ code, state })}`, { redirect: 'manual' });

/** Inicia o OAuth como o navegador faria: pega a URL, extrai o state e volta pelo callback SEM cookie (como no redirecionamento do ML). */
async function autorizar({ sis, c }, code = CODIGO) {
  const r = await c.post('/api/integracoes/ml/conectar');
  assert.equal(r.status, 200, r.texto);
  const url = new URL(r.data.url);
  const state = url.searchParams.get('state');
  const cb = await callback(sis, state, code);
  await sis.integracoes.drenar();
  return { url, state, cb };
}
async function conectar(ctx, extra = {}) {
  const r = await ctx.c.put('/api/integracoes/ml/config', { app_id: APP_ID, app_secret: APP_SECRET, margem_seguranca: 0, ...extra });
  assert.equal(r.status, 200, r.texto);
  const a = await autorizar(ctx);
  assert.equal(a.cb.status, 302);
  return a;
}
const estado = async (c) => (await c.get('/api/integracoes')).data.ml;
let proxEnd = 0;
async function produto(c, sku, qtd = 0) {
  const p = (await c.post('/api/produtos', { sku, nome: `Produto ${sku}` })).data;
  if (qtd) {
    const ends = await criarEnderecos(c, 'PICKING', { predios: 4, pos: 2 });
    const r = await c.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: ends[proxEnd++ % ends.length].id, qtd });
    assert.equal(r.status, 201, r.texto);
  }
  return p;
}
const webhook = (sis, segredo, corpo, headers = {}) => fetch(`${sis.base}/api/integracoes/ml/webhook/${segredo}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
const segredoDe = async (c) => (await estado(c)).webhook_url.split('/').pop();
const notif = (ml, id) => ({ topic: 'orders_v2', resource: `/orders/${id}`, user_id: Number(ml.est.vendedor), application_id: Number(APP_ID), attempts: 1 });

test('OAuth: state é obrigatório, de uso único, expira e o callback não precisa de sessão', async () => await com(async (ctx) => {
  const { sis, c } = ctx;
  assert.equal((await c.post('/api/integracoes/ml/conectar')).erro.code, 'SEM_APP', 'sem App ID/segredo não conecta');
  await c.put('/api/integracoes/ml/config', { app_id: APP_ID, app_secret: APP_SECRET });
  assert.equal((await estado(c)).status, 'DESCONECTADA');
  const sem = await callback(sis, '', CODIGO);
  assert.match(sem.headers.get('location'), /erro=estado/);
  assert.match((await callback(sis, 'state-inventado-1234567890')).headers.get('location'), /erro=estado/);
  assert.equal((await estado(c)).status, 'DESCONECTADA');

  const a = await autorizar(ctx);
  assert.match(a.cb.headers.get('location'), /conectado=1/);
  assert.equal(a.url.origin, new URL(sis.cfg.ml.authBase).origin);
  assert.equal(a.url.searchParams.get('client_id'), APP_ID);
  assert.equal(a.url.searchParams.get('redirect_uri'), `${sis.cfg.publicOrigin || `http://${sis.cfg.host}:${sis.cfg.port}`}/api/integracoes/ml/callback`);
  assert.equal((await estado(c)).status, 'CONECTADA');
  assert.match((await callback(sis, a.state)).headers.get('location'), /erro=estado/, 'state já usado');

  const b = await c.post('/api/integracoes/ml/conectar');
  const st = new URL(b.data.url).searchParams.get('state');
  sis.relogio.t += 11 * 60_000;
  assert.match((await callback(sis, st)).headers.get('location'), /erro=estado/, 'state expirado');
  const d = await c.post('/api/integracoes/ml/conectar');
  const ruim = await callback(sis, new URL(d.data.url).searchParams.get('state'), 'codigo-errado');
  assert.match(ruim.headers.get('location'), /erro=conexao/);
}));

test('credenciais e tokens ficam cifrados; a API nunca os devolve', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const linha = JSON.stringify(await sis.db.get('SELECT * FROM contas_canal'));
  for (const segredo of [APP_SECRET, APP_ID, 'AT-1', 'RT-1']) assert.ok(!linha.includes(segredo), `vazou ${segredo} em claro no banco`);
  const resp = (await c.get('/api/integracoes')).texto;
  for (const segredo of [APP_SECRET, 'AT-1', 'RT-1']) assert.ok(!resp.includes(segredo), 'a API devolveu um segredo');
  assert.equal((await estado(c)).vendedor_id, ml.est.vendedor);
  assert.equal((await estado(c)).app_configurado, true);
}));

test('token: renova perto do vencimento (uma vez), refresh de uso único, 401 renova e repete', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  assert.equal(ml.est.refreshes, 0);
  sis.relogio.t += 21_400_000; // falta menos de 5 min para vencer
  const [a, b] = await Promise.all([c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' }), c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(ml.est.refreshes, 1, 'duas sincronizações simultâneas, uma única renovação');
  assert.ok(!ml.est.refresh.has('RT-1'), 'o refresh token antigo foi consumido');
  ml.est.forcar401 = 1; // o ML revoga o token antes da hora
  assert.equal((await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).status, 200);
  assert.equal(ml.est.refreshes, 2, '401 → renova e repete uma vez');
  assert.equal((await estado(c)).status, 'CONECTADA');
}));

test('refresh revogado: conta vai para REAUTORIZAR, saúde vermelha, sem vazar token', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  ml.est.refresh.clear();
  sis.relogio.t += 21_400_000;
  const r = await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  assert.equal(r.status, 502);
  const e = await estado(c);
  assert.equal(e.status, 'REAUTORIZAR'); assert.equal(e.saude.cor, 'vermelho');
  assert.ok(!JSON.stringify(e).includes('RT-') && !JSON.stringify(e).includes('AT-'));
  assert.equal((await c.post('/api/integracoes/ml/sincronizar', {})).erro.code, 'DESCONECTADA');
  const sem = await webhook(sis, await segredoDe(c), notif(ml, 1));
  assert.equal((await sem.json()).data.ignorado, true, 'webhook com conta sem autorização é ignorado');
  assert.ok(await sis.db.get("SELECT 1 FROM auditoria WHERE acao = 'ML_REAUTORIZAR'"));
  await autorizar(ctx); // reconectar resolve
  assert.equal((await estado(c)).status, 'CONECTADA');
}));

test('webhook: só segredo certo; corpo nunca é confiado; pedido vem da API; duplicado não duplica', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const p = await produto(c, 'CAM-001', 10);
  ml.item('MLB1000001'); ml.pedido(9001, { itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 2 }] });
  const seg = await segredoDe(c);

  assert.equal((await webhook(sis, 'segredo-errado', notif(ml, 9001))).status, 404);
  assert.equal((await webhook(sis, seg, '{json quebrado')).status, 400);
  assert.equal((await webhook(sis, seg, notif(ml, 9001), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await webhook(sis, seg, JSON.stringify({ x: 'a'.repeat(20_000) }))).status, 413);
  // notificações fora do padrão são aceitas (200) mas ignoradas
  for (const corpo of [{ ...notif(ml, 9001), topic: 'items' }, { ...notif(ml, 9001), resource: '/orders/9001/../../users/me' }, { ...notif(ml, 9001), resource: '/orders/abc' }, { ...notif(ml, 9001), user_id: 1 }, [], '"texto"', 'null']) {
    const r = await webhook(sis, seg, corpo); assert.equal(r.status, 200); assert.equal((await r.json()).data.ignorado, true);
  }
  await sis.integracoes.drenar();
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM pedidos')).c, 0);
  assert.equal(ml.est.chamadas.filter((x) => /^\/orders\/[^s]/.test(x.p)).length, 0, 'nada ignorado chegou à API do ML');

  const antes = ml.est.chamadas.length;
  const ok = await webhook(sis, seg, notif(ml, 9001));
  assert.equal(ok.status, 200);
  const dup = await webhook(sis, seg, notif(ml, 9001));
  assert.equal(dup.status, 200);
  await sis.integracoes.drenar();
  assert.ok(ml.est.chamadas.slice(antes).some((x) => x.p === '/orders/9001' && x.auth.startsWith('Bearer ')), 'o pedido foi buscado na API com o token');
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM pedidos')).c, 1);
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM reservas')).c, 1);
  await webhook(sis, seg, notif(ml, 9001)); await sis.integracoes.drenar(); // reenvio tardio
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM pedidos')).c, 1);
  assert.equal((await sis.db.get("SELECT COALESCE(SUM(qtd),0) q FROM reservas WHERE status = 'ATIVA'")).q, 2, 'reservou 2, uma única vez');
  const onde = (await c.get(`/api/estoque/onde/${p.id}`)).data;
  assert.equal(onde.total, 10); assert.equal(onde.reservado, 2); assert.equal(onde.disponivel, 8);
  assert.equal((await sis.db.get('SELECT status FROM pedidos')).status, 'PAGO');
}));

test('webhook de pedido de outro vendedor é descartado mesmo com segredo certo', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  await produto(c, 'CAM-001', 5); ml.item('MLB1000001');
  ml.pedido(9100, { vendedor: '123123123', itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 1 }] });
  await webhook(sis, await segredoDe(c), notif(ml, 9100));
  await sis.integracoes.drenar();
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM pedidos')).c, 0);
  assert.match((await sis.db.get('SELECT resultado FROM webhooks_recebidos')).resultado, /outro vendedor/);
}));

test('segredo do webhook pode ser rotacionado e a URL antiga morre', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const velho = await segredoDe(c);
  assert.equal((await webhook(sis, velho, notif(ml, 1))).status, 200);
  assert.equal((await c.post('/api/integracoes/ml/rotacionar-webhook')).status, 200);
  assert.equal((await webhook(sis, velho, notif(ml, 1))).status, 404);
  assert.notEqual(await segredoDe(c), velho);
}));

test('polling importa sem duplicar; cancelamento libera a reserva e cancelado é terminal', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const p = await produto(c, 'CAM-001', 10); ml.item('MLB1000001');
  ml.pedido(9001, { itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 3 }] });
  const r1 = (await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).data.pedidos;
  assert.equal(r1.novos, 1);
  const r2 = (await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).data.pedidos;
  assert.equal(r2.novos, 0); assert.equal(r2.atualizados, 0);
  assert.equal((await c.get(`/api/estoque/onde/${p.id}`)).data.disponivel, 7);
  ml.pedido(9001, { status: 'cancelled', itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 3 }] });
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  assert.equal((await c.get('/api/pedidos?status=CANCELADO')).data.total, 1);
  assert.equal((await c.get(`/api/estoque/onde/${p.id}`)).data.disponivel, 10, 'a reserva foi liberada');
  ml.pedido(9001, { status: 'paid', itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 3 }] }); // o ML não "descancela"; se mandar, ignora
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  assert.equal((await sis.db.get('SELECT status FROM pedidos')).status, 'CANCELADO');
  assert.equal((await sis.db.get("SELECT COUNT(*) c FROM reservas WHERE status = 'ATIVA'")).c, 0);
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM pedidos')).c, 1);
}));

test('SKU não mapeado e venda acima do estoque viram COM_PROBLEMA e se resolvem', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const p = await produto(c, 'ABC-1', 2); ml.item('MLB1000099');
  ml.pedido(9002, { itens: [{ item: 'MLB1000099', sku: 'SKU-DESCONHECIDO', qtd: 1 }] });
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  let ped = (await c.get('/api/pedidos')).data.itens[0];
  assert.equal(ped.status, 'COM_PROBLEMA'); assert.match(ped.problema, /SKU não mapeado/);
  assert.equal((await estado(c)).sem_mapeamento, 1);
  const map = await c.post(`/api/produtos/${p.id}/anuncios`, { item_id: 'mlb1000099' });
  assert.equal(map.status, 201); assert.equal(map.data.item_id, 'MLB1000099');
  const rep = await c.post(`/api/pedidos/${ped.id}/reprocessar`, {});
  assert.equal(rep.data.status, 'PAGO');
  assert.equal((await sis.db.get("SELECT COUNT(*) c FROM reservas WHERE status = 'ATIVA'")).c, 1);

  const q = await produto(c, 'ESC-1', 1); ml.item('MLB1000050');
  ml.pedido(9003, { itens: [{ item: 'MLB1000050', sku: 'ESC-1', qtd: 3 }] });
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  ped = (await c.get('/api/pedidos?status=COM_PROBLEMA')).data.itens[0];
  assert.match(ped.problema, /Estoque insuficiente: ESC-1 \(faltam 2\)/);
  const ends = await criarEnderecos(c, 'PICKING', { predios: 4, pos: 2 });
  await c.idem('/api/estoque/receber', { produto_id: q.id, endereco_id: ends[7].id, qtd: 5 });
  assert.equal((await c.post(`/api/pedidos/${ped.id}/reprocessar`, {})).data.status, 'PAGO');
  const det = (await c.get(`/api/pedidos/${ped.id}`)).data;
  assert.equal(det.itens[0].reserva, 'ATIVA'); assert.equal(det.itens[0].sku_interno, 'ESC-1');
}));

test('pedidos malformados não entram e não derrubam a sincronização', async () => await com(async (ctx) => {
  const { c, ml, sis } = ctx;
  await conectar(ctx);
  await produto(c, 'CAM-001', 5); ml.item('MLB1000001');
  ml.pedido(9201, { itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 0 }] });
  ml.pedido(9202, { itens: [{ item: 'invalido', sku: 'CAM-001', qtd: 1 }] });
  ml.pedido(9203, { itens: [] });
  ml.pedido(9204, { itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 1 }] });
  const r = (await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).data.pedidos;
  assert.equal(r.novos, 1); assert.equal(r.erros, 3);
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM pedidos')).c, 1);
}));

test('mapeamento de anúncio: formato, dono, duplicidade e variações', async () => await com(async (ctx) => {
  const { c, ml } = ctx;
  await conectar(ctx);
  const p = await produto(c, 'CAM-001');
  const mapear = (corpo) => c.post(`/api/produtos/${p.id}/anuncios`, corpo);
  assert.equal((await mapear({ item_id: 'abc' })).status, 422);
  assert.equal((await mapear({ item_id: 'MLB1/../x' })).status, 422);
  assert.equal((await mapear({ item_id: 'MLB1000777' })).erro.code, 'NAO_ENCONTRADO');
  ml.item('MLB1000010', { seller_id: 424242 });
  assert.equal((await mapear({ item_id: 'MLB1000010' })).erro.campos.item_id, 'Este anúncio não pertence à conta conectada.');
  ml.item('MLB1000011');
  assert.equal((await mapear({ item_id: 'MLB1000011' })).status, 201);
  assert.equal((await mapear({ item_id: 'MLB1000011' })).erro.code, 'ANUNCIO_DUPLICADO');
  ml.item('MLB1000012', { variations: [{ id: 111 }, { id: 222 }] });
  assert.match((await mapear({ item_id: 'MLB1000012' })).erro.campos.variacao_id, /informe uma/);
  assert.equal((await mapear({ item_id: 'MLB1000012', variacao_id: '999' })).status, 422);
  assert.equal((await mapear({ item_id: 'MLB1000012', variacao_id: '222' })).status, 201);
  assert.equal((await c.get(`/api/produtos/${p.id}/anuncios`)).data.itens.length, 2);
  const id = (await c.get('/api/anuncios')).data.itens[0].id;
  assert.equal((await c.put(`/api/anuncios/${id}`, { sync_ativo: 0 })).data.sync_ativo, false);
  assert.equal((await c.delete(`/api/anuncios/${id}`)).status, 200);
  assert.equal((await c.delete(`/api/anuncios/${id}`)).status, 404);
}));

test('estoque → anúncio: disponível − reservas − margem, só quando muda, pausa em 0 e reativa', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx, { margem_seguranca: 2 });
  const p = await produto(c, 'CAM-001', 10);
  ml.item('MLB1000001', { available_quantity: 99 });
  await c.post(`/api/produtos/${p.id}/anuncios`, { item_id: 'MLB1000001' });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.map((a) => a.corpo), [{ available_quantity: 8 }], '10 − margem 2');
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'estoque' });
  assert.equal(ml.est.atualizacoes.length, 1, 'sem mudança, sem chamada');

  const ends = await criarEnderecos(c, 'PICKING', { predios: 4, pos: 2 });
  await c.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: ends[5].id, qtd: 5 });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.at(-1).corpo, { available_quantity: 13 }, 'o movimento de estoque dispara a sincronização');

  ml.pedido(9001, { itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 3 }] });
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.at(-1).corpo, { available_quantity: 10 }, '15 − 3 reservados − margem 2');
  ml.pedido(9001, { status: 'cancelled', itens: [{ item: 'MLB1000001', sku: 'CAM-001', qtd: 3 }] });
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.at(-1).corpo, { available_quantity: 13 }, 'cancelar devolve ao anúncio');

  await c.put('/api/integracoes/ml/config', { app_id: APP_ID, margem_seguranca: 0, pausar_sem_estoque: 1 });
  assert.equal((await estado(c)).status, 'CONECTADA', 'mesmas credenciais não derrubam a conexão');
  await sis.integracoes.drenar();
  const dispon = (await c.get(`/api/estoque/onde/${p.id}`)).data;
  for (const l of dispon.locais) await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: l.endereco_id, qtd: l.qtd, motivo: 'zerar para teste' });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.slice(-2).map((a) => a.corpo), [{ available_quantity: 0 }, { status: 'paused' }]);
  assert.equal(ml.est.itens.get('MLB1000001').status, 'paused');
  await c.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: ends[0].id, qtd: 3 });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.slice(-2).map((a) => a.corpo), [{ available_quantity: 3 }, { status: 'active' }]);
  // desligar a sincronização de um anúncio para de enviar
  const idAnuncio = (await c.get('/api/anuncios')).data.itens[0].id;
  await c.put(`/api/anuncios/${idAnuncio}`, { sync_ativo: 0 });
  const n = ml.est.atualizacoes.length;
  await c.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: ends[0].id, qtd: 1 });
  await sis.integracoes.drenar();
  assert.equal(ml.est.atualizacoes.length, n);
}));

test('anúncio com variação envia a quantidade da variação; erro por anúncio não para os outros', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const a = await produto(c, 'AAA-1', 4); const b = await produto(c, 'BBB-1', 6);
  ml.item('MLB1000020', { variations: [{ id: 555 }] }); ml.item('MLB1000021');
  await c.post(`/api/produtos/${a.id}/anuncios`, { item_id: 'MLB1000020', variacao_id: '555' });
  await c.post(`/api/produtos/${b.id}/anuncios`, { item_id: 'MLB1000021' });
  await sis.integracoes.drenar();
  assert.deepEqual(ml.est.atualizacoes.find((x) => x.id === 'MLB1000020'), { id: 'MLB1000020', corpo: { variations: [{ id: 555, available_quantity: 4 }] } }, 'variação envia a quantidade da variação');
  ml.est.itens.delete('MLB1000020'); // o anúncio sumiu do ML
  const ends = await criarEnderecos(c, 'PICKING', { predios: 4, pos: 2 });
  await c.idem('/api/estoque/receber', { produto_id: a.id, endereco_id: ends[6].id, qtd: 1 });
  await c.idem('/api/estoque/receber', { produto_id: b.id, endereco_id: ends[7].id, qtd: 1 });
  await sis.integracoes.drenar();
  const lista = (await c.get('/api/anuncios')).data.itens;
  assert.equal(lista.find((x) => x.sku === 'AAA-1').ultimo_erro, 'Anúncio não encontrado no Mercado Livre.');
  assert.equal(lista.find((x) => x.sku === 'BBB-1').ultima_qtd_enviada, 7, 'o outro anúncio foi atualizado mesmo com o primeiro falhando');
  ml.item('MLB1000020', { variations: [{ id: 555 }] });
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'estoque' });
  assert.deepEqual(ml.est.atualizacoes.at(-1), { id: 'MLB1000020', corpo: { variations: [{ id: 555, available_quantity: 5 }] } });
  assert.equal((await c.get('/api/anuncios')).data.itens.find((x) => x.sku === 'AAA-1').ultimo_erro, null, 'o erro some quando volta a funcionar');
}));

test('recuo exponencial em 429/5xx, saúde amarela e recuperação', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  ml.est.falhas429 = 2;
  assert.equal((await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).status, 200);
  assert.deepEqual(sis.atrasos.slice(0, 2), [1000, 1000], 'respeita o Retry-After');
  sis.atrasos.length = 0;
  ml.est.falhas500 = 40;
  assert.equal((await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).status, 502);
  assert.equal(sis.atrasos.length, 3, '4 tentativas, 3 esperas');
  assert.ok(sis.atrasos[1] > sis.atrasos[0] && sis.atrasos[2] > sis.atrasos[1], 'esperas crescem');
  let e = await estado(c);
  assert.equal(e.falhas_seguidas, 1); assert.equal(e.saude.cor, 'amarelo');
  await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' }); await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' });
  assert.equal((await estado(c)).saude.cor, 'vermelho', '3 falhas seguidas');
  ml.est.falhas500 = 0;
  assert.equal((await c.post('/api/integracoes/ml/sincronizar', { tipo: 'pedidos' })).status, 200);
  e = await estado(c);
  assert.equal(e.falhas_seguidas, 0); assert.equal(e.saude.cor, 'verde'); assert.equal(e.ultimo_erro, null);
  assert.ok(e.jobs.some((j) => j.tipo === 'PEDIDOS' && j.ok === 1) && e.jobs.some((j) => j.ok === 0));
}));

test('trocar a conta do vendedor desliga a sincronização dos anúncios antigos', async () => await com(async (ctx) => {
  const { sis, c, ml } = ctx;
  await conectar(ctx);
  const p = await produto(c, 'CAM-001', 5); ml.item('MLB1000001');
  await c.post(`/api/produtos/${p.id}/anuncios`, { item_id: 'MLB1000001' }); await sis.integracoes.drenar();
  assert.equal((await sis.db.get('SELECT sync_ativo FROM sku_marketplace')).sync_ativo, 1);
  ml.est.vendedor = '999888777';
  const a = await autorizar(ctx);
  assert.match(a.cb.headers.get('location'), /trocou=1/);
  assert.equal((await sis.db.get('SELECT sync_ativo FROM sku_marketplace')).sync_ativo, 0, 'nunca envia estoque para anúncios de outro dono');
  assert.ok(await sis.db.get("SELECT 1 FROM auditoria WHERE acao = 'ML_CONTA_TROCADA'"));
}));

test('desconectar apaga os tokens e para tudo', async () => await com(async (ctx) => {
  const { sis, c } = ctx;
  await conectar(ctx);
  assert.equal((await c.post('/api/integracoes/ml/desconectar', {})).data.status, 'DESCONECTADA');
  const row = await sis.db.get('SELECT access_token_enc, refresh_token_enc, status FROM contas_canal');
  assert.equal(row.access_token_enc, null); assert.equal(row.refresh_token_enc, null);
  assert.equal((await c.post('/api/integracoes/ml/sincronizar', {})).erro.code, 'DESCONECTADA');
}));

test('segurança das rotas: sessão, reautenticação, auditoria sem segredos', async () => await com(async (ctx) => {
  const { sis, c } = ctx;
  const anon = sis.cliente(); await anon.get('/api/sessao');
  for (const rota of ['/api/integracoes', '/api/pedidos', '/api/anuncios']) assert.equal((await anon.get(rota)).status, 401, rota);
  assert.equal((await anon.post('/api/integracoes/ml/conectar')).status, 401, 'sem sessão');
  assert.equal((await c.post('/api/integracoes/ml/conectar', {}, { semCsrf: true })).status, 403, 'sem CSRF');
  await conectar(ctx);
  sis.relogio.t += 6 * 60_000; // vence a janela de reautenticação
  c.csrf = (await c.get('/api/sessao')).data.csrf;
  for (const [m, rota] of [['put', '/api/integracoes/ml/config'], ['post', '/api/integracoes/ml/desconectar'], ['post', '/api/integracoes/ml/rotacionar-webhook']]) {
    assert.equal((await c[m](rota, { app_id: APP_ID })).erro.code, 'REAUTENTICACAO', rota);
  }
  await c.post('/api/reautenticar', { senha: SENHA_FORTE });
  assert.equal((await c.put('/api/integracoes/ml/config', { app_id: 'abc' })).status, 422, 'App ID numérico');
  const texto = JSON.stringify(await sis.db.all('SELECT * FROM auditoria'));
  for (const s of [APP_SECRET, 'AT-', 'RT-', CODIGO]) assert.ok(!texto.includes(s), `auditoria guardou ${s}`);
  for (const acao of ['ML_CONFIGURADO', 'ML_CONEXAO_INICIADA', 'ML_CONECTADO']) assert.ok(await sis.db.get('SELECT 1 FROM auditoria WHERE acao = ?', acao), acao);
  assert.equal((await verificarCadeia(sis.db)).ok, true);
}));

test('adapter: caminhos e IDs malformados nunca saem; hosts não são configuráveis em produção', async () => {
  const chamadas = [];
  const cfg = { ml: { apiBase: 'https://api.mercadolibre.com', authBase: 'https://auth.mercadolivre.com.br', esperar: async () => {} } };
  const cli = criarClienteML(cfg, { fetchImpl: async (u) => { chamadas.push(u); return new Response('{}', { status: 200 }); } });
  for (const f of [() => cli.buscarPedido('t', '1/../2'), () => cli.buscarPedido('t', 'abc'), () => cli.buscarItem('t', 'MLB1/x'), () => cli.atualizarItem('t', '../x', {}), () => cli.req('GET', '//evil.example/x'), () => cli.req('GET', '/a/../b'), () => cli.req('GET', 'https://evil.example/')]) {
    await assert.rejects(async () => f(), (e) => e instanceof ErroML && e.codigo !== undefined);
  }
  assert.equal(chamadas.length, 0, 'nenhuma chamada saiu');
  await cli.buscarPedido('t', '123');
  assert.equal(chamadas[0], 'https://api.mercadolibre.com/orders/123');

  const hex = () => crypto.randomBytes(32).toString('hex');
  const prod = loadConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://wms.exemplo.com.br', PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex(), ML_API_BASE: 'http://evil.example', ML_AUTH_BASE: 'http://evil.example' });
  assert.equal(prod.ml.apiBase, 'https://api.mercadolibre.com');
  assert.equal(prod.ml.authBase, 'https://auth.mercadolivre.com.br');
  const redirect = criarClienteML(cfg, { fetchImpl: async () => { throw new TypeError('redirect mode is set to error'); } });
  await assert.rejects(redirect.buscarPedido('t', '1'), (e) => e.codigo === 'REDE');
});
