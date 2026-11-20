// Entrada da Vercel: cada requisição /api/* cai aqui. Reaproveita o mesmo sistema do servidor fixo (src/server.js); a Vercel só muda
// COMO ele é executado (função sob demanda em vez de processo sempre ligado). Os arquivos estáticos (public/) saem direto da CDN.
import { waitUntil } from '@vercel/functions';
import { loadConfig } from '../src/config.js';
import { montar } from '../src/server.js';

let sistema = null; // reaproveitado entre requisições enquanto a função está "quente"
const iniciar = () => (sistema ??= montar(loadConfig()).catch((e) => { sistema = null; throw e; }));

export default async function handler(req, res) {
  let s;
  try { s = await iniciar(); } catch (e) {
    console.error('falha ao iniciar o sistema:', e?.message);
    res.statusCode = 503; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: false, error: { code: 'INICIANDO', message: 'Sistema indisponível no momento. Tente de novo em instantes.' } }));
  }
  await s.app.atender(req, res);
  // O webhook do Mercado Livre responde na hora e processa depois: a Vercel congela a função ao responder, então pedimos para ela esperar.
  waitUntil(s.integracoes.drenar().catch(() => {}));
}
