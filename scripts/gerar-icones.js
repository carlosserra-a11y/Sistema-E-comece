// Gera os ícones PNG do app (celular/tela inicial) a partir da mesma geometria do public/icone.svg. Sem dependências: só node:zlib.
// Uso: npm run icones
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../src/config.js';

// Geometria da marca no sistema de 64x64 do SVG: um "C" (anel aberto à direita) com um pacote quadrado dentro da abertura.
const CENTRO = [31, 32]; const RAIO = 14.5; const ESPESSURA = 7; const ABERTURA = (40 * Math.PI) / 180;
const PONTAS = [[42.1, 22.7], [42.1, 41.3]];
const PACOTE = { x: 41, y: 28, l: 8, a: 8, r: 2.2 };
const COR_A = [0x63, 0x66, 0xf1]; const COR_B = [0x06, 0xb6, 0xd4];

/** Distância assinada ao "C" (negativa = dentro do traço). Na abertura, o ponto mais próximo é uma das duas pontas arredondadas. */
function distAnel(x, y) {
  const dx = x - CENTRO[0]; const dy = y - CENTRO[1];
  if (Math.abs(Math.atan2(dy, dx)) >= ABERTURA) return Math.abs(Math.hypot(dx, dy) - RAIO) - ESPESSURA / 2;
  return Math.min(...PONTAS.map(([ax, ay]) => Math.hypot(x - ax, y - ay))) - ESPESSURA / 2;
}
function distPacote(x, y) {
  const cx = PACOTE.x + PACOTE.l / 2; const cy = PACOTE.y + PACOTE.a / 2;
  const qx = Math.abs(x - cx) - (PACOTE.l / 2 - PACOTE.r); const qy = Math.abs(y - cy) - (PACOTE.a / 2 - PACOTE.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - PACOTE.r;
}
function distFundo(x, y, arredondar) {
  if (!arredondar) return -1;
  const r = 16; const qx = Math.abs(x - 32) - (32 - r); const qy = Math.abs(y - 32) - (32 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function renderizar(tam, { arredondar }) {
  const SS = 3; const dados = Buffer.alloc(tam * tam * 4);
  for (let py = 0; py < tam; py++) for (let px = 0; px < tam; px++) {
    let cobFundo = 0; let cobMarca = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = ((px + (sx + 0.5) / SS) / tam) * 64; const y = ((py + (sy + 0.5) / SS) / tam) * 64;
      if (distFundo(x, y, arredondar) <= 0) cobFundo++;
      if (Math.min(distAnel(x, y), distPacote(x, y)) <= 0) cobMarca++;
    }
    const t = (px + py) / (2 * tam); // gradiente diagonal
    const fundo = COR_A.map((c, i) => c + (COR_B[i] - c) * t);
    const f = cobFundo / (SS * SS); const m = cobMarca / (SS * SS);
    const i = (py * tam + px) * 4;
    for (let k = 0; k < 3; k++) dados[i + k] = Math.round(fundo[k] * (1 - m) + 255 * m);
    dados[i + 3] = Math.round(255 * f);
  }
  return dados;
}

const crcTabela = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTabela[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function bloco(tipo, corpo) {
  const t = Buffer.from(tipo, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(corpo.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, corpo])));
  return Buffer.concat([len, t, corpo, crc]);
}
function png(tam, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const linhas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let y = 0; y < tam; y++) { linhas[y * (tam * 4 + 1)] = 0; rgba.copy(linhas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(linhas, { level: 9 })), bloco('IEND', Buffer.alloc(0))]);
}

const saida = path.join(ROOT, 'public', 'icones');
fs.mkdirSync(saida, { recursive: true });
for (const [arquivo, tam, arredondar] of [['icone-192.png', 192, true], ['icone-512.png', 512, true], ['icone-maskable-512.png', 512, false], ['apple-touch-icon.png', 180, false]]) {
  fs.writeFileSync(path.join(saida, arquivo), png(tam, renderizar(tam, { arredondar })));
  console.log(`gerado ${arquivo}`);
}
