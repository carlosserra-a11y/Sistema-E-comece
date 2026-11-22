// Gerador de códigos de barras: lista os produtos sem código, gera o código interno (um a um ou todos de uma vez) e imprime a etiqueta
// para colar no produto. Tem também um gerador avulso (qualquer número/texto) só para imprimir. A impressão usa as mesmas regras de
// etiqueta da tela Etiquetas (uma etiqueta por página, tamanho exato) e vale para impressoras térmicas e comuns.
import { h, limpar, api, icone, tratar, toast, selecao, campo, entrada, abas, badge, vazio, qs, confirmar, esqueleto, paginacao, debounce } from './core.js';

const FORMATOS = [['50x30', '50 × 30 mm (produto)'], ['40x25', '40 × 25 mm (pequena)'], ['100x50', '100 × 50 mm'], ['100x150', '100 × 150 mm (10×15)']];
const TIPOS = [['code128', 'Code 128 (letras e números)'], ['ean13', 'EAN-13 (13 dígitos)'], ['ean8', 'EAN-8 (8 dígitos)'], ['upca', 'UPC-A (12 dígitos)']];
const POR_PAGINA = 50;
const mm = (f) => f.split('x').map((n) => Number(n) * 3.78);

/** Dígito verificador GS1 (EAN/UPC): pesos 3 e 1 da direita para a esquerda. */
const digitoGs1 = (base) => { let s = 0; for (let i = base.length - 1, p = 3; i >= 0; i--, p = p === 3 ? 1 : 3) s += Number(base[i]) * p; return (10 - (s % 10)) % 10; };

export async function renderizar(el) {
  let formato = '50x30';
  const area = h('div', { class: 'etiquetas', 'aria-hidden': 'true' }); // só tem conteúdo durante a impressão
  const fm = selecao(FORMATOS, formato, { 'aria-label': 'Tamanho da etiqueta', onchange: () => { formato = fm.value; } });

  /** Monta uma imagem por etiqueta (a impressora corta uma por página), espera carregar e abre a impressão. */
  async function imprimir(urls) {
    if (!urls.length) return toast('Escolha ao menos uma etiqueta.', 'aviso');
    limpar(area);
    const [w, hh] = mm(formato);
    for (const src of urls) area.append(h('img', { class: `f-${formato}`, alt: '', width: w, height: hh, src }));
    await Promise.all([...area.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    window.print();
    limpar(area);
  }
  const urlProduto = (id) => `/api/etiquetas/svg?${qs({ tipo: 'produto', id, formato })}`;

  // ---------------------------------------------------------------- aba 1: produtos sem código
  const abaFaltando = h('div', { class: 'stack' });
  let linhas = []; let pagina = 1; let total = 0; let carregando = false;
  const marcados = new Set();

  async function gerarUm(l) {
    const r = await api.post(`/api/produtos/${l.id}/codigos/gerar`, {});
    l.codigo = r.codigo;
    return r.codigo;
  }
  async function carregar() {
    carregando = true; pintarFaltando();
    try {
      const r = await api.get(`/api/produtos?${qs({ sem_codigo: 1, pagina, por_pagina: POR_PAGINA })}`);
      total = r.total;
      const gerados = linhas.filter((l) => l.codigo); // os que acabaram de ganhar código continuam na tela para imprimir
      linhas = [...gerados, ...r.itens.filter((p) => !gerados.some((g) => g.id === p.id)).map((p) => ({ id: p.id, sku: p.sku, nome: p.nome, saldo: p.saldo_total, codigo: null, copias: Math.max(1, Math.min(99, p.saldo_total || 1)) }))];
    } catch (e) { tratar(e); }
    carregando = false; pintarFaltando();
  }

  async function gerarTodos() {
    let previa;
    try { previa = await api.post('/api/codigos/gerar-faltantes', { confirmar: 0 }); } catch (e) { return tratar(e); }
    if (!previa.total) return toast('Todos os produtos ativos já têm código.', 'ok');
    if (!await confirmar('Gerar códigos de barras', `Vai criar um código interno (EAN-13) para ${previa.total} produto(s) que ainda não têm. Depois você escolhe quais etiquetas imprimir.`, { rotulo: `Gerar ${previa.total}` })) return;
    try {
      const r = await api.post('/api/codigos/gerar-faltantes', { confirmar: 1 });
      const mapa = new Map(r.gerados.map((g) => [g.produto_id, g.codigo]));
      for (const l of linhas) if (mapa.has(l.id)) { l.codigo = mapa.get(l.id); marcados.add(l.id); }
      toast(`${r.total} código(s) gerado(s). Os produtos ficaram marcados para imprimir.`, 'ok', 6000);
      await carregar();
    } catch (e) { tratar(e); }
  }

  async function imprimirMarcados() {
    const alvo = linhas.filter((l) => marcados.has(l.id));
    if (!alvo.length) return toast('Marque os produtos que você quer imprimir.', 'aviso');
    try { for (const l of alvo) if (!l.codigo) await gerarUm(l); } catch (e) { return tratar(e); }
    pintarFaltando();
    const urls = alvo.flatMap((l) => Array.from({ length: l.copias }, () => urlProduto(l.id)));
    await imprimir(urls);
  }

  function linha(l) {
    const marca = h('input', { type: 'checkbox', checked: marcados.has(l.id), 'aria-label': `Marcar ${l.sku}`, onchange: (e) => { if (e.target.checked) marcados.add(l.id); else marcados.delete(l.id); } });
    const copias = h('input', { type: 'number', min: 1, max: 999, value: l.copias, class: 'copias', 'aria-label': `Cópias de ${l.sku}`, onchange: (e) => { l.copias = Math.max(1, Number(e.target.value) || 1); } });
    const acao = l.codigo
      ? h('button', { class: 'btn pequeno', onclick: () => imprimir(Array.from({ length: l.copias }, () => urlProduto(l.id))) }, icone('printer', 16), 'Imprimir')
      : h('button', { class: 'btn pequeno primario', 'data-requer': 'produtos.editar', onclick: async (e) => { e.target.disabled = true; try { await gerarUm(l); toast(`Código gerado para ${l.sku}.`, 'ok', 2500); pintarFaltando(); } catch (x) { tratar(x); e.target.disabled = false; } } }, icone('barcode', 16), 'Gerar código');
    return h('tr', null, h('td', null, marca), h('td', null, h('span', { class: 'mono' }, l.sku)), h('td', null, h('span', { class: 'quebra' }, l.nome)), h('td', { class: 'num' }, String(l.saldo ?? 0)),
      h('td', null, l.codigo ? h('span', { class: 'mono' }, l.codigo) : badge('sem código', 'aviso')), h('td', null, copias), h('td', null, acao));
  }

  function pintarFaltando() {
    limpar(abaFaltando);
    const semCodigo = linhas.filter((l) => !l.codigo).length;
    const todos = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos', checked: linhas.length > 0 && linhas.every((l) => marcados.has(l.id)), onchange: (e) => { for (const l of linhas) { if (e.target.checked) marcados.add(l.id); else marcados.delete(l.id); } pintarFaltando(); } });
    abaFaltando.append(
      h('div', { class: 'row' }, badge(`${total} produto(s) sem código`, total ? 'aviso' : 'ok'), h('span', { class: 'grow' }),
        h('div', { class: 'campo' }, fm), h('button', { class: 'btn', 'data-requer': 'produtos.editar', onclick: gerarTodos }, icone('barcode', 18), 'Gerar códigos de todos'), h('button', { class: 'btn primario', onclick: imprimirMarcados }, icone('printer', 18), `Imprimir marcados (${marcados.size})`)),
      carregando ? esqueleto(4)
        : !linhas.length ? vazio('Todos os produtos têm código de barras', 'Quando você cadastrar um produto sem código, ele aparece aqui para gerar e imprimir.')
          : h('div', { class: 'tabela-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, todos), h('th', null, 'SKU'), h('th', null, 'Produto'), h('th', { class: 'num' }, 'Em estoque'), h('th', null, 'Código'), h('th', null, 'Cópias'), h('th', null, ''))), h('tbody', null, linhas.map(linha)))),
      total > POR_PAGINA ? paginacao(total, pagina, POR_PAGINA, (n) => { pagina = n; carregar(); }) : null,
      h('p', { class: 'muted' }, semCodigo ? 'Dica: "Cópias" já vem com a quantidade em estoque, para colar uma etiqueta em cada unidade.' : 'Códigos gerados aqui são internos (EAN-13 com prefixo 20): valem só na sua loja. Se o produto tiver código do fabricante, cadastre esse em Produtos.'));
  }

  // ---------------------------------------------------------------- aba 2: código avulso
  const abaAvulso = (() => {
    const tipo = selecao(TIPOS, 'code128', { 'aria-label': 'Tipo de código' });
    const dados = entrada({ placeholder: 'Digite o número ou texto', maxlength: 60, autocapitalize: 'characters', 'aria-label': 'Conteúdo do código' });
    const copias = h('input', { type: 'number', min: 1, max: 999, value: 1, class: 'copias', 'aria-label': 'Cópias' });
    const previa = h('img', { class: 'previa-codigo', alt: 'Prévia do código de barras', hidden: true });
    const msg = h('p', { class: 'muted', role: 'status' }, 'Digite o conteúdo para ver a prévia.');
    const url = () => `/api/barcode.svg?${qs({ sim: tipo.value, dados: dados.value.trim() })}`;
    const atualizar = debounce(() => {
      if (!dados.value.trim()) { previa.hidden = true; msg.textContent = 'Digite o conteúdo para ver a prévia.'; return; }
      previa.hidden = false; previa.src = `${url()}&t=${Date.now()}`; msg.textContent = '';
    }, 250);
    previa.addEventListener('error', () => { previa.hidden = true; msg.textContent = tipo.value === 'code128' ? 'Conteúdo inválido para este tipo.' : 'Esse tipo pede só números, no tamanho certo (com o dígito verificador correto).'; });
    dados.addEventListener('input', atualizar); tipo.addEventListener('change', atualizar);
    const sugerir = () => {
      const base = `20${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`; // prefixo 20 = uso interno da loja
      tipo.value = 'ean13'; dados.value = base + digitoGs1(base); atualizar();
    };
    return h('div', { class: 'stack' },
      h('div', { class: 'grid cols-2' }, campo('Tipo', tipo), campo('Conteúdo', dados)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: sugerir }, icone('refresh', 18), 'Sugerir um EAN-13 interno'), h('span', { class: 'grow' }), campo('Cópias', copias),
        h('button', { class: 'btn primario', type: 'button', onclick: () => { if (!dados.value.trim() || previa.hidden) return toast('Digite um conteúdo válido antes de imprimir.', 'aviso'); imprimir(Array.from({ length: Math.max(1, Number(copias.value) || 1) }, () => url())); } }, icone('printer', 18), 'Imprimir')),
      h('div', { class: 'card previa-wrap' }, previa, msg),
      h('p', { class: 'muted' }, 'Este código é só para imprimir: não fica ligado a nenhum produto. Para associar a um produto, cadastre-o em Produtos.'));
  })();

  const conteudo = h('div', { class: 'stack' });
  const mostrar = (id) => { limpar(conteudo).append(id === 'avulso' ? abaAvulso : abaFaltando); };
  const barra = abas([['faltando', 'Produtos sem código'], ['avulso', 'Código avulso']], 'faltando', mostrar);

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Gerador de códigos de barras'), h('p', null, 'Gere o código dos produtos que não têm e imprima a etiqueta para colar.'))),
    h('div', { class: 'stack nao-imprimir' }, barra, conteudo,
      h('p', { class: 'muted' }, 'Na janela de impressão escolha a impressora, margens "nenhuma" e escala 100%. Impressora Zebra (ZPL)? Use a tela Etiquetas.')),
    area);
  mostrar('faltando');
  await carregar();
}
