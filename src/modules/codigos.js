// Código de 6 dígitos enviado por e-mail. Serve para três coisas: confirmar o e-mail do cadastro, vincular um e-mail a uma conta
// e (a cada login) funcionar como segunda etapa. O código nunca é guardado: só o HMAC dele, preso ao usuário.
import crypto from 'node:crypto';
import { erro } from '../util.js';
import { hmacHex, iguais } from '../security/crypto.js';
import { mensagemCodigo } from '../email.js';

export const VALIDADE_MIN = 10;
export const MAX_ERROS_CODIGO = 5;
export const ESPERA_REENVIO_MS = 60_000;
export const MAX_ENVIOS_HORA = 5;
export const HORA = 3_600_000;
export const espera = (s) => (s >= 90 ? `${Math.ceil(s / 60)} minutos` : `${Math.max(1, s)} segundos`);

export function criarCodigos({ cfg, db, email, log }) {
  const codigoHash = (id, codigo) => hmacHex(cfg.hmacKey, `cod|${id}|${codigo}`);

  /** Confere a espera entre envios e o limite por hora (lança 429). Devolve o estado da janela de envios. */
  function cotaEnvio(u) {
    const t = cfg.agora();
    if (u.cod_enviado_em && t - u.cod_enviado_em < ESPERA_REENVIO_MS) {
      const s = Math.ceil((ESPERA_REENVIO_MS - (t - u.cod_enviado_em)) / 1000);
      throw Object.assign(erro(429, 'AGUARDE_REENVIO', `O código acabou de ser enviado. Aguarde ${espera(s)} para pedir outro.`), { retryAfterS: s });
    }
    const janelaNova = !u.cod_envios_desde || t - u.cod_envios_desde > HORA;
    const envios = janelaNova ? 0 : u.cod_envios;
    if (envios >= MAX_ENVIOS_HORA) throw erro(429, 'MUITOS_ENVIOS', 'Muitos códigos pedidos nesta hora. Tente de novo mais tarde.');
    return { t, janelaNova, envios };
  }

  /** Gera e envia um código novo para `para`. */
  async function emitirCodigo(u, para, nome) {
    const { t, janelaNova, envios } = cotaEnvio(u);
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.run('UPDATE users SET cod_hash = ?, cod_expira = ?, cod_tentativas = 0, cod_enviado_em = ?, cod_envios = ?, cod_envios_desde = ? WHERE id = ?',
      codigoHash(u.id, codigo), t + VALIDADE_MIN * 60_000, t, envios + 1, janelaNova ? t : u.cod_envios_desde, u.id);
    try {
      await email.enviar({ para, ...mensagemCodigo({ nome: nome?.split(' ')[0], codigo, minutos: VALIDADE_MIN, appName: cfg.appName }) });
    } catch (e) {
      await db.run('UPDATE users SET cod_hash = NULL, cod_enviado_em = NULL WHERE id = ?', u.id); // não deixa um código que ninguém recebeu
      log?.error?.('falha ao enviar e-mail', { erro: e?.message });
      throw erro(502, 'EMAIL_FALHOU', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
    }
  }

  /** Confere o código de `u`. Lança erro se inválido/vencido/esgotado. */
  async function conferirCodigo(u, codigo) {
    const t = cfg.agora();
    const msgGenerica = 'Código incorreto ou vencido.';
    if (!u?.cod_hash || !u.cod_expira || t > u.cod_expira) throw erro(422, 'CODIGO_INVALIDO', `${msgGenerica} Peça um novo código.`, { codigo: msgGenerica });
    if (u.cod_tentativas >= MAX_ERROS_CODIGO) throw erro(422, 'CODIGO_ESGOTADO', 'Muitos erros. Peça um novo código.', { codigo: 'Peça um novo código.' });
    const certo = typeof codigo === 'string' && /^\d{6}$/.test(codigo.trim()) && iguais(codigoHash(u.id, codigo.trim()), u.cod_hash);
    if (!certo) {
      const erros = u.cod_tentativas + 1;
      await db.run('UPDATE users SET cod_tentativas = ?, cod_hash = CASE WHEN ? >= ? THEN NULL ELSE cod_hash END WHERE id = ?', erros, erros, MAX_ERROS_CODIGO, u.id);
      const restam = MAX_ERROS_CODIGO - erros;
      throw erro(422, 'CODIGO_INVALIDO', restam > 0 ? `Código incorreto. Restam ${restam} tentativa(s).` : 'Código incorreto. Peça um novo código.', { codigo: 'Código incorreto.' });
    }
  }

  return { cotaEnvio, emitirCodigo, conferirCodigo };
}
