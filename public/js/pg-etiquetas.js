import { h, limpar, api, icone, tratar, toast, combobox, buscarProdutos, buscarEnderecos, selecao, campo, baixarArquivo, copiar, badge, vazio, qs } from './core.js';

const FORMATOS = [['50x30', '50 × 30 mm (produto)'], ['40x25', '40 × 25 mm (pequena)'], ['100x50', '100 × 50 mm'], ['100x150', '100 × 150 mm (10×15)']];

export async function renderizar(el, { params }) {
  const itens = []; // { tipo, id, rotulo, copias }
  let formato = '50x30'; let gerar = true;
  const lista = h('div', { class: 'stack' }); const previa = h('div', { class: 'etiquetas' }); const aviso = h('p', { class: 'aviso muted', role: 'status' });

  const add = (tipo, id, rotulo, copias = 1) => { const ex = itens.find((i) => i.tipo === tipo && i.id === id); if (ex) ex.copias += copias; else itens.push({ tipo, id, rotulo, copias }); pintar(); };
  const cbP = combobox({ rotulo: 'Produto', buscar: buscarProdutos, aoEscolher: (i) => { add('produto', i.id, i.rotulo); cbP.limpar(); } });
  const cbE = combobox({ rotulo: 'Endereço', buscar: buscarEnderecos, aoEscolher: (i) => { add('endereco', i.id, i.rotulo); cbE.limpar(); } });
  const fm = selecao(FORMATOS, formato, { 'aria-label': 'Formato', onchange: () => { formato = fm.value; pintar(); } });
  const gerarCk = h('input', { type: 'checkbox', checked: true, onchange: (e) => { gerar = e.target.checked; } });

  function pintar() {
    limpar(lista).append(...(itens.length ? itens.map((it, i) => h('div', { class: 'row' }, badge(it.tipo), h('span', { class: 'grow' }, it.rotulo),
      h('input', { type: 'number', min: 1, max: 999, value: it.copias, 'aria-label': `Cópias de ${it.rotulo}`, class: 'copias', onchange: (e) => { it.copias = Math.max(1, Number(e.target.value) || 1); } }),
      h('button', { class: 'btn pequeno fantasma', 'aria-label': `Remover ${it.rotulo}`, onclick: () => { itens.splice(i, 1); pintar(); } }, icone('x', 16)))) : [vazio('Nenhuma etiqueta escolhida', 'Adicione produtos ou endereços.')]));
    limpar(previa);
    for (const it of itens.slice(0, 12)) previa.append(h('img', { class: `f-${formato}`, alt: `Etiqueta de ${it.rotulo}`, width: formato.split('x')[0] * 3.78, height: formato.split('x')[1] * 3.78, src: `/api/etiquetas/svg?${qs({ tipo: it.tipo, id: it.id, formato, t: Date.now() })}`,
      onerror: (e) => { e.target.replaceWith(h('p', { class: 'perigo-txt' }, `${it.rotulo}: sem código de barras — gere um código no produto.`)); } }));
    aviso.textContent = itens.length > 12 ? `Mostrando as 12 primeiras de ${itens.length}.` : '';
  }
  const corpo = () => ({ formato, gerar_codigo: gerar ? 1 : 0, itens: itens.map((i) => ({ tipo: i.tipo, id: i.id, copias: i.copias })) });
  async function zpl(acao) {
    if (!itens.length) return toast('Escolha ao menos uma etiqueta.', 'aviso');
    try { const r = await api.post('/api/etiquetas/zpl', corpo()); r.avisos.forEach((a) => toast(a, 'aviso', 8000)); if (acao === 'baixar') baixarArquivo(`etiquetas-${formato}.zpl`, r.zpl); else copiar(r.zpl); toast(`${r.etiquetas} etiqueta(s) em ZPL.`, 'ok'); } catch (e) { tratar(e); }
  }
  async function imprimir() {
    if (!itens.length) return toast('Escolha ao menos uma etiqueta.', 'aviso');
    if (gerar) { try { await api.post('/api/etiquetas/zpl', corpo()); } catch (e) { return tratar(e); } pintar(); await new Promise((r) => setTimeout(r, 400)); } // garante os códigos antes de imprimir
    // uma imagem por cópia, para a impressora térmica cortar uma etiqueta por página
    const copias = h('div', { class: 'etiquetas' });
    for (const it of itens) for (let n = 0; n < it.copias; n++) copias.append(h('img', { class: `f-${formato}`, alt: '', width: formato.split('x')[0] * 3.78, height: formato.split('x')[1] * 3.78, src: `/api/etiquetas/svg?${qs({ tipo: it.tipo, id: it.id, formato })}` }));
    previa.replaceWith(copias); await Promise.all([...copias.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    window.print(); copias.replaceWith(previa); pintar();
  }

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Etiquetas'), h('p', null, 'Código de barras de produtos novos, QR/Code 128 de endereços. Imprima no navegador ou exporte ZPL para a Zebra.'))),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card stack' }, h('h2', null, 'Escolher'), cbP.el, cbE.el, campo('Formato', fm), h('label', { class: 'check' }, gerarCk, 'Gerar código interno para produtos que ainda não têm'), lista),
      h('section', { class: 'card stack' }, h('h2', null, 'Prévia'), aviso, previa)),
    h('div', { class: 'row nao-imprimir' }, h('button', { class: 'btn primario', onclick: imprimir }, icone('printer'), 'Imprimir'), h('button', { class: 'btn', onclick: () => zpl('baixar') }, icone('download'), 'Baixar ZPL'), h('button', { class: 'btn', onclick: () => zpl('copiar') }, 'Copiar ZPL')),
    h('p', { class: 'muted nao-imprimir' }, 'Dica: na janela de impressão escolha a impressora térmica, margens "nenhuma" e escala 100%.'));
  if (params.get('produto')) { try { const p = await api.get(`/api/produtos/${params.get('produto')}`); add('produto', p.id, `${p.sku} — ${p.nome}`); } catch (e) { tratar(e); } }
  if (params.get('endereco')) { try { const d = await api.get(`/api/enderecos/${params.get('endereco')}`); add('endereco', d.id, d.codigo); } catch (e) { tratar(e); } }
  pintar();
}
