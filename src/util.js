export class HttpError extends Error {
  constructor(status, code, message, campos) {
    super(message);
    this.status = status;
    this.code = code;
    this.campos = campos;
  }
}
export const erro = (status, code, message, campos) => new HttpError(status, code, message, campos);
export const invalido = (campos, message = 'Dados inválidos.') => new HttpError(422, 'VALIDACAO', message, campos);
export const naoEncontrado = (o = 'Registro') => new HttpError(404, 'NAO_ENCONTRADO', `${o} não encontrado.`);
export const conflito = (code, message) => new HttpError(409, code, message);

export function normalizarTexto(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
export const escaparLike = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);
export const pad2 = (n) => String(n).padStart(2, '0');
export const nul = (v) => (v === undefined ? null : v);

/** Neutraliza injeção de fórmula em CSV/planilha (OWASP). */
export function celulaCsv(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function paginar(query, padrao = 25, max = 200) {
  const por = Math.min(Math.max(parseInt(query.por_pagina ?? padrao, 10) || padrao, 1), max);
  const pagina = Math.min(Math.max(parseInt(query.pagina ?? 1, 10) || 1, 1), 100_000);
  return { por, pagina, offset: (pagina - 1) * por };
}
