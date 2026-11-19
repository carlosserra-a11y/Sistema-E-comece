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

const SEQUENCIAS = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function temSequencia(s) {
  const t = s.toLowerCase();
  for (const base of SEQUENCIAS) {
    const rev = [...base].reverse().join('');
    for (let i = 0; i + 4 <= t.length; i++) {
      const trecho = t.slice(i, i + 4);
      if (base.includes(trecho) || rev.includes(trecho)) return true;
    }
  }
  return false;
}

/** Política: 12–128 caracteres, sem datas, sem sequências, sem repetição, sem o login. Retorna a lista de problemas. */
export function validarPolitica(senha, { login = '' } = {}) {
  const problemas = [];
  const s = String(senha ?? '');
  if (s.length < 12) problemas.push('Use pelo menos 12 caracteres.');
  if (s.length > 128) problemas.push('Use no máximo 128 caracteres.');
  if (/(.)\1{3,}/.test(s)) problemas.push('Evite repetir o mesmo caractere 4 vezes seguidas.');
  if (temSequencia(s)) problemas.push('Evite sequências como 1234, abcd ou qwer.');
  if (/(?:0[1-9]|[12]\d|3[01])[\/.\-]?(?:0[1-9]|1[0-2])[\/.\-]?(?:19|20)\d{2}/.test(s) || /(?:19|20)\d{2}[\/.\-]?(?:0[1-9]|1[0-2])[\/.\-]?(?:0[1-9]|[12]\d|3[01])/.test(s)) {
    problemas.push('Evite datas (como nascimento).');
  }
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
