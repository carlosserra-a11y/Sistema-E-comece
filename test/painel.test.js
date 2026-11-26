// Rastreio (separação, conferência, expedição), "Equipe em ação", painel, estoque por produto e exclusão de conta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, novoProduto, criarEnderecos } from './helpers.js';
import { verificarCadeia } from '../src/security/audit.js';

const SENHA = 'Lume!Verde#Telhado59';
const SENHA_DONO = 'Telhado!Verde#Lume47';
const ok = (r, status = 200) => { assert.equal(r.status, status, r.texto); return r.data; };
const falha = (r, status, codigo) => { assert.equal(r.status, status, r.texto); if (codigo) assert.equal(r.erro.code, codigo, r.texto); return r.erro; };

async function com(fn) {
  const sis = await criarSistema();
  try {
    const dono = await entrarCompleto(sis);
    const pick = (await criarEnderecos(dono, 'PICKING', { rua: 1 })).filter((e) => e.rua === 1);
    await fn({ sis, dono, pick });
    assert.equal((await verificarCadeia(sis.db)).ok, true);
  } finally { await sis.parar(); }
}
async function contratar(sis, dono, dados) {
  const nova = ok(await dono.post('/api/equipe', dados), 201);
  const c = sis.cliente();
  await c.get('/api/sessao');
  ok(await c.post('/api/login', { login: nova.login, senha: nova.senha_provisoria }));
  ok(await c.post('/api/senha/trocar', { senha_atual: nova.senha_provisoria, senha_nova: SENHA }));
  return { c, id: nova.id ?? (await sis.db.get('SELECT MAX(id) AS id FROM users')).id, login: nova.login };
}
async function vendaPronta({ sis, dono, pick }) {
  const p = await novoProduto(dono, { preco_centavos: 1000, sku: 'EXP-1' });
  ok(await dono.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: pick[0].id, qtd: 5 }), 201);
  const vend = await contratar(sis, dono, { nome: 'Vera Caixa', papel: 'vendedor' });
  ok(await vend.c.idem('/api/caixa/abrir', { abertura_centavos: 0 }), 201);
  const v = ok(await vend.c.idem('/api/vendas', { itens: [{ id: p.id, qtd: 3 }], valor_esperado_centavos: 3000, pagamentos: [{ forma: 'PIX', valor_centavos: 3000 }] }), 201);
  return { p, vend, v };
}

test('expedição: separar, conferir e expedir na ordem, bipando as quantidades certas; cada passo grava quem fez', async () => await com(async (s) => {
  const { sis, dono } = s;
  const { v, vend } = await vendaPronta(s);
  const sep = await contratar(sis, dono, { nome: 'Sam Separa', papel: 'operador' });
  const conf = await contratar(sis, dono, { nome: 'Caio Confere', papel: 'estoquista' });
  assert.equal(ok(await sep.c.get('/api/expedicao')).total, 1);
  const d = ok(await sep.c.get(`/api/expedicao/${v.id}`));
  assert.deepEqual([d.itens[0].sku, d.itens[0].qtd, d.vendedor_nome, d.caixa_de], ['EXP-1', 3, 'Vera Caixa', 'Vera Caixa']);
  assert.ok(d.itens[0].enderecos.length);
  assert.doesNotMatch(JSON.stringify(d), /centavos/);
  const passo = (c, etapa, leituras) => c.post(`/api/expedicao/${v.id}/etapa`, { etapa, leituras });
  falha(await passo(conf.c, 'CONFERENCIA', [{ codigo: 'EXP-1', qtd: 3 }]), 409, 'FORA_DE_ORDEM');
  falha(await passo(sep.c, 'SEPARACAO', []), 422);
  falha(await passo(sep.c, 'SEPARACAO', [{ codigo: 'EXP-1', qtd: 2 }]), 409, 'QUANTIDADE_DIFERENTE');
  falha(await passo(sep.c, 'SEPARACAO', [{ codigo: 'OUTRO', qtd: 3 }]), 409, 'LEITURA_ERRADA');
  ok(await passo(sep.c, 'SEPARACAO', [{ codigo: 'exp-1' }, { codigo: 'EXP-1', qtd: 2 }]));
  falha(await passo(sep.c, 'SEPARACAO', [{ codigo: 'EXP-1', qtd: 3 }]), 409, 'JA_FEITA');
  ok(await passo(conf.c, 'CONFERENCIA', [{ codigo: 'EXP-1', qtd: 3 }]));
  const fim = ok(await passo(conf.c, 'EXPEDICAO'));
  assert.deepEqual(fim.etapas.map((e) => [e.etapa, e.quem]), [['SEPARACAO', 'Sam Separa'], ['CONFERENCIA', 'Caio Confere'], ['EXPEDICAO', 'Caio Confere']]);
  assert.equal(ok(await sep.c.get('/api/expedicao')).total, 0);
  assert.equal(ok(await sep.c.get('/api/expedicao?situacao=expedidas')).total, 1);
  for (const sql of ['DELETE FROM etapas', "UPDATE etapas SET observacao = 'x'"]) await assert.rejects(async () => await sis.db.run(sql), /imut/i);

  const a = ok(await dono.get('/api/atividade'));
  const pessoa = (nome) => a.pessoas.find((x) => x.nome === nome);
  assert.deepEqual([pessoa('Sam Separa').separacoes, pessoa('Caio Confere').conferencias, pessoa('Caio Confere').expedicoes], [1, 1, 1]);
  assert.deepEqual([pessoa('Vera Caixa').vendas, pessoa('Vera Caixa').valor_centavos], [1, 3000]);
  assert.equal(pessoa('Vera Caixa').caixa_aberto.id > 0, true);
  assert.ok(a.pessoas.some((x) => x.bipagens === 1 && x.unidades === 5), 'o recebimento conta como bipagem de quem fez');
  for (const trecho of [/separou a venda/, /conferiu a venda/, /expediu a venda/, /abriu o caixa/, /recebeu 5 × EXP-1/]) assert.ok(a.linha_do_tempo.some((e) => trecho.test(e.texto)), String(trecho));
  falha(await vend.c.get('/api/atividade'), 403);
  for (const q of ['de=xx', 'de=2026-01-02&ate=2026-01-01', 'de=2000-01-01&ate=2026-01-01']) falha(await dono.get(`/api/atividade?${q}`), 422);
}));

test('expedição: venda cancelada não entra; sem permissão não opera; entrada inválida não derruba', async () => await com(async (s) => {
  const { sis, dono } = s;
  const { v } = await vendaPronta(s);
  const olha = await contratar(sis, dono, { nome: 'Olga Olha', papel: 'personalizado', permissoes: ['expedicao.ver'] });
  falha(await olha.c.post(`/api/expedicao/${v.id}/etapa`, { etapa: 'SEPARACAO', leituras: [{ codigo: 'EXP-1', qtd: 3 }] }), 403, 'SEM_PERMISSAO');
  for (const corpo of [{}, { etapa: 'X' }, { etapa: 'SEPARACAO', leituras: 'a' }, { etapa: 'SEPARACAO', leituras: [null] }]) { const r = await dono.post(`/api/expedicao/${v.id}/etapa`, corpo); assert.ok(r.status >= 400 && r.status < 500, r.texto); }
  for (const rota of ['/api/expedicao/999999', '/api/expedicao/abc']) { const r = await dono.get(rota); assert.ok(r.status >= 400 && r.status < 500, r.texto); }
  ok(await dono.post('/api/reautenticar', { senha: SENHA_DONO }));
  ok(await dono.idem(`/api/vendas/${v.id}/cancelar`, { motivo: 'cliente desistiu' }));
  falha(await dono.post(`/api/expedicao/${v.id}/etapa`, { etapa: 'SEPARACAO', leituras: [{ codigo: 'EXP-1', qtd: 3 }] }), 409, 'STATUS');
  assert.equal(ok(await dono.get('/api/expedicao')).total, 0);
}));

test('levou na hora: tira a venda da fila com um registro só, grava quem marcou e respeita quem pode', async () => await com(async (s) => {
  const { sis, dono } = s;
  const { p, v, vend } = await vendaPronta(s);
  assert.equal(ok(await vend.c.get(`/api/vendas/${v.id}`)).pode_levar_na_hora, true);
  // quem só vende (sem nada de expedição) marca a própria venda, não a dos outros
  const soVende = await contratar(sis, dono, { nome: 'Beto Balcao', papel: 'personalizado', permissoes: ['produtos.ver', 'estoque.ver', 'vendas.registrar'] });
  falha(await soVende.c.post(`/api/expedicao/${v.id}/levou-na-hora`), 403, 'SEM_PERMISSAO');
  ok(await soVende.c.idem('/api/caixa/abrir', { abertura_centavos: 0 }), 201);
  const dele = ok(await soVende.c.idem('/api/vendas', { itens: [{ id: p.id, qtd: 1 }], valor_esperado_centavos: 1000, pagamentos: [{ forma: 'PIX', valor_centavos: 1000 }] }), 201);
  const feito = ok(await soVende.c.post(`/api/expedicao/${dele.id}/levou-na-hora`));
  assert.deepEqual(feito.etapas.map((e) => [e.etapa, e.na_hora, e.quem]), [['EXPEDICAO', 1, 'Beto Balcao']]);
  assert.equal(ok(await soVende.c.get(`/api/vendas/${dele.id}`)).pode_levar_na_hora, false);
  falha(await soVende.c.post(`/api/expedicao/${dele.id}/levou-na-hora`), 409, 'JA_FEITA');
  for (const etapa of ['SEPARACAO', 'CONFERENCIA', 'EXPEDICAO']) falha(await dono.post(`/api/expedicao/${dele.id}/etapa`, { etapa, leituras: [{ codigo: 'EXP-1', qtd: 1 }] }), 409, 'JA_FEITA');
  assert.deepEqual([ok(await dono.get('/api/expedicao')).total, ok(await dono.get('/api/expedicao?situacao=expedidas')).total], [1, 1]);
  assert.equal(ok(await dono.get('/api/expedicao')).itens[0].pode_levar_na_hora, true);
  const a = ok(await dono.get('/api/atividade'));
  assert.equal(a.pessoas.find((x) => x.nome === 'Beto Balcao').expedicoes, 0, 'levar na hora não conta como expedição');
  assert.ok(a.linha_do_tempo.some((e) => e.tipo === 'retirada' && e.quem === 'Beto Balcao'));
  // depois que a separação começa, não vale mais
  ok(await dono.post(`/api/expedicao/${v.id}/etapa`, { etapa: 'SEPARACAO', leituras: [{ codigo: 'EXP-1', qtd: 3 }] }));
  falha(await vend.c.post(`/api/expedicao/${v.id}/levou-na-hora`), 409, 'EM_SEPARACAO');
  assert.equal(ok(await dono.get(`/api/vendas/${v.id}`)).pode_levar_na_hora, false);
  for (const id of ['999999', 'abc']) { const r = await dono.post(`/api/expedicao/${id}/levou-na-hora`); assert.ok(r.status >= 400 && r.status < 500, r.texto); }
}));

test('levou na hora: venda cancelada não é marcada e o clique duplo grava uma vez só', async () => await com(async (s) => {
  const { sis, dono } = s;
  const { p, v, vend } = await vendaPronta(s);
  const duas = await Promise.all([1, 2].map(() => vend.c.post(`/api/expedicao/${v.id}/levou-na-hora`)));
  assert.deepEqual(duas.map((r) => r.status).sort(), [200, 409]);
  assert.equal(Number((await sis.db.get('SELECT COUNT(*) AS c FROM etapas WHERE venda_id = ?', v.id)).c), 1);
  const outra = ok(await vend.c.idem('/api/vendas', { itens: [{ id: p.id, qtd: 1 }], valor_esperado_centavos: 1000, pagamentos: [{ forma: 'PIX', valor_centavos: 1000 }] }), 201);
  ok(await dono.post('/api/reautenticar', { senha: SENHA_DONO }));
  ok(await dono.idem(`/api/vendas/${outra.id}/cancelar`, { motivo: 'cliente desistiu' }));
  falha(await dono.post(`/api/expedicao/${outra.id}/levou-na-hora`), 409, 'STATUS');
}));

test('painel e estoque por produto: números clicáveis têm dados e respeitam as permissões', async () => await com(async (s) => {
  const { dono } = s;
  const { p, vend } = await vendaPronta(s);
  const painel = ok(await dono.get('/api/painel'));
  assert.equal(painel.vendas_7_dias.length, 7);
  assert.equal(painel.vendas_7_dias[6].valor_centavos, 3000);
  assert.equal(painel.expedicao_pendente, 1);
  assert.ok(painel.equipe_hoje.some((x) => x.nome === 'Vera Caixa'));
  assert.equal(ok(await vend.c.get('/api/painel')).equipe_hoje, null);
  const e = ok(await dono.get('/api/estoque/por-produto'));
  assert.deepEqual([e.total_unidades, e.itens[0].sku, e.itens[0].unidades, e.itens[0].vendaveis, e.itens[0].enderecos], [2, p.sku, 2, 2, 1]);
  assert.equal(ok(await dono.get('/api/estoque/por-produto?q=nadaaqui')).total, 0);
  assert.ok((await dono.get('/api/estoque/por-produto?q=%25%27&pagina=-3')).status < 500);
  assert.equal(ok(await dono.get('/api/estoque/saldos?vencendo=30')).total, 0);
}));

test('excluir conta: some da equipe, perde o acesso, libera o login e mantém o nome no histórico', async () => await com(async (s) => {
  const { sis, dono } = s;
  const { vend, v } = await vendaPronta(s);
  ok(await dono.post('/api/reautenticar', { senha: SENHA_DONO }));
  falha(await dono.post(`/api/equipe/${vend.id}/excluir`), 409, 'CAIXA_ABERTO');
  const { caixa } = ok(await vend.c.get('/api/caixa'));
  ok(await vend.c.idem(`/api/caixas/${caixa.id}/fechar`, { contado_centavos: 0 }));
  falha(await vend.c.post(`/api/equipe/${vend.id}/excluir`), 403);
  const donoId = ok(await dono.get('/api/equipe')).itens.find((u) => u.dono).id;
  falha(await dono.post(`/api/equipe/${donoId}/excluir`), 409);
  ok(await dono.post(`/api/equipe/${vend.id}/excluir`));
  assert.ok(!ok(await dono.get('/api/equipe')).itens.some((u) => u.id === vend.id), 'sumiu da equipe');
  assert.equal((await vend.c.get('/api/caixa')).status, 401, 'sessão derrubada');
  const novo = sis.cliente(); await novo.get('/api/sessao');
  assert.equal((await novo.post('/api/login', { login: vend.login, senha: SENHA })).status, 401);
  for (const acao of ['excluir', 'reativar', 'desativar', 'redefinir-senha']) falha(await dono.post(`/api/equipe/${vend.id}/${acao}`), 404);
  const u = await sis.db.get('SELECT * FROM users WHERE id = ?', vend.id);
  assert.deepEqual([u.nome, u.login_enc, u.email_enc, u.email_hmac, u.permissoes, Number(u.ativo)], ['Vera Caixa', null, null, null, '[]', 0]);
  assert.equal(ok(await dono.get(`/api/vendas/${v.id}`)).vendedor_nome, 'Vera Caixa');
  const depois = ok(await dono.get('/api/atividade'));
  assert.ok(depois.linha_do_tempo.some((e) => e.quem === 'Vera Caixa (excluída)'));
  const vera = depois.pessoas.find((x) => x.id === vend.id);
  assert.deepEqual([vera.nome, vera.situacao, vera.vendas, vera.valor_centavos], ['Vera Caixa (excluída)', 'excluída', 1, 3000], 'os números do período não somem com a exclusão');
  assert.equal(ok(await dono.get('/api/atividade?de=2020-01-01&ate=2020-01-02')).pessoas.some((x) => x.id === vend.id), false, 'sem nada no período, não aparece');
  const outra = await sis.db.get('SELECT * FROM users WHERE id = ?', vend.id);
  assert.deepEqual([outra.email_novo_enc, outra.email_novo_hmac], [null, null]);
}));
