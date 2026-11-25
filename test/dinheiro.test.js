// Dinheiro: a mesma leitura na tela e na planilha. Antes, "35.90" virava R$ 3.590,00 (exportar e reimportar multiplicava por 100).
import test from 'node:test';
import assert from 'node:assert/strict';
import { centavosParaTexto, lerCentavos } from '../public/js/dinheiro.js';
import { criarSistema, entrarCompleto, novoProduto } from './helpers.js';

test('lerCentavos: formatos brasileiros e com ponto decimal; o que é ambíguo ou inválido vira null', () => {
  const certos = { 35: 3500, '35,9': 3590, '35,90': 3590, '35.90': 3590, '35.9': 3590, '1.234,56': 123456, '1.500': 150000, 'R$ 1.234,56': 123456, '1,234.56': 123456, '0,05': 5, '1000000': 100000000, ' 12,00 ': 1200 };
  for (const [texto, esperado] of Object.entries(certos)) assert.equal(lerCentavos(texto), esperado, texto);
  for (const ruim of ['', '  ', 'abc', '-5', '12,345', '1.2.3', '12,3,4', '1e3', null, undefined, '5 reais']) assert.equal(lerCentavos(ruim), null, String(ruim));
  assert.equal(centavosParaTexto(123456), '1234,56');
  assert.equal(lerCentavos(centavosParaTexto(7)), 7);
});

test('planilha de produtos: exportar e importar de novo mantém os preços (não multiplica por 100)', async () => {
  const sis = await criarSistema();
  try {
    const c = await entrarCompleto(sis);
    await novoProduto(c, { sku: 'PRECO-1', nome: 'Compressor teste', preco_centavos: 123456, custo_centavos: 3590 });
    const csv = (await c.get('/api/produtos-exportar')).texto;
    const importar = (texto) => c.req('POST', '/api/produtos/importar?confirmar=1', texto, { texto: true });
    // a planilha exportada usa "saldo_total" etc.; basta trocar o SKU para importar como produto novo (sem o código de barras)
    const r = await importar(csv.replace(/PRECO-1/g, 'PRECO-2'));
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.data.validos, 1, r.texto);
    const p = (await c.get('/api/produtos?q=PRECO-2')).data.itens[0];
    assert.deepEqual([p.custo_centavos, p.preco_centavos], [3590, 123456]);
    // planilha feita à mão, com ponto como casa decimal
    const antiga = await importar('sku;nome;custo;preco\r\nPRECO-3;Peca antiga;12.50;35.90');
    assert.equal(antiga.data.validos, 1, antiga.texto);
    const q = (await c.get('/api/produtos?q=PRECO-3')).data.itens[0];
    assert.deepEqual([q.custo_centavos, q.preco_centavos], [1250, 3590]);
    assert.match(csv, /1234,56/, 'exporta com vírgula, como o Excel em português espera');
    // valor ambíguo é recusado na linha, nunca "adivinhado"
    const ruim = await importar('sku;nome;preco\r\nPRECO-4;Peca ruim;12,345');
    assert.deepEqual([ruim.data.validos, ruim.data.com_erro], [0, 1]);
  } finally { await sis.parar(); }
});
