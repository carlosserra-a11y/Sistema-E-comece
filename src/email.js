// Envio de e-mail (código de confirmação). Três modos, escolhidos pela configuração:
//  - SMTP (produção): SMTP_HOST/PORT/USER/PASS. Ex.: Gmail com "senha de app" (smtp.gmail.com, 465).
//  - memória (só testes/desenvolvimento, EMAIL_TRANSPORTE=memoria): guarda as mensagens em `caixa` e não envia nada.
//  - não configurado: `configurado === false` e o cadastro por e-mail fica desligado (a tela nem mostra "Criar conta").
import nodemailer from 'nodemailer';
import { hmacHex } from './security/crypto.js';

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
