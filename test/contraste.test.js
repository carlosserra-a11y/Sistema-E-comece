// Critério de aceite do design: todo par texto/fundo dos tokens com contraste >= 4,5:1 (WCAG AA), em todos os temas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const css = fs.readFileSync(path.join(ROOT, 'public/css/tokens.css'), 'utf8');

function bloco(seletorRegex) {
  const m = seletorRegex.exec(css);
  assert.ok(m, `bloco ${seletorRegex} não encontrado`);
  let i = m.index + m[0].length; let prof = 1; const ini = i;
  while (prof && i < css.length) { if (css[i] === '{') prof++; if (css[i] === '}') prof--; i++; }
  return css.slice(ini, i - 1);
}
function variaveis(texto) {
  const v = {};
  for (const [, nome, l, c, h] of texto.matchAll(/--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) v[nome] = [Number(l), Number(c), Number(h)];
  return v;
}
function oklchParaLuminancia([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180); const b = C * Math.sin((H * Math.PI) / 180);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3; const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3; const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
    .map((x) => Math.min(1, Math.max(0, x)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const razao = (a, b) => { const [x, y] = [oklchParaLuminancia(a), oklchParaLuminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const base = variaveis(bloco(/:root\s*\{/));
const temas = {
  escuro: base,
  claro: { ...base, ...variaveis(bloco(/:root\[data-theme="light"\]\s*\{/)) },
  automatico_claro: { ...base, ...variaveis(bloco(/:root\[data-theme="auto"\]\s*\{/)) },
  contraste: { ...base, ...variaveis(bloco(/:root\[data-theme="contraste"\]\s*\{/)) },
};
const PARES = [
  ['text', 'bg'], ['text', 'surface-1'], ['text', 'surface-2'], ['muted', 'bg'], ['muted', 'surface-1'], ['muted', 'surface-2'],
  ['accent', 'bg'], ['accent', 'surface-1'], ['success', 'surface-1'], ['warning', 'surface-1'], ['danger', 'surface-1'], ['info', 'surface-1'],
  ['success', 'bg'], ['warning', 'bg'], ['danger', 'bg'], ['info', 'bg'],
  ['on-accent', 'accent'], ['on-solid', 'success'], ['on-solid', 'warning'], ['on-solid', 'danger'],
];

for (const [nome, v] of Object.entries(temas)) {
  test(`contraste >= 4,5:1 no tema ${nome}`, () => {
    const falhas = [];
    for (const [fg, bg] of PARES) {
      assert.ok(v[fg] && v[bg], `variável ausente: ${fg}/${bg}`);
      const r = razao(v[fg], v[bg]);
      if (r < 4.5) falhas.push(`${fg} sobre ${bg}: ${r.toFixed(2)}:1`);
    }
    assert.deepEqual(falhas, []);
  });
}
