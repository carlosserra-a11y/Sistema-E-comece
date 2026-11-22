import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { montar } from '../src/server.js';
import { criarLogger } from '../src/log.js';
import { chaveLogin } from '../src/modules/acesso.js';
import { hashSenha } from '../src/security/password.js';

// Valores sintéticos, só para testes.
export const LOGIN = '52998224725';
export const SENHA_INICIAL = 'inicial-fraca';
export const SENHA_FORTE = 'Telhado!Verde#Lume47';
const hex = () => crypto.randomBytes(32).toString('hex');

export async function criarSistema(opts = {}) {
  const relogio = { t: Date.now() };
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex(), SCRYPT_N: '1024', PORT: '0', LOG_LEVEL: 'error', ML_POLL_MIN: '0', EMAIL_TRANSPORTE: 'memoria', ...(process.env.TEST_DB === 'pg' ? { DATABASE_URL: 'pglite://memory' } : {}), ...(opts.env ?? {}), ...(opts.ml ? { ML_API_BASE: opts.ml.base } : {}) });
  cfg.agora = () => relogio.t;
  const atrasos = []; // esperas de recuo (backoff) pedidas ao adapter, sem esperar de verdade
  cfg.ml.esperar = async (ms) => { atrasos.push(ms); };
  cfg.ml.debounceMs = 0;
  const sis = await montar(cfg, { log: criarLogger({ silencioso: true }) });
  await sis.db.run("INSERT INTO users (login_hmac, senha_hash, trocar_senha, dono, papel, criado_em) VALUES (?,?,1,1,'admin',?)", chaveLogin(cfg, LOGIN), await hashSenha(cfg, SENHA_INICIAL), relogio.t);
  await new Promise((r) => sis.app.server.listen(0, '127.0.0.1', r));
  const porta = sis.app.server.address().port;
  cfg.hostsPermitidos.add(`127.0.0.1:${porta}`);
  cfg.origensPermitidas.add(`http://127.0.0.1:${porta}`);
  return { ...sis, cfg, relogio, atrasos, base: `http://127.0.0.1:${porta}`, cliente: () => new Cliente(`http://127.0.0.1:${porta}`) };
}

export class Cliente {
  constructor(base) { this.base = base; this.cookies = new Map(); this.csrf = null; }
  async req(metodo, caminho, corpo, { headers = {}, semCsrf = false, texto = false } = {}) {
    const h = { Origin: this.base, Cookie: [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '), ...headers };
    let body;
    if (corpo !== undefined) { h['Content-Type'] = texto ? 'text/csv' : 'application/json'; body = texto ? corpo : JSON.stringify(corpo); }
    if (this.csrf && !semCsrf) h['X-CSRF-Token'] = this.csrf;
    const r = await fetch(this.base + caminho, { method: metodo, headers: h, body, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) {
      const [par] = c.split(';'); const i = par.indexOf('=');
      if (/Max-Age=0/i.test(c)) this.cookies.delete(par.slice(0, i)); else this.cookies.set(par.slice(0, i), decodeURIComponent(par.slice(i + 1)));
    }
    const corpoTxt = await r.text();
    let json = null; try { json = JSON.parse(corpoTxt); } catch { /* não é JSON */ }
    if (json?.data?.csrf) this.csrf = json.data.csrf;
    return { status: r.status, json, data: json?.data, erro: json?.error, texto: corpoTxt, headers: r.headers };
  }
  get(c, o) { return this.req('GET', c, undefined, o); }
  post(c, b = {}, o) { return this.req('POST', c, b, o); }
  put(c, b = {}, o) { return this.req('PUT', c, b, o); }
  delete(c, o) { return this.req('DELETE', c, undefined, o); }
  /** POST idempotente (cada chamada usa uma chave nova, a menos que se passe `chave`). */
  idem(c, b, chave = crypto.randomBytes(12).toString('hex')) { return this.req('POST', c, b, { headers: { 'Idempotency-Key': chave } }); }
}

/** Fluxo completo do dono: login com a senha provisória -> trocar a senha. Devolve o cliente já autenticado. */
export async function entrarCompleto(sis) {
  const c = sis.cliente();
  await c.get('/api/sessao');
  let r = await c.post('/api/login', { login: LOGIN, senha: SENHA_INICIAL });
  if (r.status !== 200) throw new Error(`login falhou: ${r.texto}`);
  r = await c.post('/api/senha/trocar', { senha_atual: SENHA_INICIAL, senha_nova: SENHA_FORTE });
  if (r.status !== 200) throw new Error(`troca falhou: ${r.texto}`);
  return c;
}

/** Último código de 6 dígitos enviado para `para` (caixa de e-mail em memória, só nos testes). */
export const codigoDoEmail = (sis, para) => [...sis.email.caixa].reverse().find((m) => m.para === para)?.assunto.match(/^(\d{6})/)?.[1] ?? null;

/** Cria produto + devolve id. */
export async function novoProduto(c, extra = {}) {
  const n = crypto.randomBytes(3).toString('hex').toUpperCase();
  const r = await c.post('/api/produtos', { sku: `SKU-${n}`, nome: `Produto ${n}`, ...extra });
  if (r.status !== 201) throw new Error(`produto: ${r.texto}`);
  return r.data;
}
export async function zona(c, tipo) {
  const deps = (await c.get('/api/depositos')).data;
  return deps[0].zonas.find((z) => z.tipo === tipo);
}
/** Cria N endereços de picking/reserva numa rua e devolve a lista. */
export async function criarEnderecos(c, tipo, { rua = 1, predios = 2, niveis = 1, pos = 2, cap = 0 } = {}) {
  const z = await zona(c, tipo);
  const r = await c.post('/api/enderecos/lote', { zona_id: z.id, rua_de: rua, rua_ate: rua, predio_de: 1, predio_ate: predios, nivel_de: 1, nivel_ate: niveis, pos_de: 1, pos_ate: pos, cap_itens: cap, confirmar: 1 });
  if (r.status !== 200) throw new Error(`enderecos: ${r.texto}`);
  return (await c.get(`/api/enderecos?zona_id=${z.id}&por_pagina=200`)).data.itens;
}
export async function enderecoDe(c, tipo) {
  const z = await zona(c, tipo);
  return (await c.get(`/api/enderecos?zona_id=${z.id}`)).data.itens[0];
}
