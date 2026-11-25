import { h, api, carregar, icone, fmt, badge, vazio } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
export function sparkline(valores) {
  const max = Math.max(1, ...valores);
  const pts = valores.map((v, i) => [(i / Math.max(1, valores.length - 1)) * 100, 30 - (v / max) * 28 - 1]);
  const linha = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 30'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Movimentações nos últimos ${valores.length} dias: ${valores.join(', ')}`);
  for (const [cls, d] of [['area', `${linha}L100 30L0 30Z`], ['linha', linha]]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', cls); p.setAttribute('d', d); svg.append(p); }
  return svg;
}

/** Faz o número "contar" de 0 até o valor em ~0,7 s. Sem animação quando a pessoa pediu menos movimento. */
const contar = (el, alvo, formatar = (n) => fmt.num(n)) => {
  if (!alvo || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = formatar(alvo); return el; }
  const t0 = performance.now(); const dur = 700;
  el.textContent = formatar(0);
  const passo = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = formatar(Math.round(alvo * (1 - (1 - p) ** 3)));
    if (p < 1 && el.isConnected) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
  return el;
};
const kpi = (rotulo, valor, nota, ic, extra = {}) => h('section', { class: `card kpi ${extra.cls ?? ''}`, 'aria-label': rotulo }, h('div', { class: 'rotulo' }, icone(ic, 16), rotulo),
  h('div', { class: 'valor' }, typeof valor === 'number' ? contar(h('span'), valor) : valor), nota && h('div', { class: 'nota' }, nota));

export async function renderizar(el, { ir, sessao }) {
  const pode = (x) => !!sessao?.usuario?.permissoes?.includes(x);
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Início'), h('p', null, 'Visão do galpão agora.')),
    h('div', { class: 'row' }, pode('vendas.registrar') && h('button', { class: 'btn primario', onclick: () => ir('balcao') }, icone('cart'), 'Nova venda'), pode('estoque.operar') && h('button', { class: 'btn primario', onclick: () => ir('estoque?op=receber') }, icone('download'), 'Receber mercadoria'), pode('contagem.operar') && h('button', { class: 'btn', onclick: () => ir('contagem?novo=1') }, icone('clipboard'), 'Nova contagem'))));
  const alvo = h('div'); el.append(alvo);
  await carregar(alvo, () => api.get('/api/painel'), (d) => {
    const ocup = d.enderecos ? Math.round((d.enderecos_ocupados / d.enderecos) * 100) : 0;
    const vh = d.vendas_hoje;
    alvo.append(h('div', { class: 'grid bento' },
      vh && h('section', { class: 'card w6 faixa-vendas', 'aria-label': 'Vendas de hoje' }, h('div', { class: 'rotulo' }, icone('cart', 16), vh.minhas ? 'Minhas vendas de hoje' : 'Vendas de hoje no balcão'),
        h('div', { class: 'total-grande' }, fmt.moeda(vh.valor_centavos)), h('div', { class: 'muted' }, `${fmt.num(vh.quantidade)} venda(s)`)),
      kpi('Produtos ativos', d.produtos_ativos, d.sem_codigo ? `${d.sem_codigo} sem código de barras` : 'todos com código', 'box'),
      kpi('Unidades em estoque', d.unidades, null, 'layers'),
      h('section', { class: 'card kpi', 'aria-label': 'Ocupação' }, h('div', { class: 'rotulo' }, icone('map', 16), 'Ocupação do galpão'), h('div', { class: 'valor' }, contar(h('span'), ocup, (n) => `${n}%`)),
        (() => { const b = h('div', { class: 'barra', role: 'progressbar', 'aria-valuenow': ocup, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Ocupação' }, h('span')); b.firstChild.style.setProperty('--p', String(ocup)); return b; })(),
        h('div', { class: 'nota' }, `${fmt.num(d.enderecos_ocupados)} de ${fmt.num(d.enderecos)} endereços`)),
      h('section', { class: 'card kpi', 'aria-label': 'Integridade' }, h('div', { class: 'rotulo' }, icone('shield', 16), 'Integridade do estoque'),
        h('div', { class: 'valor' }, d.integridade ? badge('✓ Confere', 'ok') : badge('✗ Divergência', 'erro')), h('div', { class: 'nota' }, 'Saldo = soma do livro-razão')),
      h('section', { class: 'card w4' }, h('h2', null, 'Movimentações (14 dias)'), sparkline(d.serie_movimentos.map((x) => x.n)),
        h('p', { class: 'muted' }, `${fmt.num(d.movimentos_hoje)} hoje`), h('details', null, h('summary', null, 'Ver como tabela'),
          h('table', null, h('tbody', null, d.serie_movimentos.map((x) => h('tr', null, h('td', null, fmt.data(x.dia)), h('td', { class: 'num' }, x.n))))))),
      h('section', { class: 'card w2' }, h('h2', null, 'Atenção'), h('div', { class: 'lista' },
        h('div', null, h('span', null, 'Abaixo do mínimo'), badge(String(d.abaixo_minimo_total), d.abaixo_minimo_total ? 'aviso' : 'ok')),
        h('div', null, h('span', null, 'Sem estoque disponível'), badge(String(d.zerados), d.zerados ? 'erro' : 'ok')),
        h('div', null, h('span', null, 'Lotes vencendo em 30 dias'), badge(String(d.vencendo_30d), d.vencendo_30d ? 'aviso' : 'ok')),
        h('div', null, h('span', null, 'Contagens abertas'), badge(String(d.inventarios_abertos), d.inventarios_abertos ? 'info' : '')))),
      h('section', { class: 'card w4' }, h('h2', null, 'Produtos com estoque baixo'), d.abaixo_minimo.length
        ? h('div', { class: 'lista' }, d.abaixo_minimo.map((p) => h('div', null, h('a', { href: '#/produtos' }, `${p.sku} — ${p.nome}`), badge(`${p.vendavel} / mín. ${p.estoque_min}`, p.vendavel === 0 ? 'erro' : 'aviso'))))
        : vazio('Tudo certo', 'Nenhum produto abaixo do mínimo.')),
      h('section', { class: 'card w2' }, h('h2', null, 'Atividade recente'), d.atividade.length
        ? h('div', { class: 'lista' }, d.atividade.map((a) => h('div', null, h('span', null, a.acao.replaceAll('_', ' ').toLowerCase()), h('span', { class: 'muted' }, fmt.hora(a.ts)))))
        : vazio('Sem atividade ainda'))));
  });
}
