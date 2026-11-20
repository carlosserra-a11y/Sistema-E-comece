import http from 'node:http';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, erro } from '../util.js';
import { tx, traduzirErroSql } from '../db.js';
import { criarLimitador } from '../security/ratelimit.js';
import { sha256, aleatorio } from '../security/crypto.js';
import { REGRAS, permissoesDe, semFinanceiro } from '../permissoes.js';
import { carregarSessao, csrfValido, csrfPara, lerCookies, nomesCookie, cookie } from './sessao.js';

const ID_VALIDO = /^[0-9]{1,9}$/; // até 999.999.999 (cabe em INTEGER)
const ehChaveDeId = (k) => k === 'id' || k === 'cid' || k.endsWith('_id');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

export function criarApp({ cfg, db, log }) {
  const limitador = criarLimitador(cfg.agora);
  const rotas = [];
  const ck = nomesCookie(cfg);

  function rota(metodo, padrao, opts, handler) {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const chaves = [];
    const re = new RegExp('^' + padrao.replace(/:([a-z_]+)/gi, (_, k) => { chaves.push(k); return '([^/]+)'; }) + '/?$');
    rotas.push({ metodo, padrao, re, chaves, opts: { auth: 'completa', ...opts }, handler });
  }

  const ipDe = (req) => {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff.at(-1);
    }
    return req.socket.remoteAddress ?? '0.0.0.0';
  };

  function cabecalhos(res, api) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (cfg.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (api) res.setHeader('Cache-Control', 'no-store');
  }

  function responder(ctx, status, corpo, tipo = 'application/json; charset=utf-8', extra = {}) {
    const { res } = ctx;
    if (res.headersSent) return;
    if (ctx.setCookies.length) res.setHeader('Set-Cookie', ctx.setCookies);
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    const buf = Buffer.isBuffer(corpo) ? corpo : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    res.writeHead(status, { 'Content-Type': tipo, 'Content-Length': buf.length });
    res.end(ctx.req.method === 'HEAD' ? undefined : buf);
  }

  const lerCorpo = (req, limite) => new Promise((resolve, reject) => {
    const partes = [];
    let total = 0; let excedeu = false;
    req.on('data', (c) => {
      total += c.length;
      if (excedeu) { if (total > limite * 4 + 65_536) req.destroy(); return; } // descarta o excesso (nada em memória); corta quem insiste
      if (total > limite) { excedeu = true; partes.length = 0; reject(erro(413, 'CORPO_GRANDE', 'Conteúdo grande demais.')); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });

  async function api(ctx, url) {
    const { req } = ctx;
    const achadas = rotas.filter((r) => r.re.test(url.pathname));
    const r = achadas.find((x) => x.metodo === req.method) ?? (req.method === 'HEAD' ? achadas.find((x) => x.metodo === 'GET') : null);
    if (!r) throw achadas.length ? erro(405, 'METODO', 'Método não permitido.') : erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
    const m = r.re.exec(url.pathname);
    ctx.params = Object.fromEntries(r.chaves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    ctx.query = Object.fromEntries(url.searchParams);
    // Ids na URL precisam caber num inteiro do banco (o Postgres recusa "1.5" ou números enormes com erro interno).
    for (const [k, v] of Object.entries(ctx.params)) if (ehChaveDeId(k) && !ID_VALIDO.test(v)) throw erro(404, 'NAO_ENCONTRADO', 'Registro não encontrado.');
    for (const [k, v] of Object.entries(ctx.query)) if (ehChaveDeId(k) && v !== '' && !ID_VALIDO.test(v)) throw erro(422, 'VALIDACAO', 'Parâmetro inválido.', { [k]: 'Número inteiro inválido.' });

    ctx.sessao = await carregarSessao(cfg, db, ctx);
    ctx.user = ctx.sessao ? { id: ctx.sessao.user_id, papel: ctx.sessao.papel, nome: ctx.sessao.nome, dono: !!ctx.sessao.dono } : null;
    const permitidas = permissoesDe(ctx.sessao); // vale já na próxima requisição após o dono mudar algo
    ctx.pode = (p) => permitidas.has(p);

    const geral = limitador.bater(`api:${ctx.sessao?.id ?? ctx.ip}`, 600, 60_000);
    if (!geral.ok) throw Object.assign(erro(429, 'MUITAS_REQUISICOES', 'Muitas requisições. Aguarde um instante.'), { retryAfterS: geral.retryAfterS });

    const { auth, etapas } = r.opts;
    if (auth !== 'publica') {
      if (!ctx.sessao) throw erro(401, 'NAO_AUTENTICADO', 'Entre para continuar.');
      const ok = auth === 'completa' ? ctx.sessao.estagio === 'COMPLETA' : (etapas ?? []).includes(ctx.sessao.estagio);
      if (!ok) throw Object.assign(erro(403, 'ETAPA_INVALIDA', 'Conclua as etapas de acesso antes.'), { etapa: ctx.sessao.estagio });
      if (auth === 'completa') {
        // Negado por padrão: rota sem regra em src/permissoes.js não funciona para ninguém (nem para o dono) até ganhar uma regra.
        const exigida = REGRAS.get(`${r.metodo} ${r.padrao}`);
        if (exigida === undefined) throw erro(403, 'SEM_REGRA', 'Esta função ainda não tem regra de acesso.');
        if (exigida !== 'qualquer' && !([].concat(exigida)).some((p) => ctx.pode(p))) throw erro(403, 'SEM_PERMISSAO', 'Você não tem permissão para esta função.');
      }
    }

    const mutante = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutante) {
      // Rotas `externa` (webhooks de terceiros) não têm cookie nem Origin: autenticam por segredo na URL e nunca confiam no corpo.
      if (!r.opts.externa) {
        const origem = req.headers.origin;
        if (!origem || !cfg.origensPermitidas.has(origem)) throw erro(403, 'ORIGEM', 'Origem não permitida.');
        const sfs = req.headers['sec-fetch-site'];
        if (sfs && !['same-origin', 'none'].includes(sfs)) throw erro(403, 'ORIGEM', 'Origem não permitida.');
        if (!csrfValido(cfg, ctx, req.headers['x-csrf-token'])) throw erro(403, 'CSRF', 'Sessão da página expirada. Recarregue a página.');
      }
      const tipo = String(req.headers['content-type'] ?? '');
      const bruto = await lerCorpo(req, r.opts.limite ?? 256 * 1024);
      if (r.opts.texto) ctx.corpoTexto = bruto;
      else if (bruto.length) {
        if (!tipo.startsWith('application/json')) throw erro(415, 'TIPO', 'Envie JSON.');
        try { ctx.corpo = JSON.parse(bruto); } catch { throw erro(400, 'JSON', 'JSON inválido.'); }
      }
      ctx.corpoBruto = bruto;
    }
    ctx.corpo ??= {};

    if (r.opts.reauth && !(ctx.sessao?.reauth_em && cfg.agora() - ctx.sessao.reauth_em <= cfg.reauthMs)) {
      throw erro(403, 'REAUTENTICACAO', 'Confirme sua senha para continuar.');
    }

    if (r.opts.idempotente) return await idempotente(ctx, r);
    return await executar(ctx, r);
  }

  async function executar(ctx, r) {
    const resultado = await r.handler(ctx);
    return resultado;
  }

  async function idempotente(ctx, r) {
    const chave = ctx.req.headers['idempotency-key'];
    if (!chave || !/^[A-Za-z0-9_-]{16,64}$/.test(chave)) throw erro(400, 'IDEMPOTENCIA', 'Chave de idempotência ausente ou inválida.');
    const rotaId = `${r.metodo} ${r.padrao}`;
    const corpoHash = sha256(ctx.corpoBruto ?? '');
    const original = ctx.db;
    return await tx(db, async (db) => {
      await db.travar(`idem|${ctx.user.id}|${chave}`); // duas requisições com a mesma chave não correm juntas (no Postgres)
      const salvo = await db.get('SELECT * FROM idempotencia WHERE chave = ? AND user_id = ? AND rota = ?', chave, ctx.user.id, rotaId);
      if (salvo) {
        if (salvo.corpo_hash !== corpoHash) throw erro(422, 'IDEMPOTENCIA', 'Esta chave já foi usada com outro conteúdo.');
        ctx.repetido = true;
        return JSON.parse(salvo.resposta);
      }
      ctx.db = db; // o handler trabalha DENTRO desta transação
      let out;
      try { out = await r.handler(ctx); } finally { ctx.db = original; }
      await db.run('INSERT INTO idempotencia (chave, user_id, rota, corpo_hash, status, resposta, criado_em) VALUES (?,?,?,?,?,?,?)', chave, ctx.user.id, rotaId, corpoHash, 200, JSON.stringify(out ?? null), cfg.agora());
      return out;
    });
  }

  function estatico(ctx, url) {
    if (!['GET', 'HEAD'].includes(ctx.req.method)) throw erro(405, 'METODO', 'Método não permitido.');
    let rel = decodeURIComponent(url.pathname);
    if (rel.includes('\0')) throw erro(400, 'CAMINHO', 'Caminho inválido.');
    // Arquivos/pastas ocultos (.env, .git...) nunca são servidos, nem pelo fallback da SPA.
    if (rel.split('/').some((parte) => parte.startsWith('.'))) throw erro(404, 'NAO_ENCONTRADO', 'Não encontrado.');
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const alvo = path.resolve(cfg.publicDir, '.' + rel);
    if (!alvo.startsWith(cfg.publicDir + path.sep) || path.basename(alvo).startsWith('.')) throw erro(404, 'NAO_ENCONTRADO', 'Não encontrado.');
    let st;
    try { st = fs.statSync(alvo); } catch { throw erro(404, 'NAO_ENCONTRADO', 'Não encontrado.'); }
    if (!st.isFile()) throw erro(404, 'NAO_ENCONTRADO', 'Não encontrado.');
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (ctx.req.headers['if-none-match'] === etag) { ctx.res.writeHead(304, { ETag: etag }); ctx.res.end(); return; }
    const ext = path.extname(alvo).toLowerCase();
    responder(ctx, 200, fs.readFileSync(alvo), MIME[ext] ?? 'application/octet-stream', { ETag: etag, 'Cache-Control': 'no-cache' });
  }

  async function atender(req, res) {
    const t0 = process.hrtime.bigint();
    const ctx = { req, res, cfg, db, log, agora: cfg.agora, ip: ipDe(req), id: crypto.randomUUID().slice(0, 8), cookies: lerCookies(req.headers.cookie), setCookies: [], limitador };
    let url;
    try {
      if (!cfg.hostsPermitidos.has(String(req.headers.host ?? '').toLowerCase())) throw erro(400, 'HOST', 'Host não permitido.');
      url = new URL(req.url, 'http://x');
      cabecalhos(res, url.pathname.startsWith('/api/'));
      if (url.pathname.startsWith('/api/')) {
        const out = await api(ctx, url);
        if (out && out._raw) responder(ctx, out.status ?? 200, out.corpo, out.tipo, out.headers);
        else responder(ctx, ctx.status ?? 200, { ok: true, data: ctx.pode('financeiro.ver') ? out ?? null : semFinanceiro(out ?? null) }, undefined, ctx.repetido ? { 'Idempotent-Replay': 'true' } : {});
      } else estatico(ctx, url);
    } catch (e) {
      let he = e;
      if (!(e instanceof HttpError)) he = traduzirErroSql(e);
      if (!he) {
        log.error('erro interno', { id: ctx.id, rota: url?.pathname, erro: e?.message, pilha: String(e?.stack ?? '').split('\n').slice(0, 4).join(' | ') });
        he = erro(500, 'ERRO_INTERNO', 'Algo deu errado. Tente novamente.');
      }
      const extra = he.status === 429 && e.retryAfterS ? { 'Retry-After': String(e.retryAfterS) } : {};
      const corpo = { ok: false, error: { code: he.code, message: he.message, campos: he.campos, etapa: e.etapa, retryAfterS: e.retryAfterS, requestId: ctx.id } };
      if (url?.pathname.startsWith('/api/') || he.status !== 404) responder(ctx, he.status, corpo, undefined, extra);
      else responder(ctx, 404, 'Não encontrado', 'text/plain; charset=utf-8');
    } finally {
      res.on('finish', () => log.info('req', { id: ctx.id, m: req.method, p: url?.pathname, s: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6 | 0, u: ctx.user?.id }));
    }
  }

  const server = http.createServer(atender);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;

  return {
    server, rota, rotas, limitador, atender, eventos: new EventEmitter(),
    fechar: () => new Promise((resolve) => { limitador.parar(); server.close(() => resolve()); server.closeAllConnections?.(); }),
    csrfPara: (ctx) => csrfPara(cfg, ctx),
    novoAid: (ctx) => { const v = aleatorio(16); ctx.cookies[ck.aid] = v; ctx.setCookies.push(cookie(cfg, ck.aid, v, { maxAgeS: 86400 })); },
  };
}
