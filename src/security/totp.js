import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  let bits = 0, valor = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const novoSegredo = () => base32(crypto.randomBytes(20));

export function codigoTotp(segredoB32, passo, digitos = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', base32Decode(segredoB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digitos).padStart(digitos, '0');
}

export const passoAtual = (agora) => Math.floor(agora / 30000);

/**
 * Valida o código com janela de ±1 passo e anti-replay: só aceita passo MAIOR que o último usado.
 * Retorna o passo aceito ou null.
 */
export function verificarTotp(segredoB32, codigo, agora, ultimoPasso = 0) {
  const c = String(codigo ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const atual = passoAtual(agora);
  for (const p of [atual, atual - 1, atual + 1]) {
    if (p <= ultimoPasso) continue;
    const esperado = Buffer.from(codigoTotp(segredoB32, p));
    if (crypto.timingSafeEqual(esperado, Buffer.from(c))) return p;
  }
  return null;
}

export const uriOtpauth = (emissor, conta, segredo) =>
  `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(conta)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;

export function gerarCodigosRecuperacao(qtd = 10) {
  const out = [];
  for (let i = 0; i < qtd; i++) {
    const s = base32(crypto.randomBytes(7)).slice(0, 10);
    out.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return out;
}
export const normalizarCodigoRecuperacao = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
