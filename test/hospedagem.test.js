import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { CSP } from '../src/http/app.js';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { criarSistema } from './helpers.js';

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const cab = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));

test('vercel.json: a CDN serve os arquivos estáticos com os MESMOS cabeçalhos de segurança do servidor', () => {
  assert.equal(cab['Content-Security-Policy'], CSP, 'CSP diferente: rode a geração do vercel.json de novo');
  assert.equal(cab['X-Content-Type-Options'], 'nosniff');
  assert.equal(cab['X-Frame-Options'], 'DENY');
  assert.equal(cab['Referrer-Policy'], 'no-referrer');
  assert.match(cab['Permissions-Policy'], /camera=\(self\)/);
  assert.match(cab['Strict-Transport-Security'], /max-age=31536000/);
  assert.equal(vercel.outputDirectory, 'public');
  assert.ok(fs.existsSync(path.join(ROOT, 'api', 'index.js')), 'a função da Vercel existe');
  assert.equal(vercel.crons[0].path, '/api/cron/manutencao');
  assert.deepEqual(vercel.rewrites, [{ source: '/api/:path*', destination: '/api/index' }], 'todo /api/* (inclusive 2+ níveis) vai para a função');
  assert.ok(vercel.functions['api/index.js'], 'configuração da função aponta para o arquivo certo');
});

test('cron de manutenção: só responde com o segredo certo (sem segredo configurado, nunca)', async () => {
  delete process.env.CRON_SECRET;
  let sis = await criarSistema();
  try {
    const c = sis.cliente();
    assert.equal((await c.get('/api/cron/manutencao')).status, 401, 'sem CRON_SECRET configurado a rota fica fechada');
    assert.equal((await c.get('/api/cron/manutencao', { headers: { Authorization: 'Bearer ' } })).status, 401);
  } finally { await sis.parar(); }

  process.env.CRON_SECRET = 'segredo-de-teste-do-cron-1234567890';
  sis = await criarSistema();
  try {
    const c = sis.cliente();
    assert.equal((await c.get('/api/cron/manutencao', { headers: { Authorization: 'Bearer errado' } })).status, 401);
    assert.equal((await c.get('/api/cron/manutencao')).status, 401);
    const ok = await c.get('/api/cron/manutencao', { headers: { Authorization: 'Bearer segredo-de-teste-do-cron-1234567890' } });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.data.ok, true);
  } finally { await sis.parar(); delete process.env.CRON_SECRET; }
});

test('função da Vercel (api/index.js): sobe o sistema sob demanda, responde e se recupera de configuração ruim', async () => {
  const livre = await new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const hex = () => crypto.randomBytes(32).toString('hex');
  const antigo = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: ':memory:', PORT: String(livre), SCRYPT_N: '1024', LOG_LEVEL: 'error', ML_POLL_MIN: '0' });
  process.env.PEPPER = 'curta'; // chave inválida (o .env local, se existir, não pode mascarar o teste)
  delete process.env.DATABASE_URL;
  const { default: handler } = await import('../api/index.js');
  const servidor = http.createServer(handler);
  await new Promise((ok) => servidor.listen(livre, '127.0.0.1', ok));
  try {
    const ruim = await fetch(`http://127.0.0.1:${livre}/api/sessao`);
    assert.equal(ruim.status, 503, 'sem as chaves o sistema responde 503 em JSON, sem vazar detalhes');
    assert.equal((await ruim.json()).error.code, 'INICIANDO');

    Object.assign(process.env, { PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex() });
    const bom = await fetch(`http://127.0.0.1:${livre}/api/sessao`);
    assert.equal(bom.status, 200, 'na requisição seguinte ele sobe sozinho');
    const j = await bom.json();
    assert.equal(j.ok, true);
    assert.equal(j.data.appName, 'Carlos Desenvolvedor de Sistema');
    assert.equal(j.data.autenticado, false);
    assert.equal((await fetch(`http://127.0.0.1:${livre}/api/produtos`)).status, 401);
    assert.equal(bom.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await new Promise((ok) => { servidor.close(ok); servidor.closeAllConnections?.(); });
    for (const k of Object.keys(process.env)) if (!(k in antigo)) delete process.env[k];
    Object.assign(process.env, antigo);
  }
});
