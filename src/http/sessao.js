import { sha256, hmacHex, aleatorio, iguais } from '../security/crypto.js';

export function nomesCookie(cfg) {
  return cfg.prod ? { sid: '__Host-sid', aid: '__Host-aid' } : { sid: 'sid', aid: 'aid' };
}

export function lerCookies(header = '') {
  const out = {};
  for (const par of String(header).split(';')) {
    const i = par.indexOf('=');
    if (i < 1) continue;
    const k = par.slice(0, i).trim();
    if (!(k in out)) { try { out[k] = decodeURIComponent(par.slice(i + 1).trim()); } catch { /* ignora */ } }
  }
  return out;
}

export function cookie(cfg, nome, valor, { maxAgeS } = {}) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (cfg.prod) partes.push('Secure');
  if (maxAgeS !== undefined) partes.push(`Max-Age=${maxAgeS}`);
  return partes.join('; ');
}

/** Token de CSRF sem estado: HMAC da sessão (ou do identificador anônimo, antes do login). */
export function csrfPara(cfg, ctx) {
  const aid = ctx.cookies[nomesCookie(cfg).aid];
  const base = ctx.sessao ? `s:${ctx.sessao.token_hash}` : aid ? `a:${aid}` : null;
  return base ? hmacHex(cfg.hmacKey, `csrf|${base}`) : null;
}
export const csrfValido = (cfg, ctx, enviado) => {
  const esperado = csrfPara(cfg, ctx);
  return Boolean(esperado && enviado && iguais(esperado, enviado));
};

/** Cria uma nova sessão (rotação: o chamador revoga a anterior) e põe o cookie na resposta. */
export async function criarSessao(cfg, db, ctx, userId, estagio) {
  const token = aleatorio(32);
  const t = cfg.agora();
  await db.run('INSERT INTO sessions (user_id, token_hash, estagio, criado_em, ultimo_uso, expira_abs, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)', userId, sha256(token), estagio, t, t, t + cfg.sessao.absolutaMs, ctx.ip ?? null, String(ctx.req.headers['user-agent'] ?? '').slice(0, 200));
  ctx.setCookies.push(cookie(cfg, nomesCookie(cfg).sid, token, { maxAgeS: Math.floor(cfg.sessao.absolutaMs / 1000) }));
  ctx.sessao = { ...(ctx.sessao ?? {}), user_id: userId, token_hash: sha256(token), estagio };
}

export async function revogarSessao(cfg, db, id) {
  await db.run('UPDATE sessions SET revogada_em = ? WHERE id = ? AND revogada_em IS NULL', cfg.agora(), id);
}

export async function carregarSessao(cfg, db, ctx) {
  const tok = ctx.cookies[nomesCookie(cfg).sid];
  if (!tok || tok.length > 100) return null;
  const s = await db.get(`SELECT s.*, u.papel, u.nome, u.mfa_ativo, u.trocar_senha, u.dono, u.permissoes FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revogada_em IS NULL AND u.ativo = 1`, sha256(tok));
  if (!s) return null;
  const t = cfg.agora();
  const ocioso = s.estagio === 'COMPLETA' ? cfg.sessao.ociosoMs : cfg.sessao.preAuthMs;
  if (t > s.expira_abs || t - s.ultimo_uso > ocioso) { await revogarSessao(cfg, db, s.id); return null; }
  if (t - s.ultimo_uso > 15_000) await db.run('UPDATE sessions SET ultimo_uso = ? WHERE id = ?', t, s.id);
  return s;
}
