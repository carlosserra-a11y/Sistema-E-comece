/** GS1: dígito verificador, validação e variantes equivalentes (GTIN-8/UPC-A/EAN-13/GTIN-14). */

export function digitoVerificador(base) {
  let soma = 0;
  for (let i = base.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(base[i]) * peso;
  return (10 - (soma % 10)) % 10;
}

const TIPO_POR_TAMANHO = { 8: 'EAN8', 12: 'UPCA', 13: 'EAN13', 14: 'GTIN14' };

/** Retorna { valido, tipo, motivo }. Aceita só dígitos. */
export function validarGtin(codigo) {
  const c = String(codigo ?? '');
  if (!/^\d+$/.test(c)) return { valido: false, tipo: null, motivo: 'Use apenas números.' };
  const tipo = TIPO_POR_TAMANHO[c.length];
  if (!tipo) return { valido: false, tipo: null, motivo: 'GTIN precisa ter 8, 12, 13 ou 14 dígitos.' };
  const certo = digitoVerificador(c.slice(0, -1));
  if (certo !== Number(c.at(-1))) return { valido: false, tipo, motivo: `Dígito verificador inválido (o correto seria ${certo}).` };
  return { valido: true, tipo, motivo: null };
}

/**
 * Todas as formas pelas quais o MESMO produto pode ser lido. Um GTIN é um número alinhado à direita:
 * o leitor pode entregar o UPC-A (12) como EAN-13 com zero à frente, ou um GTIN-14 com indicador 0.
 * Usado em buscas e na checagem de colisão entre produtos.
 */
export function variantes(codigo) {
  const c = String(codigo);
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return [c];
  const nucleo = c.replace(/^0+/, '') || '0';
  const set = new Set([c]);
  for (const tam of [8, 12, 13, 14]) if (tam >= nucleo.length) set.add(nucleo.padStart(tam, '0'));
  return [...set];
}

/** EAN-13 de circulação restrita (prefixo 20–29): uso interno da loja. 20 + 10 dígitos de sequência + verificador. */
export function ean13Interno(seq) {
  if (!Number.isInteger(seq) || seq < 1 || seq > 9_999_999_999) throw new Error('sequência fora do intervalo');
  const base = '20' + String(seq).padStart(10, '0');
  return base + digitoVerificador(base);
}
