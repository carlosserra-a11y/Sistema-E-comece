/**
 * Etiquetas térmicas. Um único modelo (lista de elementos em mm) gera SVG (tela/impressão) e ZPL II (Zebra, 203 dpi).
 * Elementos: { t:'texto', x,y,w,h,texto,negrito,alinhar } | { t:'barras', x,y,w,h,sim,dados } | { t:'qr', x,y,s,dados }.
 */
import { bitsLinear, SILENCIO } from './linear.js';
import { qrMatriz } from './qr.js';

export const DPMM = 8; // 203 dpi
export const FORMATOS = {
  '40x25': { w: 40, h: 25 },
  '50x30': { w: 50, h: 30 },
  '100x50': { w: 100, h: 50 },
  '100x150': { w: 100, h: 150 },
};
const LARGURA_CHAR = 0.52; // largura média de um caractere em relação à altura da fonte

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIM_POR_TIPO = { EAN13: 'ean13', EAN8: 'ean8', UPCA: 'upca', GTIN14: 'code128', CODE128: 'code128' };

export function quebrar(texto, largura, h, maxLinhas) {
  const cabem = Math.max(4, Math.floor(largura / (LARGURA_CHAR * h)));
  const linhas = [];
  let atual = '';
  for (const palavra of String(texto).split(/\s+/).filter(Boolean)) {
    const tent = atual ? `${atual} ${palavra}` : palavra;
    if (tent.length <= cabem) { atual = tent; continue; }
    if (atual) linhas.push(atual);
    atual = palavra.length > cabem ? palavra.slice(0, cabem) : palavra;
  }
  if (atual) linhas.push(atual);
  if (linhas.length > maxLinhas) {
    const cortadas = linhas.slice(0, maxLinhas);
    cortadas[maxLinhas - 1] = cortadas[maxLinhas - 1].slice(0, Math.max(1, cabem - 1)) + '…';
    return cortadas;
  }
  return linhas.length ? linhas : [''];
}

function textoLinhas(els, x, y, w, h, texto, maxLinhas, opts = {}) {
  let yy = y;
  for (const linha of quebrar(texto, w, h, maxLinhas)) {
    els.push({ t: 'texto', x, y: yy, w, h, texto: linha, ...opts });
    yy += h * 1.2;
  }
  return yy;
}

const PARAMS = {
  '40x25': { nome: 2.4, linhas: 2, sku: 2.2, m: 1.5 },
  '50x30': { nome: 3, linhas: 2, sku: 2.6, m: 2 },
  '100x50': { nome: 5.5, linhas: 2, sku: 4, m: 4 },
  '100x150': { nome: 9, linhas: 3, sku: 6, m: 6 },
};

export function etiquetaProduto(produto, codigo, formato) {
  const f = FORMATOS[formato];
  if (!f) throw new Error('formato de etiqueta desconhecido');
  const P = PARAMS[formato];
  const w = f.w - 2 * P.m;
  const els = [];
  let y = textoLinhas(els, P.m, P.m, w, P.nome, produto.nome, P.linhas, { negrito: true });
  els.push({ t: 'texto', x: P.m, y, w, h: P.sku, texto: `SKU ${produto.sku}`, negrito: false });
  y += P.sku * 1.4;
  els.push({ t: 'barras', x: P.m, y, w, h: f.h - y - P.m, sim: SIM_POR_TIPO[codigo.tipo] ?? 'code128', dados: codigo.codigo });
  return { ...f, els };
}

export function etiquetaEndereco(endereco, formato) {
  const f = FORMATOS[formato];
  if (!f) throw new Error('formato de etiqueta desconhecido');
  const m = formato === '100x150' ? 6 : formato === '100x50' ? 4 : 2;
  const els = [];
  const partes = endereco.codigo.split('-');
  if (f.w <= 50) {
    const s = f.h - 2 * m;
    els.push({ t: 'qr', x: m, y: m, s, dados: endereco.codigo });
    const area = f.w - s - 3 * m;
    const h = Math.min(5.2, area / (8 * LARGURA_CHAR));
    const x = 2 * m + s;
    els.push({ t: 'texto', x, y: f.h / 2 - h * 1.3, w: area, h, texto: partes.slice(0, 3).join('-'), negrito: true, alinhar: 'c' });
    els.push({ t: 'texto', x, y: f.h / 2 + h * 0.1, w: area, h, texto: partes.slice(3).join('-'), negrito: true, alinhar: 'c' });
  } else if (formato === '100x50') {
    const h = Math.min(9, (f.w - 2 * m) / (16 * LARGURA_CHAR));
    els.push({ t: 'texto', x: m, y: m, w: f.w - 2 * m, h, texto: endereco.codigo, negrito: true, alinhar: 'c' });
    els.push({ t: 'barras', x: m, y: m + h * 1.3, w: f.w - 2 * m, h: f.h - 2 * m - h * 1.3, sim: 'code128', dados: endereco.codigo });
  } else {
    const h = Math.min(14, (f.w - 2 * m) / (16 * LARGURA_CHAR));
    els.push({ t: 'texto', x: m, y: m, w: f.w - 2 * m, h, texto: endereco.codigo, negrito: true, alinhar: 'c' });
    els.push({ t: 'barras', x: m, y: m + h * 1.4, w: f.w - 2 * m, h: 40, sim: 'code128', dados: endereco.codigo });
    const s = 70;
    els.push({ t: 'qr', x: (f.w - s) / 2, y: m + h * 1.4 + 48, s, dados: endereco.codigo });
    if (endereco.zona) els.push({ t: 'texto', x: m, y: f.h - m - 8, w: f.w - 2 * m, h: 6, texto: endereco.zona, alinhar: 'c' });
  }
  return { ...f, els };
}

export function etiquetaLote(lote, produto, formato) {
  const f = FORMATOS[formato];
  if (!f) throw new Error('formato de etiqueta desconhecido');
  const P = PARAMS[formato];
  const w = f.w - 2 * P.m;
  const els = [];
  let y = textoLinhas(els, P.m, P.m, w, P.nome, produto.nome, P.linhas, { negrito: true });
  const val = lote.validade ? lote.validade.split('-').reverse().join('/') : 'sem validade';
  els.push({ t: 'texto', x: P.m, y, w, h: P.sku, texto: `Lote ${lote.codigo} · Val ${val}`, negrito: false });
  y += P.sku * 1.4;
  els.push({ t: 'barras', x: P.m, y, w, h: f.h - y - P.m, sim: 'code128', dados: `LT-${String(lote.id).padStart(6, '0')}` });
  return { ...f, els };
}

// ---------- renderização ----------

function geometriaBarras(el) {
  const bits = bitsLinear(el.sim, el.dados);
  const total = bits.length + 2 * SILENCIO[el.sim];
  const mwDots = Math.max(1, Math.floor((el.w * DPMM) / total));
  const mw = mwDots / DPMM;
  const larg = bits.length * mw;
  const txt = Math.min(3.2, Math.max(2, el.h * 0.16));
  return { bits, mwDots, mw, larg, x0: el.x + (el.w - larg) / 2, barH: el.h - txt - 0.4, txt, estreito: mwDots < 2 };
}

function geometriaQr(el) {
  const { tamanho, modulos } = qrMatriz(el.dados);
  const mwDots = Math.max(1, Math.floor((el.s * DPMM) / (tamanho + 4)));
  const mw = mwDots / DPMM;
  const lado = tamanho * mw;
  return { tamanho, modulos, mwDots, mw, x0: el.x + (el.s - lado) / 2, y0: el.y + (el.s - lado) / 2 };
}

const num = (v) => Math.round(v * 1000) / 1000;

export function svgEtiqueta(modelo) {
  const partes = [`<svg xmlns="http://www.w3.org/2000/svg" width="${modelo.w}mm" height="${modelo.h}mm" viewBox="0 0 ${modelo.w} ${modelo.h}"><rect width="${modelo.w}" height="${modelo.h}" fill="#fff"/>`];
  for (const el of modelo.els) {
    if (el.t === 'texto') {
      const anc = el.alinhar === 'c' ? 'middle' : 'start';
      const x = el.alinhar === 'c' ? el.x + el.w / 2 : el.x;
      partes.push(`<text x="${num(x)}" y="${num(el.y + el.h * 0.8)}" font-size="${num(el.h)}" font-family="Arial, Helvetica, sans-serif" font-weight="${el.negrito ? 700 : 400}" text-anchor="${anc}" fill="#000">${esc(el.texto)}</text>`);
    } else if (el.t === 'barras') {
      const g = geometriaBarras(el);
      let d = '';
      for (let i = 0; i < g.bits.length;) {
        if (g.bits[i] !== '1') { i++; continue; }
        let j = i;
        while (j < g.bits.length && g.bits[j] === '1') j++;
        d += `M${num(g.x0 + i * g.mw)} ${num(el.y)}h${num((j - i) * g.mw)}v${num(g.barH)}h-${num((j - i) * g.mw)}z`;
        i = j;
      }
      partes.push(`<path d="${d}" fill="#000" shape-rendering="crispEdges"/>`);
      partes.push(`<text x="${num(el.x + el.w / 2)}" y="${num(el.y + g.barH + 0.4 + g.txt * 0.85)}" font-size="${num(g.txt)}" font-family="Consolas, monospace" text-anchor="middle" fill="#000">${esc(el.dados)}</text>`);
    } else if (el.t === 'qr') {
      const g = geometriaQr(el);
      let d = '';
      for (let y = 0; y < g.tamanho; y++) for (let x = 0; x < g.tamanho; x++) {
        if (g.modulos[y][x]) d += `M${num(g.x0 + x * g.mw)} ${num(g.y0 + y * g.mw)}h${num(g.mw)}v${num(g.mw)}h-${num(g.mw)}z`;
      }
      partes.push(`<path d="${d}" fill="#000" shape-rendering="crispEdges"/>`);
    }
  }
  return partes.join('') + '</svg>';
}

const zplTexto = (s) => String(s).replace(/[\^~\\]/g, ' ');
const dots = (mm) => Math.round(mm * DPMM);

export function zplEtiqueta(modelo, copias = 1) {
  const z = ['^XA', '^CI28', `^PW${dots(modelo.w)}`, `^LL${dots(modelo.h)}`, '^LH0,0'];
  for (const el of modelo.els) {
    if (el.t === 'texto') {
      z.push(`^FO${dots(el.x)},${dots(el.y)}^FB${dots(el.w)},1,0,${el.alinhar === 'c' ? 'C' : 'L'},0^A0N,${dots(el.h)}^FD${zplTexto(el.texto)}^FS`);
    } else if (el.t === 'barras') {
      const g = geometriaBarras(el);
      const pref = el.sim === 'code128' ? (/^\d+$/.test(el.dados) && el.dados.length % 2 === 0 ? '>;' : '>:') : '';
      const cmd = { code128: `^BCN,${dots(g.barH)},N,N,N,N`, ean13: `^BEN,${dots(g.barH)},N,N`, ean8: `^B8N,${dots(g.barH)},N,N`, upca: `^BUN,${dots(g.barH)},N,N,N` }[el.sim];
      const dado = el.sim === 'ean13' ? el.dados.slice(0, 12) : el.sim === 'ean8' ? el.dados.slice(0, 7) : el.sim === 'upca' ? el.dados.slice(0, 11) : el.dados;
      z.push(`^BY${g.mwDots},3,${dots(g.barH)}^FO${dots(g.x0)},${dots(el.y)}${cmd}^FD${pref}${zplTexto(dado)}^FS`);
      z.push(`^FO${dots(el.x)},${dots(el.y + g.barH + 0.4)}^FB${dots(el.w)},1,0,C,0^A0N,${dots(g.txt)}^FD${zplTexto(el.dados)}^FS`);
    } else if (el.t === 'qr') {
      const g = geometriaQr(el);
      z.push(`^FO${dots(g.x0)},${dots(g.y0)}^BQN,2,${g.mwDots}^FDMA,${zplTexto(el.dados)}^FS`);
    }
  }
  z.push(`^PQ${Math.min(Math.max(copias, 1), 999)}`, '^XZ');
  return z.join('\n');
}

/** Aviso quando o módulo cai abaixo de 2 pontos (barras muito finas para leitores baratos). */
export function avisosEtiqueta(modelo) {
  const avisos = [];
  for (const el of modelo.els) {
    if (el.t === 'barras' && geometriaBarras(el).estreito) avisos.push('Barras muito finas para este tamanho: use uma etiqueta maior ou um código mais curto.');
  }
  return avisos;
}
