import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmacHex = (chave, s) => crypto.createHmac('sha256', chave).update(s).digest('hex');
export const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** AES-256-GCM. Formato: v1.iv.tag.cifrado (base64url). */
export function cifrar(fieldKey, texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', fieldKey, iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decifrar(fieldKey, token) {
  const [v, iv, tag, enc] = String(token).split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('formato cifrado inválido');
  const d = crypto.createDecipheriv('aes-256-gcm', fieldKey, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}
