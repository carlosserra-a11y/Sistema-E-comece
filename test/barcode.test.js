import test from 'node:test';
import assert from 'node:assert/strict';
import { digitoVerificador, validarGtin, variantes, ean13Interno } from '../src/barcode/gtin.js';
import { PADROES_128, code128, valores128, ean13, ean8, upca } from '../src/barcode/linear.js';
import { geradorRS, restoRS, bitsFormato, qrMatriz, qrSvg } from '../src/barcode/qr.js';

test('GTIN: dígito verificador e validação', () => {
  assert.equal(digitoVerificador('400638133393'), 1);
  assert.equal(validarGtin('4006381333931').valido, true);
  assert.equal(validarGtin('4006381333932').valido, false);
  assert.equal(validarGtin('036000291452').tipo, 'UPCA');
  assert.equal(validarGtin('96385074').tipo, 'EAN8');
  assert.equal(validarGtin('12345').valido, false);
  assert.equal(validarGtin('40063813339A1').valido, false);
});

test('GTIN: UPC-A e EAN-13 com zero à frente são o mesmo produto', () => {
  const v = variantes('036000291452');
  assert.ok(v.includes('0036000291452') && v.includes('036000291452') && v.includes('00036000291452'));
  assert.ok(variantes('0036000291452').includes('036000291452'));
  assert.deepEqual(variantes('ABC-1'), ['ABC-1']);
});

test('EAN-13 interno: prefixo 20, 13 dígitos, verificador correto', () => {
  const c = ean13Interno(1);
  assert.equal(c.length, 13);
  assert.ok(c.startsWith('20'));
  assert.equal(validarGtin(c).valido, true);
  assert.notEqual(ean13Interno(2), c);
  assert.throws(() => ean13Interno(0));
});

test('Code 128: tabela íntegra (107 padrões, soma 11, barras pares, únicos)', () => {
  assert.equal(PADROES_128.length, 107);
  assert.equal(new Set(PADROES_128).size, 107);
  PADROES_128.forEach((p, v) => {
    const soma = [...p].reduce((a, c) => a + Number(c), 0);
    assert.equal(soma, v === 106 ? 13 : 11, `valor ${v}`);
    if (v < 106) {
      const barras = [...p].filter((_, i) => i % 2 === 0).reduce((a, c) => a + Number(c), 0);
      assert.equal(barras % 2, 0, `paridade das barras do valor ${v}`);
    }
  });
});

function decodificar128(bits) {
  const mapa = new Map(PADROES_128.slice(0, 106).map((p, v) => {
    let b = '';
    [...p].forEach((w, i) => { b += (i % 2 === 0 ? '1' : '0').repeat(+w); });
    return [b, v];
  }));
  assert.ok(bits.endsWith('1100011101011'), 'termina com Stop');
  const corpo = bits.slice(0, -13);
  assert.equal(corpo.length % 11, 0);
  const vals = [];
  for (let i = 0; i < corpo.length; i += 11) vals.push(mapa.get(corpo.slice(i, i + 11)));
  assert.ok(vals.every((v) => v !== undefined), 'todos os símbolos reconhecidos');
  const check = vals.pop();
  let soma = vals[0];
  for (let i = 1; i < vals.length; i++) soma += vals[i] * i;
  assert.equal(soma % 103, check, 'checksum');
  if (vals[0] === 105) return vals.slice(1).map((v) => String(v).padStart(2, '0')).join('');
  return vals.slice(1).map((v) => String.fromCharCode(v + 32)).join('');
}

test('Code 128: ida e volta (endereço, SKU, numérico par e ímpar)', () => {
  for (const t of ['D1-A-03-02-01-04', 'LT-000123', 'ABC.123_x', '123456', '12345', 'a', ' ']) {
    assert.equal(decodificar128(code128(t)), t, t);
  }
  assert.equal(valores128('123456')[0], 105);
  assert.equal(valores128('12345')[0], 104);
  assert.throws(() => code128('ação'));
  assert.throws(() => code128(''));
});

test('EAN-13/8/UPC-A: 95/67 módulos, bordas e centro', () => {
  const b = ean13('4006381333931');
  assert.equal(b.length, 95);
  assert.ok(b.startsWith('101') && b.endsWith('101') && b.slice(45, 50) === '01010');
  assert.equal(ean8('96385074').length, 67);
  assert.equal(upca('036000291452'), ean13('0036000291452'));
  assert.throws(() => ean13('123'));
});

test('QR: Reed-Solomon bate com o exemplo clássico HELLO WORLD 1-Q (13 bytes de correção)', () => {
  const dados = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
  assert.deepEqual(restoRS(dados, geradorRS(13)), [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
});

test('QR: informação de formato (M, máscara 0 = 0x5412) e estrutura', () => {
  assert.equal(bitsFormato(0), 0x5412);
  const { tamanho, versao, modulos } = qrMatriz('D1-A-03-02-01-04');
  assert.equal(tamanho, versao * 4 + 17);
  assert.equal(versao, 2); // 16 bytes + cabeçalho não cabem na versão 1-M (14 bytes)
  assert.equal(qrMatriz('12345678901234').versao, 1);
  assert.equal(qrMatriz('123456789012345').versao, 2);
  for (const [x, y] of [[0, 0], [tamanho - 7, 0], [0, tamanho - 7]]) {
    assert.equal(modulos[y][x], true);
    assert.equal(modulos[y + 3][x + 3], true);
    assert.equal(modulos[y + 1][x + 1], false);
  }
  assert.equal(modulos[tamanho - 8][8], true);
});

test('QR: escolhe versão maior para textos longos e rejeita excesso', () => {
  assert.ok(qrMatriz('x'.repeat(100)).versao >= 6);
  assert.equal(qrMatriz('x'.repeat(213)).versao, 10);
  assert.throws(() => qrMatriz('x'.repeat(214)));
  assert.match(qrSvg('teste'), /^<svg /);
});
