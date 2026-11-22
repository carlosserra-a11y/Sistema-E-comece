// Dados cadastrais da empresa (uma linha só): razão social, CNPJ, endereço de cobrança, contatos e perfil fiscal.
// Ficam no banco (nunca no código nem no GitHub). A auditoria registra QUAIS campos mudaram, sem os valores.
import { tx } from '../db.js';
import { invalido } from '../util.js';
import { B, E, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { cpfCnpjValido } from './catalogo.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const email = () => T({ max: 254, regex: EMAIL_RE, msg: 'E-mail inválido.' });
const telefone = () => T({ regex: /^\d{10,13}$/, msg: 'Telefone com DDD (10 a 13 dígitos).' });

export const CONTRIBUINTE = ['CONTRIBUINTE', 'NAO_CONTRIBUINTE', 'ISENTO'];
export const APLICACOES = ['INDUSTRIALIZACAO', 'INSTALACAO', 'REVENDA', 'USO_CONSUMO'];
const ESPEC = {
  razao_social: T({ obrig: true, min: 2, max: 160 }), nome_fantasia: T({ max: 160 }),
  cnpj: T({ regex: /^\d{14}$/, msg: 'CNPJ tem 14 dígitos.' }), inscricao_estadual: T({ max: 30 }),
  endereco: T({ max: 200 }), cidade: T({ max: 80 }), uf: T({ upper: true, regex: /^[A-Z]{2}$/, msg: 'Use a sigla do estado (2 letras).' }), cep: T({ regex: /^\d{8}$/, msg: 'CEP tem 8 dígitos.' }),
  email_nf: email(),
  compras_nome: T({ max: 120 }), compras_email: email(), compras_telefone: telefone(),
  financeiro_nome: T({ max: 120 }), financeiro_email: email(), financeiro_telefone: telefone(),
  simples_nacional: B({ padrao: 0 }), contribuinte_icms: E(CONTRIBUINTE, { padrao: 'CONTRIBUINTE' }),
  suframa_numero: T({ regex: /^\d{6,15}$/, msg: 'Inscrição SUFRAMA: só números.' }),
  aplicacao: E(APLICACOES, { padrao: 'REVENDA' }), responsavel: T({ max: 120 }),
};
const CAMPOS = Object.keys(ESPEC);
const SO_DIGITOS = ['cnpj', 'cep', 'compras_telefone', 'financeiro_telefone', 'suframa_numero'];

/** Tira máscara (pontos, traços, parênteses) dos campos numéricos antes de validar. */
function desmascarar(corpo) {
  const c = corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? { ...corpo } : {};
  for (const k of SO_DIGITOS) if (typeof c[k] === 'string') c[k] = c[k].replace(/\D/g, '');
  for (const k of ['email_nf', 'compras_email', 'financeiro_email']) if (typeof c[k] === 'string') c[k] = c[k].trim().toLowerCase();
  return c;
}

export const lerEmpresa = async (db) => (await db.get('SELECT * FROM empresa WHERE id = 1')) ?? null;

/** Valida e grava (cria ou substitui) os dados da empresa. Devolve a lista de campos que mudaram. */
export async function gravarEmpresa(db, ctx, corpo) {
  const d = validar(desmascarar(corpo), ESPEC);
  if (d.cnpj && !cpfCnpjValido(d.cnpj)) throw invalido({ cnpj: 'CNPJ inválido (confira os dígitos).' });
  return await tx(db, async (db) => {
    const antes = await lerEmpresa(db);
    const vals = CAMPOS.map((c) => d[c] ?? null);
    await db.run(`INSERT INTO empresa (id, ${CAMPOS.join(',')}, atualizado_em) VALUES (1, ${CAMPOS.map(() => '?').join(',')}, ?)
      ON CONFLICT (id) DO UPDATE SET ${CAMPOS.map((c) => `${c} = excluded.${c}`).join(', ')}, atualizado_em = excluded.atualizado_em`, ...vals, ctx.agora());
    const mudou = CAMPOS.filter((c) => (antes?.[c] ?? null) !== (d[c] ?? null));
    await auditar(db, ctx, antes ? 'EMPRESA_ALTERADA' : 'EMPRESA_CADASTRADA', 'empresa', 1, { campos: mudou });
    return mudou;
  });
}

export function registrarEmpresa(app, { db }) {
  const { rota } = app;
  rota('GET', '/api/empresa', async () => ({ empresa: await lerEmpresa(db), contribuinte: CONTRIBUINTE, aplicacoes: APLICACOES }));
  rota('PUT', '/api/empresa', { reauth: true }, async (ctx) => {
    await gravarEmpresa(db, ctx, ctx.corpo);
    return { empresa: await lerEmpresa(db) };
  });
}
