import { pode, h, limpar, api, carregar, icone, fmt, badge, qs, tratar, toast, tabela, paginacao, gaveta, abas, vazio, combobox, buscarProdutos, campo, confirmar, selecao, ApiError, esqueleto } from './core.js';

const NIVEIS_ZONA = { RECEBIMENTO: 'Recebimento', PICKING: 'Picking', RESERVA: 'Reserva', AVARIA: 'Avaria', DEVOLUCAO: 'Devolução', QUARENTENA: 'Quarentena', EXPEDICAO: 'Expedição' };

export async function renderizar(el, { params }) {
  const painel = h('div', { class: 'stack' });
  const deps = await api.get('/api/depositos');
  const zonas = deps.flatMap((d) => d.zonas.map((z) => ({ ...z, dep: d.codigo })));
  const trocar = (id) => { limpar(painel); ({ lista, mapa, massa, zonasAba })[id](painel, zonas, deps); };
  const inicial = params.get('massa') && pode('enderecos.gerenciar') ? 'massa' : ['mapa', 'zonasAba'].includes(params.get('aba')) ? params.get('aba') : 'lista';
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Endereços'), h('p', null, 'DEPÓSITO-ZONA-RUA-PRÉDIO-NÍVEL-POSIÇÃO, ex.: D1-P-03-02-01-04'))),
    abas([['lista', 'Lista'], ['mapa', 'Mapa do galpão'], ['massa', 'Criar em massa', 'enderecos.gerenciar'], ['zonasAba', 'Zonas']], inicial, trocar), painel);
  trocar(inicial);
}

function lista(el, zonas) {
  let q = ''; let zona = ''; let status = ''; let pagina = 1; const alvo = h('div');
  const busca = h('input', { type: 'search', placeholder: 'Buscar endereço (ex.: D1-P-01)', 'aria-label': 'Buscar endereço' });
  let t; busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = busca.value; pagina = 1; ler(); }, 250); });
  const sz = selecao([['', 'Todas as zonas'], ...zonas.map((z) => [z.id, `${z.dep}-${z.codigo} · ${z.nome}`])], '', { 'aria-label': 'Zona', onchange: () => { zona = sz.value; pagina = 1; ler(); } });
  const ss = selecao([['', 'Todos'], ['vazio', 'Vazios'], ['ocupado', 'Ocupados'], ['bloqueado', 'Bloqueados']], '', { 'aria-label': 'Situação', onchange: () => { status = ss.value; pagina = 1; ler(); } });
  const ler = () => carregar(alvo, () => api.get(`/api/enderecos?${qs({ q, zona_id: zona, status, pagina, por_pagina: 50 })}`), (d) => alvo.append(d.total ? tabela([
    { titulo: 'Endereço', render: (x) => h('strong', { class: 'mono' }, x.codigo) }, { titulo: 'Zona', render: (x) => x.zona_nome }, { titulo: 'Itens', num: true, chave: 'qtd_total' },
    { titulo: 'Capacidade', num: true, render: (x) => (x.cap_itens ? `${x.qtd_total}/${x.cap_itens}` : '∞') }, { titulo: 'Situação', render: (x) => (x.bloqueado ? badge('bloqueado', 'erro') : x.qtd_total ? badge('ocupado', 'info') : badge('vazio', 'ok')) }], d.itens, { aoClicar: (x) => abrir(x.id), compacta: true })
    : vazio('Nenhum endereço', 'Use "Criar em massa" para gerar o depósito.'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));
  el.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, busca), sz, ss), alvo); ler();

  async function abrir(id) {
    const g = gaveta('Endereço', esqueleto(5));
    const d = await api.get(`/api/enderecos/${id}`).catch((e) => { tratar(e); g.fechar(); });
    if (!d) return;
    const cap = h('input', { type: 'number', min: 0, value: d.cap_itens, 'aria-label': 'Capacidade em itens' });
    const capP = h('input', { type: 'number', min: 0, value: d.cap_peso_g, 'aria-label': 'Capacidade em gramas' });
    const bloq = h('input', { type: 'checkbox', checked: !!d.bloqueado }); const motivo = h('input', { type: 'text', value: d.motivo_bloqueio ?? '', placeholder: 'Motivo do bloqueio' });
    const pc = combobox({ rotulo: 'Produto de picking deste endereço', buscar: buscarProdutos, aoEscolher: async (i) => { try { await api.put(`/api/produtos/${i.id}/picking`, { endereco_id: id }); toast('Picking definido.', 'ok'); ler(); } catch (e) { tratar(e); } }, valorInicial: d.produto_designado ? `${d.produto_designado.sku} — ${d.produto_designado.nome}` : '' });
    limpar(g.corpo).append(h('div', { class: 'row' }, h('h2', { class: 'mono' }, d.codigo), d.bloqueado ? badge('bloqueado', 'erro') : badge(d.zona_nome, 'info')),
      d.conteudo.length ? tabela([{ titulo: 'SKU', chave: 'sku' }, { titulo: 'Produto', render: (x) => h('span', { class: 'quebra' }, x.nome) }, { titulo: 'Lote', render: (x) => x.lote ?? '—' }, { titulo: 'Qtd', num: true, chave: 'qtd' }], d.conteudo, { compacta: true }) : vazio('Endereço vazio'),
      d.zona_tipo === 'PICKING' ? pc.el : null,
      h('div', { class: 'cols-2' }, campo('Capacidade (itens, 0 = sem limite)', cap), campo('Capacidade (gramas, 0 = sem limite)', capP)),
      h('label', { class: 'check' }, bloq, 'Bloqueado (cheio / em manutenção)'), campo('Motivo do bloqueio', motivo),
      h('div', { class: 'row' }, h('button', { class: 'btn primario', 'data-requer': 'enderecos.gerenciar', onclick: async () => { try { await api.put(`/api/enderecos/${id}`, { cap_itens: Number(cap.value), cap_peso_g: Number(capP.value), bloqueado: bloq.checked ? 1 : 0, motivo_bloqueio: motivo.value }); toast('Salvo.', 'ok'); g.fechar(); ler(); } catch (e) { tratar(e); } } }, 'Salvar'),
        h('a', { class: 'btn', href: `#/etiquetas?endereco=${id}` }, icone('printer'), 'Etiqueta'),
        h('button', { class: 'btn perigo', 'data-requer': 'enderecos.gerenciar', onclick: async () => { if (await confirmar('Inativar endereço', 'O endereço sai de uso. Só é possível se estiver vazio.', { perigo: true, rotulo: 'Inativar' })) { try { await api.post(`/api/enderecos/${id}/inativar`); g.fechar(); ler(); } catch (e) { tratar(e); } } } }, 'Inativar')));
  }
}

function massa(el, zonas) {
  const num = (v, min = 1, max = 99) => h('input', { type: 'number', min, max, value: v, inputmode: 'numeric' });
  const zona = selecao(zonas.map((z) => [z.id, `${z.dep}-${z.codigo} · ${z.nome}`]), zonas.find((z) => z.tipo === 'PICKING')?.id ?? zonas[0]?.id, { 'aria-label': 'Zona' });
  const c = { rua_de: num(1), rua_ate: num(1), predio_de: num(1), predio_ate: num(10), nivel_de: num(1), nivel_ate: num(4), pos_de: num(1), pos_ate: num(6), cap_itens: num(0, 0, 1000000) };
  const saida = h('div', { class: 'stack' });
  const corpo = (confirmar) => ({ zona_id: Number(zona.value), ...Object.fromEntries(Object.entries(c).map(([k, i]) => [k, Number(i.value)])), confirmar: confirmar ? 1 : 0 });
  const previa = async () => {
    limpar(saida).append(esqueleto(2));
    try {
      const r = await api.post('/api/enderecos/lote', corpo(false)); limpar(saida);
      saida.append(h('p', null, badge(`${fmt.num(r.total)} no total`, 'info'), ' ', badge(`${fmt.num(r.novos)} novos`, 'ok'), ' ', badge(`${fmt.num(r.existentes)} já existem`)), h('p', { class: 'mono muted' }, r.amostra.join(' · '), r.novos > 8 ? ' …' : ''),
        r.novos ? h('button', { class: 'btn primario', onclick: async () => { try { const f = await api.post('/api/enderecos/lote', corpo(true)); toast(`${f.criados} endereço(s) criado(s).`, 'ok'); limpar(saida); } catch (e) { tratar(e); } } }, `Criar ${fmt.num(r.novos)} endereço(s)`) : h('p', { class: 'muted' }, 'Nada novo para criar.'));
    } catch (e) { limpar(saida); tratar(e); }
  };
  el.append(h('section', { class: 'card stack' }, h('h2', null, 'Criar endereços em massa'), h('p', { class: 'muted' }, 'Ex.: Rua 1, prédios 1–10, níveis 1–4, posições 1–6 gera 240 endereços. Você vê a prévia antes de gravar.'), campo('Zona', zona),
    h('div', { class: 'cols-2' }, campo('Rua de', c.rua_de), campo('Rua até', c.rua_ate), campo('Prédio de', c.predio_de), campo('Prédio até', c.predio_ate), campo('Nível de', c.nivel_de), campo('Nível até', c.nivel_ate), campo('Posição de', c.pos_de), campo('Posição até', c.pos_ate)),
    campo('Capacidade por endereço (itens, 0 = sem limite)', c.cap_itens), h('button', { class: 'btn', onclick: previa }, 'Ver prévia'), saida));
}

async function mapa(el, zonas) {
  let zona = zonas.find((z) => z.tipo === 'PICKING')?.id ?? zonas[0]?.id; let alvoSku = new Set();
  const sz = selecao(zonas.map((z) => [z.id, `${z.dep}-${z.codigo} · ${z.nome}`]), zona, { 'aria-label': 'Zona do mapa', onchange: () => { zona = Number(sz.value); desenhar(); } });
  const onde = combobox({ rotulo: 'Onde está o SKU?', buscar: buscarProdutos, aoEscolher: async (i) => { try { const r = await api.get(`/api/estoque/onde/${i.id}`); alvoSku = new Set(r.locais.map((l) => l.endereco_id)); toast(r.locais.length ? `${r.total} un em ${r.locais.length} endereço(s) — destacados no mapa.` : 'Sem estoque deste produto.', r.locais.length ? 'ok' : 'aviso'); desenhar(); } catch (e) { tratar(e); } } });
  const area = h('div'); const detalhe = h('div', { class: 'stack' });
  async function desenhar() {
    limpar(area).append(esqueleto(3));
    let itens; try { itens = (await api.get(`/api/mapa?${qs({ zona_id: zona })}`)).itens; } catch (e) { return limpar(area).append(h('p', { class: 'perigo-txt' }, e.message)); }
    limpar(area);
    if (!itens.length) return area.append(vazio('Zona sem endereços', 'Crie endereços em massa.'));
    const ruas = [...new Set(itens.map((i) => i.rua))]; const predios = [...new Set(itens.map((i) => i.predio))].sort((a, b) => a - b);
    const grade = h('div', { class: 'mapa', role: 'grid', 'aria-label': 'Mapa do galpão: ruas por prédios' });
    grade.style.setProperty('grid-template-columns', `44px repeat(${predios.length}, minmax(38px, 1fr))`);
    grade.append(h('div', { class: 'cab' }), ...predios.map((p) => h('div', { class: 'cab' }, `P${p}`)));
    for (const r of ruas) {
      grade.append(h('div', { class: 'cab' }, `R${r}`));
      for (const p of predios) {
        const cel = itens.filter((i) => i.rua === r && i.predio === p); if (!cel.length) { grade.append(h('div')); continue; }
        const ocup = cel.filter((i) => i.qtd > 0).length; const pct = Math.round((ocup / cel.length) * 100); const alvo = cel.some((i) => alvoSku.has(i.id));
        const b = h('button', { class: `celula ${pct === 100 ? 'cheia' : ''} ${alvo ? 'alvo' : ''}`, 'aria-label': `Rua ${r}, prédio ${p}: ${ocup} de ${cel.length} endereços ocupados${alvo ? ', contém o SKU buscado' : ''}`, onclick: () => abrirCelula(r, p, cel) }, `${pct}%`);
        b.style.setProperty('--o', String(Math.round(pct * 0.55))); grade.append(b);
      }
    }
    area.append(grade, h('p', { class: 'muted' }, 'Verde mais forte = mais ocupado; vermelho = cheio; contorno amarelo = contém o SKU buscado.'));
    function abrirCelula(r, p, cel) {
      const niveis = [...new Set(cel.map((c) => c.nivel))].sort((a, b) => b - a);
      limpar(detalhe).append(h('h3', null, `Rua ${r}, prédio ${p}`), h('div', { class: 'stack' }, niveis.map((n) => h('div', { class: 'row' }, h('span', { class: 'muted' }, `Nível ${n}`), cel.filter((c) => c.nivel === n).sort((a, b) => a.posicao - b.posicao).map((c) =>
        h('a', { class: `btn pequeno ${alvoSku.has(c.id) ? 'primario' : ''}`, href: `#/consulta?c=${encodeURIComponent(c.codigo)}`, title: `${c.codigo}: ${c.qtd} un` }, `${c.posicao}${c.bloqueado ? ' ⛔' : ''}${c.qtd ? ` (${c.qtd})` : ''}`))))));
    }
  }
  el.append(h('div', { class: 'row' }, h('div', null, campo('Zona', sz)), h('div', { class: 'grow' }, onde.el)), area, detalhe);
  desenhar();
}

function zonasAba(el, zonas) {
  el.append(tabela([{ titulo: 'Código', render: (z) => h('strong', { class: 'mono' }, `${z.dep}-${z.codigo}`) }, { titulo: 'Nome', chave: 'nome' }, { titulo: 'Tipo', render: (z) => NIVEIS_ZONA[z.tipo] }, { titulo: 'Conta como disponível', render: (z) => (z.vendavel ? badge('sim', 'ok') : badge('não')) }], zonas),
    h('p', { class: 'muted' }, 'Só picking e reserva contam como estoque disponível. Recebimento, avaria, devolução, quarentena e expedição são físicos, mas não vendáveis.'));
}
