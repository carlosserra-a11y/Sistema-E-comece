// Início: painel vivo em que cada número leva ao lugar dele. Só vira link o que a pessoa pode abrir.
import { h, limpar, api, pode, icone, fmt, badge, vazio, modal, avatar, esqueleto, blocoErro, tratar } from './core.js';
import { sparkline, contar, graficoSemana, saudacao, dataPorExtenso, hojeDaLoja } from './painel-blocos.js';

const ATUALIZAR_A_CADA_MS = 60_000;
const VE_VENDAS = 'vendas.registrar,vendas.gerenciar,vendas.cancelar';
const seta = () => h('span', { class: 'ir-seta', 'aria-hidden': 'true' }, icone('chevron', 16));
const plural = (n, um, varios) => `${fmt.num(n)} ${n === 1 ? um : varios}`;

/** Indicador. Com destino liberado vira link; sem permissão, só mostra o número. */
function indicador({ rotulo, ic, cor, valor, nota, destino, perm, aoClicar, extra, animar }) {
  const dentro = [h('div', { class: 'rotulo' }, icone(ic, 16), rotulo), h('div', { class: 'valor' }, typeof valor === 'number' ? contar(valor, { animar }) : valor), extra, nota && h('div', { class: 'nota' }, nota)];
  const classe = `card kpi ${cor}`;
  if (aoClicar && pode(perm)) return h('button', { class: `${classe} ir`, type: 'button', onclick: aoClicar }, dentro, seta());
  if (destino && pode(perm)) return h('a', { class: `${classe} ir`, href: `#/${destino}` }, dentro, seta());
  return h('section', { class: classe, 'aria-label': rotulo }, dentro);
}

const cabecalho = (titulo, destino, perm, texto = 'Ver tudo') => h('div', { class: 'cab-cartao' }, h('h2', null, titulo), destino && pode(perm) ? h('a', { href: `#/${destino}`, 'aria-label': `${texto}: ${titulo}` }, `${texto} →`) : null);

/** Linha de lista que leva a algum lugar (ou só informa, sem permissão). */
function linha(destino, perm, ...filhos) {
  return destino && pode(perm) ? h('a', { href: `#/${destino}` }, ...filhos, h('span', { class: 'fazer-seta', 'aria-hidden': 'true' }, icone('chevron', 16))) : h('div', null, ...filhos);
}

/** O que pede atenção agora, em ordem de urgência. */
function paraFazer(d) {
  const itens = [
    d.expedicao_pendente > 0 && ['send', 'info', `${plural(d.expedicao_pendente, 'venda', 'vendas')} para separar e expedir`, 'expedicao', 'expedicao.ver'],
    d.caixas_antigos > 0 && ['wallet', 'erro', `${plural(d.caixas_antigos, 'caixa aberto', 'caixas abertos')} desde antes de hoje: confira e feche`, 'balcao?aba=caixa', VE_VENDAS],
    d.sem_preco > 0 && ['tag', 'erro', `${plural(d.sem_preco, 'produto sem preço não pode', 'produtos sem preço não podem')} ser vendido no balcão`, 'produtos?filtro=sem_preco', 'produtos.ver'],
    d.zerados > 0 && ['alert', 'erro', `${plural(d.zerados, 'produto', 'produtos')} sem estoque disponível`, 'produtos?filtro=zerados', 'produtos.ver'],
    d.abaixo_minimo_total > 0 && ['download', 'aviso', `${plural(d.abaixo_minimo_total, 'produto', 'produtos')} abaixo do mínimo`, 'produtos?filtro=abaixo', 'produtos.ver'],
    d.vencendo_30d > 0 && ['clock', 'aviso', `${plural(d.vencendo_30d, 'lote vence', 'lotes vencem')} em até 30 dias`, 'estoque?op=saldos&vencendo=30', 'estoque.ver'],
    d.sem_codigo > 0 && ['barcode', 'aviso', `${plural(d.sem_codigo, 'produto', 'produtos')} sem código de barras`, 'produtos?filtro=sem_codigo', 'produtos.ver'],
    d.inventarios_abertos > 0 && ['clipboard', 'info', plural(d.inventarios_abertos, 'contagem aberta', 'contagens abertas'), 'contagem', 'contagem.operar'],
  ].filter(Boolean);
  return h('section', { class: 'card w2' }, h('div', { class: 'cab-cartao' }, h('h2', null, 'Para fazer agora'), badge(itens.length ? String(itens.length) : '✓', itens.length ? 'aviso' : 'ok')),
    itens.length ? h('div', { class: 'lista' }, itens.map(([ic, tom, texto, destino, perm]) => linha(destino, perm, h('span', { class: `fazer-ic ${tom}`, 'aria-hidden': 'true' }, icone(ic, 18)), h('span', { class: 'fazer-txt' }, texto))))
      : vazio('Tudo em dia', 'Nada pendente no momento.'));
}

function equipeHoje(pessoas) {
  const resumo = (x) => [x.bipagens && plural(x.bipagens, 'bipagem', 'bipagens'), x.separacoes && plural(x.separacoes, 'separação', 'separações'), x.conferencias && plural(x.conferencias, 'conferência', 'conferências'), x.expedicoes && plural(x.expedicoes, 'expedição', 'expedições'), x.vendas && plural(x.vendas, 'venda', 'vendas')].filter(Boolean).join(' · ') || 'sem lançamentos hoje';
  return h('section', { class: 'card w2' }, cabecalho('Equipe hoje', 'atividade', 'atividade.ver', 'Ver quem fez o quê'),
    pessoas.length ? h('div', { class: 'lista' }, pessoas.slice(0, 5).map((x) => linha(`atividade?pessoa=${x.id}`, 'atividade.ver', avatar(x.nome), h('span', { class: 'quem-txt' }, h('strong', null, x.nome), h('small', null, resumo(x))), x.caixa_aberto ? h('span', { class: 'row' }, h('i', { class: 'pulso', 'aria-hidden': 'true' }), badge('no caixa', 'ok')) : null)))
      : vazio('Ninguém lançou nada ainda hoje', 'Bipagens, vendas e conferências aparecem aqui.'));
}

function vendas(d, animar, largura) {
  const v = d.vendas_hoje; const destino = `balcao?aba=vendas&dia=${hojeDaLoja()}`; const abre = pode(VE_VENDAS);
  const titulo = v.minhas ? 'Minhas vendas de hoje' : 'Vendas de hoje no balcão';
  const total = contar(v.valor_centavos, { formatar: fmt.moeda, animar });
  return h('section', { class: `card ${largura} cartao-vendas ${abre ? 'ir' : ''}`, 'aria-label': titulo },
    h('div', { class: 'stack' }, h('div', { class: 'rotulo muted' }, icone('cart', 16), titulo),
      abre ? h('a', { class: 'cobre total-grande', href: `#/${destino}`, 'aria-label': `${titulo}: ${fmt.moeda(v.valor_centavos)}. Abrir a lista` }, total) : h('div', { class: 'total-grande' }, total),
      h('div', { class: 'muted' }, `${plural(v.quantidade, 'venda', 'vendas')}${v.quantidade ? ` · média de ${fmt.moeda(Math.round(v.valor_centavos / v.quantidade))}` : ''}`)),
    d.vendas_7_dias && graficoSemana(d.vendas_7_dias, { clicavel: abre }),
    d.vendas_7_dias && h('details', null, h('summary', null, 'Ver como tabela'), h('table', null, h('tbody', null, d.vendas_7_dias.map((x) => h('tr', null, h('td', null, fmt.data(x.dia)), h('td', { class: 'num' }, x.quantidade), h('td', { class: 'num' }, fmt.moeda(x.valor_centavos))))))),
    abre ? seta() : null);
}

async function verificarIntegridade() {
  const corpo = h('div', { class: 'stack' }, esqueleto(2));
  const m = modal('Integridade do sistema', corpo);
  try {
    const [estoque, cadeia] = await Promise.all([pode('estoque.ver') ? api.get('/api/estoque/integridade') : null, pode('auditoria.ver') ? api.get('/api/auditoria/verificar') : null]);
    limpar(corpo).append(
      estoque && (estoque.ok ? h('p', null, badge('✓ Estoque confere', 'ok'), ' O saldo de cada endereço é igual à soma das movimentações.') : h('p', null, badge(`✗ ${estoque.divergencias.length} divergência(s)`, 'erro'), ' Avise quem cuida do sistema antes de continuar lançando.')),
      cadeia && (cadeia.ok ? h('p', null, badge('✓ Histórico íntegro', 'ok'), ` ${fmt.num(cadeia.total)} registros encadeados, nenhum alterado.`) : h('p', null, badge('✗ Histórico quebrado', 'erro'), ` Falha no registro ${cadeia.quebrouEm}.`)),
      h('button', { class: 'btn primario', type: 'button', autofocus: true, onclick: () => m.fechar() }, 'Fechar'));
  } catch (e) { m.fechar(); tratar(e); }
}

function estoqueBaixo(d) {
  return d.abaixo_minimo.length
    ? h('div', { class: 'lista' }, d.abaixo_minimo.map((p) => linha(`produtos?abrir=${p.id}`, 'produtos.ver', h('span', { class: 'fazer-txt quebra' }, `${p.sku} — ${p.nome}`), badge(`${p.vendavel} / mín. ${p.estoque_min}`, p.vendavel === 0 ? 'erro' : 'aviso'))))
    : vazio('Tudo certo', 'Nenhum produto abaixo do mínimo.');
}

function desenhar(d, animar) {
  const ocup = d.enderecos ? Math.round((d.enderecos_ocupados / d.enderecos) * 100) : 0;
  const barra = h('div', { class: 'barra', role: 'progressbar', 'aria-valuenow': ocup, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Ocupação' }, h('span'));
  barra.firstChild.style.setProperty('--p', String(ocup));
  const fila = d.expedicao_pendente;
  // largura de cada bloco conforme o que a pessoa enxerga, para a grade não ficar com buracos
  const temLateral = !!(d.equipe_hoje || d.atividade);
  return h('div', { class: 'grid bento' },
    d.vendas_hoje && vendas(d, animar, fila === null ? 'w6' : 'w4'),
    fila !== null && indicador({ rotulo: 'Para expedir', ic: 'send', cor: `cor-sol ${d.vendas_hoje ? 'w3' : 'w6'}`, valor: fila, nota: fila ? 'vendas aguardando separar, conferir ou enviar' : 'nenhuma venda aguardando', destino: 'expedicao', perm: 'expedicao.ver', animar }),
    indicador({ rotulo: 'Produtos ativos', ic: 'box', cor: 'cor-gelo', valor: d.produtos_ativos, nota: d.sem_codigo ? `${d.sem_codigo} sem código de barras` : 'todos com código', destino: 'produtos?filtro=ativos', perm: 'produtos.ver', animar }),
    indicador({ rotulo: 'Unidades em estoque', ic: 'layers', cor: 'cor-agua', valor: d.unidades, nota: 'veja produto por produto', destino: 'estoque?op=produtos', perm: 'estoque.ver', animar }),
    indicador({ rotulo: 'Ocupação do galpão', ic: 'map', cor: 'cor-menta', valor: contar(ocup, { formatar: (n) => `${n}%`, animar }), extra: barra, nota: `${fmt.num(d.enderecos_ocupados)} de ${fmt.num(d.enderecos)} endereços`, destino: 'enderecos?aba=mapa', perm: 'enderecos.ver' }),
    indicador({ rotulo: 'Integridade do estoque', ic: 'shield', cor: d.integridade ? 'cor-menta' : 'cor-alerta', valor: d.integridade ? badge('✓ Confere', 'ok') : badge('✗ Divergência', 'erro'), nota: 'toque para verificar agora', aoClicar: verificarIntegridade, perm: 'estoque.ver,auditoria.ver' }),
    paraFazer(d),
    d.equipe_hoje ? equipeHoje(d.equipe_hoje) : h('section', { class: 'card w2' }, cabecalho('Produtos com estoque baixo', 'produtos?filtro=abaixo', 'produtos.ver'), estoqueBaixo(d)),
    h('section', { class: `card ${temLateral ? 'w4' : 'w6'}` }, cabecalho('Movimentações (14 dias)', 'estoque?op=mov', 'estoque.ver', 'Ver movimentações'), sparkline(d.serie_movimentos.map((x) => x.n)),
      h('p', { class: 'muted' }, `${fmt.num(d.movimentos_hoje)} hoje`), h('details', null, h('summary', null, 'Ver como tabela'),
        h('table', null, h('tbody', null, d.serie_movimentos.map((x) => h('tr', null, h('td', null, fmt.data(x.dia)), h('td', { class: 'num' }, x.n))))))),
    d.equipe_hoje ? h('section', { class: 'card w3' }, cabecalho('Estoque baixo', 'produtos?filtro=abaixo', 'produtos.ver'), estoqueBaixo(d))
      : d.atividade ? h('section', { class: 'card w3' }, cabecalho('Atividade recente', 'config', null, 'Ver histórico'), d.atividade.length
        ? h('div', { class: 'lista' }, d.atividade.map((a) => h('div', null, h('span', null, a.acao.replaceAll('_', ' ').toLowerCase()), h('span', { class: 'muted' }, fmt.hora(a.ts)))))
        : vazio('Sem atividade ainda')) : null);
}

export async function renderizar(el, { ir, sessao }) {
  const primeiro = String(sessao?.usuario?.nome ?? '').trim().split(/\s+/)[0];
  const resumo = h('p', { class: 'heroi-resumo' }, 'Visão da loja e do galpão agora.');
  const acao = (rotulo, ic, destino, perm, principal) => pode(perm) && h('button', { class: `btn ${principal ? 'primario' : ''}`, type: 'button', onclick: () => ir(destino) }, icone(ic), rotulo);
  const acoes = [acao('Nova venda', 'cart', 'balcao', 'vendas.registrar', true), acao('Receber mercadoria', 'download', 'estoque?op=receber', 'estoque.operar'),
    acao('Separar pedidos', 'send', 'expedicao', 'expedicao.operar'), acao('Nova contagem', 'clipboard', 'contagem?novo=1', 'contagem.operar')];
  const quando = h('span', { role: 'status' });
  const botaoAtualizar = h('button', { class: 'btn pequeno fantasma', type: 'button', onclick: () => atualizar(false) }, icone('refresh', 14), 'Atualizar');
  const alvo = h('div');
  el.append(h('section', { class: 'heroi', 'aria-label': 'Boas-vindas' }, h('div', null, h('p', { class: 'heroi-data' }, dataPorExtenso()), h('h1', null, `${saudacao()}${primeiro ? `, ${primeiro}` : ''}`), resumo), h('div', { class: 'heroi-acoes' }, acoes)),
    h('div', { class: 'barra-atualizado' }, quando, botaoAtualizar), alvo);

  let ocupado = false; let ultimo = '';
  async function atualizar(automatico) {
    if (ocupado) return; ocupado = true; botaoAtualizar.classList.add('girando');
    try {
      const d = await api.get('/api/painel');
      if (!alvo.isConnected) return;
      quando.textContent = `Atualizado às ${fmt.hora(Date.now())}`;
      const partes = [d.vendas_hoje && `${plural(d.vendas_hoje.quantidade, 'venda', 'vendas')} hoje`, d.expedicao_pendente > 0 && `${fmt.num(d.expedicao_pendente)} para expedir`, d.abaixo_minimo_total > 0 && `${fmt.num(d.abaixo_minimo_total)} abaixo do mínimo`].filter(Boolean);
      resumo.textContent = partes.length ? partes.join(' · ') : 'Visão da loja e do galpão agora.';
      const marca = JSON.stringify({ ...d, atividade: d.atividade?.[0]?.id });
      if (automatico && marca === ultimo) return; // nada mudou: não redesenha
      const animar = !ultimo;
      ultimo = marca;
      limpar(alvo).classList.toggle('sem-entrada', !animar);
      alvo.append(desenhar(d, animar));
    } catch (e) {
      if (!ultimo) limpar(alvo).append(blocoErro(e, () => atualizar(false))); else if (!automatico) tratar(e);
    } finally { ocupado = false; botaoAtualizar.classList.remove('girando'); }
  }
  alvo.append(esqueleto(6));
  await atualizar(false);
  if (!alvo.isConnected) return undefined; // saiu da tela enquanto carregava
  // painel vivo: só enquanto está visível, sem janela aberta e sem tirar o foco de quem navega pelo teclado
  const relogio = setInterval(() => { if (!document.hidden && !document.querySelector('.overlay') && !alvo.contains(document.activeElement)) atualizar(true); }, ATUALIZAR_A_CADA_MS);
  return () => clearInterval(relogio);
}
