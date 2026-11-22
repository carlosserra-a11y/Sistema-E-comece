import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

function preparar(cfg, senha) {
  // pepper (segredo fora do banco) + senha -> 32 bytes; a senha crua nunca chega ao scrypt.
  return crypto.createHmac('sha256', cfg.pepper).update(String(senha), 'utf8').digest();
}

export async function hashSenha(cfg, senha) {
  const { N, r, p } = cfg.scrypt;
  const salt = crypto.randomBytes(16);
  const h = await scrypt(preparar(cfg, senha), salt, 32, { N, r, p, maxmem: 256 * N * r });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verificarSenha(cfg, senha, armazenado) {
  const [alg, N, r, p, salt, hash] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const h = await scrypt(preparar(cfg, senha), Buffer.from(salt, 'base64url'), esperado.length, {
    N: +N, r: +r, p: +p, maxmem: 256 * +N * +r,
  });
  return crypto.timingSafeEqual(h, esperado);
}

let dummy;
/** Gasta o mesmo tempo de uma verificação real quando o login não existe (evita enumeração por tempo). */
export async function verificacaoFalsa(cfg, senha) {
  dummy ??= await hashSenha(cfg, 'senha-falsa-para-igualar-o-tempo');
  await verificarSenha(cfg, senha, dummy);
  return false;
}

const COMUNS = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '123123123', 'password', 'password1', 'senha123', 'senha1234', 'qwertyui', 'abcd1234', 'abc12345', 'a1234567', 'iloveyou', 'brasil123', 'mudar123', 'admin123', 'trocar123']);

/** Política simples: 8 a 128 caracteres (pode ser mais longa, nunca limitada a 8), não ser uma senha muito comum e não conter o e-mail/login. */
export function validarPolitica(senha, { email = '', login = '' } = {}) {
  const problemas = [];
  const s = String(senha ?? '');
  if (s.length < 8) problemas.push('Use pelo menos 8 caracteres.');
  if (s.length > 128) problemas.push('Use no máximo 128 caracteres.');
  if (s.length >= 8 && /^(.)\1+$/.test(s)) problemas.push('Não use um único caractere repetido.');
  if (COMUNS.has(s.toLowerCase())) problemas.push('Essa senha é muito comum. Escolha outra.');
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && s.toLowerCase().includes(local)) problemas.push('A senha não pode conter o seu e-mail.');
  if (login && s.includes(login)) problemas.push('A senha não pode conter o seu login.');
  return problemas;
}

export function gerarSenhaForte(tamanho = 18) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  while (out.length < tamanho) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % alfabeto.length)) out += alfabeto[b % alfabeto.length];
  }
  return out;
}
