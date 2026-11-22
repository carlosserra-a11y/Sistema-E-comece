import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function chave(nome, valor) {
  if (!valor) throw new Error(`${nome} ausente. Rode "npm run setup" para gerar os segredos.`);
  const buf = /^[0-9a-f]{64,}$/i.test(valor) ? Buffer.from(valor, 'hex') : Buffer.from(valor, 'base64');
  if (buf.length < 32) throw new Error(`${nome} precisa ter pelo menos 32 bytes (64 caracteres hexadecimais).`);
  return buf.subarray(0, 32);
}

export function loadConfig(overrides = {}) {
  const arquivo = path.join(ROOT, '.env');
  const doArquivo = fs.existsSync(arquivo) ? parseEnv(fs.readFileSync(arquivo, 'utf8')) : {};
  const env = { ...doArquivo, ...process.env, ...overrides };
  const prod = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 3000);
  const host = env.HOST || '127.0.0.1';
  const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  if (prod && !/^https:\/\//.test(publicOrigin)) throw new Error('Em produção, PUBLIC_ORIGIN precisa ser uma URL https.');
  const origensPermitidas = new Set();
  const hostsPermitidos = new Set();
  if (publicOrigin) {
    origensPermitidas.add(publicOrigin);
    hostsPermitidos.add(new URL(publicOrigin).host);
  }
  if (!prod) {
    for (const h of ['localhost', '127.0.0.1', '[::1]']) {
      hostsPermitidos.add(`${h}:${port}`);
      origensPermitidas.add(`http://${h}:${port}`);
    }
  }
  const databaseUrl = env.DATABASE_URL || '';
  const dbPath = env.DB_PATH === ':memory:' ? ':memory:' : path.resolve(ROOT, env.DB_PATH || 'data/armazem.db');
  return {
    prod, host, port, publicOrigin, origensPermitidas, hostsPermitidos, dbPath, databaseUrl,
    databaseSslCa: env.DATABASE_SSL_CA || '', dbPoolMax: Number(env.DB_POOL_MAX ?? 3),
    appName: env.APP_NAME || 'Carlos Desenvolvedor de Sistema',
    trustProxy: env.TRUST_PROXY === 'true',
    pepper: chave('PEPPER', env.PEPPER),
    hmacKey: chave('HMAC_KEY', env.HMAC_KEY),
    fieldKey: chave('FIELD_KEY', env.FIELD_KEY),
    scrypt: { N: Number(env.SCRYPT_N ?? 32768), r: 8, p: 1 },
    sessao: {
      ociosoMs: Number(env.SESSAO_OCIOSA_MS ?? 30 * 60_000),
      absolutaMs: Number(env.SESSAO_ABSOLUTA_MS ?? 30 * 24 * 3600_000), // praticamente sem teto: com a aba aberta a tela renova a sessão a cada minuto
      preAuthMs: 15 * 60_000,
    },
    reauthMs: 5 * 60_000,
    publicDir: path.join(ROOT, 'public'),
    migrationsDir: path.join(ROOT, databaseUrl.startsWith('pglite:') ? 'supabase/migrations' : 'migrations'),
    logLevel: env.LOG_LEVEL || 'info',
    // Mercado Livre: hosts fixos (proteção contra SSRF). Só fora de produção dá para apontar para um servidor falso nos testes.
    ml: {
      apiBase: (!prod && env.ML_API_BASE ? env.ML_API_BASE : 'https://api.mercadolibre.com').replace(/\/$/, ''),
      authBase: (!prod && env.ML_AUTH_BASE ? env.ML_AUTH_BASE : 'https://auth.mercadolivre.com.br').replace(/\/$/, ''),
      pollMin: Number(env.ML_POLL_MIN ?? 10),
      esperar: null,
    },
    // E-mail do código de confirmação. SMTP (ex.: Gmail com senha de app) em produção; "memoria" só em testes/desenvolvimento.
    email: {
      transporte: !prod && env.EMAIL_TRANSPORTE === 'memoria' ? 'memoria' : 'smtp',
      smtp: env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER, pass: env.SMTP_PASS } : null,
      de: env.EMAIL_DE || (env.SMTP_USER ? `"${env.APP_NAME || 'Carlos Desenvolvedor de Sistema'}" <${env.SMTP_USER}>` : ''),
      dominios: (env.EMAIL_DOMINIOS || 'gmail.com,googlemail.com').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean), // '*' libera qualquer e-mail
    },
    loginCodigo: env.LOGIN_CODIGO !== '0', // código por e-mail a cada login (2ª etapa). LOGIN_CODIGO=0 desliga (emergência: e-mail fora do ar)
    donoEmail: (env.DONO_EMAIL || '').trim(), // e-mail da conta de dono (desenvolvedor): vinculado e confirmado na partida; entra só com o código do e-mail
    provisionar: env.PROVISIONAR || '', // 'frio' = carga inicial do cliente (uma vez): empresa, endereços, produtos e estoque de teste
    empresaJson: env.EMPRESA_JSON || '', // dados fiscais e de contato da empresa (variável do servidor, nunca no código)
    donosExtras: env.DONOS_EXTRAS_JSON || '', // contas de dono adicionais: [{"email":"...","nome":"..."}]; entram só com e-mail + código
    adminLogin: env.ADMIN_LOGIN || '',
    adminSenha: env.ADMIN_INITIAL_PASSWORD || '',
    agora: () => Date.now(),
  };
}
