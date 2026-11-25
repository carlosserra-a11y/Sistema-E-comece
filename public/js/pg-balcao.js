// Balcão (venda presencial): casca com as abas. Cada aba mora no seu arquivo (balcao-*.js).
import { h, limpar, api, abas, pode, carregar } from './core.js';
import { abaVender } from './balcao-venda.js';
import { abaLista } from './balcao-vendas.js';
import { abaCaixa } from './balcao-caixa.js';
import { abaRelatorios, abaServicos, abaAjustes } from './balcao-gestao.js';

const ABAS = [
  ['vender', 'Vender', 'vendas.registrar'],
  ['vendas', 'Vendas', 'vendas.registrar,vendas.gerenciar,vendas.cancelar'],
  ['orcamentos', 'Orçamentos', 'vendas.registrar'],
  ['caixa', 'Caixa', 'vendas.registrar,vendas.gerenciar'],
  ['relatorios', 'Relatórios', 'vendas.gerenciar'],
  ['servicos', 'Serviços', 'servicos.editar'],
  ['ajustes', 'Ajustes', 'vendas.configurar'],
];

export async function renderizar(el, { params, sessao }) {
  const painel = h('div', { class: 'stack' });
  const raiz = h('div', { class: 'stack' });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Balcão'), h('p', null, 'Venda presencial: bipe, receba e entregue.'))), raiz);
  let sair = null; let geracao = 0;

  await carregar(raiz, () => (pode('vendas.registrar,vendas.gerenciar,vendas.configurar') ? api.get('/api/balcao/config') : Promise.resolve({ desconto_max_pct: 0 })), (config) => {
    const liberadas = ABAS.filter(([, , perm]) => pode(perm)).map(([id]) => id);
    const inicial = liberadas.includes(params.get('aba')) ? params.get('aba') : liberadas[0];
    const montar = { vender: abaVender, vendas: (e, o) => abaLista(e, { ...o, orcamentos: false }), orcamentos: (e, o) => abaLista(e, { ...o, orcamentos: true }), caixa: abaCaixa, relatorios: abaRelatorios, servicos: abaServicos, ajustes: abaAjustes };
    const trocar = async (id) => {
      const g = ++geracao;
      sair?.(); sair = null;
      const area = h('div', { class: 'stack' });
      limpar(painel).append(area);
      const desfazer = await montar[id](area, { config, sessao });
      if (g === geracao) sair = desfazer ?? null; else desfazer?.(); // trocou de aba enquanto esta ainda carregava
    };
    raiz.append(abas(ABAS, inicial, trocar), painel);
    trocar(inicial);
  });
  return () => { geracao++; sair?.(); };
}
