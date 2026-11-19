/** Simbologias lineares. Cada função devolve uma string de módulos: '1' = barra, '0' = espaço. */

// Code 128: larguras (barra,espaço,barra,espaço,barra,espaço) dos valores 0..106. 103/104/105 = Start A/B/C; 106 = Stop.
export const PADROES_128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function larguras(padrao) {
  let out = '';
  [...padrao].forEach((w, i) => { out += (i % 2 === 0 ? '1' : '0').repeat(Number(w)); });
  return out;
}

/** Valores Code 128: Start C quando for só dígitos em quantidade par; senão Start B (ASCII 32–126). */
export function valores128(texto) {
  const t = String(texto);
  if (!t.length || !/^[\x20-\x7e]+$/.test(t)) throw new Error('Code 128: use apenas caracteres ASCII imprimíveis.');
  const vals = [];
  if (/^\d+$/.test(t) && t.length % 2 === 0) {
    vals.push(105);
    for (let i = 0; i < t.length; i += 2) vals.push(Number(t.slice(i, i + 2)));
  } else {
    vals.push(104);
    for (const ch of t) vals.push(ch.charCodeAt(0) - 32);
  }
  let soma = vals[0];
  for (let i = 1; i < vals.length; i++) soma += vals[i] * i;
  vals.push(soma % 103, 106);
  return vals;
}

export const code128 = (texto) => valores128(texto).map((v) => larguras(PADROES_128[v])).join('');
export const subconjunto128 = (texto) => (/^\d+$/.test(texto) && texto.length % 2 === 0 ? 'C' : 'B');

// EAN/UPC
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((s) => [...s].map((c) => (c === '1' ? '0' : '1')).join(''));
const G = R.map((s) => [...s].reverse().join(''));
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13(codigo) {
  if (!/^\d{13}$/.test(codigo)) throw new Error('EAN-13 precisa de 13 dígitos.');
  const par = PARIDADE[Number(codigo[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (par[i] === 'L' ? L : G)[Number(codigo[i + 1])];
  bits += '01010';
  for (let i = 7; i < 13; i++) bits += R[Number(codigo[i])];
  return bits + '101';
}

export function ean8(codigo) {
  if (!/^\d{8}$/.test(codigo)) throw new Error('EAN-8 precisa de 8 dígitos.');
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += L[Number(codigo[i])];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += R[Number(codigo[i])];
  return bits + '101';
}

export const upca = (codigo) => {
  if (!/^\d{12}$/.test(codigo)) throw new Error('UPC-A precisa de 12 dígitos.');
  return ean13('0' + codigo);
};

/** Módulos de silêncio exigidos de cada lado (em módulos). */
export const SILENCIO = { code128: 10, ean13: 11, ean8: 7, upca: 9 };

export function bitsLinear(sim, dados) {
  switch (sim) {
    case 'code128': return code128(dados);
    case 'ean13': return ean13(dados);
    case 'ean8': return ean8(dados);
    case 'upca': return upca(dados);
    default: throw new Error(`simbologia desconhecida: ${sim}`);
  }
}
