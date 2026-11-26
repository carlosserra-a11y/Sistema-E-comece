// Expedição: separar -> conferir (bipando) -> expedir. Cada passo grava quem fez e quando.
import { h, limpar, api, carregar, pode, icone, fmt, badge, qs, tratar, toast, feedback, paginacao, gaveta, abas, vazio, campo, avatar, esqueleto } from './core.js';
import { botaoLevouNaHora } from './balcao-cupom.js';

const PASSOS = [['SEPARACAO', 'Separação', 'Separar', 'Separado'], ['CONFERENCIA', 'Conferência', 'Conferir', 'Conferido'], ['EXPEDICAO', 'Expedição', 'Expedir', 'Expedido']];
// venda que já saiu (inclusive "levou na hora", sem separação nem conferência) não tem próximo passo
const proximo = (etapas) => (etapas.some((e) => e.etapa === 'EXPEDICAO') ? null : PASSOS.find(([id]) => !etapas.some((e) => e.etapa === id)) ?? null);
// Duas filas na mesma tela: muda o endereço da API e o nome de cada coisa.
const FONTES = {
  balcao: { api: '/api/expedicao', rotulo: 'Balcão', nome: (v) => `Venda nº ${v.id}`, curto: (v) => `venda ${v.id}`, titulo: (id) => `Venda nº ${id}`, deste: 'desta venda', feito: (v) => `Venda ${v.id} expedida ✓` },
  internet: { api: '/api/expedicao-pedidos', rotulo: 'Internet', nome: (v) => `Pedido ${v.canal_pedido_id}`, curto: (v) => `pedido ${v.canal_pedido_id}`, titulo: () => 'Pedido da internet', deste: 'deste pedido', feito: (v) => `Pedido ${v.canal_pedido_id} expedido ✓` },
};
// Mesma limpeza que o servidor faz na leitura (caracteres de controle e prefixo de simbologia do leitor).
const limparLeitura = (t) => t.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\][A-Za-z][0-9A-Za-z]/, '').toUpperCase();
const leituras = new Map(); // origem:id:etapa -> { produto_id: { codigo, qtd } } (fechar a gaveta sem querer não perde o que já foi bipado)

function passos(etapas) {
  const direto = etapas.find((e) => e.na_hora);
  if (direto) return h('ol', { class: 'passos', 'aria-label': 'Andamento' }, h('li', { class: 'feito' }, h('span', { class: 'passo-marca', 'aria-hidden': 'true' }, icone('check', 14)),
    h('span', { class: 'passo-texto' }, h('strong', null, 'Levou na hora'), h('small', null, `${direto.quem} · ${fmt.dataHora(direto.ts)}`))));
  const atual = proximo(etapas)?.[0];
  return h('ol', { class: 'passos', 'aria-label': 'Andamento' }, PASSOS.map(([id, rotulo, , feito]) => {
    const e = etapas.find((x) => x.etapa === id);
    return h('li', { class: e ? 'feito' : id === atual ? 'atual' : '' }, h('span', { class: 'passo-marca', 'aria-hidden': 'true' }, e ? icone('check', 14) : null),
      h('span', { class: 'passo-texto' }, h('strong', null, e ? feito : rotulo), h('small', null, e ? `${e.quem} · ${fmt.dataHora(e.ts)}` : id === atual ? 'próximo passo' : 'aguardando')));
  }));
}

export async function renderizar(el, { params }) {
  let situacao = 'pendentes'; let pagina = 1; let aberta = null; let scanner = null;
  let origem = params.get('pedido') ? 'internet' : 'balcao';
  const contagem = { balcao: null, internet: null }; // quantos esperam em cada fila
  const alvo = h('div', { class: 'stack' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Origem' }, Object.keys(FONTES).map((id) => h('button', { class: 'chip', type: 'button', 'data-origem': id, onclick: () => { origem = id; pagina = 1; pintarChips(); listar(); } }, FONTES[id].rotulo)));
  const pintarChips = () => chips.querySelectorAll('.chip').forEach((c) => {
    const id = c.dataset.origem;
    c.setAttribute('aria-pressed', String(id === origem));
    c.textContent = contagem[id] === null ? FONTES[id].rotulo : `${FONTES[id].rotulo} (${contagem[id]})`;
  });
  const contar = async () => {
    const [b, i] = await Promise.all(Object.values(FONTES).map((f) => api.get(`${f.api}?por_pagina=1`)));
    contagem.balcao = b.total; contagem.internet = i.total; pintarChips();
  };

  const cartao = (v, de) => {
    const p = proximo(v.etapas); const daLoja = de === 'balcao';
    const quem = daLoja ? v.vendedor_nome : v.comprador_apelido ?? 'Comprador';
    return h('article', { class: 'card exp-cartao' },
      h('header', null, h('div', null, h('h2', null, FONTES[de].nome(v)), h('p', { class: 'muted' }, `${fmt.dataHora(daLoja ? v.concluida_em : v.data_canal)} · ${fmt.num(v.unidades)} unidade(s)`)),
        h('div', { class: 'quem' }, avatar(quem), h('span', null, h('small', { class: 'muted' }, daLoja ? 'Vendeu' : 'Mercado Livre'), h('strong', null, quem)))),
      passos(v.etapas),
      h('button', { class: `btn ${p && pode('expedicao.operar') ? 'primario' : ''}`, type: 'button', onclick: () => abrir(de, v.id) },
        icone(p ? (p[0] === 'EXPEDICAO' ? 'send' : 'scan') : 'eye', 18), p && pode('expedicao.operar') ? `${p[2]} ${FONTES[de].curto(v)}` : 'Ver detalhes'),
      v.pode_levar_na_hora ? botaoLevouNaHora(v.id, { perguntar: true, aoMarcar: () => listar() }) : null);
  };
  const VAZIO = {
    balcao: { pendentes: ['Nada para separar', 'Quando uma venda com produtos for concluída no balcão, ela aparece aqui.'], expedidas: ['Nenhuma venda expedida ainda', 'As vendas aparecem aqui depois do passo "Expedir".'] },
    internet: { pendentes: ['Nenhum pedido para separar', 'Os pedidos pagos do Mercado Livre aparecem aqui.'], expedidas: ['Nenhum pedido expedido ainda', 'Os pedidos aparecem aqui depois do passo "Expedir".'] },
  };
  const desenhar = (d) => alvo.append(
    situacao === 'pendentes' && d.com_problema ? h('p', { class: 'aviso-txt', role: 'status' }, `${fmt.num(d.com_problema)} pedido(s) pago(s) com problema ficam fora da fila. `, pode('integracoes.ver,pedidos.ver') ? h('a', { href: '#/integracoes' }, 'Resolver em Integrações') : 'Avise quem cuida das integrações.') : null,
    d.total ? h('div', { class: 'exp-lista' }, d.itens.map((v) => cartao(v, d.origem))) : vazio(...VAZIO[d.origem][situacao]),
    d.total > d.por_pagina ? paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; listar(); }) : null);
  const buscar = async () => {
    const de = origem;
    const [d] = await Promise.all([api.get(`${FONTES[de].api}?${qs({ situacao, pagina, por_pagina: 24 })}`), contar()]);
    return { ...d, origem: de };
  };
  const listar = () => carregar(alvo, buscar, desenhar);

  async function abrir(de, id) {
    const g = gaveta(FONTES[de].titulo(id), esqueleto(5), { aoFechar: () => { scanner?.fechar(); aberta = null; listar(); } });
    aberta = g;
    await mostrar(g, de, id);
  }

  async function mostrar(g, de, id) {
    let v;
    try { v = { ...await api.get(`${FONTES[de].api}/${id}`), origem: de }; } catch (e) { tratar(e); return g.fechar(); }
    const daLoja = de === 'balcao';
    const liberado = daLoja ? v.status === 'CONCLUIDA' : v.status === 'PAGO' && !v.enviado_a_mao;
    const p = liberado && v.itens.length ? proximo(v.etapas) : null;
    const operar = p && pode('expedicao.operar');
    const aviso = daLoja ? (v.status === 'CANCELADA' && 'Esta venda foi cancelada: não separe nem envie.')
      : v.status === 'CANCELADO' ? (v.etapas.some((e) => e.etapa === 'EXPEDICAO') ? 'Cancelado depois do envio: quando a peça voltar, dê entrada em Estoque → Receber.' : 'Este pedido foi cancelado: não envie. Guarde de volta o que já foi separado.')
        : v.enviado_a_mao ? 'Marcado como enviado em Integrações (baixa feita à mão): não há o que expedir.'
          : v.status === 'NOVO' ? 'Este pedido ainda não foi pago.' : v.status === 'COM_PROBLEMA' && `Pedido com problema: ${v.problema ?? 'veja em Integrações'}`;
    const dados = daLoja ? [['Vendida em', fmt.dataHora(v.concluida_em)], ['Atendente', v.vendedor_nome], ['Caixa', v.caixa_id ? `nº ${v.caixa_id} · ${v.caixa_de}` : '—'], v.observacao ? ['Observação', v.observacao] : null]
      : [['Pedido', v.canal_pedido_id], ['Recebido em', fmt.dataHora(v.data_canal)], ['Comprador', v.comprador_apelido ?? '—']];
    limpar(g.corpo).append(
      aviso ? h('p', { class: 'aviso-txt', role: 'alert' }, aviso) : null,
      h('div', { class: 'lista' }, dados.filter(Boolean).map(([r, x]) => h('div', null, h('span', { class: 'muted' }, r), h('strong', { class: 'quebra' }, x)))),
      passos(v.etapas),
      v.pode_levar_na_hora ? botaoLevouNaHora(v.id, { perguntar: true, aoMarcar: () => mostrar(g, de, v.id) }) : null,
      v.etapas.filter((e) => e.observacao).map((e) => h('p', { class: 'muted quebra' }, `${PASSOS.find(([x]) => x === e.etapa)[1]}: ${e.observacao}`)),
      operar && p[0] !== 'EXPEDICAO' ? leitura(g, v, p) : itens(v),
      operar && p[0] === 'EXPEDICAO' ? expedir(g, v) : null);
  }

  // venda: a baixa já aconteceu no caixa; pedido: só acontece no "Expedir", então até lá é de onde pegar
  const rotuloEndereco = (v) => (v.origem === 'internet' && !v.etapas.some((e) => e.etapa === 'EXPEDICAO') ? 'Pegar em ' : 'Saiu de ');
  const linhaItem = (v, i, extra) => h('li', { class: 'item-exp' }, h('div', { class: 'item-exp-topo' }, h('span', { class: 'quebra' }, h('strong', { class: 'mono' }, i.sku), ` ${i.descricao}`), h('strong', { class: 'item-exp-qtd' }, `${fmt.num(i.qtd)} un`)),
    i.enderecos.length ? h('small', { class: 'muted' }, rotuloEndereco(v), h('span', { class: 'mono' }, i.enderecos.join(', '))) : null, extra);
  const itens = (v) => h('ul', { class: 'itens-exp' }, v.itens.map((i) => linhaItem(v, i)));

  async function confirmar(g, v, etapa, corpo, botao, mensagem) {
    botao.disabled = true;
    try {
      await api.post(`${FONTES[v.origem].api}/${v.id}/etapa`, { etapa, ...corpo });
      leituras.delete(`${v.origem}:${v.id}:${etapa}`); scanner?.fechar();
      feedback('ok', mensagem); toast(mensagem, 'ok');
      await mostrar(g, v.origem, v.id);
    } catch (e) {
      tratar(e); botao.disabled = false;
      if (['JA_FEITA', 'JA_ENVIADO', 'STATUS', 'FORA_DE_ORDEM'].includes(e.code)) await mostrar(g, v.origem, v.id); // outra pessoa mexeu: mostra o estado atual
    }
  }

  /** Separação e conferência: bipa cada produto; o botão só libera quando tudo bate. */
  function leitura(g, v, [etapa, rotulo]) {
    const chave = `${v.origem}:${v.id}:${etapa}`;
    const lido = leituras.get(chave) ?? {}; leituras.set(chave, lido);
    const lista = h('ul', { class: 'itens-exp' });
    const situacaoTxt = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
    const obs = h('input', { type: 'text', maxlength: 300, autocomplete: 'off', placeholder: 'Opcional' });
    const entrada = h('input', { type: 'text', class: 'enorme', autocomplete: 'off', autofocus: true, placeholder: 'Bipe ou digite o código / SKU', 'aria-label': 'Código do produto' });
    const vezes = h('input', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric', class: 'copias', 'aria-label': 'Quantidade por leitura' });
    const botao = h('button', { class: 'btn primario enorme', type: 'button', onclick: () => confirmar(g, v, etapa, { leituras: Object.values(lido), observacao: obs.value.trim() || undefined }, botao, `${rotulo} registrada ✓`) }, icone('check'), `Confirmar ${rotulo.toLowerCase()}`);
    const pintar = (destaque) => {
      let feitas = 0; let total = 0;
      limpar(lista).append(...v.itens.map((i) => {
        const n = lido[i.produto_id]?.qtd ?? 0; feitas += Math.min(n, i.qtd); total += i.qtd;
        const barra = h('div', { class: 'barra', role: 'progressbar', 'aria-valuenow': n, 'aria-valuemin': 0, 'aria-valuemax': i.qtd, 'aria-label': `Lido de ${i.sku}` }, h('span'));
        barra.firstChild.style.setProperty('--p', String(Math.round((Math.min(n, i.qtd) / i.qtd) * 100)));
        const li = linhaItem(v, i, h('div', { class: 'item-exp-progresso' }, barra, h('span', { class: 'mono' }, `${n}/${i.qtd}`), n ? h('button', { class: 'btn pequeno fantasma', type: 'button', 'aria-label': `Zerar leituras de ${i.sku}`, onclick: () => { delete lido[i.produto_id]; pintar(); entrada.focus(); } }, 'Zerar') : null));
        li.classList.toggle('completo', n === i.qtd); li.classList.toggle('acabou-de-ler', destaque === i.produto_id);
        return li;
      }));
      botao.disabled = feitas !== total;
      situacaoTxt.textContent = feitas === total ? 'Tudo lido. Pode confirmar.' : `${feitas} de ${total} unidade(s) lida(s).`;
    };
    /** Devolve a frase do resultado (também mostrada dentro da câmera). */
    const ler = (bruto) => {
      const codigo = limparLeitura(bruto);
      if (!codigo) return '';
      const recusar = (curto, frase) => { feedback('erro', curto); toast(frase, 'erro'); return frase; };
      const item = v.itens.find((i) => i.aceitos.includes(codigo));
      const { deste } = FONTES[v.origem];
      if (!item) return recusar(`Não é ${deste}`, `${codigo} não é de nenhum produto ${deste}.`);
      const n = lido[item.produto_id]?.qtd ?? 0; const soma = Math.max(1, Math.trunc(Number(vezes.value)) || 1);
      if (n + soma > item.qtd) return recusar('Quantidade a mais', n === item.qtd ? `${item.sku}: já está completo.` : `${item.sku}: faltam ${item.qtd - n}, não ${soma}.`);
      lido[item.produto_id] = { codigo, qtd: n + soma }; vezes.value = 1;
      const frase = `${item.sku} ${n + soma}/${item.qtd}`;
      feedback('ok', frase); pintar(item.produto_id);
      return `✓ ${frase}`;
    };
    entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ler(entrada.value); entrada.value = ''; } });
    const camera = navigator.mediaDevices?.getUserMedia ? h('button', { class: 'btn icone com-camera', type: 'button', 'aria-label': 'Ler com a câmera', onclick: async () => {
      const { abrirScanner } = await import('./scanner.js');
      scanner = abrirScanner({ titulo: `${rotulo}: ${FONTES[v.origem].curto(v)}`, continuo: true, exigirSaida: true, semBipe: true, aoLer: (c) => { scanner.avisar(ler(c)); return false; } });
    } }, icone('camera')) : null;
    const mesmaPessoa = etapa === 'CONFERENCIA' ? h('p', { class: 'muted' }, 'Dica: o ideal é conferir quem não separou.') : null;
    pintar();
    setTimeout(() => entrada.focus(), 60);
    return h('section', { class: 'stack leitura-exp', 'aria-label': rotulo }, h('h3', null, `${rotulo}: bipe cada produto`), mesmaPessoa,
      h('div', { class: 'com-linha' }, entrada, camera), h('label', { class: 'row' }, h('span', { class: 'muted' }, 'Quantidade por leitura'), vezes), situacaoTxt, lista, campo('Observação', obs), botao);
  }

  function expedir(g, v) {
    const daLoja = v.origem === 'balcao';
    const obs = h('input', { type: 'text', maxlength: 300, autocomplete: 'off', placeholder: daLoja ? 'Ex.: entregue ao cliente, motoboy, transportadora' : 'Ex.: Mercado Envios, motoboy' });
    const botao = h('button', { class: 'btn primario enorme', type: 'button', onclick: () => confirmar(g, v, 'EXPEDICAO', { observacao: obs.value.trim() || undefined }, botao, FONTES[v.origem].feito(v)) }, icone('send'), daLoja ? 'Marcar como expedida' : 'Expedir e dar baixa');
    return h('section', { class: 'stack' }, h('h3', null, 'Expedir'), daLoja ? null : h('p', { class: 'muted' }, 'Ao expedir, o sistema dá a baixa das peças no estoque. Não dê baixa à mão.'), campo('Como saiu', obs), botao);
  }

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Expedição'), h('p', null, 'Separe, confira bipando e envie. O sistema grava quem fez cada passo.')),
    h('button', { class: 'btn', type: 'button', onclick: () => listar() }, icone('refresh', 18), 'Atualizar')),
    abas([['pendentes', 'Para fazer'], ['expedidas', 'Expedidas']], situacao, (id) => { situacao = id; pagina = 1; listar(); }), chips, alvo);
  // sem destino no endereço: se o balcão não tem nada esperando e a internet tem, abre na internet
  await contar().catch(() => {});
  if (!params.get('venda') && !params.get('pedido') && contagem.balcao === 0 && contagem.internet > 0) origem = 'internet';
  pintarChips();
  await listar();
  if (!alvo.isConnected) return undefined; // saiu da tela enquanto carregava
  for (const [param, de] of [['venda', 'balcao'], ['pedido', 'internet']]) if (/^\d+$/.test(params.get(param) ?? '')) { abrir(de, Number(params.get(param))); break; }
  // fila viva: atualiza sozinha enquanto a tela está visível, sem mexer em quem está com uma venda aberta ou navegando pelo teclado
  const relogio = setInterval(async () => {
    if (document.hidden || aberta || document.querySelector('.overlay') || alvo.contains(document.activeElement) || situacao !== 'pendentes') return;
    const filtro = `${origem}:${situacao}:${pagina}`;
    try { const d = await buscar(); if (!aberta && alvo.isConnected && filtro === `${origem}:${situacao}:${pagina}`) { limpar(alvo).classList.add('sem-entrada'); desenhar(d); } } catch { /* tenta de novo no próximo ciclo */ }
  }, 30_000);
  // as leituras valem só enquanto a pessoa está na tela: quem entrar depois no mesmo aparelho bipa de novo
  return () => { clearInterval(relogio); scanner?.fechar(); leituras.clear(); };
}
