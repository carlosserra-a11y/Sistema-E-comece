import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, codigoMfa, LOGIN, SENHA_INICIAL, SENHA_FORTE, novoProduto } from './helpers.js';
import { verificarCadeia } from '../src/security/audit.js';
import { validarPolitica } from '../src/security/password.js';
import { cifrar, decifrar } from '../src/security/crypto.js';
import { verificarTotp, codigoTotp, passoAtual, base32Decode, novoSegredo } from '../src/security/totp.js';
import { celulaCsv } from '../src/util.js';

async function com(fn) {
  const sis = await criarSistema();
  try { await fn(sis); } finally { await sis.parar(); }
}

test('fluxo de acesso: etapas obrigatórias e rotas protegidas', () => com(async (sis) => {
  const c = sis.cliente();
  await c.get('/api/sessao');
  assert.equal((await c.get('/api/produtos')).status, 401);

  let r = await c.post('/api/login', { login: LOGIN, senha: SENHA_INICIAL });
  assert.equal(r.status, 200);
  assert.equal(r.data.estagio, 'TROCAR_SENHA');
  r = await c.get('/api/produtos');
  assert.equal(r.status, 403);
  assert.equal(r.erro.code, 'ETAPA_INVALIDA');

  r = await c.post('/api/senha/trocar', { senha_atual: SENHA_INICIAL, senha_nova: 'curta' });
  assert.equal(r.status, 422);
  r = await c.post('/api/senha/trocar', { senha_atual: SENHA_INICIAL, senha_nova: SENHA_FORTE });
  assert.equal(r.data.estagio, 'MFA_INSCREVER');
  assert.equal((await c.get('/api/produtos')).status, 403);

  const ini = await c.post('/api/mfa/iniciar');
  assert.match(ini.data.qrSvg, /^<svg/);
  assert.equal((await c.post('/api/mfa/confirmar', { codigo: '000000' })).status, 422);
  r = await c.post('/api/mfa/confirmar', { codigo: codigoTotp(ini.data.segredo, passoAtual(sis.relogio.t)) });
  assert.equal(r.data.estagio, 'COMPLETA');
  assert.equal(r.data.codigos_recuperacao.length, 10);
  assert.equal((await c.get('/api/produtos')).status, 200);
}));

test('login: resposta idêntica para login inexistente e senha errada; bloqueio progressivo', () => com(async (sis) => {
  const a = sis.cliente(); await a.get('/api/sessao');
  const b = sis.cliente(); await b.get('/api/sessao');
  const r1 = await a.post('/api/login', { login: LOGIN, senha: 'errada-errada-1' });
  const r2 = await b.post('/api/login', { login: '11122233344', senha: 'errada-errada-1' });
  assert.equal(r1.status, 401); assert.equal(r2.status, 401);
  assert.equal(r1.erro.message, r2.erro.message);
  assert.equal(r1.erro.code, r2.erro.code);
  for (let i = 0; i < 3; i++) await a.post('/api/login', { login: LOGIN, senha: 'errada-errada-1' });
  const quinta = await a.post('/api/login', { login: LOGIN, senha: 'errada-errada-1' });
  assert.equal(quinta.status, 401);
  const bloq = await a.post('/api/login', { login: LOGIN, senha: SENHA_INICIAL });
  assert.equal(bloq.status, 429, 'mesmo com a senha certa, fica bloqueado');
  assert.ok(bloq.erro.retryAfterS > 0);
  // login inexistente também bloqueia (não dá para distinguir)
  for (let i = 0; i < 5; i++) await b.post('/api/login', { login: '11122233344', senha: 'x-errada-x-1' });
  assert.equal((await b.post('/api/login', { login: '11122233344', senha: 'x-errada-x-1' })).status, 429);
  sis.relogio.t += 2 * 60_000;
  assert.equal((await a.post('/api/login', { login: LOGIN, senha: SENHA_INICIAL })).status, 200, 'libera depois do prazo');
}));

test('login: entradas malformadas não derrubam o servidor', () => com(async (sis) => {
  const c = sis.cliente(); await c.get('/api/sessao');
  for (const corpo of [{}, { login: null, senha: null }, { login: { $ne: 1 }, senha: [] }, { login: 'a'.repeat(5000), senha: 'b'.repeat(5000) }, { login: LOGIN, senha: 12345 }]) {
    const r = await c.post('/api/login', corpo);
    assert.ok([401, 429].includes(r.status), JSON.stringify(corpo).slice(0, 40));
  }
  const r = await c.req('POST', '/api/login', undefined, { headers: { 'Content-Type': 'application/json' } });
  assert.ok(r.status < 500);
}));

test('CSRF, Origin, tipo de conteúdo e host', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  assert.equal((await c.post('/api/produtos', { sku: 'A1', nome: 'Teste' }, { semCsrf: true })).erro.code, 'CSRF');
  const outro = await c.post('/api/produtos', { sku: 'A1', nome: 'Teste' }, { headers: { Origin: 'https://malicioso.example' } });
  assert.equal(outro.erro.code, 'ORIGEM');
  const semOrigem = await fetch(`${sis.base}/api/produtos`, { method: 'POST', headers: { Cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'X-CSRF-Token': c.csrf, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(semOrigem.status, 403);
  const crossSite = await c.post('/api/produtos', { sku: 'A1', nome: 'T' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const tipo = await fetch(`${sis.base}/api/produtos`, { method: 'POST', headers: { Origin: sis.base, Cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'X-CSRF-Token': c.csrf, 'Content-Type': 'text/plain' }, body: '{"sku":"A1"}' });
  assert.equal(tipo.status, 415);
  // o fetch não deixa trocar o Host; usa http cru (proteção contra DNS rebinding)
  const statusHost = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: new URL(sis.base).port, path: '/api/sessao', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(statusHost, 400);
  assert.equal((await c.get('/api/produtos', { headers: { Cookie: 'sid=roubado' } })).status, 401);
}));

test('MFA: anti-replay, recuperação de uso único e esgotamento de tentativas', () => com(async (sis) => {
  const c1 = await entrarCompleto(sis);
  await c1.post('/api/logout');
  const c = sis.cliente(); await c.get('/api/sessao');
  await c.post('/api/login', { login: LOGIN, senha: SENHA_FORTE });
  // o código do passo usado na inscrição não vale de novo (replay)
  assert.equal((await c.post('/api/mfa/verificar', { codigo: codigoMfa(c1, sis, 0) })).status, 422);
  const ok = await c.post('/api/mfa/verificar', { codigo: codigoMfa(c1, sis, 1) });
  assert.equal(ok.status, 200);
  await c.post('/api/logout');

  const d = sis.cliente(); await d.get('/api/sessao');
  await d.post('/api/login', { login: LOGIN, senha: SENHA_FORTE });
  const rec = c1.codigos[0];
  assert.equal((await d.post('/api/mfa/recuperar', { codigo: rec })).data.codigos_restantes, 9);
  await d.post('/api/logout');
  const e = sis.cliente(); await e.get('/api/sessao');
  await e.post('/api/login', { login: LOGIN, senha: SENHA_FORTE });
  assert.equal((await e.post('/api/mfa/recuperar', { codigo: rec })).status, 422, 'código de recuperação não pode ser reutilizado');
  for (let i = 0; i < 4; i++) await e.post('/api/mfa/verificar', { codigo: '000001' });
  const ultimo = await e.post('/api/mfa/verificar', { codigo: '000001' });
  assert.ok([401, 429].includes(ultimo.status));
  assert.equal((await e.get('/api/produtos')).status, 401, 'sessão revogada após excesso de falhas');
}));

test('sessão: expiração por inatividade e absoluta, rotação e lista/revogação', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  assert.equal((await c.get('/api/produtos')).status, 200);
  const lista = await c.get('/api/sessoes');
  assert.equal(lista.data.sessoes.filter((s) => s.atual).length, 1);
  const c2 = sis.cliente(); await c2.get('/api/sessao');
  await c2.post('/api/login', { login: LOGIN, senha: SENHA_FORTE });
  const sair = await c.post('/api/sessoes/sair-todas');
  assert.equal(sair.data.revogadas, 1);
  assert.equal((await c2.get('/api/sessao')).data.estagio, null, 'a outra sessão foi encerrada');
  assert.equal((await c.delete('/api/sessoes/99999')).status, 404);
  sis.relogio.t += 31 * 60_000;
  assert.equal((await c.get('/api/produtos')).status, 401, 'expira por inatividade');
}));

test('troca de senha: derruba as outras sessões e exige política', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  const outra = sis.cliente(); await outra.get('/api/sessao');
  await outra.post('/api/login', { login: LOGIN, senha: SENHA_FORTE });
  const r = await c.post('/api/senha/trocar', { senha_atual: SENHA_FORTE, senha_nova: SENHA_FORTE });
  assert.equal(r.status, 422);
  const nova = 'Cobalto&Sereno@Praia91';
  assert.equal((await c.post('/api/senha/trocar', { senha_atual: SENHA_FORTE, senha_nova: nova })).status, 200);
  assert.equal((await outra.get('/api/sessao')).data.estagio, null);
  assert.equal((await c.get('/api/produtos')).status, 200);
  assert.deepEqual(validarPolitica('Xabcd!Mk#92Lpq'), ['Evite sequências como 1234, abcd ou qwer.']);
  assert.deepEqual(validarPolitica(SENHA_FORTE), []);
  assert.ok(validarPolitica('Senha!Forte15031990').some((p) => /datas/.test(p)));
  assert.ok(validarPolitica('aaaa!Bcdxkj#92Zq').some((p) => /repetir/.test(p)));
}));

test('reautenticação é exigida para ações críticas', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  sis.relogio.t += 6 * 60_000; // vence a janela de 5 min
  c.csrf = (await c.get('/api/sessao')).data.csrf;
  const r = await c.post('/api/mfa/regenerar');
  assert.equal(r.erro.code, 'REAUTENTICACAO');
  assert.equal((await c.post('/api/reautenticar', { senha: 'errada-errada-1' })).status, 401);
  assert.equal((await c.post('/api/reautenticar', { senha: SENHA_FORTE })).status, 200);
  assert.equal((await c.post('/api/mfa/regenerar')).data.codigos_recuperacao.length, 10);
}));

test('cabeçalhos de segurança, caminho relativo e arquivos ocultos', () => com(async (sis) => {
  const r = await fetch(`${sis.base}/`);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(`${sis.base}/api/sessao`)).headers.get('cache-control'), 'no-store');
  for (const caminho of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/.env', '/%2e%2e%2f%2e%2e%2f.env', '/css/../../package.json']) {
    const x = await fetch(`${sis.base}${caminho}`);
    assert.notEqual(x.status, 200, caminho);
    assert.ok(!/armazem-wms/.test(await x.text()), caminho);
  }
  assert.equal((await fetch(`${sis.base}/api/rota-que-nao-existe`)).status, 404);
}));

test('injeção SQL e mass assignment', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  const p = await novoProduto(c);
  for (const q of ["' OR 1=1 --", "'; DROP TABLE produtos; --", '%', '_', '\\']) {
    const r = await c.get(`/api/produtos?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, q);
  }
  assert.equal((await c.get('/api/produtos')).data.total, 1, 'tabela intacta');
  const r = await c.post('/api/produtos', { sku: 'MASS-1', nome: 'Mass', id: 999, ativo: 0, versao: 50, criado_em: 1, busca: 'x' });
  assert.equal(r.status, 201);
  assert.notEqual(r.data.id, 999); assert.equal(r.data.ativo, 1); assert.equal(r.data.versao, 1);
  const proto = await c.req('POST', '/api/produtos', JSON.parse('{"sku":"PROTO-1","nome":"Pp","__proto__":{"admin":true}}'));
  assert.equal(proto.status, 201);
  assert.equal(({}).admin, undefined);
  assert.equal(p.versao, 1);
}));

test('auditoria encadeada: íntegra, só-inserção e detecta adulteração', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  await novoProduto(c);
  const v = (await c.get('/api/auditoria/verificar')).data;
  assert.equal(v.ok, true);
  assert.ok(v.total >= 4);
  assert.throws(() => sis.db.exec("UPDATE auditoria SET acao = 'X' WHERE id = 1"), /somente insercao/);
  assert.throws(() => sis.db.exec('DELETE FROM auditoria WHERE id = 1'), /somente insercao/);
  sis.db.exec('DROP TRIGGER trg_auditoria_no_update');
  sis.db.exec("UPDATE auditoria SET acao = 'FORJADO' WHERE id = 2");
  const apos = verificarCadeia(sis.db);
  assert.equal(apos.ok, false);
  assert.equal(apos.quebrouEm, 2);
}));

test('auditoria não guarda senha, token nem login', () => com(async (sis) => {
  const c = await entrarCompleto(sis);
  await c.post('/api/login', { login: LOGIN, senha: 'errada-errada-1' }).catch(() => {});
  const texto = JSON.stringify(sis.db.prepare('SELECT * FROM auditoria').all());
  for (const segredo of [SENHA_FORTE, SENHA_INICIAL, LOGIN, c.segredo, ...c.codigos]) assert.ok(!texto.includes(segredo), 'vazou algo sensível');
  const banco = JSON.stringify(sis.db.prepare('SELECT * FROM users').all()) + JSON.stringify(sis.db.prepare('SELECT * FROM sessions').all());
  assert.ok(!banco.includes(LOGIN) && !banco.includes(SENHA_FORTE) && !banco.includes(c.segredo));
}));

test('criptografia de campo, TOTP (RFC 6238) e CSV seguro', () => {
  const chave = Buffer.alloc(32, 7);
  const c = cifrar(chave, 'segredo');
  assert.equal(decifrar(chave, c), 'segredo');
  const partes = c.split('.'); partes[3] = Buffer.from('adulterado').toString('base64url');
  assert.throws(() => decifrar(chave, partes.join('.')));
  // vetor RFC 6238 (SHA-1, segredo ASCII "12345678901234567890", t=59 -> 94287082)
  const b32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(base32Decode(b32).toString(), '12345678901234567890');
  assert.equal(codigoTotp(b32, Math.floor(59 / 30), 8), '94287082');
  const seg = novoSegredo(); const t = 1_700_000_000_000;
  const passo = verificarTotp(seg, codigoTotp(seg, passoAtual(t)), t, 0);
  assert.equal(passo, passoAtual(t));
  assert.equal(verificarTotp(seg, codigoTotp(seg, passoAtual(t)), t, passo), null, 'replay');
  assert.equal(celulaCsv('=1+1'), "'=1+1");
  assert.equal(celulaCsv('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(celulaCsv('a;b'), '"a;b"');
});
