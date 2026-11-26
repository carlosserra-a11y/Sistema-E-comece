// Equipe em ação: quem bipou, quem separou, conferiu e expediu, quem vendeu e quem está no caixa.
import { h, limpar, api, carregar, pode, icone, fmt, badge, qs, vazio, avatar } from './core.js';
import { contar, hojeDaLoja } from './painel-blocos.js';

const METRICAS = [['bipagens', 'Bipagens', 'scan'], ['separacoes', 'Separações', 'box'], ['conferencias', 'Conferências', 'checks'], ['expedicoes', 'Expedições', 'send'], ['vendas', 'Vendas', 'cart']];
const ICONE_EVENTO = { estoque: ['scan', 'info'], separacao: ['box', 'info'], conferencia: ['checks', 'ok'], expedicao: ['send', 'ok'], retirada: ['check', 'info'], venda: ['cart', 'ok'], cancelamento: ['x', 'erro'], caixa: ['wallet', 'aviso'] };
const dias = (n) => hojeDaLoja(new Date(Date.now() - n * 86_400_000));
const PERIODOS = [['hoje', 'Hoje', () => [dias(0), dias(0)]], ['ontem', 'Ontem', () => [dias(1), dias(1)]], ['7', '7 dias', () => [dias(6), dias(0)]], ['30', '30 dias', () => [dias(29), dias(0)]]];
const podeAbrir = (link) => pode(link.startsWith('produtos') ? 'produtos.ver' : link.startsWith('expedicao') ? 'expedicao.ver' : link.startsWith('integracoes') ? 'integracoes.ver,pedidos.ver' : 'vendas.registrar,vendas.gerenciar,vendas.cancelar');

export async function renderizar(el, { params }) {
  let periodo = PERIODOS.some(([id]) => id === params.get('periodo')) ? params.get('periodo') : 'hoje';
  let [de, ate] = PERIODOS.find(([id]) => id === periodo)[2]();
  let pessoa = /^\d+$/.test(params.get('pessoa') ?? '') ? Number(params.get('pessoa')) : null;
  let animar = true;
  const alvo = h('div', { class: 'stack' });
  const buscar = () => api.get(`/api/atividade?${qs({ de, ate, pessoa })}`);

  const desenhar = (d) => {
    const total = (k) => d.pessoas.reduce((s, x) => s + x[k], 0);
    const noCaixa = d.pessoas.filter((x) => x.caixa_aberto);
    const escolhida = d.pessoas.find((x) => x.id === pessoa);
    alvo.append(
      h('div', { class: 'resumo-equipe' }, METRICAS.map(([k, rotulo, ic]) => h('section', { class: 'card kpi', 'aria-label': rotulo }, h('div', { class: 'rotulo' }, icone(ic, 16), rotulo), h('div', { class: 'valor' }, contar(total(k), { animar }))))),
      h('section', { class: 'card no-caixa', 'aria-label': 'Quem está no caixa' }, h('h2', null, 'No caixa agora'), noCaixa.length
        ? h('div', { class: 'chips' }, noCaixa.map((x) => (pode('vendas.registrar,vendas.gerenciar,vendas.cancelar') ? h('a', { class: 'pessoa-chip', href: '#/balcao?aba=caixa' }, avatar(x.nome), h('span', null, h('strong', null, x.nome), h('small', null, `caixa nº ${x.caixa_aberto.id} desde ${fmt.dataHora(x.caixa_aberto.desde)}`)), h('i', { class: 'pulso', 'aria-hidden': 'true' }))
          : h('span', { class: 'pessoa-chip' }, avatar(x.nome), h('span', null, h('strong', null, x.nome), h('small', null, `caixa nº ${x.caixa_aberto.id} desde ${fmt.dataHora(x.caixa_aberto.desde)}`)), h('i', { class: 'pulso', 'aria-hidden': 'true' })))))
        : h('p', { class: 'muted' }, 'Nenhum caixa aberto neste momento.')),
      h('div', { class: 'pessoas', role: 'group', 'aria-label': 'Equipe: toque em uma pessoa para ver só o que ela fez' }, d.pessoas.map((x) => h('button', { class: 'card pessoa', type: 'button', 'aria-pressed': x.id === pessoa, onclick: () => { pessoa = pessoa === x.id ? null : x.id; ler(false); } },
        h('span', { class: 'pessoa-topo' }, avatar(x.nome), h('span', { class: 'pessoa-nome' }, h('strong', null, x.nome), h('small', { class: 'muted' }, x.dono ? 'dono' : x.situacao ? `conta ${x.situacao}` : 'equipe')), x.caixa_aberto ? badge('caixa aberto', 'aviso') : null),
        h('span', { class: 'pessoa-numeros' }, METRICAS.map(([k, rotulo]) => h('span', { class: x[k] ? '' : 'zero' }, h('strong', null, fmt.num(x[k])), h('small', null, rotulo)))),
        x.valor_centavos !== undefined && x.vendas ? h('span', { class: 'muted' }, `${fmt.moeda(x.valor_centavos)} vendidos`) : null))),
      h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, escolhida ? `O que ${escolhida.nome} fez` : 'Linha do tempo'), pessoa ? h('button', { class: 'btn pequeno', type: 'button', onclick: () => { pessoa = null; ler(false); } }, icone('x', 14), 'Ver todos') : null),
        d.linha_do_tempo.length ? h('ol', { class: 'linha-tempo' }, d.linha_do_tempo.map((e) => {
          const [ic, tom] = ICONE_EVENTO[e.tipo] ?? ['activity', 'info'];
          const dentro = [h('span', { class: `evento-ic ${tom}`, 'aria-hidden': 'true' }, icone(ic, 16)), h('span', { class: 'evento-txt quebra' }, h('strong', null, e.quem), ` ${e.texto}`), h('time', { class: 'muted' }, de === ate ? fmt.hora(e.ts) : fmt.dataHora(e.ts))];
          return h('li', null, podeAbrir(e.link) ? h('a', { href: `#/${e.link}` }, dentro) : h('span', null, dentro));
        })) : vazio('Nada neste período', 'As leituras, vendas, conferências e o caixa aparecem aqui assim que acontecem.')),
      h('p', { class: 'muted' }, 'Bipagens = leituras de estoque feitas à mão (receber, guardar, baixar, contagem). Baixas automáticas de venda não contam. Expedições incluem os pedidos da internet enviados; venda que o cliente levou na hora não conta, mas aparece na linha do tempo.'));
  };
  const ler = (comAnimacao = true) => { animar = comAnimacao; alvo.classList.toggle('sem-entrada', !comAnimacao); return carregar(alvo, buscar, desenhar); };

  const campoData = (rotulo, valor, aoMudar) => h('label', { class: 'campo-data' }, h('span', { class: 'muted' }, rotulo), h('input', { type: 'date', value: valor, onchange: (e) => { if (!e.target.value) return; aoMudar(e.target.value); periodo = null; marcar(); ler(); } }));
  const inDe = campoData('De', de, (x) => { de = x; if (ate < de) { ate = x; inAte.querySelector('input').value = x; } });
  const inAte = campoData('Até', ate, (x) => { ate = x; if (de > ate) { de = x; inDe.querySelector('input').value = x; } });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Período' }, PERIODOS.map(([id, rotulo, calc]) => h('button', { class: 'chip', type: 'button', 'data-periodo': id, 'aria-pressed': id === periodo, onclick: () => { periodo = id; [de, ate] = calc(); inDe.querySelector('input').value = de; inAte.querySelector('input').value = ate; marcar(); ler(); } }, rotulo)));
  const marcar = () => chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.periodo === periodo)));
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Equipe em ação'), h('p', null, 'Quem bipou, quem conferiu, quem expediu e quem estava no caixa.')),
    h('button', { class: 'btn', type: 'button', onclick: () => ler() }, icone('refresh', 18), 'Atualizar')), h('div', { class: 'row filtros' }, chips, h('span', { class: 'grow' }), inDe, inAte), alvo);
  await ler();
  if (!alvo.isConnected) return undefined; // saiu da tela enquanto carregava
  const relogio = setInterval(async () => {
    if (document.hidden || document.querySelector('.overlay') || alvo.contains(document.activeElement) || periodo !== 'hoje') return;
    try { [de, ate] = [dias(0), dias(0)]; const filtro = `${de}:${ate}:${pessoa}`; const d = await buscar(); if (alvo.isConnected && filtro === `${de}:${ate}:${pessoa}`) { animar = false; limpar(alvo).classList.add('sem-entrada'); desenhar(d); } } catch { /* tenta no próximo ciclo */ }
  }, 45_000);
  return () => clearInterval(relogio);
}
