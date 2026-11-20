import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from '../src/config.js';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, novoProduto } from './helpers.js';
import { codigoTotp, passoAtual } from '../src/security/totp.js';
import { verificarCadeia } from '../src/security/audit.js';
import { PAPEIS, REGRAS, TODAS, SO_DONO, limparPermissoes, permissoesDe, semFinanceiro } from '../src/permissoes.js';

async function com(fn) {
  const sis = await criarSistema();
  try { await fn(sis, await entrarCompleto(sis)); } finally { await sis.parar(); }
}

const NOVA_SENHA = 'Lume!Verde#Telhado59';

/** Cria a pessoa pelo dono e faz o primeiro acesso dela (troca de senha + MFA). Devolve o cliente logado. */
async function contratar(sis, dono, dados) {
  const r = await dono.post('/api/equipe', dados);
  assert.equal(r.status, 201, r.texto);
  const c = sis.cliente();
  await c.get('/api/sessao');
  let x = await c.post('/api/login', { login: r.data.login, senha: r.data.senha_provisoria });
  assert.equal(x.data.estagio, 'TROCAR_SENHA');
  x = await c.post('/api/senha/trocar', { senha_atual: r.data.senha_provisoria, senha_nova: NOVA_SENHA });
  assert.equal(x.data.estagio, 'MFA_INSCREVER');
  const ini = await c.post('/api/mfa/iniciar');
  x = await c.post('/api/mfa/confirmar', { codigo: codigoTotp(ini.data.segredo, passoAtual(sis.relogio.t)) });
  assert.equal(x.data.estagio, 'COMPLETA');
  return { c, pessoa: r.data };
}

test('toda rota autenticada tem regra de permissão (e nenhuma regra é órfã)', async () => await com(async (sis) => {
  const reais = new Set(sis.app.rotas.filter((r) => r.opts.auth === 'completa').map((r) => `${r.metodo} ${r.padrao}`));
  const faltando = [...reais].filter((k) => !REGRAS.has(k));
  const orfas = [...REGRAS.keys()].filter((k) => !reais.has(k));
  assert.deepEqual(faltando, [], 'rotas sem regra ficam bloqueadas para todos');
  assert.deepEqual(orfas, [], 'regras sem rota correspondente');
  for (const exigida of REGRAS.values()) for (const p of [].concat(exigida)) assert.ok(p === 'qualquer' || TODAS.includes(p), `permissão desconhecida: ${p}`);
}));

test('permissões: papéis só usam permissões existentes e ninguém além do dono gerencia a equipe', () => {
  for (const [nome, papel] of Object.entries(PAPEIS)) {
    for (const p of papel.permissoes) assert.ok(TODAS.includes(p), `${nome}: ${p}`);
    assert.ok(!papel.permissoes.includes('usuarios.gerenciar'), `${nome} não pode gerenciar a equipe`);
  }
  assert.ok(!PAPEIS.gerente.permissoes.includes('financeiro.ver'), 'financeiro nem para o gerente');
  assert.deepEqual(limparPermissoes(['produtos.ver', 'usuarios.gerenciar', 'inventada', 'produtos.ver']), ['produtos.ver']);
  assert.ok(SO_DONO.has('usuarios.gerenciar'));
  assert.equal(permissoesDe({ dono: 1 }).size, TODAS.length);
  assert.equal(permissoesDe({ dono: 0, permissoes: 'isto não é json' }).size, 0, 'lista corrompida = sem acesso');
  assert.deepEqual([...permissoesDe({ dono: 0, permissoes: '["usuarios.gerenciar","estoque.ver"]' })], ['estoque.ver']);
  assert.deepEqual(semFinanceiro({ a: 1, custo_centavos: 5, itens: [{ preco_centavos: 9, nome: 'x' }] }), { a: 1, itens: [{ nome: 'x' }] });
});

test('dono: tem tudo; sessão informa dono e todas as permissões', async () => await com(async (_sis, dono) => {
  const s = await dono.get('/api/sessao');
  assert.equal(s.data.usuario.dono, true);
  assert.equal(s.data.usuario.permissoes.length, TODAS.length);
  for (const rota of ['/api/equipe', '/api/produtos', '/api/auditoria', '/api/pedidos', '/api/integracoes']) assert.equal((await dono.get(rota)).status, 200, rota);
  const eq = (await dono.get('/api/equipe/catalogo')).data;
  assert.ok(eq.grupos.length && eq.papeis.operador);
}));

test('equipe: o operador só faz o que foi liberado e nunca mexe na equipe nem no financeiro', async () => await com(async (sis, dono) => {
  const { c: op } = await contratar(sis, dono, { nome: 'Joana do Galpão', papel: 'operador' });
  assert.equal((await op.get('/api/produtos')).status, 200);
  assert.equal((await op.get('/api/estoque/saldos')).status, 200);
  for (const [metodo, rota] of [['GET', '/api/equipe'], ['GET', '/api/auditoria'], ['GET', '/api/pedidos'], ['GET', '/api/integracoes'], ['POST', '/api/produtos'], ['GET', '/api/fornecedores']]) {
    const r = await op.req(metodo, rota, metodo === 'POST' ? {} : undefined);
    assert.equal(r.status, 403, `${metodo} ${rota}`);
    assert.equal(r.erro.code, 'SEM_PERMISSAO');
  }
  const eu = (await op.get('/api/sessao')).data.usuario;
  assert.equal(eu.dono, false);
  assert.ok(!eu.permissoes.includes('financeiro.ver') && !eu.permissoes.includes('usuarios.gerenciar'));
  // a própria conta continua podendo ver/derrubar as sessões dela e conferir o painel
  assert.equal((await op.get('/api/sessoes')).status, 200);
  assert.equal((await op.get('/api/painel')).status, 200);
}));

test('financeiro: custo e preço só aparecem (e só se gravam) para quem tem a permissão', async () => await com(async (sis, dono) => {
  const p = await novoProduto(dono, { custo_centavos: 1234, preco_centavos: 5000 });
  assert.equal(p.custo_centavos, 1234);

  const { c: estoquista } = await contratar(sis, dono, { nome: 'Pedro Estoque', papel: 'estoquista' });
  const lido = (await estoquista.get(`/api/produtos/${p.id}`)).data;
  assert.equal(lido.nome, p.nome);
  assert.ok(!('custo_centavos' in lido) && !('preco_centavos' in lido), 'estoquista não vê valores');
  assert.ok(!JSON.stringify((await estoquista.get('/api/produtos')).data).includes('custo_centavos'));
  const csv = (await estoquista.get('/api/produtos-exportar')).texto;
  assert.ok(!/custo|preco/.test(csv.split('\n')[0]), 'planilha sem colunas de valor');

  // editar sem permissão financeira preserva os valores; cadastrar novo grava zero
  const alterado = await estoquista.put(`/api/produtos/${p.id}`, { ...lido, nome: 'Nome novo', custo_centavos: 1, preco_centavos: 1 });
  assert.equal(alterado.status, 200, alterado.texto);
  const naMao = (await dono.get(`/api/produtos/${p.id}`)).data;
  assert.equal(naMao.nome, 'Nome novo');
  assert.equal(naMao.custo_centavos, 1234);
  assert.equal(naMao.preco_centavos, 5000);
  const novo = await estoquista.post('/api/produtos', { sku: 'SKU-ZERO', nome: 'Produto zero', custo_centavos: 999, preco_centavos: 999 });
  assert.equal(novo.status, 201);
  assert.equal((await dono.get(`/api/produtos/${novo.data.id}`)).data.custo_centavos, 0);

  const { c: fin } = await contratar(sis, dono, { nome: 'Marta Financeiro', papel: 'financeiro' });
  assert.equal((await fin.get(`/api/produtos/${p.id}`)).data.custo_centavos, 1234, 'financeiro enxerga');
  assert.equal((await fin.post('/api/estoque/receber', {})).status, 403, 'mas não mexe no estoque');
  assert.match((await fin.get('/api/produtos-exportar')).texto.split('\n')[0], /custo/);
}));

test('equipe: o dono escolhe permissões livremente, mas ninguém vira gerente da equipe', async () => await com(async (sis, dono) => {
  const { c, pessoa } = await contratar(sis, dono, { nome: 'Caio Custom', papel: 'personalizado', permissoes: ['produtos.ver', 'financeiro.ver', 'usuarios.gerenciar', 'nao.existe'] });
  assert.equal(pessoa.papel, 'personalizado');
  assert.deepEqual(pessoa.permissoes, ['financeiro.ver', 'produtos.ver']);
  assert.equal((await c.get('/api/produtos')).status, 200);
  assert.equal((await c.get('/api/equipe')).status, 403);

  // mesmo com a lista adulterada direto no banco, a regra "só o dono" vale
  await sis.db.run('UPDATE users SET permissoes = ? WHERE id = ?', JSON.stringify(['usuarios.gerenciar', 'produtos.ver']), pessoa.id);
  assert.equal((await c.get('/api/equipe')).status, 403);

  // alterar permissões vale na próxima requisição, sem precisar sair
  await sis.db.run('UPDATE users SET permissoes = ? WHERE id = ?', '[]', pessoa.id);
  assert.equal((await c.get('/api/produtos')).status, 403);
  const r = await dono.put(`/api/equipe/${pessoa.id}`, { nome: 'Caio Custom', papel: 'consulta' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.permissoes, limparPermissoes(PAPEIS.consulta.permissoes));
  assert.equal((await c.get('/api/produtos')).status, 200);
}));

test('equipe: criar/alterar exige confirmar a senha do dono', async () => await com(async (sis, dono) => {
  sis.relogio.t += 6 * 60_000; // passou a janela de reautenticação
  const r = await dono.post('/api/equipe', { nome: 'Sem Senha', papel: 'consulta' });
  assert.equal(r.status, 403);
  assert.equal(r.erro.code, 'REAUTENTICACAO');
  assert.equal((await dono.get('/api/equipe')).data.itens.length, 1, 'ninguém foi criado');
}));

test('equipe: desativar derruba as sessões na hora; reativar e redefinir senha funcionam', async () => await com(async (sis, dono) => {
  const { c, pessoa } = await contratar(sis, dono, { nome: 'Rui Saída', papel: 'estoquista' });
  assert.equal((await c.get('/api/produtos')).status, 200);

  assert.equal((await dono.post(`/api/equipe/${pessoa.id}/desativar`)).status, 200);
  assert.equal((await c.get('/api/produtos')).status, 401, 'sessão aberta caiu imediatamente');
  const bloqueado = sis.cliente(); await bloqueado.get('/api/sessao');
  assert.equal((await bloqueado.post('/api/login', { login: pessoa.login, senha: NOVA_SENHA })).status, 401);

  assert.equal((await dono.post(`/api/equipe/${pessoa.id}/reativar`)).status, 200);
  const volta = sis.cliente(); await volta.get('/api/sessao');
  assert.equal((await volta.post('/api/login', { login: pessoa.login, senha: NOVA_SENHA })).data.estagio, 'MFA_VERIFICAR');

  const red = await dono.post(`/api/equipe/${pessoa.id}/redefinir-senha`);
  assert.equal(red.status, 200);
  assert.match(red.data.senha_provisoria, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  const outro = sis.cliente(); await outro.get('/api/sessao');
  assert.equal((await outro.post('/api/login', { login: pessoa.login, senha: NOVA_SENHA })).status, 401, 'senha antiga morreu');
  assert.equal((await outro.post('/api/login', { login: pessoa.login, senha: red.data.senha_provisoria })).data.estagio, 'TROCAR_SENHA');

  const mfa = await dono.post(`/api/equipe/${pessoa.id}/resetar-mfa`);
  assert.equal(mfa.status, 200);
  assert.equal(mfa.data.mfa_ativo, false);
}));

test('equipe: a conta do dono é intocável e tudo fica auditado sem segredos', async () => await com(async (sis, dono) => {
  const eu = (await dono.get('/api/equipe')).data.itens.find((u) => u.dono);
  for (const [m, rota, corpo] of [['PUT', `/api/equipe/${eu.id}`, { nome: 'X X', papel: 'consulta' }], ['POST', `/api/equipe/${eu.id}/desativar`, {}], ['POST', `/api/equipe/${eu.id}/redefinir-senha`, {}], ['POST', `/api/equipe/${eu.id}/resetar-mfa`, {}]]) {
    const r = await dono.req(m, rota, corpo);
    assert.equal(r.status, 409, rota);
    assert.equal(r.erro.code, 'DONO');
  }
  const { pessoa } = await contratar(sis, dono, { nome: 'Ana Auditada', papel: 'consulta' });
  assert.equal((await dono.get('/api/equipe')).data.itens.find((u) => u.id === pessoa.id).login, pessoa.login, 'o dono consegue rever o login');
  assert.equal((await dono.post('/api/equipe', { nome: 'Papel Ruim', papel: 'chefe' })).status, 422);
  assert.equal((await dono.post(`/api/equipe/9999/desativar`)).status, 404);

  const trilha = JSON.stringify(await sis.db.all('SELECT acao, detalhes FROM auditoria'));
  assert.match(trilha, /EQUIPE_CRIADA/);
  assert.ok(!trilha.includes(pessoa.senha_provisoria), 'senha provisória nunca vai para a auditoria');
  const banco = JSON.stringify(await sis.db.all('SELECT * FROM users'));
  assert.ok(!banco.includes(pessoa.login), 'o login só é guardado cifrado/HMAC');
  assert.ok(!banco.includes(pessoa.senha_provisoria));
  assert.equal((await verificarCadeia(sis.db)).ok, true);
}));

test('emergência: npm run resetar-dono devolve o acesso ao dono (senha nova, 2 etapas zeradas, sessões derrubadas, auditado)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-reset-'));
  const hex = () => crypto.randomBytes(32).toString('hex');
  const env = { ...process.env, NODE_ENV: 'development', DB_PATH: path.join(dir, 't.db'), DATABASE_URL: '', PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex(), SCRYPT_N: '1024', ADMIN_LOGIN: '52998224725', ADMIN_INITIAL_PASSWORD: 'Inicial-Teste-9x!Kq' };
  const rodar = (arq) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', arq], { cwd: ROOT, env, encoding: 'utf8' });
  try {
    assert.equal(rodar('scripts/criar-admin.js').status, 0);
    const db = new DatabaseSync(env.DB_PATH);
    db.exec("UPDATE users SET trocar_senha = 0, mfa_ativo = 1, mfa_segredo_enc = 'x'; INSERT INTO recovery_codes (user_id, codigo_hmac) VALUES (1, 'abc'); INSERT INTO sessions (user_id, token_hash, estagio, criado_em, ultimo_uso, expira_abs) VALUES (1, 'tok', 'COMPLETA', 1, 1, 9999999999999)");
    const antes = db.prepare('SELECT senha_hash FROM users WHERE dono = 1').get().senha_hash;
    const r = rodar('scripts/resetar-dono.js');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nova senha provisória[^:]*: [A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}/);
    const u = db.prepare('SELECT * FROM users WHERE dono = 1').get();
    assert.notEqual(u.senha_hash, antes);
    assert.equal(u.trocar_senha, 1); assert.equal(u.mfa_ativo, 0); assert.equal(u.mfa_segredo_enc, null);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM recovery_codes').get().c, 0);
    assert.ok(db.prepare("SELECT revogada_em FROM sessions WHERE token_hash = 'tok'").get().revogada_em, 'sessão derrubada');
    assert.equal(db.prepare("SELECT COUNT(*) c FROM auditoria WHERE acao = 'DONO_RESETADO'").get().c, 1);
    assert.ok(!r.stdout.includes(env.PEPPER));
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
