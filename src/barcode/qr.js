/** QR Code (modo byte, correção M, versões 1–10). Baseado no algoritmo da especificação ISO/IEC 18004. */

// versão: [ecPorBloco, blocos1, dados1, blocos2, dados2]
const TAB = {
  1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
};
const ALINHAMENTO = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

export function geradorRS(grau) {
  let g = [1];
  for (let i = 0; i < grau; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}

export function restoRS(dados, gen) {
  const grau = gen.length - 1;
  const resto = new Array(grau).fill(0);
  for (const b of dados) {
    const f = b ^ resto.shift();
    resto.push(0);
    for (let i = 0; i < grau; i++) resto[i] ^= mul(gen[i + 1], f);
  }
  return resto;
}

export function bitsFormato(mascara) {
  const dados = (0 << 3) | mascara; // nível M = 00
  let r = dados;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((dados << 10) | r) ^ 0x5412;
}

const bit = (v, i) => ((v >>> i) & 1) === 1;

export function qrMatriz(texto) {
  const bytes = Buffer.from(String(texto), 'utf8');
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    const [ec, b1, d1, b2, d2] = TAB[v];
    if (4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= (b1 * d1 + b2 * d2) * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('Texto longo demais para o QR Code (máx. ~213 bytes).');
  const [ec, b1, d1, b2, d2] = TAB[ver];
  const capacidade = (b1 * d1 + b2 * d2) * 8;

  const bits = [];
  const empurrar = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  empurrar(0b0100, 4);
  empurrar(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) empurrar(b, 8);
  empurrar(0, Math.min(4, capacidade - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacidade; pad ^= 0xec ^ 0x11) empurrar(pad, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const blocos = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) { const len = i < b1 ? d1 : d2; blocos.push(dados.slice(k, k + len)); k += len; }
  const gen = geradorRS(ec);
  const eccs = blocos.map((b) => restoRS(b, gen));
  const final = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocos) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of eccs) final.push(e[i]);

  const tam = ver * 4 + 17;
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fn = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const set = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };

  for (let i = 0; i < tam; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const localizador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < tam && y >= 0 && y < tam) set(x, y, d !== 2 && d !== 4);
    }
  };
  localizador(3, 3); localizador(tam - 4, 3); localizador(3, tam - 4);
  const pos = ALINHAMENTO[ver];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const desenharFormato = (mascara) => {
    const f = bitsFormato(mascara);
    for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
    set(8, 7, bit(f, 6)); set(8, 8, bit(f, 7)); set(7, 8, bit(f, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
    for (let i = 0; i < 8; i++) set(tam - 1 - i, 8, bit(f, i));
    for (let i = 8; i < 15; i++) set(8, tam - 15 + i, bit(f, i));
    set(8, tam - 8, true);
  };
  desenharFormato(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const v = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const a = tam - 11 + (i % 3); const b = Math.floor(i / 3); set(a, b, bit(v, i)); set(b, a, bit(v, i)); }
  }

  let idx = 0;
  for (let dir = tam - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < tam; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j;
      const y = ((dir + 1) & 2) === 0 ? tam - 1 - vert : vert;
      if (!fn[y][x] && idx < final.length * 8) { m[y][x] = bit(final[idx >>> 3], 7 - (idx & 7)); idx++; }
    }
  }

  const aplicar = (mascara) => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
      if (fn[y][x]) continue;
      const inv = [
        (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
        (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][mascara];
      if (inv) m[y][x] = !m[y][x];
    }
  };
  let melhor = 0; let menor = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    aplicar(mk); desenharFormato(mk);
    const p = penalidade(m, tam);
    if (p < menor) { menor = p; melhor = mk; }
    aplicar(mk);
  }
  aplicar(melhor); desenharFormato(melhor);
  return { tamanho: tam, versao: ver, mascara: melhor, modulos: m };
}

function penalidade(m, tam) {
  let r = 0;
  for (let passo = 0; passo < 2; passo++) for (let a = 0; a < tam; a++) {
    let corrida = 1;
    for (let b = 1; b < tam; b++) {
      const cur = passo ? m[b][a] : m[a][b];
      const ant = passo ? m[b - 1][a] : m[a][b - 1];
      if (cur === ant) { corrida++; if (corrida === 5) r += 3; else if (corrida > 5) r += 1; } else corrida = 1;
    }
  }
  for (let y = 0; y < tam - 1; y++) for (let x = 0; x < tam - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) r += 3;
  }
  const alvo = [1, 0, 1, 1, 1, 0, 1];
  const claro = (v) => v === undefined || v === false;
  for (let passo = 0; passo < 2; passo++) for (let a = 0; a < tam; a++) for (let b = 0; b <= tam - 7; b++) {
    const g = (i) => (passo ? m[i]?.[a] : m[a][i]);
    if (!alvo.every((v, i) => (g(b + i) ? 1 : 0) === v)) continue;
    if ([1, 2, 3, 4].every((i) => claro(g(b - i)))) r += 40;
    if ([7, 8, 9, 10].every((i) => claro(g(b + i)))) r += 40;
  }
  let escuros = 0;
  for (const linha of m) for (const v of linha) if (v) escuros++;
  r += (Math.ceil(Math.abs(escuros * 20 - tam * tam * 10) / (tam * tam)) - 1) * 10;
  return r;
}

/** SVG do QR (só atributos, sem estilos inline; compatível com a CSP estrita). */
export function qrSvg(texto, { borda = 4, px = 1 } = {}) {
  const { tamanho, modulos } = qrMatriz(texto);
  const total = tamanho + borda * 2;
  let d = '';
  for (let y = 0; y < tamanho; y++) {
    let x = 0;
    while (x < tamanho) {
      if (!modulos[y][x]) { x++; continue; }
      let w = 1;
      while (x + w < tamanho && modulos[y][x + w]) w++;
      d += `M${x + borda} ${y + borda}h${w}v1h-${w}z`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * px}" height="${total * px}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
