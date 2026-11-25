// Venda presencial (balcão): caixa, venda, pagamentos, estoque, cancelamento, orçamento, permissões, Pix, relatórios e backup.
// Roda nos dois bancos (npm test = SQLite; npm run test:pg = PostgreSQL embutido).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { criarSistema, entrarCompleto, novoProduto, criarEnderecos, enderecoDe, SENHA_FORTE } from './helpers.js';
import { integridade } from '../src/modules/estoque.js';
import { integridadeVendas } from '../src/modules/relatorios.js';
import { verificarCadeia } from '../src/security/audit.js';
import { crc16, normalizarChavePix, payloadPix } from '../src/pix.js';
import { qrMatriz } from '../src/barcode/qr.js';
import { exportar, restaurar, verificar } from '../src/backup.js';
import { abrirBanco, migrar } from '../src/db.js';
import { PAPEIS, limparPermissoes } from '../src/permissoes.js';

const chave = () => crypto.randomBytes(12).toString('hex');
const SENHA_PESSOA = 'Lume!Verde#Telhado59';

/** Sistema pronto: dono logado, 4 endereços de picking e 4 de reserva. No fim confere estoque, vendas e auditoria. */
async function com(fn) {
  const sis = await criarSistema();
  try {
    const dono = await entrarCompleto(sis);
    const doTipo = async (tipo, rua) => (await criarEnderecos(dono, tipo, { rua })).filter((e) => e.rua === rua);
    const pick = await doTipo('PICKING', 1);
    const reserva = await doTipo('RESERVA', 2);
    await fn({ sis, dono, pick, reserva });
    assert.equal((await integridade(sis.db)).ok, true, 'estoque = livro-razão');
    assert.deepEqual(await integridadeVendas(sis.db), { ok: true, problemas: [] });
    assert.equal((await verificarCadeia(sis.db)).ok, true, 'auditoria íntegra');
  } finally { await sis.parar(); }
}

const ok = (r, status = 200) => { assert.equal(r.status, status, r.texto); return r.data; };
const falha = (r, status, codigo) => { assert.equal(r.status, status, r.texto); if (codigo) assert.equal(r.erro.code, codigo, r.texto); return r.erro; };

async function contratar(sis, dono, dados) {
  const nova = ok(await dono.post('/api/equipe', dados), 201);
  const c = sis.cliente();
  await c.get('/api/sessao');
  ok(await c.post('/api/login', { login: nova.login, senha: nova.senha_provisoria }));
  ok(await c.post('/api/senha/trocar', { senha_atual: nova.senha_provisoria, senha_nova: SENHA_PESSOA }));
  return c;
}
async function entrarDeNovo(sis) {
  const c = sis.cliente();
  await c.get('/api/sessao');
  ok(await c.post('/api/login', { login: '52998224725', senha: SENHA_FORTE }));
  return c;
}
const comEstoque = async (c, endereco, qtd, extra = {}, recebimento = {}) => {
  const p = await novoProduto(c, { preco_centavos: 1000, custo_centavos: 400, ...extra });
  if (qtd) ok(await c.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: endereco.id, qtd, ...recebimento }), 201);
  return p;
};
const abrir = async (c, valor = 10000) => ok(await c.idem('/api/caixa/abrir', { abertura_centavos: valor }), 201);
const item = (p, qtd, extra = {}) => ({ tipo: 'PRODUTO', id: p.id, qtd, ...extra });
const corpo = (itens, total, pagamentos = [{ forma: 'DINHEIRO', valor_centavos: total }], extra = {}) => ({ itens, valor_esperado_centavos: total, pagamentos, ...extra });
const saldoEm = async (sis, produtoId, enderecoId) => Number((await sis.db.get('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE produto_id = ? AND endereco_id = ?', produtoId, enderecoId)).q);
const reautenticar = async (c, senha = SENHA_FORTE) => ok(await c.post('/api/reautenticar', { senha }));

test('venda: exige caixa aberto, baixa do picking primeiro, calcula troco e aparece no caixa', async () => await com(async ({ sis, dono, pick, reserva }) => {
  const p = await comEstoque(dono, reserva[0], 10);
  ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: pick[3].id, qtd: 2 }), 201);
  ok(await dono.put(`/api/produtos/${p.id}/picking`, { endereco_id: pick[3].id }));
  falha(await dono.idem('/api/vendas', corpo([item(p, 3)], 3000)), 409, 'CAIXA_FECHADO');
  await abrir(dono);
  falha(await dono.idem('/api/caixa/abrir', { abertura_centavos: 0 }), 409, 'CAIXA_JA_ABERTO');
  const v = ok(await dono.idem('/api/vendas', corpo([item(p, 3)], 3000, [{ forma: 'DINHEIRO', valor_centavos: 5000 }])), 201);
  assert.equal(v.troco_centavos, 2000);
  assert.equal(await saldoEm(sis, p.id, pick[3].id), 0, 'o picking sai primeiro');
  assert.equal(await saldoEm(sis, p.id, reserva[0].id), 9);
  const d = ok(await dono.get(`/api/vendas/${v.id}`));
  assert.deepEqual(d.pagamentos, [{ forma: 'DINHEIRO', valor_centavos: 3000, parcelas: 1 }], 'grava o valor já sem o troco');
  assert.equal(d.itens[0].valor_centavos, 3000);
  const { caixa } = ok(await dono.get('/api/caixa'));
  assert.equal(caixa.resumo.esperado_centavos, 13000);
  assert.equal(caixa.resumo.por_forma.DINHEIRO, 3000);
  assert.equal(ok(await dono.get('/api/painel')).vendas_hoje.valor_centavos, 3000);
}));

test('venda repetida com a mesma chave (duplo clique, internet caindo) não vende nem baixa duas vezes', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 5);
  await abrir(dono);
  const k = chave();
  const a = ok(await dono.idem('/api/vendas', corpo([item(p, 2)], 2000), k), 201);
  const b = await dono.idem('/api/vendas', corpo([item(p, 2)], 2000), k);
  assert.equal(b.data.id, a.id);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(await saldoEm(sis, p.id, pick[0].id), 3);
  falha(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000), k), 422, 'IDEMPOTENCIA');
}));

test('preço e desconto: o servidor manda no preço; quem não tem permissão não muda nem passa do limite', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 20);
  const semPreco = await comEstoque(dono, pick[1], 5, { preco_centavos: 0 });
  const vend = await contratar(sis, dono, { nome: 'Vera Vendas', papel: 'vendedor' });
  await abrir(vend, 0);
  falha(await vend.idem('/api/vendas', corpo([item(p, 1, { preco_unit_centavos: 1 })], 1)), 403, 'SEM_PERMISSAO');
  falha(await vend.idem('/api/vendas', corpo([item(semPreco, 1)], 1)), 409, 'SEM_PRECO');
  falha(await vend.idem('/api/vendas', corpo([item(p, 2)], 1900, undefined, { desconto_centavos: 100 })), 403, 'DESCONTO');
  falha(await vend.idem('/api/vendas', corpo([item(p, 2)], 1800)), 409, 'PRECO_MUDOU');
  await reautenticar(dono);
  ok(await dono.put('/api/balcao/config', { desconto_max_pct: 10 }));
  ok(await vend.idem('/api/vendas', corpo([item(p, 2)], 1800, undefined, { desconto_centavos: 200 })), 201);
  falha(await vend.idem('/api/vendas', corpo([item(p, 2)], 1799, undefined, { desconto_centavos: 201 })), 403, 'DESCONTO');
  // o dono (tem vendas.desconto) vende abaixo da tabela, mas nunca de graça
  await abrir(dono, 0);
  ok(await dono.idem('/api/vendas', corpo([item(p, 1, { preco_unit_centavos: 500 })], 500)), 201);
  falha(await dono.idem('/api/vendas', corpo([item(p, 1)], 1, undefined, { desconto_centavos: 1000 })), 422);
}));

test('pagamentos: falta dinheiro, cartão acima do total, combinação com troco e parcelas', async () => await com(async ({ dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 20);
  await abrir(dono, 0);
  const tentar = (pagamentos) => dono.idem('/api/vendas', corpo([item(p, 5)], 5000, pagamentos));
  falha(await tentar([{ forma: 'PIX', valor_centavos: 4999 }]), 409, 'PAGAMENTO_INSUFICIENTE');
  falha(await tentar([{ forma: 'CREDITO', valor_centavos: 5001 }]), 409, 'PAGAMENTO_EXCEDE');
  falha(await tentar([{ forma: 'PIX', valor_centavos: 5000 }, { forma: 'DINHEIRO', valor_centavos: 100 }]), 409, 'PAGAMENTO_EXCEDE');
  falha(await tentar([]), 422);
  falha(await tentar([{ forma: 'CHEQUE', valor_centavos: 5000 }]), 422);
  falha(await tentar([{ forma: 'DINHEIRO', valor_centavos: -1 }]), 422);
  const v = ok(await tentar([{ forma: 'CREDITO', valor_centavos: 3000, parcelas: 3 }, { forma: 'DINHEIRO', valor_centavos: 1500 }, { forma: 'DINHEIRO', valor_centavos: 1000 }]), 201);
  assert.equal(v.troco_centavos, 500);
  const { pagamentos } = ok(await dono.get(`/api/vendas/${v.id}`));
  assert.deepEqual(pagamentos, [{ forma: 'DINHEIRO', valor_centavos: 2000, parcelas: 1 }, { forma: 'CREDITO', valor_centavos: 3000, parcelas: 3 }]);
}));

test('estoque: não vende além do saldo, nem de recebimento/bloqueado, e respeita reservas da internet', async () => await com(async ({ sis, dono, pick }) => {
  const rec = await enderecoDe(dono, 'RECEBIMENTO');
  const p = await comEstoque(dono, pick[0], 5);
  if (rec) ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: rec.id, qtd: 7 }), 201);
  await abrir(dono, 0);
  const e = falha(await dono.idem('/api/vendas', corpo([item(p, 6)], 6000)), 409, 'ESTOQUE_INSUFICIENTE');
  assert.match(e.message, /pode vender 5/);
  falha(await dono.idem('/api/vendas', corpo([item(p, 3), item(p, 3)], 6000)), 409, 'ESTOQUE_INSUFICIENTE');
  assert.equal(await saldoEm(sis, p.id, pick[0].id), 5, 'venda recusada não mexe no estoque');
  assert.equal(Number((await sis.db.get('SELECT COUNT(*) c FROM vendas')).c), 0, 'venda recusada não é gravada');
  // 4 reservadas por um pedido da internet: no balcão sobra 1
  const canal = (await sis.db.get("SELECT id FROM canais WHERE codigo = 'ML'")).id;
  const conta = (await sis.db.get('SELECT id FROM contas_canal WHERE canal_id = ?', canal))?.id ?? await sis.db.insert('INSERT INTO contas_canal (canal_id, criado_em, atualizado_em) VALUES (?,1,1)', canal);
  const ped = await sis.db.insert("INSERT INTO pedidos (conta_id, canal_pedido_id, status, total_centavos, criado_em, atualizado_em) VALUES (?,'9','PAGO',0,1,1)", conta);
  const pi = await sis.db.insert("INSERT INTO pedido_itens (pedido_id, item_id, variacao_id, titulo, qtd, preco_centavos) VALUES (?,'MLB1','','x',4,0)", ped);
  await sis.db.run("INSERT INTO reservas (pedido_item_id, produto_id, qtd, status, criado_em, atualizado_em) VALUES (?,?,4,'ATIVA',1,1)", pi, p.id);
  const e2 = falha(await dono.idem('/api/vendas', corpo([item(p, 2)], 2000)), 409, 'ESTOQUE_INSUFICIENTE');
  assert.match(e2.message, /reservada/);
  ok(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  // endereço bloqueado não entra na venda
  const q = await comEstoque(dono, pick[1], 3);
  await sis.db.run("UPDATE enderecos SET bloqueado = 1, motivo_bloqueio = 'conferencia' WHERE id = ?", pick[1].id);
  falha(await dono.idem('/api/vendas', corpo([item(q, 1)], 1000)), 409, 'ESTOQUE_INSUFICIENTE');
  assert.equal(ok(await dono.get(`/api/balcao/buscar?q=${q.sku}`)).exato.disponivel, 0);
}));

test('lotes: vende primeiro o que vence antes e nunca o vencido', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 0, { controla_lote: 1, controla_validade: 1 });
  const dia = (n) => new Date(sis.relogio.t + n * 86_400_000).toISOString().slice(0, 10);
  for (const [e, lote, validade, qtd] of [[pick[0], 'NOVO', dia(300), 5], [pick[1], 'VELHO', dia(60), 2], [pick[2], 'CURTO', dia(3), 4]]) {
    ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: e.id, qtd, lote, validade }), 201);
  }
  sis.relogio.t += 10 * 86_400_000; // o lote CURTO venceu
  const dono2 = await entrarDeNovo(sis);
  await abrir(dono2, 0);
  falha(await dono2.idem('/api/vendas', corpo([item(p, 8)], 8000)), 409, 'ESTOQUE_INSUFICIENTE');
  ok(await dono2.idem('/api/vendas', corpo([item(p, 3)], 3000)), 201);
  assert.deepEqual([await saldoEm(sis, p.id, pick[0].id), await saldoEm(sis, p.id, pick[1].id), await saldoEm(sis, p.id, pick[2].id)], [4, 0, 4]);
}));

test('duas vendas ao mesmo tempo das últimas unidades: só uma passa e o estoque nunca fica negativo', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 3);
  const a = await contratar(sis, dono, { nome: 'Ana Balcão', papel: 'vendedor' });
  const b = await contratar(sis, dono, { nome: 'Beto Balcão', papel: 'vendedor' });
  await abrir(a, 0); await abrir(b, 0);
  const r = await Promise.all([a, b].map((c) => c.idem('/api/vendas', corpo([item(p, 2)], 2000))));
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409], r.map((x) => x.texto).join('\n'));
  assert.equal(await saldoEm(sis, p.id, pick[0].id), 1);
}));

test('cancelamento: pede permissão e senha, devolve ao mesmo endereço, acerta o caixa e não repete', async () => await com(async ({ sis, dono, pick, reserva }) => {
  const p = await comEstoque(dono, pick[0], 2);
  ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: reserva[0].id, qtd: 5 }), 201);
  const vend = await contratar(sis, dono, { nome: 'Vera Vendas', papel: 'vendedor' });
  await abrir(vend, 0);
  const v = ok(await vend.idem('/api/vendas', corpo([item(p, 4)], 4000, [{ forma: 'DINHEIRO', valor_centavos: 3000 }, { forma: 'PIX', valor_centavos: 1000 }])), 201);
  falha(await vend.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'cliente desistiu' }), 403, 'SEM_PERMISSAO');
  sis.relogio.t += 6 * 60_000; // passou a janela de confirmação de identidade
  falha(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'cliente desistiu' }), 403, 'REAUTENTICACAO');
  await reautenticar(dono);
  falha(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'x' }), 422);
  const c = ok(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'cliente desistiu' }));
  assert.equal(c.devolver_dinheiro_centavos, 3000);
  assert.deepEqual(c.estornar_fora, [{ forma: 'PIX', valor_centavos: 1000 }]);
  assert.deepEqual([await saldoEm(sis, p.id, pick[0].id), await saldoEm(sis, p.id, reserva[0].id)], [2, 5]);
  falha(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'de novo não' }), 409, 'STATUS');
  assert.equal(ok(await vend.get('/api/caixa')).caixa.resumo.vendas, 0);
  assert.equal(ok(await dono.get(`/api/vendas/${v.id}`)).status, 'CANCELADA');
}));

test('cancelar depois do caixa fechado: a devolução sai do caixa de quem cancela e a foto do fechamento não muda', async () => await com(async ({ dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 3);
  const primeiro = await abrir(dono, 0);
  const v = ok(await dono.idem('/api/vendas', corpo([item(p, 2)], 2000)), 201);
  ok(await dono.idem(`/api/caixas/${primeiro.id}/fechar`, { contado_centavos: 2000 }));
  await reautenticar(dono);
  falha(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'produto com defeito' }), 409, 'CAIXA_FECHADO');
  await abrir(dono, 500);
  falha(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'produto com defeito' }), 409, 'CAIXA_SEM_DINHEIRO');
  ok(await dono.idem('/api/caixa/movimento', { tipo: 'SUPRIMENTO', valor_centavos: 2000, motivo: 'troco para devolver' }), 201);
  ok(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'produto com defeito' }));
  const novo = ok(await dono.get('/api/caixa')).caixa;
  assert.equal(novo.resumo.estornos_centavos, 2000);
  assert.equal(novo.resumo.esperado_centavos, 500);
  const antigo = ok(await dono.get(`/api/caixas/${primeiro.id}`));
  assert.equal(antigo.resumo.esperado_centavos, 2000, 'fechamento antigo não é reescrito');
  assert.equal(antigo.diferenca_centavos, 0);
}));

test('caixa: sangria limitada, diferença exige explicação, conferência cega e um por pessoa', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 5);
  const vend = await contratar(sis, dono, { nome: 'Vera Vendas', papel: 'vendedor' });
  const outro = await contratar(sis, dono, { nome: 'Otto Vendas', papel: 'vendedor' });
  const cx = await abrir(vend, 1000);
  ok(await vend.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  falha(await vend.idem('/api/caixa/movimento', { tipo: 'SANGRIA', valor_centavos: 2001, motivo: 'depósito no banco' }), 409, 'CAIXA_SEM_DINHEIRO');
  ok(await vend.idem('/api/caixa/movimento', { tipo: 'SANGRIA', valor_centavos: 500, motivo: 'depósito no banco' }), 201);
  const cego = ok(await vend.get('/api/caixa')).caixa;
  assert.equal(cego.cego, true);
  assert.equal(cego.resumo.esperado_centavos, undefined, 'quem fecha não vê o esperado antes de contar');
  falha(await outro.get(`/api/caixas/${cx.id}`), 404);
  falha(await outro.idem(`/api/caixas/${cx.id}/fechar`, { contado_centavos: 0 }), 403, 'SEM_PERMISSAO');
  falha(await vend.idem(`/api/caixas/${cx.id}/fechar`, { contado_centavos: 1400 }), 409, 'CAIXA_DIFERENCA');
  const f = ok(await vend.idem(`/api/caixas/${cx.id}/fechar`, { contado_centavos: 1400, observacao: 'faltou troco' }));
  assert.equal(f.diferenca_centavos, -100);
  falha(await vend.idem(`/api/caixas/${cx.id}/fechar`, { contado_centavos: 1500 }), 409, 'CAIXA_FECHADO');
  falha(await vend.idem('/api/vendas', corpo([item(p, 1)], 1000)), 409, 'CAIXA_FECHADO');
  const cx2 = await abrir(outro, 100); // o gerente fecha o caixa esquecido por outra pessoa
  ok(await dono.idem(`/api/caixas/${cx2.id}/fechar`, { contado_centavos: 100 }));
  assert.equal(ok(await dono.get('/api/caixas')).total, 2);
}));

test('orçamento: não mexe no estoque, mantém o preço combinado, vence e não conclui duas vezes', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 5);
  const serv = ok(await dono.post('/api/servicos', { nome: 'Carga de gás', valor_centavos: 15000 }), 201);
  const itens = [item(p, 2), { tipo: 'SERVICO', id: serv.id, qtd: 1 }];
  const o = ok(await dono.idem('/api/orcamentos', { itens, valor_esperado_centavos: 17000 }), 201);
  const o2 = ok(await dono.idem('/api/orcamentos', { itens, valor_esperado_centavos: 17000 }), 201);
  assert.equal(await saldoEm(sis, p.id, pick[0].id), 5);
  ok(await dono.put(`/api/servicos/${serv.id}`, { nome: 'Carga de gás', valor_centavos: 20000, versao: 1 }));
  await abrir(dono, 0);
  const pagar = { pagamentos: [{ forma: 'DEBITO', valor_centavos: 17000 }] };
  const k = chave();
  ok(await dono.idem(`/api/vendas/${o.id}/concluir`, pagar, k));
  // a mesma chave e o mesmo corpo em OUTRO orçamento precisam executar de verdade
  assert.equal(ok(await dono.idem(`/api/vendas/${o2.id}/concluir`, pagar, k)).id, o2.id);
  assert.equal(ok(await dono.get(`/api/vendas/${o2.id}`)).status, 'CONCLUIDA');
  assert.equal(await saldoEm(sis, p.id, pick[0].id), 1);
  falha(await dono.idem(`/api/vendas/${o.id}/concluir`, pagar), 409, 'STATUS');
  falha(await dono.post(`/api/vendas/${o.id}/descartar`), 409, 'STATUS');
  const o3 = ok(await dono.idem('/api/orcamentos', { itens: [item(p, 1)], valor_esperado_centavos: 1000 }), 201);
  sis.relogio.t += 9 * 86_400_000;
  const dono2 = await entrarDeNovo(sis);
  falha(await dono2.idem(`/api/vendas/${o3.id}/concluir`, { pagamentos: [{ forma: 'PIX', valor_centavos: 1000 }] }), 409, 'ORCAMENTO_VENCIDO');
  ok(await dono2.post(`/api/vendas/${o3.id}/descartar`));
}));

test('cancelar venda de produto inativado depois: o produto volta a ficar ativo junto com o estoque', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 1);
  await abrir(dono, 0);
  const v = ok(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  ok(await dono.post(`/api/produtos/${p.id}/inativar`));
  await reautenticar(dono);
  ok(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'venda errada' }));
  assert.equal(await saldoEm(sis, p.id, pick[0].id), 1);
  assert.equal(ok(await dono.get(`/api/produtos/${p.id}`)).ativo, 1);
}));

test('permissões: vendedor vê preço de venda mas nunca custo; vê só as próprias vendas; Pix é só do dono', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 10);
  const vend = await contratar(sis, dono, { nome: 'Vera Vendas', papel: 'vendedor' });
  const olha = await contratar(sis, dono, { nome: 'Caio Consulta', papel: 'consulta' });
  const gerente = await contratar(sis, dono, { nome: 'Gil Gerente', papel: 'gerente' });
  await abrir(dono, 0); await abrir(vend, 0);
  const minha = ok(await vend.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  const deles = ok(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  const busca = await vend.get(`/api/balcao/buscar?q=${p.sku}`);
  assert.equal(ok(busca).exato.preco_unit_centavos, 1000);
  for (const r of [busca, await vend.get(`/api/vendas/${minha.id}`), await vend.get('/api/vendas'), await vend.get('/api/painel'), await vend.get(`/api/produtos/${p.id}`)]) {
    assert.doesNotMatch(r.texto, /custo|margem|"preco_centavos"/, r.texto);
  }
  falha(await vend.get(`/api/vendas/${deles.id}`), 404);
  assert.equal(ok(await vend.get('/api/vendas')).total, 1);
  assert.equal(ok(await gerente.get('/api/vendas')).total, 2);
  const rel = ok(await gerente.get('/api/relatorios/vendas'));
  assert.equal(rel.valor_centavos, 2000);
  assert.equal(rel.margem_centavos, undefined, 'gerente não tem financeiro');
  assert.equal(ok(await dono.get('/api/relatorios/vendas')).margem_centavos, 1200);
  falha(await vend.get('/api/relatorios/vendas'), 403);
  for (const rota of ['/api/vendas', '/api/caixa', '/api/clientes', '/api/balcao/buscar?q=x']) falha(await olha.get(rota), 403);
  assert.equal(ok(await olha.get('/api/painel')).vendas_hoje, null);
  falha(await gerente.put('/api/balcao/config', { pix_chave: 'a@b.com', pix_nome: 'X', pix_cidade: 'Y' }), 403, 'SEM_PERMISSAO');
  assert.ok(!limparPermissoes(['vendas.configurar']).length, 'ninguém recebe a permissão de configurar o Pix');
  assert.ok(!PAPEIS.gerente.permissoes.includes('vendas.configurar'));
  assert.equal(ok(await vend.get('/api/balcao/config')).pix_chave, undefined);
}));

test('Pix: só o dono configura (confirmando a identidade) e o código segue o padrão do Banco Central', async () => await com(async ({ sis, dono }) => {
  falha(await dono.post('/api/balcao/pix', { valor_centavos: 100 }), 409, 'PIX_NAO_CONFIGURADO');
  sis.relogio.t += 6 * 60_000;
  falha(await dono.put('/api/balcao/config', { pix_chave: 'loja@exemplo.com' }), 403, 'REAUTENTICACAO');
  await reautenticar(dono);
  falha(await dono.put('/api/balcao/config', { pix_chave: '123', pix_nome: 'Loja', pix_cidade: 'Palhoça' }), 422);
  falha(await dono.put('/api/balcao/config', { pix_chave: 'loja@exemplo.com' }), 422);
  ok(await dono.put('/api/balcao/config', { pix_chave: 'Loja@Exemplo.com', pix_nome: 'Peças & Serviços São José da Silva', pix_cidade: 'Palhoça' }));
  const r = ok(await dono.post('/api/balcao/pix', { valor_centavos: 123450 }));
  assert.equal(r.chave, 'loja@exemplo.com');
  assert.match(r.copia_e_cola, /^000201/);
  assert.match(r.copia_e_cola, /br\.gov\.bcb\.pix0116loja@exemplo\.com/);
  assert.match(r.copia_e_cola, /54071234\.505802BR/);
  assert.match(r.copia_e_cola, /6007PALHOCA62070503\*\*\*6304[0-9A-F]{4}$/);
  assert.equal(crc16(r.copia_e_cola.slice(0, -4)), r.copia_e_cola.slice(-4));
  assert.match(r.svg, /^<svg/);
  const log = await sis.db.get("SELECT detalhes FROM auditoria WHERE acao = 'CONFIG_VENDAS_ALTERADA' ORDER BY id DESC LIMIT 1");
  assert.ok(!log.detalhes.includes('exemplo.com'), 'a auditoria não guarda a chave');
}));

test('Pix: CRC de referência, formatos de chave e QR até com a maior chave possível', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(normalizarChavePix('529.982.247-25'), '52998224725');
  assert.equal(normalizarChavePix('+55 (48) 99999-0000'), '+5548999990000');
  assert.equal(normalizarChavePix('123E4567-E89B-12D3-A456-426614174000'), '123e4567-e89b-12d3-a456-426614174000');
  for (const ruim of ['', '48999990000', '11111111111', 'a@b', 'abc', '+1 555 000', `${'a'.repeat(70)}@exemplo.com`]) assert.equal(normalizarChavePix(ruim), null, ruim);
  const grande = payloadPix({ chave: `${'a'.repeat(65)}@exemplo.com`, nome: 'N'.repeat(25), cidade: 'C'.repeat(15), valorCentavos: 100_000_000_00 });
  assert.ok(grande.length <= 213, `tamanho ${grande.length}`);
  assert.ok(qrMatriz(grande).versao <= 10);
});

test('clientes e serviços: documento cifrado e mascarado, sem duplicar, busca por nome/telefone/CPF, histórico', async () => await com(async ({ sis, dono, pick }) => {
  falha(await dono.post('/api/clientes', { nome: 'Fulano', documento: '11111111111' }), 422);
  const c = ok(await dono.post('/api/clientes', { nome: 'José Antônio', documento: '529.982.247-25', telefone: '(48) 99999-0000' }), 201);
  assert.equal(c.documento_mascarado, '*********25');
  assert.equal(c.documento_enc, undefined);
  assert.ok(!(await sis.db.get('SELECT documento_enc FROM clientes WHERE id = ?', c.id)).documento_enc.includes('52998224725'));
  falha(await dono.post('/api/clientes', { nome: 'Outro', documento: '52998224725' }), 409, 'DOCUMENTO_DUPLICADO');
  for (const q of ['jose', '99999', '52998224725']) assert.equal(ok(await dono.get(`/api/clientes?q=${q}`)).total, 1, q);
  const alterado = ok(await dono.put(`/api/clientes/${c.id}`, { nome: 'José A.', versao: 1 }));
  assert.equal(alterado.documento_mascarado, '*********25', 'editar sem digitar o documento mantém o salvo');
  falha(await dono.put(`/api/clientes/${c.id}`, { nome: 'Velho', versao: 1 }), 409, 'VERSAO');
  const p = await comEstoque(dono, pick[0], 2);
  await abrir(dono, 0);
  ok(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000, undefined, { cliente_id: c.id })), 201);
  assert.equal(ok(await dono.get(`/api/clientes/${c.id}`)).compras.length, 1);
  assert.equal(ok(await dono.get('/api/vendas?q=jose')).total, 1);
  ok(await dono.post(`/api/clientes/${c.id}/inativar`));
  falha(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000, undefined, { cliente_id: c.id })), 422);
}));

test('relatório e planilha: totais por forma/vendedor/produto, datas no fuso da loja e entradas ruins', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 10, { sku: 'REL-1', nome: 'Capacitor 35uF' });
  const vend = await contratar(sis, dono, { nome: 'Vera Vendas', papel: 'vendedor' });
  await abrir(dono, 0); await abrir(vend, 0);
  ok(await dono.idem('/api/vendas', corpo([item(p, 3)], 2900, [{ forma: 'PIX', valor_centavos: 2900 }], { desconto_centavos: 100 })), 201);
  ok(await vend.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  const r = ok(await dono.get('/api/relatorios/vendas'));
  assert.deepEqual([r.vendas, r.subtotal_centavos, r.desconto_centavos, r.valor_centavos, r.ticket_medio_centavos], [2, 4000, 100, 3900, 1950]);
  assert.deepEqual(r.por_forma.map((x) => [x.forma, x.valor_centavos]), [['PIX', 2900], ['DINHEIRO', 1000]]);
  assert.equal(r.por_vendedor.length, 2);
  assert.deepEqual([r.mais_vendidos[0].qtd, r.mais_vendidos[0].valor_centavos], [4, 4000]);
  assert.equal(r.por_dia.length, 1);
  assert.equal(r.margem_centavos, 3900 - 1600);
  assert.equal(ok(await dono.get('/api/relatorios/vendas?de=2000-01-01&ate=2000-01-31')).vendas, 0);
  for (const q of ['de=ontem', 'de=2026-01-02&ate=2026-01-01', 'de=2000-01-01&ate=2026-01-01', 'de=2026-13-45']) falha(await dono.get(`/api/relatorios/vendas?${q}`), 422);
  const csv = await dono.get('/api/relatorios/vendas.csv');
  assert.equal(csv.status, 200, csv.texto);
  assert.match(csv.texto, /"29,00";"PIX 29,00"/);
  falha(await dono.get('/api/vendas?de=xx'), 422);
}));

test('entradas absurdas no balcão: nunca erro 500', async () => await com(async ({ dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 3);
  await abrir(dono, 0);
  const lixo = [null, 'x', 1e30, -1, 1.5, [], {}, [null], [{}], [{ id: 'a', qtd: 1 }], [{ id: p.id, qtd: 0 }], [{ id: p.id, qtd: 1e9 }], [{ id: 999999999, qtd: 1 }], [{ tipo: 'SERVICO', id: 999, qtd: 1 }], [{ id: p.id, qtd: 100000, preco_unit_centavos: 10000000000 }], Array(200).fill({ id: p.id, qtd: 1 })];
  for (const itens of lixo) {
    for (const rota of ['/api/vendas', '/api/orcamentos']) {
      const r = await dono.idem(rota, { itens, valor_esperado_centavos: 1000, pagamentos: null });
      assert.ok(r.status >= 400 && r.status < 500, `${rota} ${JSON.stringify(itens)?.slice(0, 60)} -> ${r.status} ${r.texto}`);
    }
  }
  for (const pagamentos of lixo) {
    const r = await dono.idem('/api/vendas', { itens: [item(p, 1)], valor_esperado_centavos: 1000, pagamentos });
    assert.ok(r.status >= 400 && r.status < 500, `pagamentos ${JSON.stringify(pagamentos)?.slice(0, 60)} -> ${r.status} ${r.texto}`);
  }
  for (const rota of ['/api/vendas/999999999', '/api/vendas/abc', '/api/caixas/999999999', '/api/clientes/999999999', '/api/vendas/1.5', '/api/vendas?pagina=-1&status=%27', '/api/balcao/buscar', '/api/balcao/buscar?q=%25%27%22', `/api/balcao/buscar?q=${'a'.repeat(5000)}`, '/api/clientes?q=%25_', '/api/caixas?pagina=abc']) {
    const r = await dono.get(rota);
    assert.ok(r.status < 500, `${rota} -> ${r.status} ${r.texto}`);
  }
  for (const [rota, b] of [['/api/vendas/999999/concluir', {}], ['/api/vendas/999999/descartar', {}], ['/api/caixas/999999/fechar', { contado_centavos: 0 }], ['/api/servicos', { nome: 'x', valor_centavos: -5 }], ['/api/balcao/pix', { valor_centavos: 'muito' }], ['/api/caixa/movimento', { tipo: 'ROUBO' }]]) {
    const r = await dono.idem(rota, b);
    assert.ok(r.status >= 400 && r.status < 500, `${rota} -> ${r.status} ${r.texto}`);
  }
}));

test('dinheiro registrado não se apaga nem se reescreve', async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 2);
  await abrir(dono, 0);
  ok(await dono.idem('/api/vendas', corpo([item(p, 1)], 1000)), 201);
  ok(await dono.idem('/api/caixa/movimento', { tipo: 'SUPRIMENTO', valor_centavos: 100, motivo: 'troco inicial' }), 201);
  for (const sql of ['DELETE FROM vendas', 'DELETE FROM venda_itens', 'DELETE FROM venda_pagamentos', 'UPDATE venda_pagamentos SET valor_centavos = 1', 'DELETE FROM caixa_movimentos', 'UPDATE caixa_movimentos SET valor_centavos = 1', 'DELETE FROM caixas']) {
    await assert.rejects(async () => await sis.db.run(sql), /imut/i, sql);
  }
}));

test('backup inclui o balcão e restaura num banco novo', { skip: process.env.TEST_DB === 'pg' && 'a restauração por arquivo é só para SQLite' }, async () => await com(async ({ sis, dono, pick }) => {
  const p = await comEstoque(dono, pick[0], 3);
  await abrir(dono, 0);
  ok(await dono.post('/api/clientes', { nome: 'Cliente Backup' }), 201);
  ok(await dono.idem('/api/vendas', corpo([item(p, 2)], 2000)), 201);
  const dados = await exportar(sis.db);
  for (const t of ['vendas', 'venda_itens', 'venda_pagamentos', 'caixas', 'clientes']) assert.ok(dados.tabelas[t]?.linhas.length, t);
  assert.equal(verificar(dados).ok, true);
  const novo = await abrirBanco({ dbPath: ':memory:' });
  try {
    await migrar(novo, sis.cfg.migrationsDir);
    await restaurar(novo, dados);
    assert.deepEqual(await integridadeVendas(novo), { ok: true, problemas: [] });
    assert.equal((await integridade(novo)).ok, true);
  } finally { await novo.fechar(); }
}));
