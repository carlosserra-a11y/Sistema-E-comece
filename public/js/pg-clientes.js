// Clientes: cadastro simples usado no balcão e no orçamento.
import { h, api, carregar, icone, tratar, toast, tabela, paginacao, gaveta, vazio, badge, qs, fmt, ApiError, debounce, pode } from './core.js';
import { formulario } from './form.js';
import { SITUACAO, abrirCupom } from './balcao-cupom.js';

export const CAMPOS_CLIENTE = [['nome', 'Nome ou razão social', 'texto', { max: 160 }], ['telefone', 'Telefone / WhatsApp (com DDD)', 'texto', { max: 30, inputmode: 'tel' }],
  ['documento', 'CPF / CNPJ (opcional)', 'texto', { max: 20, inputmode: 'numeric', ajuda: 'Guardado criptografado; a lista mostra só os 2 últimos dígitos.' }],
  ['email', 'E-mail', 'texto', { max: 160 }], ['endereco', 'Endereço', 'texto', { max: 200 }], ['observacoes', 'Observações', 'area', { max: 1000 }]];

export async function renderizar(el) {
  let q = ''; let ativo = '1'; let pagina = 1; const alvo = h('div');
  const busca = h('input', { type: 'search', placeholder: 'Nome, telefone ou CPF/CNPJ completo', 'aria-label': 'Buscar cliente' });
  busca.addEventListener('input', debounce(() => { q = busca.value; pagina = 1; ler(); }, 300));
  const chk = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { ativo = e.target.checked ? '0' : '1'; pagina = 1; ler(); } }), 'Mostrar inativos');
  const ler = () => carregar(alvo, () => api.get(`/api/clientes?${qs({ q, ativo, pagina, por_pagina: 25 })}`), (d) => alvo.append(d.total ? tabela([
    { titulo: 'Nome', render: (x) => h('strong', null, x.nome) }, { titulo: 'Telefone', render: (x) => x.telefone ?? '—' }, { titulo: 'Documento', render: (x) => h('span', { class: 'mono' }, x.documento_mascarado ?? '—') },
    { titulo: 'Situação', render: (x) => (x.ativo ? badge('ativo', 'ok') : badge('inativo', 'erro')) }], d.itens, { aoClicar: (x) => abrir(x.id) }) : vazio('Nenhum cliente', 'Cadastre aqui ou direto na tela de venda.'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));

  async function abrir(id) {
    try { editar(await api.get(`/api/clientes/${id}`)); } catch (e) { tratar(e); }
  }
  function editar(c) {
    let g;
    const f = formulario(CAMPOS_CLIENTE, { ...c, documento: '' }, async (v) => {
      try { if (c) await api.put(`/api/clientes/${c.id}`, { ...v, versao: c.versao }); else await api.post('/api/clientes', v); g.fechar(); toast('Salvo.', 'ok'); ler(); }
      catch (e) { if (e instanceof ApiError && e.campos) f.erros(e.campos); tratar(e); }
    }, { perm: 'clientes.editar' });
    const compras = c?.compras?.length ? h('div', { class: 'stack' }, h('h3', null, 'Últimas compras e orçamentos'), tabela([
      { titulo: 'Nº', num: true, chave: 'id' }, { titulo: 'Quando', render: (v) => fmt.dataHora(v.concluida_em ?? v.criado_em) }, { titulo: 'Total', num: true, render: (v) => fmt.moeda(v.valor_centavos) }, { titulo: 'Situação', render: (v) => badge(...SITUACAO[v.status]) },
    ], c.compras, { compacta: true, aoClicar: (v) => abrirCupom(v.id) })) : null;
    g = gaveta(c ? c.nome : 'Novo cliente', [c?.documento_mascarado ? h('p', { class: 'muted' }, `Documento atual: ${c.documento_mascarado}. Deixe em branco para manter; digite um novo para trocar.`) : null, f.el,
      c && pode('clientes.editar') ? h('button', { class: `btn ${c.ativo ? 'perigo' : ''}`, type: 'button', onclick: async () => { try { await api.post(`/api/clientes/${c.id}/${c.ativo ? 'inativar' : 'reativar'}`); g.fechar(); ler(); } catch (e) { tratar(e); } } }, c.ativo ? 'Inativar' : 'Reativar') : null,
      compras]);
  }
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Clientes')), h('button', { class: 'btn primario', 'data-requer': 'clientes.editar', 'data-novo': true, onclick: () => editar(null) }, icone('plus'), 'Novo cliente')), h('div', { class: 'row' }, h('div', { class: 'grow' }, busca), chk), alvo);
  ler();
}
