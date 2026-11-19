// Consulta rápida: leia (ou digite) qualquer código — produto, endereço ou lote — e veja onde está e quanto tem.
import { leitorCamera } from './scanner.js';
import { h, limpar, api, icone, fmt, badge, qs, tratar, feedback, esqueleto, vazio, tabela, toast } from './core.js';

export { leitorCamera } from './scanner.js'; // a leitura por câmera agora vive em scanner.js (tela cheia, com ZXing no iPhone)

function mostrarProduto(r) {
  const p = r.produto;
  return h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('h2', null, p.nome), p.ativo ? badge('Ativo', 'ok') : badge('Inativo', 'erro')),
    h('p', { class: 'muted' }, `SKU ${p.sku}`),
    h('div', { class: 'cols-2' },
      h('div', { class: 'card kpi' }, h('div', { class: 'rotulo' }, 'Total em estoque'), h('div', { class: 'valor' }, fmt.num(r.total))),
      h('div', { class: 'card kpi' }, h('div', { class: 'rotulo' }, 'Disponível'), h('div', { class: 'valor' }, fmt.num(r.vendavel)))),
    r.picking && h('p', null, 'Picking: ', h('strong', { class: 'mono' }, r.picking.codigo)),
    r.locais.length ? tabela([{ titulo: 'Endereço', render: (l) => h('strong', { class: 'mono' }, l.codigo) }, { titulo: 'Zona', render: (l) => badge(l.zona_tipo.toLowerCase(), l.vendavel ? 'ok' : 'aviso') }, { titulo: 'Lote', render: (l) => (l.lote ? `${l.lote}${l.validade ? ` · val ${fmt.data(l.validade)}` : ''}` : '—') }, { titulo: 'Qtd', num: true, chave: 'qtd' }], r.locais)
      : vazio('Sem estoque', 'Este produto não está em nenhum endereço.'),
    h('p', { class: 'muted' }, 'Lotes que vencem primeiro aparecem primeiro (FEFO).'));
}

export async function renderizar(el, { params }) {
  const entrada = h('input', { type: 'search', class: 'enorme', placeholder: 'Leia ou digite o código', autofocus: true, autocomplete: 'off', inputmode: 'text', 'aria-label': 'Código' });
  const saida = h('div', { class: 'stack' });
  const cam = leitorCamera((c) => consultar(c));
  async function consultar(codigo) {
    const c = String(codigo).trim(); if (!c) return;
    limpar(saida).append(esqueleto(3));
    try {
      const r = await api.get(`/api/scan?${qs({ codigo: c })}`);
      limpar(saida);
      if (r.tipo === 'DESCONHECIDO') { feedback('erro', 'Código não encontrado'); saida.append(vazio('Não encontrei este código', r.dica, h('span', { class: 'mono' }, r.codigo))); }
      else if (r.tipo === 'PRODUTO') { feedback('ok', 'Produto'); saida.append(h('section', { class: 'card' }, mostrarProduto(r))); }
      else if (r.tipo === 'ENDERECO') {
        feedback('ok', 'Endereço'); const d = await api.get(`/api/enderecos/${r.endereco.id}`);
        saida.append(h('section', { class: 'card stack' }, h('h2', { class: 'mono' }, d.codigo), h('p', { class: 'muted' }, `${d.zona_nome}${d.bloqueado ? ' · BLOQUEADO' : ''}${d.cap_itens ? ` · capacidade ${d.cap_itens}` : ''}`),
          d.conteudo.length ? tabela([{ titulo: 'SKU', chave: 'sku' }, { titulo: 'Produto', chave: 'nome' }, { titulo: 'Lote', render: (x) => x.lote ?? '—' }, { titulo: 'Qtd', num: true, chave: 'qtd' }], d.conteudo) : vazio('Endereço vazio')));
      } else if (r.tipo === 'LOTE') { feedback('ok', 'Lote'); saida.append(h('section', { class: 'card' }, h('h2', null, `Lote ${r.lote.codigo}`), h('p', null, `${r.lote.sku} — ${r.lote.nome}`), h('p', { class: 'muted' }, `Validade: ${fmt.data(r.lote.validade)}`))); }
    } catch (e) { limpar(saida); tratar(e); }
    entrada.value = ''; entrada.focus();
  }
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); consultar(entrada.value); } });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Consulta'), h('p', null, 'Onde está e quanto tem — em segundos.'))),
    h('section', { class: 'card stack' }, entrada, h('div', { class: 'row' }, cam.botao, h('span', { class: 'muted' }, 'O leitor USB/Bluetooth digita no campo e envia Enter.')), cam.caixa), saida);
  if (params.get('c')) consultar(params.get('c')); else entrada.focus();
  return () => cam.parar();
}
