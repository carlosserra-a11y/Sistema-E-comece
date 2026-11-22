// Dados da empresa: razão social, CNPJ, endereço de cobrança, contatos e perfil fiscal. Todo mundo com permissão vê; só quem pode edita.
import { h, limpar, api, carregar, icone, badge, campo, entrada, selecao, gaveta, toast, copiar, vazio, pode } from './core.js';

const CONTRIBUINTE = { CONTRIBUINTE: 'Contribuinte', NAO_CONTRIBUINTE: 'Não contribuinte', ISENTO: 'Isento' };
const APLICACAO = { INDUSTRIALIZACAO: 'Industrialização', INSTALACAO: 'Instalação', REVENDA: 'Revenda', USO_CONSUMO: 'Uso/consumo' };

const fmtCnpj = (v) => (v && v.length === 14 ? `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}` : v);
const fmtCep = (v) => (v && v.length === 8 ? `${v.slice(0, 5)}-${v.slice(5)}` : v);
const fmtFone = (v) => (v && v.length >= 10 ? `(${v.slice(0, 2)}) ${v.slice(2, v.length - 4)}-${v.slice(-4)}` : v);

export async function renderizar(el) {
  const alvo = h('div', { class: 'stack' });
  let dados = null;
  const editar = h('button', { class: 'btn primario', 'data-requer': 'empresa.editar', onclick: () => formulario(dados) }, icone('edit', 18), 'Editar dados');
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Empresa'), h('p', null, 'Cadastro fiscal e contatos usados em cotações e notas fiscais.')), editar), alvo);

  const linha = (rotulo, valor, copia) => h('div', null, h('span', { class: 'muted' }, rotulo),
    h('span', { class: 'row' }, h('strong', { class: 'quebra' }, valor || '—'), copia && valor ? h('button', { class: 'btn pequeno fantasma', type: 'button', 'aria-label': `Copiar ${rotulo}`, onclick: () => copiar(copia) }, icone('clipboard', 16)) : null));
  const cartao = (titulo, ic, ...linhas) => h('section', { class: 'card stack' }, h('h2', { class: 'row' }, icone(ic, 20), titulo), h('div', { class: 'lista' }, ...linhas));
  const contato = (nome, email, tel) => [linha('Nome', nome), linha('E-mail', email, email), linha('Telefone', fmtFone(tel), tel)];

  function desenhar() {
    limpar(alvo);
    if (!dados) { alvo.append(vazio('Nenhum dado cadastrado ainda', 'Cadastre a razão social, o CNPJ e os contatos da empresa.', pode('empresa.editar') ? h('button', { class: 'btn primario', onclick: () => formulario(null) }, 'Cadastrar dados') : null)); return; }
    const d = dados;
    alvo.append(
      h('section', { class: 'card empresa-cab' }, h('img', { src: '/frio-logo.png', alt: d.nome_fantasia || d.razao_social, width: 230, height: 95 }),
        h('div', null, h('h2', null, d.razao_social), d.nome_fantasia && h('p', { class: 'muted' }, d.nome_fantasia),
          h('div', { class: 'chips' }, d.simples_nacional ? badge('Simples Nacional', 'ok') : badge('Fora do Simples', ''), badge(CONTRIBUINTE[d.contribuinte_icms] ?? d.contribuinte_icms, 'info'), badge(`Aplicação: ${APLICACAO[d.aplicacao] ?? d.aplicacao}`, 'aviso')))),
      h('div', { class: 'grid empresa-grade' },
        cartao('Identificação', 'building', linha('CNPJ', fmtCnpj(d.cnpj), d.cnpj), linha('Inscrição estadual', d.inscricao_estadual, d.inscricao_estadual), linha('Inscrição SUFRAMA', d.suframa_numero, d.suframa_numero)),
        cartao('Endereço de cobrança', 'map', linha('Endereço', d.endereco), linha('Cidade', d.cidade && d.uf ? `${d.cidade} – ${d.uf}` : d.cidade), linha('CEP', fmtCep(d.cep), d.cep)),
        cartao('Nota fiscal e compras', 'mail', linha('E-mail para nota fiscal', d.email_nf, d.email_nf), ...contato(d.compras_nome, d.compras_email, d.compras_telefone)),
        cartao('Financeiro e responsável', 'users', ...contato(d.financeiro_nome, d.financeiro_email, d.financeiro_telefone), linha('Responsável', d.responsavel))));
  }

  function formulario(d) {
    const v = (k) => d?.[k] ?? '';
    const t = (k, props = {}) => entrada({ name: k, value: v(k), maxlength: 200, ...props });
    const f = {
      razao_social: t('razao_social', { autofocus: true }), nome_fantasia: t('nome_fantasia'), cnpj: t('cnpj', { inputmode: 'numeric', value: fmtCnpj(v('cnpj')) ?? '' }), inscricao_estadual: t('inscricao_estadual'),
      suframa_numero: t('suframa_numero', { inputmode: 'numeric' }), endereco: t('endereco'), cidade: t('cidade'), uf: t('uf', { maxlength: 2 }), cep: t('cep', { inputmode: 'numeric', value: fmtCep(v('cep')) ?? '' }),
      email_nf: t('email_nf', { inputmode: 'email', autocapitalize: 'none' }),
      compras_nome: t('compras_nome'), compras_email: t('compras_email', { inputmode: 'email', autocapitalize: 'none' }), compras_telefone: t('compras_telefone', { inputmode: 'tel', value: fmtFone(v('compras_telefone')) ?? '' }),
      financeiro_nome: t('financeiro_nome'), financeiro_email: t('financeiro_email', { inputmode: 'email', autocapitalize: 'none' }), financeiro_telefone: t('financeiro_telefone', { inputmode: 'tel', value: fmtFone(v('financeiro_telefone')) ?? '' }),
      responsavel: t('responsavel'),
    };
    const simples = h('input', { type: 'checkbox', checked: d ? !!d.simples_nacional : true });
    const icms = selecao(Object.entries(CONTRIBUINTE), d?.contribuinte_icms ?? 'CONTRIBUINTE');
    const aplic = selecao(Object.entries(APLICACAO), d?.aplicacao ?? 'REVENDA');
    const erro = h('p', { class: 'erro', role: 'alert' });
    let g;
    const grupo = (titulo, ...filhos) => h('fieldset', { class: 'permissoes' }, h('legend', null, titulo), ...filhos);
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      const corpo = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value]));
      Object.assign(corpo, { simples_nacional: simples.checked, contribuinte_icms: icms.value, aplicacao: aplic.value });
      try { const r = await api.put('/api/empresa', corpo); dados = r.empresa; g.fechar(); desenhar(); toast('Dados da empresa salvos.', 'ok'); }
      catch (x) { erro.textContent = x.campos ? Object.entries(x.campos).map(([k, m]) => `${k}: ${m}`).join(' · ') : x.message; }
    } },
    grupo('Identificação', campo('Razão social', f.razao_social), campo('Nome fantasia', f.nome_fantasia), campo('CNPJ', f.cnpj), campo('Inscrição estadual', f.inscricao_estadual), campo('Inscrição SUFRAMA (se houver)', f.suframa_numero)),
    grupo('Endereço de cobrança', campo('Endereço', f.endereco), campo('Cidade', f.cidade), campo('UF', f.uf), campo('CEP', f.cep)),
    grupo('Nota fiscal e compras', campo('E-mail para nota fiscal', f.email_nf), campo('Contato de compras', f.compras_nome), campo('E-mail (compras)', f.compras_email), campo('Telefone (compras)', f.compras_telefone)),
    grupo('Financeiro e responsável', campo('Contato financeiro', f.financeiro_nome), campo('E-mail (financeiro)', f.financeiro_email), campo('Telefone (financeiro)', f.financeiro_telefone), campo('Responsável', f.responsavel)),
    grupo('Perfil fiscal', h('label', { class: 'check' }, simples, 'Optante pelo Simples Nacional'), campo('Contribuinte de ICMS', icms), campo('Aplicação do material', aplic)),
    erro, h('div', { class: 'row' }, h('button', { class: 'btn primario', type: 'submit' }, 'Salvar'), h('button', { class: 'btn', type: 'button', onclick: () => g.fechar() }, 'Cancelar')));
    g = gaveta('Dados da empresa', form);
  }

  await carregar(alvo, async () => { const r = await api.get('/api/empresa'); dados = r.empresa; return r; }, () => desenhar());
}
