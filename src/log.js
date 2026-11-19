const REDACT = /senha|password|token|secret|cookie|authorization|otp|mfa_codigo|recovery|login|pepper|segredo/i;
const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 };

export function limpar(v, depth = 0) {
  if (depth > 4) return '[fundo]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => limpar(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = REDACT.test(k) ? '[oculto]' : limpar(x, depth + 1);
    return o;
  }
  return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
}

export function criarLogger({ nivel = 'info', saida = process.stdout, silencioso = false } = {}) {
  const min = NIVEIS[nivel] ?? 20;
  const emitir = (lvl, msg, dados) => {
    if (silencioso || NIVEIS[lvl] < min) return;
    saida.write(JSON.stringify({ t: new Date().toISOString(), nivel: lvl, msg, ...limpar(dados ?? {}) }) + '\n');
  };
  return {
    debug: (m, d) => emitir('debug', m, d),
    info: (m, d) => emitir('info', m, d),
    warn: (m, d) => emitir('warn', m, d),
    error: (m, d) => emitir('error', m, d),
  };
}
