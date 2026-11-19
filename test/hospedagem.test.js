import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { CSP } from '../src/http/app.js';
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
  assert.ok(fs.existsSync(path.join(ROOT, 'api', '[...rota].js')), 'a função da Vercel existe');
  assert.equal(vercel.crons[0].path, '/api/cron/manutencao');
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
