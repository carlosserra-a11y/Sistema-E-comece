import { h, api, carregar, icone, tratar, toast, tabela, paginacao, gaveta, vazio, badge, qs, ApiError } from './core.js';
import { formulario } from './form.js';

const CAMPOS = [['nome', 'Nome', 'texto', { max: 160 }], ['documento', 'CNPJ / CPF', 'texto', { max: 20, inputmode: 'numeric', ajuda: 'Guardado criptografado; a lista mostra só os 2 últimos dígitos.' }],
  ['contato', 'Contato', 'texto', { max: 120 }], ['email', 'E-mail', 'texto', { max: 160 }], ['telefone', 'Telefone', 'texto', { max: 30 }], ['prazo_dias', 'Prazo de entrega (dias)', 'int'], ['observacoes', 'Observações', 'area', { max: 1000 }]];

export async function renderizar(el) {
  let q = ''; let ativo = '1'; let pagina = 1; const alvo = h('div');
  const busca = h('input', { type: 'search', placeholder: 'Buscar fornecedor', 'aria-label': 'Buscar fornecedor' });
  let t; busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = busca.value; pagina = 1; ler(); }, 250); });
  const chk = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { ativo = e.target.checked ? '0' : '1'; pagina = 1; ler(); } }), 'Mostrar inativos');
  const ler = () => carregar(alvo, () => api.get(`/api/fornecedores?${qs({ q, ativo, pagina, por_pagina: 25 })}`), (d) => alvo.append(d.total ? tabela([
    { titulo: 'Nome', render: (x) => h('strong', null, x.nome) }, { titulo: 'Documento', render: (x) => h('span', { class: 'mono' }, x.documento_mascarado ?? '—') }, { titulo: 'Contato', render: (x) => x.contato ?? x.email ?? '—' }, { titulo: 'Prazo', num: true, render: (x) => `${x.prazo_dias} d` },
    { titulo: 'Situação', render: (x) => (x.ativo ? badge('ativo', 'ok') : badge('inativo', 'erro')) }], d.itens, { aoClicar: (x) => editar(x) }) : vazio('Nenhum fornecedor', 'Cadastre quem entrega para você.'), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; ler(); })));
  function editar(f) {
    let g;
    const fm = formulario(CAMPOS, { ...f, documento: '' }, async (v) => {
      try { if (f) await api.put(`/api/fornecedores/${f.id}`, { ...v, versao: f.versao }); else await api.post('/api/fornecedores', v); g.fechar(); toast('Salvo.', 'ok'); ler(); } catch (e) { if (e instanceof ApiError && e.campos) fm.erros(e.campos); tratar(e); }
    }, { perm: 'fornecedores.editar' });
    g = gaveta(f ? f.nome : 'Novo fornecedor', [f?.documento_mascarado ? h('p', { class: 'muted' }, `Documento atual: ${f.documento_mascarado}. Deixe em branco para manter; digite um novo para trocar.`) : null, fm.el,
      f ? h('button', { class: `btn ${f.ativo ? 'perigo' : ''}`, 'data-requer': 'fornecedores.editar', onclick: async () => { try { await api.post(`/api/fornecedores/${f.id}/${f.ativo ? 'inativar' : 'reativar'}`); g.fechar(); ler(); } catch (e) { tratar(e); } } }, f.ativo ? 'Inativar' : 'Reativar') : null]);
  }
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Fornecedores')), h('button', { class: 'btn primario', 'data-requer': 'fornecedores.editar', 'data-novo': true, onclick: () => editar(null) }, icone('plus'), 'Novo fornecedor')), h('div', { class: 'row' }, h('div', { class: 'grow' }, busca), chk), alvo);
  ler();
}
