// Leitura de valores em dinheiro digitados ou vindos de planilha. Usado pela tela E pelo servidor (importação CSV),
// para os dois entenderem o texto do mesmo jeito. Sem dependências e sem DOM (roda no navegador e no Node).

const FORMATOS = [
  [/^\d+$/, (t) => t], // 35
  [/^\d+,\d{1,2}$/, (t) => t.replace(',', '.')], // 35,90
  [/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/, (t) => t.replace(/\./g, '').replace(',', '.')], // 1.234,56 e 1.500
  [/^\d+\.\d{1,2}$/, (t) => t], // 35.90 (ponto como casa decimal)
  [/^\d{1,3}(,\d{3})+\.\d{1,2}$/, (t) => t.replace(/,/g, '')], // 1,234.56
];

/** Texto -> centavos (inteiro). Devolve null quando não dá para entender com segurança (nunca "chuta" um valor). */
export function lerCentavos(texto) {
  const t = String(texto ?? '').replace(/R\$/i, '').replace(/\s/g, '');
  const formato = FORMATOS.find(([re]) => re.test(t));
  if (!formato) return null;
  const n = Number(formato[1](t));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centavos -> "1234,56" (para preencher campos e escrever planilhas). */
export const centavosParaTexto = (c) => ((c ?? 0) / 100).toFixed(2).replace('.', ',');
