// Envio de e-mail (código de confirmação). Três modos, escolhidos pela configuração:
//  - SMTP (produção): SMTP_HOST/PORT/USER/PASS. Ex.: Gmail com "senha de app" (smtp.gmail.com, 465).
//  - memória (só testes/desenvolvimento, EMAIL_TRANSPORTE=memoria): guarda as mensagens em `caixa` e não envia nada.
//  - não configurado: `configurado === false` e o cadastro por e-mail fica desligado (a tela nem mostra "Criar conta").
import nodemailer from 'nodemailer';
import { hmacHex, cifrar } from './security/crypto.js';

export function criarEmail(cfg) {
  const e = cfg.email;
  if (e.transporte === 'memoria') {
    const caixa = [];
    return { configurado: true, modo: 'memoria', caixa, enviar: async (m) => { caixa.push({ ...m, em: cfg.agora() }); } };
  }
  if (!e.smtp) return { configurado: false, modo: 'nenhum', caixa: [], enviar: async () => { throw new Error('E-mail não configurado.'); } };
  let transporte = null;
  const pegar = () => (transporte ??= nodemailer.createTransport({
    host: e.smtp.host, port: e.smtp.port, secure: e.smtp.port === 465, auth: { user: e.smtp.user, pass: e.smtp.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  }));
  return { configurado: true, modo: 'smtp', caixa: [], enviar: async ({ para, assunto, texto }) => { await pegar().sendMail({ from: e.de || e.smtp.user, to: para, subject: assunto, text: texto }); } };
}

/** Texto do e-mail com o código. Curto, em português, sem links (nada para clicar e ser enganado). */
export function mensagemCodigo({ nome, codigo, minutos, appName }) {
  return {
    assunto: `${codigo} é o seu código de confirmação`,
    texto: `Olá${nome ? `, ${nome}` : ''}!\n\nSeu código de confirmação no ${appName} é:\n\n    ${codigo}\n\nEle vale por ${minutos} minutos e só pode ser usado uma vez.\n\nSe você não pediu este código, ignore esta mensagem: ninguém entra na conta sem ele.\n`,
  };
}

const DOMINIOS_GMAIL = new Set(['gmail.com', 'googlemail.com']);
/** Valida e normaliza. `canonico` é a identidade (Gmail: sem pontos, sem +etiqueta, sempre gmail.com); `exibicao` é para onde se envia. */
export function normalizarEmail(bruto) {
  const t = String(bruto ?? '').trim().toLowerCase();
  if (t.length > 254 || !/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/.test(t)) return null;
  const [local, dominio] = t.split('@');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..') || dominio.startsWith('.') || dominio.includes('..') || dominio.startsWith('-')) return null;
  let canonico = t;
  if (DOMINIOS_GMAIL.has(dominio)) {
    const base = local.split('+')[0].replace(/\./g, '');
    if (!base) return null;
    canonico = `${base}@gmail.com`;
  }
  return { exibicao: t, dominio, canonico };
}
export const chaveEmail = (cfg, canonico) => hmacHex(cfg.hmacKey, `email|${canonico}`);
export const mascararEmail = (e) => { const [l, d] = String(e).split('@'); return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 2))}@${d}`; };

/**
 * Liga o e-mail de DONO_EMAIL à conta do dono, já confirmado (quem controla as variáveis do servidor é o próprio dono, então não precisa de código).
 * Roda na partida e é idempotente. Um cadastro não confirmado com o mesmo e-mail (alguém que "reservou" o endereço) é removido;
 * se outra conta JÁ confirmada tiver esse e-mail, não mexe em nada.
 */
export async function vincularEmailDono(cfg, db, log) {
  if (!cfg.donoEmail) return false;
  const e = normalizarEmail(cfg.donoEmail);
  if (!e) { log?.error?.('DONO_EMAIL inválido: ignorado'); return false; }
  const dono = await db.get('SELECT id, email_hmac, email_verificado FROM users WHERE dono = 1');
  if (!dono) return false; // o dono ainda não foi criado: vale na próxima partida
  const chave = chaveEmail(cfg, e.canonico);
  if (dono.email_hmac === chave && dono.email_verificado) return false;
  const outra = await db.get('SELECT id, email_verificado FROM users WHERE email_hmac = ? AND id <> ?', chave, dono.id);
  if (outra?.email_verificado) { log?.error?.('DONO_EMAIL já pertence a outra conta confirmada: ignorado'); return false; }
  if (outra) await db.run("DELETE FROM users WHERE id = ? AND dono = 0 AND papel = 'pendente' AND email_verificado = 0", outra.id);
  await db.run('UPDATE users SET email_enc = ?, email_hmac = ?, email_verificado = 1, email_novo_enc = NULL, email_novo_hmac = NULL WHERE id = ?', cifrar(cfg.fieldKey, e.exibicao), chave, dono.id);
  return true;
}
