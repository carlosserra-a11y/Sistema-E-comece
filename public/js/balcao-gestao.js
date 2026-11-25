// Abas "Relatórios", "Serviços" e "Ajustes" do balcão.
import { h, api, ApiError, carregar, icone, fmt, badge, qs, tratar, toast, tabela, gaveta, vazio } from './core.js';
import { formulario } from './form.js';
import { FORMA } from './balcao-cupom.js';
import { mostrarPix } from './balcao-pagamento.js';

const diaDe = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms));
const kpi = (rotulo, valor, nota) => h('section', { class: 'card kpi', 'aria-label': rotulo }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), nota && h('div', { class: 'nota' }, nota));
const bloco = (titulo, colunas, linhas) => h('section', { class: 'card w6' }, h('h2', null, titulo), tabela(colunas, linhas, { compacta: true, vazioMsg: 'Sem vendas no período.' }));

export function abaRelatorios(el) {
  let de = diaDe(Date.now()); let ate = de;
  const alvo = h('div');
  const link = h('a', { class: 'btn', download: '' }, icone('download', 18), 'Baixar planilha');
  const iDe = h('input', { type: 'date', value: de, onchange: (e) => { de = e.target.value || diaDe(Date.now()); if (ate < de) { ate = de; iAte.value = ate; } ler(); } });
  const iAte = h('input', { type: 'date', value: ate, onchange: (e) => { ate = e.target.value || de; if (ate < de) { de = ate; iDe.value = de; } ler(); } });
  const atalho = (rotulo, dias) => h('button', { class: 'chip', type: 'button', onclick: () => { ate = diaDe(Date.now()); de = diaDe(Date.now() - dias * 86_400_000); iDe.value = de; iAte.value = ate; ler(); } }, rotulo);
  const ler = () => {
    link.setAttribute('href', `/api/relatorios/vendas.csv?${qs({ de, ate })}`);
    return carregar(alvo, () => api.get(`/api/relatorios/vendas?${qs({ de, ate })}`), (d) => alvo.append(h('div', { class: 'grid bento' },
      kpi('Vendido', fmt.moeda(d.valor_centavos), `${fmt.num(d.vendas)} venda(s)`),
      kpi('Ticket médio', fmt.moeda(d.ticket_medio_centavos)),
      kpi('Descontos', fmt.moeda(d.desconto_centavos), `${d.canceladas.qtd} cancelada(s): ${fmt.moeda(d.canceladas.valor_centavos)}`),
      d.margem_centavos === undefined ? kpi('Subtotal', fmt.moeda(d.subtotal_centavos)) : kpi('Margem estimada', fmt.moeda(d.margem_centavos), `custo ${fmt.moeda(d.custo_total_centavos)}`),
      bloco('Por forma de pagamento', [{ titulo: 'Forma', render: (x) => FORMA[x.forma] }, { titulo: 'Vendas', num: true, chave: 'vendas' }, { titulo: 'Valor', num: true, render: (x) => fmt.moeda(x.valor_centavos) }], d.por_forma),
      bloco('Por atendente', [{ titulo: 'Atendente', chave: 'nome' }, { titulo: 'Vendas', num: true, chave: 'vendas' }, { titulo: 'Valor', num: true, render: (x) => fmt.moeda(x.valor_centavos) }], d.por_vendedor),
      bloco('Mais vendidos', [{ titulo: 'Item', render: (x) => h('span', { class: 'quebra' }, x.descricao) }, { titulo: 'Qtd', num: true, chave: 'qtd' }, { titulo: 'Valor (sem desconto)', num: true, render: (x) => fmt.moeda(x.valor_centavos) }], d.mais_vendidos),
      bloco('Por dia', [{ titulo: 'Dia', render: (x) => fmt.data(x.dia) }, { titulo: 'Vendas', num: true, chave: 'vendas' }, { titulo: 'Valor', num: true, render: (x) => fmt.moeda(x.valor_centavos) }], d.por_dia))));
  };
  el.append(h('div', { class: 'row filtros' }, h('label', { class: 'campo-data' }, h('span', { class: 'muted' }, 'De'), iDe), h('label', { class: 'campo-data' }, h('span', { class: 'muted' }, 'Até'), iAte),
    h('div', { class: 'chips' }, atalho('Hoje', 0), atalho('7 dias', 6), atalho('30 dias', 29)), h('span', { class: 'grow' }), link), alvo);
  ler();
}

const CAMPOS_SERVICO = [['nome', 'Nome do serviço', 'texto', { max: 160 }], ['valor_centavos', 'Preço (R$)', 'moeda']];

export function abaServicos(el) {
  let ativo = '1'; const alvo = h('div');
  const ler = () => carregar(alvo, () => api.get(`/api/servicos?ativo=${ativo}`), (d) => alvo.append(d.itens.length ? tabela([
    { titulo: 'Serviço', render: (s) => h('strong', null, s.nome) }, { titulo: 'Preço', num: true, render: (s) => fmt.moeda(s.valor_centavos) }, { titulo: 'Situação', render: (s) => (s.ativo ? badge('ativo', 'ok') : badge('inativo', 'erro')) },
  ], d.itens, { aoClicar: editar }) : vazio('Nenhum serviço', 'Cadastre mão de obra, instalação, carga de gás… para vender junto com as peças.')));
  function editar(s) {
    let g;
    const f = formulario(CAMPOS_SERVICO, s ?? {}, async (v) => {
      try { if (s) await api.put(`/api/servicos/${s.id}`, { ...v, versao: s.versao }); else await api.post('/api/servicos', v); g.fechar(); toast('Salvo.', 'ok'); ler(); }
      catch (e) { if (e instanceof ApiError && e.campos) f.erros(e.campos); tratar(e); }
    });
    g = gaveta(s ? s.nome : 'Novo serviço', [f.el, s ? h('button', { class: `btn ${s.ativo ? 'perigo' : ''}`, type: 'button', onclick: async () => { try { await api.post(`/api/servicos/${s.id}/${s.ativo ? 'inativar' : 'reativar'}`); g.fechar(); ler(); } catch (e) { tratar(e); } } }, s.ativo ? 'Inativar' : 'Reativar') : null]);
  }
  el.append(h('div', { class: 'row' }, h('button', { class: 'btn primario', type: 'button', 'data-novo': true, onclick: () => editar(null) }, icone('plus'), 'Novo serviço'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { ativo = e.target.checked ? '0' : '1'; ler(); } }), 'Mostrar inativos')), alvo);
  ler();
}

const CAMPOS_CONFIG = [
  ['pix_chave', 'Chave Pix da loja', 'texto', { max: 80, ajuda: 'CPF, CNPJ, e-mail, telefone com +55 ou chave aleatória. Deixe em branco para desligar o Pix.' }],
  ['pix_nome', 'Nome de quem recebe', 'texto', { max: 60, ajuda: 'Aparece no QR Code (até 25 letras, sem acento).' }],
  ['pix_cidade', 'Cidade de quem recebe', 'texto', { max: 40 }],
  ['desconto_max_pct', 'Desconto máximo do vendedor (%)', 'int', { ajuda: '0 = vendedor não dá desconto. Quem tem a permissão de desconto não tem limite.' }],
  ['validade_orcamento_dias', 'Validade do orçamento (dias)', 'int', { ajuda: 'De 1 a 90.' }],
  ['cupom_rodape', 'Mensagem no fim do cupom', 'texto', { max: 200, ajuda: 'Ex.: telefone, horário, prazo de troca.' }],
];

export function abaAjustes(el, { config }) {
  const f = formulario(CAMPOS_CONFIG, config, async (v) => {
    try {
      Object.assign(config, { pix_chave: null, pix_nome: null, pix_cidade: null, cupom_rodape: null }, await api.put('/api/balcao/config', v));
      f.erros({}); toast('Ajustes salvos.', 'ok');
    } catch (e) { if (e instanceof ApiError && e.campos) f.erros(e.campos); tratar(e); }
  });
  const teste = h('button', { class: 'btn', type: 'button', onclick: () => mostrarPix(1, { rotuloVoltar: 'Fechar', aviso: 'Teste com R$ 0,01: leia com o app do banco e confira o nome do recebedor. Não precisa pagar.' }) }, 'Testar o QR do Pix (salve antes)');
  el.append(h('section', { class: 'card stack' }, h('h2', null, 'Ajustes do balcão'), h('p', { class: 'muted' }, 'Só o dono vê esta aba. Salvar pede a sua senha, porque a chave Pix define para onde vai o dinheiro.'), f.el, teste));
}
