import { pode, h, limpar, api, carregar, icone, fmt, badge, qs, tratar, toast, tabela, paginacao, abas, vazio, combobox, buscarProdutos, buscarEnderecos, campo, feedback, novaChave, ApiError, selecao, gaveta, esqueleto, debounce } from './core.js';

const TIPOS_MOV = { ENTRADA: ['Entrada', 'ok'], SAIDA: ['Saída', 'erro'], TRANSF_SAIDA: ['Transf. (saída)', 'info'], TRANSF_ENTRADA: ['Transf. (entrada)', 'info'], AJUSTE: ['Ajuste', 'aviso'], AVARIA: ['Avaria', 'erro'], DEVOLUCAO: ['Devolução', 'ok'], INVENTARIO: ['Inventário', 'aviso'] };

/** Envia com chave de idempotência estável: reenviar o mesmo formulário (duplo clique/queda de rede) não duplica. */
function emissor() {
  let ult = null;
  return async (url, corpo) => {
    const json = JSON.stringify(corpo);
    if (!ult || ult.json !== json) ult = { json, chave: novaChave() };
    const r = await api.idem(url, corpo, ult.chave);
    ult = null; return r;
  };
}

export async function renderizar(el, { params }) {
  const painel = h('div', { class: 'stack' });
  const ABAS = [['receber', 'Receber', 'estoque.operar'], ['transferir', 'Guardar / transferir', 'estoque.operar'], ['ajustar', 'Ajustar', 'estoque.ajustar'], ['baixar', 'Baixar', 'estoque.operar'], ['avaria', 'Avaria', 'estoque.operar'], ['produtos', 'Por produto', 'estoque.ver'], ['saldos', 'Saldos', 'estoque.ver'], ['mov', 'Movimentações', 'estoque.ver'], ['repor', 'Reposição', 'estoque.ver']];
  const liberadas = ABAS.filter(([, , perm]) => pode(perm)).map(([id]) => id);
  const pedida = params.get('op');
  const inicial = liberadas.includes(pedida) ? pedida : liberadas.includes('saldos') ? 'saldos' : liberadas[0];
  const trocar = (id) => { limpar(painel); ({ receber: fReceber, transferir: fTransferir, ajustar: fAjustar, baixar: fBaixar, avaria: fAvaria, produtos: porProduto, saldos: saldos, mov: movimentos, repor: reposicao })[id](painel, params); };
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Estoque'), h('p', null, 'Toda alteração vira uma linha imutável do livro-razão.'))), abas(ABAS, inicial, trocar), painel);
  trocar(inicial);
}

function linhaOp(titulo, corpo, enviar, rotulo) {
  const erro = h('p', { class: 'erro', role: 'alert' });
  const btn = h('button', { class: 'btn primario enorme', type: 'submit' }, rotulo);
  const form = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = ''; btn.disabled = true;
    try { const msg = await enviar(); feedback('ok', msg); toast(msg, 'ok'); } catch (x) { erro.textContent = x.message; feedback('erro', x.message); if (x instanceof ApiError && x.campos) erro.textContent += ` ${Object.values(x.campos).join(' ')}`; } finally { btn.disabled = false; }
  } }, h('h2', null, titulo), corpo, erro, btn);
  return form;
}
const qtdInput = () => h('input', { type: 'number', min: 1, step: 1, inputmode: 'numeric', class: 'enorme', value: 1, 'aria-label': 'Quantidade' });

function seletores() {
  const s = { produto: null, origem: null, destino: null };
  const cp = combobox({ rotulo: 'Produto (leia o código, SKU ou nome)', buscar: async (t) => { const r = await api.get(`/api/scan?${qs({ codigo: t })}`); return r.tipo === 'PRODUTO' ? [{ id: r.produto.id, rotulo: `${r.produto.sku} — ${r.produto.nome}`, detalhe: `${fmt.num(r.total)} un`, dados: r.produto }] : buscarProdutos(t); }, aoEscolher: (i) => { s.produto = i.dados; s.aoProduto?.(i.dados); } });
  const ce = (rotulo, chave) => combobox({ rotulo, buscar: buscarEnderecos, aoEscolher: (i) => { s[chave] = i.dados; } });
  return { s, cp, ce };
}
const exigir = (v, msg) => { if (!v) throw new Error(msg); return v; };

function fReceber(el, params) {
  const { s, cp, ce } = seletores(); const enviar = emissor();
  const dest = ce('Endereço de destino (leia a etiqueta)', 'destino');
  const qtd = qtdInput(); const lote = h('input', { type: 'text', autocomplete: 'off' }); const val = h('input', { type: 'date' }); const doc = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Nota fiscal / pedido de compra' });
  const lotes = h('div', { class: 'cols-2', hidden: true }, campo('Lote', lote), campo('Validade', val));
  const sug = h('div', { class: 'chips' });
  s.aoProduto = async (p) => {
    lotes.hidden = !(p.controla_lote || p.controla_validade);
    try { const r = await api.get(`/api/estoque/sugestao?${qs({ produto_id: p.id, qtd: qtd.value })}`); limpar(sug).append(h('span', { class: 'muted' }, 'Onde guardar:'), ...r.slice(0, 4).map((x) => h('button', { class: 'chip', type: 'button', title: x.motivo, onclick: () => { s.destino = { id: x.endereco_id }; dest.input.value = x.codigo; } }, x.codigo))); } catch { /* sem sugestão */ }
  };
  if (params.get('produto')) api.get(`/api/produtos/${params.get('produto')}`).then((p) => { cp.input.value = `${p.sku} — ${p.nome}`; s.produto = p; s.aoProduto(p); });
  el.append(linhaOp('Receber mercadoria', h('div', { class: 'stack' }, cp.el, dest.el, sug, campo('Quantidade', qtd), lotes, campo('Documento', doc)), async () => {
    const r = await enviar('/api/estoque/receber', { produto_id: exigir(s.produto, 'Escolha o produto.').id, endereco_id: exigir(s.destino, 'Escolha o endereço.').id, qtd: Number(qtd.value), lote: lote.value || undefined, validade: val.value || undefined, documento: doc.value || undefined });
    return `+${r.qtd} em ${r.endereco} ✓`;
  }, 'Receber'));
}

function fTransferir(el) {
  const { s, cp, ce } = seletores(); const enviar = emissor();
  const o = ce('Origem (leia a etiqueta do endereço)', 'origem'); const d = ce('Destino', 'destino'); const qtd = qtdInput(); const sug = h('div', { class: 'chips' });
  s.aoProduto = async (p) => { try { const r = await api.get(`/api/estoque/sugestao?${qs({ produto_id: p.id, qtd: qtd.value })}`); limpar(sug).append(h('span', { class: 'muted' }, 'Sugestão de destino:'), ...r.slice(0, 4).map((x) => h('button', { class: 'chip', type: 'button', title: x.motivo, onclick: () => { s.destino = { id: x.endereco_id }; d.input.value = x.codigo; } }, `${x.codigo} · ${x.motivo}`))); } catch { /* ignora */ } };
  el.append(linhaOp('Guardar / transferir (3 leituras: origem, produto, destino)', h('div', { class: 'stack' }, o.el, cp.el, d.el, sug, campo('Quantidade', qtd)), async () => {
    const r = await enviar('/api/estoque/transferir', { produto_id: exigir(s.produto, 'Escolha o produto.').id, origem_id: exigir(s.origem, 'Escolha a origem.').id, destino_id: exigir(s.destino, 'Escolha o destino.').id, qtd: Number(qtd.value) });
    return `${r.qtd} un: ${r.de} → ${r.para} ✓`;
  }, 'Transferir'));
}

function fAjustar(el) {
  const { s, cp, ce } = seletores(); const enviar = emissor();
  const e = ce('Endereço', 'origem'); const nova = h('input', { type: 'number', min: 0, step: 1, class: 'enorme', value: 0, 'aria-label': 'Quantidade correta' }); const motivo = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Ex.: contagem física encontrou 2 a menos' });
  el.append(linhaOp('Ajustar quantidade', h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Informe a quantidade CORRETA no endereço. Pede sua senha de novo e o motivo fica na auditoria.'), cp.el, e.el, campo('Quantidade correta', nova), campo('Motivo', motivo)), async () => {
    const r = await enviar('/api/estoque/ajustar', { produto_id: exigir(s.produto, 'Escolha o produto.').id, endereco_id: exigir(s.origem, 'Escolha o endereço.').id, qtd_nova: Number(nova.value), motivo: motivo.value });
    return `Ajustado de ${r.de} para ${r.para} ✓`;
  }, 'Ajustar'));
}

function fBaixar(el) {
  const { s, cp, ce } = seletores(); const enviar = emissor();
  const e = ce('Endereço', 'origem'); const qtd = qtdInput(); const motivo = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Ex.: uso interno, amostra' });
  el.append(linhaOp('Baixar (saída avulsa)', h('div', { class: 'stack' }, cp.el, e.el, campo('Quantidade', qtd), campo('Motivo', motivo)), async () => {
    const r = await enviar('/api/estoque/baixar', { produto_id: exigir(s.produto, 'Escolha o produto.').id, endereco_id: exigir(s.origem, 'Escolha o endereço.').id, qtd: Number(qtd.value), motivo: motivo.value });
    return `Baixa feita. Restam ${r.saldo_endereco} no endereço ✓`;
  }, 'Baixar'));
}

function fAvaria(el) {
  const { s, cp, ce } = seletores(); const enviar = emissor();
  const e = ce('Endereço de origem', 'origem'); const d = ce('Mover para o endereço de avaria (opcional)', 'destino'); const qtd = qtdInput(); const motivo = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Ex.: caixa molhada' });
  el.append(linhaOp('Registrar avaria', h('div', { class: 'stack' }, cp.el, e.el, d.el, campo('Quantidade', qtd), campo('Motivo', motivo)), async () => {
    await enviar('/api/estoque/avaria', { produto_id: exigir(s.produto, 'Escolha o produto.').id, endereco_id: exigir(s.origem, 'Escolha o endereço.').id, qtd: Number(qtd.value), motivo: motivo.value, destino_id: s.destino?.id });
    return 'Avaria registrada ✓';
  }, 'Registrar avaria'));
}

/** Uma linha por produto: quanto há, quanto dá para vender e em quantos endereços; tocar mostra onde está. */
function porProduto(el) {
  let q = ''; let pagina = 1; const alvo = h('div');
  const busca = h('input', { type: 'search', placeholder: 'Buscar por nome ou SKU', 'aria-label': 'Buscar produto no estoque', autocomplete: 'off' });
  busca.addEventListener('input', debounce(() => { q = busca.value.trim(); pagina = 1; ler(); }, 250));
  async function onde(p) {
    const g = gaveta(`${p.sku} — onde está`, esqueleto(3));
    try {
      const d = await api.get(`/api/estoque/saldos?${qs({ produto_id: p.id, por_pagina: 200 })}`);
      limpar(g.corpo).append(h('p', { class: 'quebra' }, p.nome),
        d.total ? tabela([{ titulo: 'Endereço', render: (x) => h('strong', { class: 'mono' }, x.endereco) }, { titulo: 'Zona', render: (x) => x.zona_tipo.toLowerCase() }, { titulo: 'Lote', render: (x) => (x.lote ? `${x.lote}${x.validade ? ` · ${fmt.data(x.validade)}` : ''}` : '—') }, { titulo: 'Qtd', num: true, chave: 'qtd' }], d.itens, { compacta: true }) : vazio('Sem unidades', 'Este produto não está em nenhum endereço.'),
        pode('produtos.ver') ? h('a', { class: 'btn', href: `#/produtos?abrir=${p.id}` }, icone('box', 18), 'Abrir o produto') : null);
    } catch (e) { g.fechar(); tratar(e); }
  }
  const ler = () => carregar(alvo, () => api.get(`/api/estoque/por-produto?${qs({ q, pagina, por_pagina: 50 })}`), (d) => alvo.append(h('p', { class: 'muted' }, `${fmt.num(d.total_unidades)} unidade(s) no galpão · ${fmt.num(d.total)} produto(s)${q ? ' nesta busca' : ' ativo(s)'}`), d.total ? tabela([
    { titulo: 'SKU', render: (x) => h('strong', { class: 'mono' }, x.sku) }, { titulo: 'Produto', render: (x) => h('span', { class: 'quebra' }, x.nome) },
    { titulo: 'Unidades', num: true, render: (x) => h('strong', null, `${fmt.num(x.unidades)} ${x.unidade ?? ''}`) },
    { titulo: 'Disponível', num: true, render: (x) => (x.vendaveis === 0 ? badge('0', 'erro') : x.estoque_min > 0 && x.vendaveis < x.estoque_min ? badge(`${fmt.num(x.vendaveis)} ↓`, 'aviso') : fmt.num(x.vendaveis)) },
    { titulo: 'Endereços', num: true, chave: 'enderecos' }], d.itens, { aoClicar: onde, compacta: true }) : vazio('Nenhum produto', q ? 'Tente outra busca.' : 'Cadastre o primeiro produto.'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));
  el.append(busca, alvo); ler();
}

function saldos(el, params) {
  let zona = ''; let pagina = 1; const alvo = h('div');
  let vencendo = params?.get('vencendo') ?? '';
  const soVencendo = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!vencendo, onchange: (e) => { vencendo = e.target.checked ? 30 : ''; pagina = 1; ler(); } }), 'Só lotes vencendo em 30 dias (ou vencidos)');
  const sel = selecao([['', 'Todas as zonas'], ...['RECEBIMENTO', 'PICKING', 'RESERVA', 'AVARIA', 'DEVOLUCAO', 'QUARENTENA', 'EXPEDICAO'].map((z) => [z, z.toLowerCase()])], '', { 'aria-label': 'Zona', onchange: () => { zona = sel.value; pagina = 1; ler(); } });
  const ler = () => carregar(alvo, () => api.get(`/api/estoque/saldos?${qs({ zona_tipo: zona, vencendo, pagina, por_pagina: 50 })}`), (d) => alvo.append(d.total ? tabela([
    { titulo: 'SKU', chave: 'sku' }, { titulo: 'Produto', render: (x) => h('span', { class: 'quebra' }, x.nome) }, { titulo: 'Endereço', render: (x) => h('strong', { class: 'mono' }, x.endereco) },
    { titulo: 'Zona', render: (x) => x.zona_tipo.toLowerCase() }, { titulo: 'Lote', render: (x) => (x.lote ? `${x.lote}${x.validade ? ` · ${fmt.data(x.validade)}` : ''}` : '—') }, { titulo: 'Qtd', num: true, chave: 'qtd' }], d.itens) : vazio(vencendo ? 'Nenhum lote vencendo' : 'Sem saldo', vencendo ? 'Nada vence nos próximos 30 dias.' : 'Receba mercadoria para começar.'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));
  el.append(h('div', { class: 'row' }, sel, soVencendo), alvo); ler();
}

function movimentos(el) {
  let tipo = ''; let pagina = 1; const alvo = h('div');
  const sel = selecao([['', 'Todos os tipos'], ...Object.entries(TIPOS_MOV).map(([k, [r]]) => [k, r])], '', { 'aria-label': 'Tipo', onchange: () => { tipo = sel.value; pagina = 1; ler(); } });
  const ler = () => carregar(alvo, () => api.get(`/api/estoque/movimentos?${qs({ tipo, pagina, por_pagina: 50 })}`), (d) => alvo.append(d.total ? tabela([
    { titulo: 'Quando', render: (x) => fmt.dataHora(x.ts) }, { titulo: 'Tipo', render: (x) => badge(...TIPOS_MOV[x.tipo]) }, { titulo: 'SKU', chave: 'sku' }, { titulo: 'Endereço', render: (x) => h('span', { class: 'mono' }, x.endereco) },
    { titulo: 'Qtd', num: true, render: (x) => h('strong', { class: x.delta > 0 ? 'ok-txt' : 'perigo-txt' }, `${x.delta > 0 ? '+' : ''}${x.delta}`) }, { titulo: 'Motivo', render: (x) => h('span', { class: 'quebra muted' }, x.motivo ?? x.documento ?? '') }], d.itens, { compacta: true }) : vazio('Nenhuma movimentação'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));
  el.append(sel, alvo); ler();
}

function reposicao(el) {
  const alvo = h('div');
  const enviar = emissor();
  carregar(alvo, () => api.get('/api/reposicao'), (t) => alvo.append(t.length ? h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Picking vazio (ou quase) com saldo na reserva.'), tabela([
    { titulo: 'Produto', render: (x) => h('span', { class: 'quebra' }, `${x.sku} — ${x.nome}`) }, { titulo: 'De (reserva)', render: (x) => h('span', { class: 'mono' }, x.origem) }, { titulo: 'Para (picking)', render: (x) => h('strong', { class: 'mono' }, x.destino) },
    { titulo: 'Agora', num: true, chave: 'atual' }, { titulo: 'Repor', num: true, chave: 'qtd' },
    { titulo: '', render: (x) => h('button', { class: 'btn pequeno primario', onclick: async (e) => { e.currentTarget.disabled = true; try { await api.idem('/api/estoque/transferir', { produto_id: x.produto_id, origem_id: x.origem_id, destino_id: x.destino_id, qtd: x.qtd, lote_id: x.lote_id, motivo: 'Reabastecimento' }); feedback('ok', 'Reposto ✓'); renderizarReposicao(); } catch (er) { tratar(er); e.currentTarget.disabled = false; } } }, 'Repor') }], t)) : vazio('Nada para repor', 'Nenhum picking precisa de reabastecimento agora.')));
  function renderizarReposicao() { limpar(el); reposicao(el); }
  el.append(alvo);
  void enviar;
}
