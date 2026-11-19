import { h, limpar, api, carregar, icone, fmt, badge, qs, tratar, toast, tabela, paginacao, modal, vazio, campo, confirmar, selecao, feedback, esqueleto, combobox, buscarEnderecos, ApiError } from './core.js';
import { leitorCamera } from './scanner.js';

export async function renderizar(el, { params, ir }) {
  const alvo = h('div', { class: 'stack' });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Contagem de estoque'), h('p', null, 'Inventário cíclico, geral ou por endereços. A contagem é cega: o saldo do sistema só aparece depois de contar.')),
    h('button', { class: 'btn primario', 'data-novo': true, onclick: novo }, icone('plus'), 'Nova contagem')), alvo);
  const abrirId = Number(params.get('abrir'));
  if (abrirId) return contar(alvo, abrirId, () => ir('contagem'));
  listar();
  if (params.get('novo')) novo();

  function listar() {
    carregar(alvo, () => api.get('/api/inventarios?por_pagina=30'), (d) => alvo.append(d.total ? tabela([
      { titulo: '#', chave: 'id' }, { titulo: 'Nome', chave: 'nome' }, { titulo: 'Tipo', render: (x) => x.tipo.toLowerCase() }, { titulo: 'Endereços', num: true, chave: 'enderecos' },
      { titulo: 'Situação', render: (x) => badge(x.status.toLowerCase(), x.status === 'ABERTO' ? 'info' : x.status === 'APROVADO' ? 'ok' : 'erro') }, { titulo: 'Criado', render: (x) => fmt.dataHora(x.criado_em) }], d.itens, { aoClicar: (x) => contar(alvo, x.id, listar) })
      : vazio('Nenhuma contagem ainda', 'Comece por uma contagem cíclica de poucos endereços por dia.', h('button', { class: 'btn primario', onclick: novo }, 'Nova contagem'))));
  }

  function novo() {
    const tipo = selecao([['CICLICO', 'Cíclico — os endereços contados há mais tempo'], ['ENDERECOS', 'Endereços escolhidos'], ['GERAL', 'Geral — todos os endereços com estoque']], 'CICLICO', { 'aria-label': 'Tipo' });
    const limite = h('input', { type: 'number', min: 1, max: 200, value: 10 }); const nome = h('input', { type: 'text', maxlength: 80, placeholder: 'Opcional' });
    const escolhidos = new Map(); const lista = h('div', { class: 'chips' });
    const pintar = () => limpar(lista).append(...[...escolhidos].map(([id, c]) => h('button', { class: 'chip', type: 'button', 'aria-label': `Remover ${c}`, onclick: () => { escolhidos.delete(id); pintar(); } }, `${c} ✕`)));
    const cb = combobox({ rotulo: 'Adicionar endereço', buscar: buscarEnderecos, aoEscolher: (i) => { escolhidos.set(i.id, i.rotulo); pintar(); cb.limpar(); } });
    const ext = h('div', { class: 'stack' }, cb.el, lista); const cic = h('div', null, campo('Quantos endereços', limite));
    const mostrar = () => { ext.hidden = tipo.value !== 'ENDERECOS'; cic.hidden = tipo.value !== 'CICLICO'; }; tipo.addEventListener('change', mostrar); mostrar();
    const m = modal('Nova contagem', h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      try { const r = await api.post('/api/inventarios', { tipo: tipo.value, nome: nome.value || undefined, limite: Number(limite.value), enderecos: [...escolhidos.keys()] }); m.fechar(); toast('Contagem criada.', 'ok'); contar(alvo, r.id, listar); } catch (x) { tratar(x); }
    } }, campo('Tipo', tipo), cic, ext, campo('Nome', nome), h('button', { class: 'btn primario', type: 'submit' }, 'Criar')));
  }
}

async function contar(alvo, id, voltar) {
  let inv; let endAtual = null;
  const sel = { produto: null };
  const entEnd = h('input', { type: 'text', class: 'enorme', placeholder: 'Leia o ENDEREÇO', autocomplete: 'off', 'aria-label': 'Endereço' });
  const entProd = h('input', { type: 'text', class: 'enorme', placeholder: 'Leia o PRODUTO', autocomplete: 'off', 'aria-label': 'Produto', disabled: true });
  const entQtd = h('input', { type: 'number', min: 0, class: 'enorme', placeholder: 'Qtd', inputmode: 'numeric', 'aria-label': 'Quantidade contada', disabled: true });
  const cam = leitorCamera((c) => { endAtual ? (entProd.value = c, resolverProduto()) : (entEnd.value = c, resolverEndereco()); return false; }, { continuo: true, titulo: 'Contagem: leia o endereço e depois os produtos' });
  const info = h('p', { class: 'muted', role: 'status' });
  const areaItens = h('div'); const topo = h('div');

  async function ler() {
    try { inv = await api.get(`/api/inventarios/${id}`); } catch (e) { return tratar(e); }
    limpar(topo).append(h('div', { class: 'row' }, h('button', { class: 'btn pequeno', onclick: voltar }, '← Voltar'), h('h2', null, `#${inv.id} · ${inv.nome}`), badge(inv.status.toLowerCase(), inv.status === 'ABERTO' ? 'info' : inv.status === 'APROVADO' ? 'ok' : 'erro')),
      h('div', { class: 'row' }, badge(`${inv.resumo.contados}/${inv.resumo.itens} contados`, inv.resumo.pendentes ? 'aviso' : 'ok'), badge(`${inv.resumo.divergentes} divergente(s)`, inv.resumo.divergentes ? 'erro' : 'ok'), badge(`${inv.resumo.diferenca_abs} un de diferença`)));
    limpar(areaItens).append(
      h('h3', null, 'Endereços'), h('div', { class: 'chips' }, inv.enderecos.map((e) => h('button', { class: 'chip', 'aria-pressed': endAtual?.id === e.endereco_id, onclick: () => { if (inv.status === 'ABERTO') { entEnd.value = e.codigo; resolverEndereco(); } } }, `${e.codigo} ${e.concluido ? '✓' : `${e.contados}/${e.itens}`}`))),
      h('h3', null, 'Itens'), inv.itens.length ? tabela([{ titulo: 'Endereço', render: (x) => h('span', { class: 'mono' }, x.endereco) }, { titulo: 'Produto', render: (x) => h('span', { class: 'quebra' }, `${x.sku} — ${x.nome}`) }, { titulo: 'Lote', render: (x) => x.lote ?? '—' },
        { titulo: 'Sistema', num: true, render: (x) => (x.qtd_sistema === null ? '•••' : x.qtd_sistema) }, { titulo: 'Contado', num: true, render: (x) => x.qtd_contada ?? '—' },
        { titulo: 'Diferença', num: true, render: (x) => (x.diferenca === null ? '—' : x.diferenca === 0 ? badge('ok', 'ok') : badge(`${x.diferenca > 0 ? '+' : ''}${x.diferenca}`, 'erro')) }], inv.itens, { compacta: true }) : vazio('Sem itens ainda', 'Leia um endereço e conte o que encontrar.'));
  }
  async function resolverEndereco() {
    const c = entEnd.value.trim(); if (!c) return;
    try {
      const r = await api.get(`/api/scan?${qs({ codigo: c })}`);
      const e = r.tipo === 'ENDERECO' && inv.enderecos.find((x) => x.endereco_id === r.endereco.id);
      if (!e) { feedback('erro', r.tipo === 'ENDERECO' ? 'Endereço fora desta contagem' : 'Não é um endereço'); entEnd.select(); return; }
      endAtual = { id: e.endereco_id, codigo: e.codigo }; feedback('ok', e.codigo); info.textContent = `Contando ${e.codigo}. Leia cada produto e informe a quantidade.`;
      entProd.disabled = false; entProd.value = ''; entProd.focus(); ler();
    } catch (e) { tratar(e); }
  }
  async function resolverProduto() {
    const c = entProd.value.trim(); if (!c) return;
    try {
      const r = await api.get(`/api/scan?${qs({ codigo: c })}`);
      if (r.tipo !== 'PRODUTO') { feedback('erro', 'Código de produto não reconhecido'); entProd.select(); return; }
      sel.produto = r.produto; feedback('ok', r.produto.sku); info.textContent = `${r.produto.sku} — ${r.produto.nome}. Informe a quantidade encontrada.`; entQtd.disabled = false; entQtd.value = ''; entQtd.focus();
    } catch (e) { tratar(e); }
  }
  async function confirmarQtd() {
    if (!endAtual || !sel.produto || entQtd.value === '') return;
    try {
      const r = await api.post(`/api/inventarios/${id}/contar`, { endereco_id: endAtual.id, produto_id: sel.produto.id, qtd: Number(entQtd.value) });
      feedback(r.diferenca === 0 ? 'ok' : 'erro', r.diferenca === 0 ? 'Confere ✓' : `Diferença ${r.diferenca > 0 ? '+' : ''}${r.diferenca}`);
      sel.produto = null; entProd.value = ''; entQtd.value = ''; entQtd.disabled = true; entProd.focus(); info.textContent = 'Próximo produto, ou conclua o endereço.'; ler();
    } catch (e) { feedback('erro', e.message); tratar(e); }
  }
  entEnd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolverEndereco(); } });
  entProd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolverProduto(); } });
  entQtd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarQtd(); } });

  const acoes = () => h('div', { class: 'row' },
    h('button', { class: 'btn', disabled: !endAtual, onclick: async () => { if (!endAtual) return; if (await confirmar('Endereço vazio', `Confirmar que ${endAtual.codigo} está fisicamente VAZIO? Os itens ainda não contados ficam com 0.`, { perigo: true, rotulo: 'Está vazio' })) { try { await api.post(`/api/inventarios/${id}/vazio`, { endereco_id: endAtual.id }); feedback('ok', 'Vazio ✓'); ler(); } catch (e) { tratar(e); } } } }, 'Endereço vazio'),
    h('button', { class: 'btn', disabled: !endAtual, onclick: async () => { try { await api.post(`/api/inventarios/${id}/concluir-endereco`, { endereco_id: endAtual.id }); feedback('ok', `${endAtual.codigo} concluído`); endAtual = null; entEnd.value = ''; entProd.disabled = true; entEnd.focus(); ler(); } catch (e) { tratar(e); } } }, 'Concluir endereço'),
    h('button', { class: 'btn primario', onclick: async () => {
      const pend = inv.resumo.pendentes;
      if (!(await confirmar('Aprovar contagem', `Isso AJUSTA o estoque para o que foi contado (${inv.resumo.divergentes} divergência(s), ${inv.resumo.diferenca_abs} un).${pend ? ` ${pend} item(ns) não contado(s) serão ignorados.` : ''} Pede sua senha de novo.`, { rotulo: 'Aprovar e ajustar' }))) return;
      try { const r = await api.post(`/api/inventarios/${id}/aprovar`, { ignorar_pendentes: pend ? 1 : 0 }); toast(`Aprovada: ${r.ajustes} ajuste(s).`, 'ok', 7000); ler(); render(); } catch (e) { tratar(e); }
    } }, 'Aprovar'),
    h('button', { class: 'btn perigo', onclick: async () => { if (await confirmar('Cancelar contagem', 'Nada será ajustado.', { perigo: true, rotulo: 'Cancelar contagem' })) { try { await api.post(`/api/inventarios/${id}/cancelar`); voltar(); } catch (e) { tratar(e); } } } }, 'Cancelar'));

  async function render() {
    await ler(); if (!inv) return;
    limpar(alvo).append(topo, inv.status === 'ABERTO' ? h('section', { class: 'card stack' }, entEnd, entProd, entQtd, h('button', { class: 'btn primario enorme', onclick: confirmarQtd }, 'Confirmar contagem'), info, h('div', { class: 'row' }, cam.botao), cam.caixa, acoes()) : null, areaItens);
    entEnd.focus();
  }
  await render();
}
