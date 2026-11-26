// Peças visuais do painel: gráficos em SVG/CSS (sem biblioteca, por causa da CSP) e números que "contam".
import { h, fmt } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
export const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
export function contar(valor, { formatar = (n) => fmt.num(n), animar = true } = {}) {
  const el = h('span', null, formatar(valor));
  if (!valor || !animar || semMovimento() || document.hidden) return el;
  const t0 = performance.now(); const dur = 700;
  el.textContent = formatar(0);
  const passo = (t) => {
    const p = Math.min(1, Math.max(0, (t - t0) / dur));
    el.textContent = formatar(Math.round(valor * (1 - (1 - p) ** 3)));
    if (p < 1 && el.isConnected) requestAnimationFrame(passo); else el.textContent = formatar(valor);
  };
  requestAnimationFrame(passo);
  setTimeout(() => { el.textContent = formatar(valor); }, dur + 400); // aba em segundo plano: garante o número final
  return el;
}

const meioDia = (dia) => new Date(`${dia}T12:00:00Z`);
export const diaDaSemana = (dia) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(meioDia(dia)).replace('.', '');

/** Vendas dos últimos 7 dias em barras (uma série: o título nomeia). Cada barra leva às vendas daquele dia; passar o mouse ou focar mostra o valor. */
export function graficoSemana(dias, { clicavel = true } = {}) {
  const max = Math.max(1, ...dias.map((d) => d.valor_centavos));
  return h('ol', { class: 'semana', 'aria-label': 'Vendas dos últimos 7 dias' }, dias.map((d, i) => {
    const hoje = i === dias.length - 1;
    const rotulo = `${hoje ? 'Hoje' : diaDaSemana(d.dia)}, ${fmt.data(d.dia).slice(0, 5)}: ${fmt.moeda(d.valor_centavos)} em ${d.quantidade} venda(s)`;
    const barra = h('span', { class: `semana-barra ${d.valor_centavos ? '' : 'zero'}` });
    barra.style.setProperty('--p', String(d.valor_centavos / max));
    barra.style.setProperty('--i', String(i));
    const dentro = [h('span', { class: 'semana-dica', 'aria-hidden': 'true' }, h('strong', null, fmt.moeda(d.valor_centavos)), h('small', null, `${fmt.num(d.quantidade)} venda(s)`)),
      h('span', { class: 'semana-trilho', 'aria-hidden': 'true' }, barra), h('span', { class: 'semana-dia', 'aria-hidden': 'true' }, hoje ? 'hoje' : diaDaSemana(d.dia))];
    return h('li', { class: hoje ? 'hoje' : '' }, clicavel ? h('a', { class: 'semana-col', href: `#/balcao?aba=vendas&dia=${d.dia}`, 'aria-label': rotulo }, dentro) : h('span', { class: 'semana-col', tabindex: '0', role: 'img', 'aria-label': rotulo }, dentro));
  }));
}

/** Saudação pela hora de São Paulo. */
export function saudacao(agora = new Date()) {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(agora).slice(0, 2));
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}
export const dataPorExtenso = (agora = new Date()) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(agora);
/** AAAA-MM-DD no fuso da loja. */
export const hojeDaLoja = (agora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
