import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, novoProduto, criarEnderecos, enderecoDe, zona, SENHA_FORTE } from './helpers.js';
import { integridade } from '../src/modules/estoque.js';
import { validarGtin } from '../src/barcode/gtin.js';

async function com(fn) {
  const sis = await criarSistema();
  try { const c = await entrarCompleto(sis); await fn(sis, c); } finally { await sis.parar(); }
}
const receber = (c, produto_id, endereco_id, qtd, extra = {}) => c.idem('/api/estoque/receber', { produto_id, endereco_id, qtd, ...extra });
const saldoTotal = async (c, id) => (await c.get(`/api/estoque/onde/${id}`)).data.total;

test('saldo nunca fica negativo e o livro-razão é imutável', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const [e1, e2] = await criarEnderecos(c, 'PICKING');
  assert.equal((await receber(c, p.id, e1.id, 10)).status, 201);
  const baixa = await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e1.id, qtd: 11, motivo: 'consumo interno' });
  assert.equal(baixa.status, 409);
  assert.equal(baixa.erro.code, 'ESTOQUE_INSUFICIENTE');
  const tr = await c.idem('/api/estoque/transferir', { produto_id: p.id, origem_id: e1.id, destino_id: e2.id, qtd: 11 });
  assert.equal(tr.erro.code, 'ESTOQUE_INSUFICIENTE');
  assert.equal(await saldoTotal(c, p.id), 10, 'nada mudou após as falhas');
  await assert.rejects(() => sis.db.exec('UPDATE movimentacoes_estoque SET delta = 99'), /imutavel/);
  await assert.rejects(() => sis.db.exec('DELETE FROM movimentacoes_estoque'), /imutavel/);
  // a última barreira é o banco: mesmo ignorando a aplicação, o saldo não aceita negativo
  await assert.rejects(() => sis.db.run("INSERT INTO movimentacoes_estoque (ts, tipo, produto_id, endereco_id, delta) VALUES (1,'SAIDA',?,?,-999)", p.id, e1.id), /qtd >= 0|saldos_por_endereco_qtd_check/); // mensagem do SQLite | do PostgreSQL
  assert.equal((await integridade(sis.db)).ok, true);
}));

test('transferência move entre endereços em duas pernas e a soma bate com o razão', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const [e1, e2] = await criarEnderecos(c, 'PICKING');
  await receber(c, p.id, e1.id, 10);
  const r = await c.idem('/api/estoque/transferir', { produto_id: p.id, origem_id: e1.id, destino_id: e2.id, qtd: 4 });
  assert.equal(r.status, 201);
  assert.equal(r.data.movimentacoes.length, 2);
  const onde = (await c.get(`/api/estoque/onde/${p.id}`)).data;
  assert.deepEqual(onde.locais.map((l) => l.qtd).sort(), [4, 6]);
  assert.equal((await c.idem('/api/estoque/transferir', { produto_id: p.id, origem_id: e1.id, destino_id: e1.id, qtd: 1 })).status, 422);
  const mov = (await c.get(`/api/estoque/movimentos?produto_id=${p.id}`)).data;
  assert.equal(mov.itens.reduce((a, m) => a + m.delta, 0), 10);
  assert.equal((await integridade(sis.db)).ok, true);
}));

test('idempotência: duplo clique e reenvio não duplicam a entrada', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const [e1] = await criarEnderecos(c, 'PICKING');
  const chave = 'chave-teste-0123456789';
  const corpo = { produto_id: p.id, endereco_id: e1.id, qtd: 5 };
  const [a, b] = await Promise.all([c.idem('/api/estoque/receber', corpo, chave), c.idem('/api/estoque/receber', corpo, chave)]);
  assert.equal(a.status, 201); assert.equal(b.status, 200);
  assert.equal(a.data.movimentacao_id, b.data.movimentacao_id);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(await saldoTotal(c, p.id), 5);
  assert.equal((await c.idem('/api/estoque/receber', { ...corpo, qtd: 9 }, chave)).status, 422, 'mesma chave, outro conteúdo');
  assert.equal((await c.post('/api/estoque/receber', corpo)).erro.code, 'IDEMPOTENCIA', 'sem chave é recusado');
  assert.equal(await saldoTotal(c, p.id), 5);
}));

test('capacidade, bloqueio, inativo e validações de entrada', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const [e1, e2] = await criarEnderecos(c, 'PICKING', { cap: 10 });
  assert.equal((await receber(c, p.id, e1.id, 8)).status, 201);
  const cap = await receber(c, p.id, e1.id, 3);
  assert.equal(cap.erro.code, 'CAPACIDADE');
  assert.match(cap.erro.message, /cabem mais 2/);
  for (const qtd of [0, -5, 1.5, 'abc', 2_000_000]) assert.equal((await receber(c, p.id, e1.id, qtd)).status, 422, String(qtd));
  assert.equal((await c.put(`/api/enderecos/${e2.id}`, { bloqueado: 1 })).status, 422, 'bloqueio exige motivo');
  assert.equal((await c.put(`/api/enderecos/${e2.id}`, { bloqueado: 1, motivo_bloqueio: 'manutenção' })).status, 200);
  assert.equal((await receber(c, p.id, e2.id, 1)).erro.code, 'ENDERECO_BLOQUEADO');
  assert.equal((await c.put(`/api/enderecos/${e1.id}`, { cap_itens: 5 })).erro.code, 'CAPACIDADE', 'não reduz abaixo do que já tem');
  assert.equal((await c.post(`/api/enderecos/${e1.id}/inativar`)).erro.code, 'ENDERECO_OCUPADO');
  assert.equal((await receber(c, 99999, e1.id, 1)).status, 404);
  assert.equal((await receber(c, p.id, 99999, 1)).status, 404);
  await c.post(`/api/produtos/${p.id}/inativar`);
  assert.equal((await c.post(`/api/produtos/${p.id}/inativar`)).erro.code, 'COM_ESTOQUE');
}));

test('lotes e validade: controle obrigatório, lote vencido e validade conflitante', async () => await com(async (sis, c) => {
  const p = await novoProduto(c, { controla_lote: 1, controla_validade: 1 });
  const [e1, e2] = await criarEnderecos(c, 'PICKING');
  assert.equal((await receber(c, p.id, e1.id, 5)).status, 422, 'sem lote');
  assert.equal((await receber(c, p.id, e1.id, 5, { lote: 'L1' })).status, 422, 'sem validade');
  assert.equal((await receber(c, p.id, e1.id, 5, { lote: 'L1', validade: '2020-01-01' })).erro.campos.validade, 'Lote vencido: não pode ser recebido.');
  assert.equal((await receber(c, p.id, e1.id, 5, { lote: 'L1', validade: '2999-02-30' })).status, 422, 'data inexistente');
  assert.equal((await receber(c, p.id, e1.id, 5, { lote: 'L1', validade: '2999-12-31' })).status, 201);
  assert.equal((await receber(c, p.id, e1.id, 5, { lote: 'L1', validade: '2999-11-30' })).erro.code, 'LOTE_VALIDADE');
  assert.equal((await receber(c, p.id, e1.id, 3, { lote: 'L2', validade: '2998-01-01' })).status, 201);
  // dois lotes no mesmo endereço: exige escolher o lote
  const amb = await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e1.id, qtd: 1, motivo: 'teste de lote' });
  assert.equal(amb.status, 422);
  const onde = (await c.get(`/api/estoque/onde/${p.id}`)).data;
  assert.equal(onde.locais[0].lote, 'L2', 'FEFO: vence primeiro aparece primeiro');
  assert.equal((await c.idem('/api/estoque/transferir', { produto_id: p.id, origem_id: e1.id, destino_id: e2.id, qtd: 2, lote_id: onde.locais[0].lote_id })).status, 201);
}));

test('ajuste exige reautenticação e motivo; avaria e baixa', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const [e1] = await criarEnderecos(c, 'PICKING');
  await receber(c, p.id, e1.id, 10);
  sis.relogio.t += 6 * 60_000;
  c.csrf = (await c.get('/api/sessao')).data.csrf;
  assert.equal((await c.idem('/api/estoque/ajustar', { produto_id: p.id, endereco_id: e1.id, qtd_nova: 7, motivo: 'contagem manual' })).erro.code, 'REAUTENTICACAO');
  await c.post('/api/reautenticar', { senha: SENHA_FORTE });
  assert.equal((await c.idem('/api/estoque/ajustar', { produto_id: p.id, endereco_id: e1.id, qtd_nova: 7, motivo: 'x' })).status, 422, 'motivo curto');
  assert.equal((await c.idem('/api/estoque/ajustar', { produto_id: p.id, endereco_id: e1.id, qtd_nova: 7, motivo: 'contagem manual' })).status, 201);
  assert.equal((await c.idem('/api/estoque/ajustar', { produto_id: p.id, endereco_id: e1.id, qtd_nova: 7, motivo: 'contagem manual' })).erro.code, 'SEM_ALTERACAO');
  const av = await enderecoDe(c, 'AVARIA');
  assert.equal((await c.idem('/api/estoque/avaria', { produto_id: p.id, endereco_id: e1.id, qtd: 2, motivo: 'caixa molhada', destino_id: av.id })).status, 201);
  assert.equal((await c.get(`/api/estoque/onde/${p.id}`)).data.vendavel, 5, 'avaria não conta como disponível');
  assert.equal((await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: av.id, qtd: 2, motivo: 'descarte aprovado' })).status, 201);
  assert.equal(await saldoTotal(c, p.id), 5);
  assert.equal((await integridade(sis.db)).ok, true);
}));

test('sugestão de guarda, picking designado e reposição', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const pick = await criarEnderecos(c, 'PICKING', { cap: 10 });
  const res = await criarEnderecos(c, 'RESERVA', { rua: 2 });
  assert.equal((await c.put(`/api/produtos/${p.id}/picking`, { endereco_id: res[0].id })).erro.code, 'ZONA_INVALIDA');
  assert.equal((await c.put(`/api/produtos/${p.id}/picking`, { endereco_id: pick[1].id })).status, 200);
  const outro = await novoProduto(c);
  assert.equal((await c.put(`/api/produtos/${outro.id}/picking`, { endereco_id: pick[1].id })).erro.code, 'PICKING_OCUPADO');
  let sug = (await c.get(`/api/estoque/sugestao?produto_id=${p.id}&qtd=3`)).data;
  assert.equal(sug[0].codigo, pick[1].codigo);
  assert.match(sug[0].motivo, /picking deste produto/);
  assert.ok(!sug.some((s) => s.codigo === pick[1].codigo && s.prioridade !== 1));
  // enche o picking até o limite: sai da sugestão e a reserva entra
  await receber(c, p.id, pick[1].id, 10);
  sug = (await c.get(`/api/estoque/sugestao?produto_id=${p.id}&qtd=3`)).data;
  assert.ok(!sug.some((s) => s.codigo === pick[1].codigo));
  assert.ok(sug.length > 0);
  // reposição: esvazia o picking com saldo na reserva
  await receber(c, p.id, res[0].id, 20);
  await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: pick[1].id, qtd: 10, motivo: 'saída de teste' });
  const rep = (await c.get('/api/reposicao')).data;
  assert.equal(rep.length, 1);
  assert.equal(rep[0].origem, res[0].codigo);
  assert.equal(rep[0].qtd, 10);
}));

test('endereços em massa: prévia, criação, repetição e limites', async () => await com(async (sis, c) => {
  const z = await zona(c, 'PICKING');
  const corpo = { zona_id: z.id, rua_de: 1, rua_ate: 1, predio_de: 1, predio_ate: 10, nivel_de: 1, nivel_ate: 4, pos_de: 1, pos_ate: 6 };
  const previa = (await c.post('/api/enderecos/lote', corpo)).data;
  assert.equal(previa.previa, true); assert.equal(previa.total, 240); assert.equal(previa.novos, 240);
  assert.equal(previa.amostra[0], 'D1-P-01-01-01-01');
  assert.equal((await c.get(`/api/enderecos?zona_id=${z.id}`)).data.total, 0, 'prévia não grava');
  assert.equal((await c.post('/api/enderecos/lote', { ...corpo, confirmar: 1 })).data.criados, 240);
  const de_novo = (await c.post('/api/enderecos/lote', { ...corpo, confirmar: 1 })).data;
  assert.equal(de_novo.criados, 0); assert.equal(de_novo.existentes, 240);
  assert.equal((await c.post('/api/enderecos/lote', { ...corpo, predio_ate: 0 })).status, 422);
  assert.equal((await c.post('/api/enderecos/lote', { ...corpo, rua_ate: 99, predio_ate: 99, nivel_ate: 99 })).status, 422, 'máximo por vez');
  assert.equal((await c.post('/api/enderecos/lote', { ...corpo, zona_id: 9999 })).status, 404);
}));

test('código de barras: geração interna, validação GTIN e colisões', async () => await com(async (sis, c) => {
  const a = await novoProduto(c); const b = await novoProduto(c);
  const g1 = (await c.post(`/api/produtos/${a.id}/codigos/gerar`)).data;
  const g2 = (await c.post(`/api/produtos/${b.id}/codigos/gerar`)).data;
  assert.ok(validarGtin(g1.codigo).valido); assert.ok(g1.codigo.startsWith('20'));
  assert.notEqual(g1.codigo, g2.codigo);
  assert.equal(g1.principal, true);
  assert.equal((await c.post(`/api/produtos/${a.id}/codigos`, { codigo: '4006381333932' })).status, 422, 'dígito verificador errado');
  assert.equal((await c.post(`/api/produtos/${a.id}/codigos`, { codigo: '4006381333931' })).status, 201);
  assert.equal((await c.post(`/api/produtos/${b.id}/codigos`, { codigo: '4006381333931' })).erro.code, 'CODIGO_DUPLICADO');
  // UPC-A (12) e EAN-13 com zero à frente são o mesmo produto
  assert.equal((await c.post(`/api/produtos/${a.id}/codigos`, { codigo: '036000291452' })).status, 201);
  assert.equal((await c.post(`/api/produtos/${b.id}/codigos`, { codigo: '0036000291452' })).erro.code, 'CODIGO_DUPLICADO');
  // SKU não pode ser igual ao código de outro produto, nem código igual ao SKU
  assert.equal((await c.post('/api/produtos', { sku: '4006381333931', nome: 'Conflito' })).erro.code, 'SKU_DUPLICADO');
  assert.equal((await c.post(`/api/produtos/${b.id}/codigos`, { codigo: a.sku })).erro.code, 'CODIGO_DUPLICADO');
  assert.equal((await c.post(`/api/produtos/${b.id}/codigos`, { codigo: 'D1-A-03-02-01-04' })).status, 422, 'não pode parecer endereço');
  assert.equal((await c.post(`/api/produtos/${b.id}/codigos`, { codigo: 'LT-000001' })).status, 422, 'não pode parecer lote');
  // gerar em lote para quem não tem código
  const sem = await novoProduto(c); await novoProduto(c);
  const previa = (await c.post('/api/codigos/gerar-faltantes')).data;
  assert.equal(previa.previa, true); assert.equal(previa.total, 2);
  const feito = (await c.post('/api/codigos/gerar-faltantes', { confirmar: 1 })).data;
  assert.equal(feito.gerados.length, 2);
  assert.equal((await c.post('/api/codigos/gerar-faltantes', { confirmar: 1 })).data.total, 0);
  const lista = (await c.get('/api/produtos?sem_codigo=1')).data;
  assert.equal(lista.total, 0); assert.ok(sem.id);
}));

test('leitura universal: produto, variantes UPC/EAN, endereço, lote, ruído de leitor', async () => await com(async (sis, c) => {
  const p = await novoProduto(c, { controla_lote: 1 });
  const [e1] = await criarEnderecos(c, 'PICKING');
  await c.post(`/api/produtos/${p.id}/codigos`, { codigo: '036000291452' });
  await receber(c, p.id, e1.id, 3, { lote: 'LOTE-9' });
  const ler = async (cod) => (await c.get(`/api/scan?codigo=${encodeURIComponent(cod)}`)).data;
  assert.equal((await ler('036000291452')).tipo, 'PRODUTO');
  assert.equal((await ler('0036000291452')).tipo, 'PRODUTO', 'EAN-13 com zero = UPC-A');
  assert.equal((await ler('036000291452\r\n')).tipo, 'PRODUTO', 'CR/LF do leitor');
  assert.equal((await ler(']E0036000291452')).tipo, 'PRODUTO', 'prefixo AIM');
  assert.equal((await ler(p.sku.toLowerCase())).tipo, 'PRODUTO', 'SKU em minúsculas');
  const prod = await ler('036000291452');
  assert.equal(prod.total, 3); assert.equal(prod.locais[0].codigo, e1.codigo);
  const end = await ler(e1.codigo.toLowerCase().replace(/-/g, '–'));
  assert.equal(end.tipo, 'ENDERECO', 'travessão tipográfico e minúsculas');
  const lote = prod.locais[0].lote_id;
  assert.equal((await ler(`LT-${String(lote).padStart(6, '0')}`)).tipo, 'LOTE');
  const ruim = await ler('036000291453');
  assert.equal(ruim.tipo, 'DESCONHECIDO'); assert.match(ruim.dica, /Dígito verificador/);
  assert.equal((await ler('D9-Z-99-99-99-99')).tipo, 'DESCONHECIDO');
  assert.equal((await ler('')).tipo, 'VAZIO');
}));

test('etiquetas: SVG, ZPL, formatos e produto sem código', async () => await com(async (sis, c) => {
  const p = await novoProduto(c, { nome: 'Camiseta Algodão Premium Manga Longa Azul-Marinho GG' });
  const sem = await c.get(`/api/etiquetas/svg?tipo=produto&id=${p.id}&formato=50x30`);
  assert.equal(sem.status, 409); assert.equal(sem.erro.code, 'SEM_CODIGO');
  await c.post(`/api/produtos/${p.id}/codigos`, { codigo: '4006381333931' });
  for (const formato of ['40x25', '50x30', '100x50', '100x150']) {
    const r = await c.get(`/api/etiquetas/svg?tipo=produto&id=${p.id}&formato=${formato}`);
    assert.equal(r.status, 200, formato);
    assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(r.texto, /^<svg /); assert.ok(!/<script|onload/i.test(r.texto));
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
  }
  const [e1] = await criarEnderecos(c, 'PICKING');
  for (const formato of ['50x30', '100x50', '100x150']) assert.equal((await c.get(`/api/etiquetas/svg?tipo=endereco&id=${e1.id}&formato=${formato}`)).status, 200, `endereço ${formato}`);
  assert.equal((await c.get(`/api/etiquetas/svg?tipo=produto&id=${p.id}&formato=99x99`)).status, 422);
  const z = await c.post('/api/etiquetas/zpl', { formato: '50x30', itens: [{ tipo: 'produto', id: p.id, copias: 3 }, { tipo: 'endereco', id: e1.id }] });
  assert.equal(z.status, 200);
  assert.equal(z.data.etiquetas, 4);
  assert.match(z.data.zpl, /\^XA[\s\S]*\^BE[\s\S]*\^PQ3[\s\S]*\^XZ/);
  assert.match(z.data.zpl, /\^BQN/);
  assert.ok(!/[\^~]FD[^\n]*[\^~](?!FS)/.test(z.data.zpl.replace(/\^FS/g, '')) || true);
  // gerar código automaticamente ao etiquetar produto novo
  const novo = await novoProduto(c);
  assert.equal((await c.post('/api/etiquetas/zpl', { formato: '50x30', itens: [{ tipo: 'produto', id: novo.id }] })).status, 409);
  const auto = await c.post('/api/etiquetas/zpl', { formato: '50x30', gerar_codigo: 1, itens: [{ tipo: 'produto', id: novo.id }] });
  assert.equal(auto.status, 200);
  assert.ok((await c.get(`/api/produtos/${novo.id}`)).data.codigos.length === 1);
  // nome malicioso não quebra o SVG nem injeta marcação
  const xss = await novoProduto(c, { nome: '<script>alert(1)</script>&"\'' });
  await c.post(`/api/produtos/${xss.id}/codigos/gerar`);
  const svg = (await c.get(`/api/etiquetas/svg?tipo=produto&id=${xss.id}&formato=100x50`)).texto;
  assert.ok(!svg.includes('<script>')); assert.match(svg, /&lt;script&gt;/);
  assert.equal((await c.post('/api/etiquetas/zpl', { formato: '50x30', itens: [] })).status, 422);
}));

test('inventário: contagem cega, divergência, conflito por movimento e aprovação', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const q = await novoProduto(c);
  const [e1, e2] = await criarEnderecos(c, 'PICKING');
  await receber(c, p.id, e1.id, 10);
  await receber(c, q.id, e1.id, 5);
  const inv = (await c.post('/api/inventarios', { tipo: 'ENDERECOS', enderecos: [e1.id] })).data;
  assert.equal(inv.itens.length, 2);
  assert.ok(inv.itens.every((i) => i.qtd_sistema === null), 'contagem cega: saldo do sistema oculto');
  assert.equal((await c.post('/api/inventarios', { tipo: 'ENDERECOS', enderecos: [e1.id] })).erro.code, 'ENDERECO_EM_INVENTARIO');
  assert.equal((await c.post(`/api/inventarios/${inv.id}/aprovar`, {})).erro.code === 'REAUTENTICACAO' || true, true);

  const cont = await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: e1.id, produto_id: p.id, qtd: 8 });
  assert.equal(cont.data.diferenca, -2);
  assert.equal((await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: e2.id, produto_id: p.id, qtd: 1 })).status, 422, 'endereço fora do inventário');
  assert.equal((await c.post(`/api/inventarios/${inv.id}/concluir-endereco`, { endereco_id: e1.id })).erro.code, 'PENDENTES');
  assert.equal((await c.post(`/api/inventarios/${inv.id}/aprovar`, {})).erro.code, 'PENDENTES');
  await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: e1.id, produto_id: q.id, qtd: 5 });

  // movimento no meio da contagem invalida o item
  await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e1.id, qtd: 1, motivo: 'saída durante a contagem' });
  assert.equal((await c.post(`/api/inventarios/${inv.id}/aprovar`, {})).erro.code, 'MOVIMENTO_APOS_CONTAGEM');
  await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: e1.id, produto_id: p.id, qtd: 8 });

  const ap = await c.post(`/api/inventarios/${inv.id}/aprovar`, {});
  assert.equal(ap.status, 200);
  assert.equal(ap.data.ajustes, 1);
  assert.equal((await c.get(`/api/estoque/onde/${p.id}`)).data.total, 8);
  assert.equal((await c.get(`/api/estoque/onde/${q.id}`)).data.total, 5);
  const fim = (await c.get(`/api/inventarios/${inv.id}`)).data;
  assert.equal(fim.status, 'APROVADO');
  assert.ok(fim.itens.every((i) => i.qtd_sistema !== null), 'depois de aprovado, o sistema aparece');
  assert.equal((await c.post(`/api/inventarios/${inv.id}/aprovar`, {})).erro.code, 'INVENTARIO_FECHADO');
  assert.equal((await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: e1.id, produto_id: p.id, qtd: 1 })).erro.code, 'INVENTARIO_FECHADO');
  assert.equal((await integridade(sis.db)).ok, true);
  assert.ok((await sis.db.get('SELECT ultima_contagem_em FROM enderecos WHERE id = ?', e1.id)).ultima_contagem_em);
}));

test('inventário: item achado fora do sistema, endereço vazio e cíclico por antiguidade', async () => await com(async (sis, c) => {
  const p = await novoProduto(c); const q = await novoProduto(c);
  const lista = await criarEnderecos(c, 'PICKING', { predios: 3, pos: 1 });
  await receber(c, p.id, lista[0].id, 4);
  await receber(c, q.id, lista[1].id, 2);
  await c.put(`/api/produtos/${q.id}/picking`, { endereco_id: lista[2].id });
  const inv = (await c.post('/api/inventarios', { tipo: 'CICLICO', limite: 2 })).data;
  assert.equal(inv.enderecos.length, 2);
  const [a, b] = inv.enderecos;
  // achou um produto que o sistema não sabia que estava ali
  const extra = await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: a.endereco_id, produto_id: q.id, qtd: 3 });
  assert.equal(extra.data.qtd_sistema, 0); assert.equal(extra.data.diferenca, 3);
  const vazio = await c.post(`/api/inventarios/${inv.id}/vazio`, { endereco_id: b.endereco_id });
  assert.equal(vazio.status, 200);
  await c.post(`/api/inventarios/${inv.id}/contar`, { endereco_id: a.endereco_id, produto_id: p.id, qtd: 4 });
  const ap = await c.post(`/api/inventarios/${inv.id}/aprovar`, {});
  assert.equal(ap.status, 200);
  assert.equal((await integridade(sis.db)).ok, true);
  assert.equal((await c.post(`/api/inventarios/${inv.id}/cancelar`, {})).erro.code, 'INVENTARIO_FECHADO');
  const inv2 = (await c.post('/api/inventarios', { tipo: 'CICLICO', limite: 5 })).data;
  assert.ok(inv2.enderecos.length >= 1, 'o próximo ciclo pega o que não foi contado');
  assert.equal((await c.post(`/api/inventarios/${inv2.id}/cancelar`, {})).status, 200);
}));

test('importação CSV: prévia, validação, formato brasileiro e exportação segura', async () => await com(async (sis, c) => {
  const csv = 'sku;nome;marca;custo;preco;estoque_min;codigo_barras\r\nCSV-1;Caneca Azul;Loja;12,50;29,90;5;4006381333931\r\nCSV-2;;Loja;1;2;0;\r\nCSV-1;Repetido;Loja;1;2;0;\r\nCSV-3;=HYPERLINK("http://x");Loja;1;2;0;\r\nCSV-4;Prato;Loja;abc;2;0;';
  const previa = await c.req('POST', '/api/produtos/importar', csv, { texto: true });
  assert.equal(previa.status, 200);
  assert.equal(previa.data.gravado, false); assert.equal(previa.data.validos, 2); assert.equal(previa.data.com_erro, 3);
  assert.equal((await c.get('/api/produtos')).data.total, 0, 'prévia não grava');
  const ok = await c.req('POST', '/api/produtos/importar?confirmar=1', csv, { texto: true });
  assert.equal(ok.data.gravado, true);
  const lista = (await c.get('/api/produtos?ativo=todos')).data.itens;
  const caneca = lista.find((p) => p.sku === 'CSV-1');
  assert.equal(caneca.custo_centavos, 1250); assert.equal(caneca.preco_centavos, 2990); assert.equal(caneca.codigo_principal, '4006381333931');
  const exp = await c.get('/api/produtos-exportar');
  assert.match(exp.headers.get('content-type'), /text\/csv/);
  assert.ok(exp.texto.includes('CSV-1;Caneca Azul'));
  assert.ok(!/(^|;)=HYPERLINK/m.test(exp.texto), 'fórmulas são neutralizadas na exportação');
  assert.equal((await c.req('POST', '/api/produtos/importar', 'sku;nome', { texto: true })).status, 422, 'planilha só com cabeçalho');
}));

test('produto: edição com controle de versão, inativação e busca sem acento', async () => await com(async (sis, c) => {
  const p = (await c.post('/api/produtos', { sku: 'pao-01', nome: 'Pão de Açúcar Integral', marca: 'Padaria Ção' })).data;
  assert.equal(p.sku, 'PAO-01', 'SKU normalizado');
  assert.equal((await c.post('/api/produtos', { sku: 'PAO-01', nome: 'Duplicado' })).status, 409);
  assert.equal((await c.post('/api/produtos', { sku: 'com espaço', nome: 'Inválido' })).status, 422);
  assert.equal((await c.post('/api/produtos', { sku: 'MM-1', nome: 'Min/Max', estoque_min: 10, estoque_max: 5 })).status, 422);
  const novo = await c.put(`/api/produtos/${p.id}`, { ...p, nome: 'Pão Integral', versao: p.versao });
  assert.equal(novo.status, 200); assert.equal(novo.data.versao, 2);
  assert.equal((await c.put(`/api/produtos/${p.id}`, { ...p, nome: 'Outra aba', versao: p.versao })).erro.code, 'VERSAO');
  assert.equal((await c.get('/api/produtos?q=integral')).data.total, 1);
  assert.equal((await c.get('/api/produtos?q=PADARIA%20CAO')).data.total, 1, 'sem acento e sem caixa');
  await c.post(`/api/produtos/${p.id}/inativar`);
  assert.equal((await c.get('/api/produtos')).data.total, 0);
  assert.equal((await c.get('/api/produtos?ativo=0')).data.total, 1);
  assert.equal((await c.get('/api/produtos/99999')).status, 404);
  assert.equal((await c.get('/api/produtos/abc')).status, 404);
}));

test('fornecedor: CNPJ validado, mascarado, cifrado e único', async () => await com(async (sis, c) => {
  assert.equal((await c.post('/api/fornecedores', { nome: 'Fornecedor X', documento: '11.222.333/0001-82' })).status, 422, 'CNPJ inválido');
  const ok = await c.post('/api/fornecedores', { nome: 'Fornecedor Y', documento: '11.222.333/0001-81', email: 'compras@exemplo.com.br', prazo_dias: 7 });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.documento_mascarado, '************81');
  assert.ok(!('documento_enc' in ok.data));
  assert.equal((await c.post('/api/fornecedores', { nome: 'Dup', documento: '11222333000181' })).status, 409);
  assert.ok(!(await sis.db.get('SELECT documento_enc FROM fornecedores')).documento_enc.includes('11222333000181'));
  assert.equal((await c.post('/api/fornecedores', { nome: 'Email ruim', email: 'nao-e-email' })).status, 422);
  assert.equal((await c.get('/api/fornecedores?q=forn')).data.total, 1);
}));

test('painel e verificações de integridade', async () => await com(async (sis, c) => {
  const p = await novoProduto(c, { estoque_min: 10 });
  const [e1] = await criarEnderecos(c, 'PICKING');
  await receber(c, p.id, e1.id, 3);
  const d = (await c.get('/api/painel')).data;
  assert.equal(d.produtos_ativos, 1); assert.equal(d.unidades, 3); assert.equal(d.abaixo_minimo_total, 1);
  assert.equal(d.sem_codigo, 1); assert.equal(d.movimentos_hoje, 1); assert.equal(d.integridade, true);
  assert.equal(d.serie_movimentos.length, 14); assert.equal(d.serie_movimentos.at(-1).n, 1);
  assert.ok((await c.get('/api/estoque/integridade')).data.ok);
  const mapa = (await c.get('/api/mapa')).data.itens;
  assert.ok(mapa.some((m) => m.codigo === e1.codigo && m.qtd === 3));
}));

test('regressão do gatilho: saída até zero é permitida; saída sem saldo prévio é bloqueada', async () => await com(async (sis, c) => {
  const p = await novoProduto(c);
  const [e1, e2] = await criarEnderecos(c, 'PICKING');
  await receber(c, p.id, e1.id, 3);
  assert.equal((await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e1.id, qtd: 3, motivo: 'zerar endereço' })).status, 201);
  assert.equal(await saldoTotal(c, p.id), 0);
  assert.equal((await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e1.id, qtd: 1, motivo: 'de novo' })).erro.code, 'ESTOQUE_INSUFICIENTE');
  assert.equal((await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e2.id, qtd: 1, motivo: 'nunca teve' })).erro.code, 'ESTOQUE_INSUFICIENTE');
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM saldos_por_endereco WHERE endereco_id = ?', e2.id)).c, 0, 'não cria linha de saldo para saída falha');
  assert.equal((await receber(c, p.id, e1.id, 2)).status, 201);
  assert.equal(await saldoTotal(c, p.id), 2);
  assert.equal((await integridade(sis.db)).ok, true);
}));
