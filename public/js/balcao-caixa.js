// Aba "Caixa": abrir, suprimento, sangria, fechar com conferência e (para quem gerencia) os caixas de todos.
import { h, limpar, api, carregar, pode, fmt, badge, tratar, toast, tabela, paginacao, gaveta, vazio } from './core.js';
import { pedirDados } from './balcao-pagamento.js';
import { FORMA } from './balcao-cupom.js';

const MOV = { SUPRIMENTO: ['Suprimento', 'ok'], SANGRIA: ['Sangria', 'aviso'], ESTORNO: ['Devolução', 'erro'] };
const linha = (r, v) => h('div', null, h('span', { class: 'muted' }, r), h('strong', null, v));

function resumo(c) {
  const r = c.resumo;
  return h('div', { class: 'stack' },
    h('div', { class: 'lista' }, linha('Aberto por', c.aberto_por_nome ?? '—'), linha('Aberto em', fmt.dataHora(c.aberto_em)), linha('Dinheiro na abertura', fmt.moeda(r.abertura_centavos)), linha('Vendas', fmt.num(r.vendas)),
      !c.cego && [linha('Total vendido', fmt.moeda(r.vendido_centavos)), Object.entries(r.por_forma).map(([f, v]) => linha(FORMA[f], fmt.moeda(v))),
        linha('Suprimentos', fmt.moeda(r.suprimentos_centavos)), linha('Sangrias', fmt.moeda(r.sangrias_centavos)), r.estornos_centavos > 0 && linha('Devoluções em dinheiro', fmt.moeda(r.estornos_centavos)),
        linha('Dinheiro que deve estar na gaveta', fmt.moeda(r.esperado_centavos))],
      c.status === 'FECHADO' && [linha('Fechado por', c.fechado_por_nome ?? '—'), linha('Fechado em', fmt.dataHora(c.fechado_em)), linha('Dinheiro contado', fmt.moeda(c.contado_centavos)),
        h('div', null, h('span', { class: 'muted' }, 'Diferença'), c.diferenca_centavos === 0 ? badge('Confere', 'ok') : badge(`${c.diferenca_centavos > 0 ? 'Sobrou' : 'Faltou'} ${fmt.moeda(Math.abs(c.diferenca_centavos))}`, 'erro'))],
      c.observacao && linha('Observação', c.observacao)),
    c.cego && h('p', { class: 'muted' }, 'Conferência cega: o valor esperado aparece depois que você contar o dinheiro e fechar.'),
    c.movimentos.length ? tabela([{ titulo: 'Quando', render: (m) => fmt.hora(m.ts) }, { titulo: 'Tipo', render: (m) => badge(...MOV[m.tipo]) }, { titulo: 'Motivo', render: (m) => h('span', { class: 'quebra' }, m.motivo) }, { titulo: 'Valor', num: true, render: (m) => fmt.moeda(m.valor_centavos) }], c.movimentos, { compacta: true }) : null);
}

export function abaCaixa(el) {
  const meu = h('div'); const todos = h('div'); let pagina = 1;
  const recarregar = () => { lerMeu(); if (pode('vendas.gerenciar')) lerTodos(); };

  function fechar(caixaId, depois) {
    pedirDados('Fechar caixa', 'Conte TODO o dinheiro da gaveta (incluindo o troco) e informe o valor. Se não bater, explique na observação.', [['contado_centavos', 'Dinheiro contado (R$)', 'moeda'], ['observacao', 'Observação (obrigatória se houver diferença)', 'texto']], 'Fechar caixa', async (d, chave) => {
      const r = await api.idem(`/api/caixas/${caixaId}/fechar`, { ...d, observacao: d.observacao || undefined }, chave);
      toast(r.diferenca_centavos === 0 ? 'Caixa fechado: tudo conferiu.' : `Caixa fechado com ${r.diferenca_centavos > 0 ? 'sobra' : 'falta'} de ${fmt.moeda(Math.abs(r.diferenca_centavos))}.`, r.diferenca_centavos === 0 ? 'ok' : 'aviso', 8000);
      depois?.(); recarregar();
    });
  }
  const movimento = (tipo) => pedirDados(tipo === 'SANGRIA' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar dinheiro)', tipo === 'SANGRIA' ? 'Registre todo dinheiro que sair da gaveta que não seja troco de venda.' : 'Registre todo dinheiro colocado na gaveta durante o dia.', [['valor_centavos', 'Valor (R$)', 'moeda'], ['motivo', 'Motivo', 'texto']], 'Registrar', async (d, chave) => {
    await api.idem('/api/caixa/movimento', { tipo, ...d }, chave); toast('Registrado.', 'ok'); recarregar();
  });

  const lerMeu = () => (pode('vendas.registrar,vendas.cancelar') ? carregar(meu, () => api.get('/api/caixa'), ({ caixa }) => meu.append(h('section', { class: 'card stack' }, h('h2', null, 'Meu caixa'), caixa ? [resumo(caixa),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => movimento('SUPRIMENTO') }, 'Suprimento'), h('button', { class: 'btn', type: 'button', onclick: () => movimento('SANGRIA') }, 'Sangria'), h('button', { class: 'btn primario', type: 'button', onclick: () => fechar(caixa.id) }, 'Fechar caixa'))]
    : vazio('Caixa fechado', 'Abra o caixa para começar a vender.', h('button', { class: 'btn primario', type: 'button', onclick: () => pedirDados('Abrir caixa', 'Conte o dinheiro de troco que está na gaveta agora (pode ser zero).', [['abertura_centavos', 'Dinheiro na gaveta (R$)', 'moeda', '0,00']], 'Abrir caixa', async (d, chave) => { await api.idem('/api/caixa/abrir', d, chave); toast('Caixa aberto.', 'ok'); recarregar(); }) }, 'Abrir caixa'))))) : null);

  async function ver(id) {
    let c;
    try { c = await api.get(`/api/caixas/${id}`); } catch (e) { return tratar(e); }
    let g;
    g = gaveta(`Caixa nº ${c.id}`, [resumo(c), c.status === 'ABERTO' ? h('button', { class: 'btn primario', type: 'button', onclick: () => fechar(c.id, () => g.fechar()) }, 'Fechar este caixa') : null]);
  }
  const lerTodos = () => carregar(todos, () => api.get(`/api/caixas?pagina=${pagina}`), (d) => todos.append(h('section', { class: 'card stack' }, h('h2', null, 'Todos os caixas'), tabela([
    { titulo: 'Nº', num: true, chave: 'id' }, { titulo: 'Pessoa', chave: 'aberto_por_nome' }, { titulo: 'Abertura', render: (x) => fmt.dataHora(x.aberto_em) }, { titulo: 'Fechamento', render: (x) => fmt.dataHora(x.fechado_em) },
    { titulo: 'Situação', render: (x) => (x.status === 'ABERTO' ? badge('Aberto', 'info') : x.contado_centavos === x.esperado_centavos ? badge('Conferiu', 'ok') : badge(`Diferença ${fmt.moeda(x.contado_centavos - x.esperado_centavos)}`, 'erro')) },
  ], d.itens, { aoClicar: (x) => ver(x.id), vazioMsg: 'Nenhum caixa ainda.' }), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; lerTodos(); }))));

  el.append(meu, todos);
  recarregar();
  return () => limpar(meu);
}
