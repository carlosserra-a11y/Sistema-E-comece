// Abas "Vendas" e "Orçamentos": histórico, detalhe, reimpressão, cancelamento e conclusão de orçamento.
import { h, limpar, api, carregar, pode, icone, fmt, badge, qs, tratar, toast, tabela, paginacao, gaveta, vazio, confirmar, modal, debounce } from './core.js';
import { abrirPagamento, pedirDados } from './balcao-pagamento.js';
import { FORMA, SITUACAO, abrirCupom, botoesCupom } from './balcao-cupom.js';

export function abaLista(el, { config, orcamentos }) {
  let q = ''; let de = ''; let ate = ''; let status = orcamentos ? 'ORCAMENTO' : ''; let pagina = 1;
  const alvo = h('div');
  const ler = () => carregar(alvo, () => api.get(`/api/vendas?${qs({ q, de, ate, status, pagina, por_pagina: 25 })}`), (d) => alvo.append(d.total ? tabela([
    { titulo: 'Nº', num: true, chave: 'id' },
    { titulo: 'Quando', render: (v) => fmt.dataHora(v.concluida_em ?? v.criado_em) },
    { titulo: 'Cliente', render: (v) => v.cliente_nome ?? '—' },
    { titulo: 'Atendente', render: (v) => v.vendedor_nome },
    { titulo: orcamentos ? 'Válido até' : 'Itens', render: (v) => (orcamentos ? fmt.data(v.validade) : fmt.num(v.unidades)) },
    { titulo: 'Total', num: true, render: (v) => h('strong', null, fmt.moeda(v.valor_centavos)) },
    { titulo: 'Situação', render: (v) => badge(...SITUACAO[v.status]) },
  ], d.itens, { aoClicar: (v) => detalhe(v.id) }) : vazio(orcamentos ? 'Nenhum orçamento em aberto' : 'Nenhuma venda', orcamentos ? 'Monte o carrinho na aba Vender e toque em "Salvar como orçamento".' : 'As vendas concluídas aparecem aqui.'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));

  async function detalhe(id) {
    let v;
    try { v = await api.get(`/api/vendas/${id}`); } catch (e) { return tratar(e); }
    let g;
    const atualizar = () => { g.fechar(); ler(); };
    const linha = (r, x) => h('div', null, h('span', { class: 'muted' }, r), h('strong', null, x));
    const acoes = [];
    if (v.status === 'ORCAMENTO' && pode('vendas.registrar')) {
      acoes.push(h('button', { class: 'btn primario', type: 'button', onclick: () => concluir(v, atualizar) }, 'Receber e concluir'),
        h('button', { class: 'btn perigo', type: 'button', onclick: async () => { if (!await confirmar('Descartar orçamento?', 'Ele sai da lista de orçamentos em aberto.', { perigo: true, rotulo: 'Descartar' })) return; try { await api.post(`/api/vendas/${v.id}/descartar`); toast('Orçamento descartado.', 'ok'); atualizar(); } catch (e) { tratar(e); } } }, 'Descartar'));
    }
    if (v.status === 'CONCLUIDA' && pode('vendas.cancelar')) acoes.push(h('button', { class: 'btn perigo', type: 'button', onclick: () => cancelar(v, atualizar) }, 'Cancelar venda'));
    g = gaveta(`${v.status === 'ORCAMENTO' || v.status === 'DESCARTADA' ? 'Orçamento' : 'Venda'} nº ${v.id}`, [
      h('div', { class: 'chips' }, badge(...SITUACAO[v.status])),
      h('div', { class: 'lista' }, linha('Quando', fmt.dataHora(v.concluida_em ?? v.criado_em)), linha('Atendente', v.vendedor_nome), linha('Cliente', v.cliente_nome ?? '—'),
        v.status === 'ORCAMENTO' && linha('Válido até', fmt.data(v.validade)),
        v.status === 'CANCELADA' && [linha('Cancelada em', fmt.dataHora(v.cancelada_em)), linha('Por', v.cancelada_por_nome ?? '—'), linha('Motivo', v.motivo_cancelamento)]),
      tabela([{ titulo: 'Item', render: (i) => h('span', { class: 'quebra' }, i.descricao) }, { titulo: 'Qtd', num: true, chave: 'qtd' }, { titulo: 'Unitário', num: true, render: (i) => fmt.moeda(i.preco_unit_centavos) }, { titulo: 'Valor', num: true, render: (i) => fmt.moeda(i.valor_centavos) }], v.itens, { compacta: true }),
      h('div', { class: 'lista' }, v.desconto_centavos > 0 && linha('Desconto', fmt.moeda(v.desconto_centavos)), linha('Total', fmt.moeda(v.valor_centavos)),
        v.pagamentos.map((p) => linha(`${FORMA[p.forma]}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}`, fmt.moeda(p.valor_centavos))), v.troco_centavos > 0 && linha('Troco dado', fmt.moeda(v.troco_centavos))),
      botoesCupom(v), acoes.length ? h('div', { class: 'row' }, acoes) : null,
    ]);
  }

  function concluir(v, atualizar) {
    let envio = null;
    abrirPagamento({
      total: v.valor_centavos, pixAtivo: config.pix_ativo,
      envio: { get dados() { return envio; }, gravar: (d) => { envio = d; } },
      enviar: (pagamentos, chave) => api.idem(`/api/vendas/${v.id}/concluir`, { pagamentos }, chave),
      aoConcluir: (r) => { atualizar(); abrirCupom(r.id); },
    });
  }

  function cancelar(v, atualizar) {
    pedirDados(`Cancelar a venda nº ${v.id}?`, 'O estoque volta para os mesmos endereços e a venda sai dos totais. Pede a sua senha.', [['motivo', 'Motivo do cancelamento', 'texto']], 'Cancelar venda', async (d, chave) => {
      const r = await api.idem(`/api/vendas/${v.id}/cancelar`, d, chave);
      atualizar();
      let m;
      m = modal('Venda cancelada', h('div', { class: 'stack' },
        r.devolver_dinheiro_centavos > 0 && h('p', { class: 'troco' }, `Devolva ${fmt.moeda(r.devolver_dinheiro_centavos)} em dinheiro.`),
        r.estornar_fora.map((p) => h('p', { class: 'aviso-txt' }, `Estorne ${fmt.moeda(p.valor_centavos)} (${FORMA[p.forma]}) na maquininha ou no banco: o sistema não faz isso.`)),
        r.devolver.length ? h('div', null, h('p', null, 'Guarde os itens de volta:'), h('ul', null, r.devolver.map((i) => h('li', null, `${i.qtd} × ${i.sku} em `, h('strong', { class: 'mono' }, i.endereco))))) : null,
        h('button', { class: 'btn primario', type: 'button', autofocus: true, onclick: () => m.fechar() }, 'Entendi')));
    });
  }

  const busca = h('input', { type: 'search', placeholder: 'Número ou nome do cliente', 'aria-label': 'Buscar venda' });
  busca.addEventListener('input', debounce(() => { q = busca.value.trim(); pagina = 1; ler(); }, 300));
  const data = (rotulo, aoMudar) => h('label', { class: 'campo-data' }, h('span', { class: 'muted' }, rotulo), h('input', { type: 'date', onchange: (e) => { aoMudar(e.target.value); pagina = 1; ler(); } }));
  const canceladas = orcamentos ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { status = e.target.checked ? 'CANCELADA' : ''; pagina = 1; ler(); } }), 'Só canceladas');
  el.append(h('div', { class: 'row filtros' }, h('div', { class: 'grow' }, busca), data('De', (x) => { de = x; }), data('Até', (x) => { ate = x; }), canceladas,
    h('button', { class: 'btn icone', type: 'button', 'aria-label': 'Atualizar lista', onclick: ler }, icone('refresh', 18))), alvo);
  ler();
  return () => limpar(alvo);
}
