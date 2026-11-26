// Galeria de componentes (/#/design): valida o design system em todos os temas.
import { h, icone, badge, toast, modal, gaveta, tabela, abas, vazio, esqueleto, feedback, campo, combobox, confirmar } from './core.js';
import { sparkline } from './painel-blocos.js';

export async function renderizar(el) {
  const sec = (t, ...f) => h('section', { class: 'card stack' }, h('h2', null, t), ...f);
  const cores = ['bg', 'surface-1', 'surface-2', 'border', 'text', 'muted', 'accent', 'success', 'warning', 'danger', 'info'];
  const amostra = (c) => { const d = h('div', { class: 'card kpi', 'aria-label': `Cor ${c}` }, h('div', { class: 'rotulo' }, `--${c}`)); d.firstChild.style.setProperty('color', 'var(--muted)'); const b = h('div', { class: 'skeleton' }); b.style.setProperty('animation', 'none'); b.style.setProperty('background', `var(--${c})`); b.style.setProperty('height', '36px'); d.append(b); return d; };
  const combo = combobox({ rotulo: 'Seleção com busca', buscar: async (t) => ['Alfa', 'Bravo', 'Charlie', 'Delta'].filter((x) => x.toLowerCase().includes(t.toLowerCase())).map((x, i) => ({ id: i, rotulo: x, detalhe: 'exemplo' })), aoEscolher: () => {} });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Design system'), h('p', null, 'Tokens, componentes e estados. Troque o tema no botão do topo (escuro, claro, automático, alto contraste).'))),
    sec('Cores (OKLCH)', h('div', { class: 'cols-2' }, cores.map(amostra))),
    sec('Tipografia', h('h1', null, 'Título 1 — Estoque'), h('h2', null, 'Título 2 — Endereços'), h('h3', null, 'Título 3 — Contagem'), h('p', null, 'Texto base com números tabulares: 1.234.567,89 · 0123456789'), h('p', { class: 'muted' }, 'Texto de apoio'), h('code', null, 'D1-P-03-02-01-04')),
    sec('Botões', h('div', { class: 'row' }, h('button', { class: 'btn primario' }, 'Primário'), h('button', { class: 'btn' }, 'Secundário'), h('button', { class: 'btn fantasma' }, 'Fantasma'), h('button', { class: 'btn perigo' }, 'Perigo'), h('button', { class: 'btn icone', 'aria-label': 'Pesquisar' }, icone('search')), h('button', { class: 'btn', disabled: true }, 'Desativado'))),
    sec('Campos', h('div', { class: 'cols-2' }, campo('Texto', h('input', { type: 'text', placeholder: 'Digite…' })), campo('Com erro', h('input', { type: 'text', value: 'abc' }), { erro: 'Mensagem de erro clara e humana.' }), campo('Data', h('input', { type: 'date' })), combo.el)),
    sec('Badges', h('div', { class: 'row' }, badge('Padrão'), badge('Ok', 'ok'), badge('Atenção', 'aviso'), badge('Erro', 'erro'), badge('Info', 'info'))),
    sec('Abas', abas([['a', 'Dados'], ['b', 'Estoque'], ['c', 'Códigos']], 'a', () => {})),
    sec('Tabela', tabela([{ titulo: 'SKU', render: (x) => h('strong', { class: 'mono' }, x.s) }, { titulo: 'Produto', chave: 'n' }, { titulo: 'Qtd', num: true, chave: 'q' }], [{ s: 'CAM-001', n: 'Camiseta', q: 12 }, { s: 'CAN-002', n: 'Caneca', q: 0 }], { aoClicar: () => {} })),
    sec('Gráfico (SVG com tabela alternativa)', sparkline([3, 5, 2, 8, 6, 9, 4, 7, 10, 6, 8, 12, 9, 11])),
    sec('Estados', h('div', { class: 'cols-2' }, esqueleto(3), vazio('Nada por aqui', 'Estado vazio com ação.', h('button', { class: 'btn primario' }, 'Criar'))),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => toast('Salvo com sucesso.', 'ok') }, 'Toast ok'), h('button', { class: 'btn', onclick: () => toast('Algo deu errado.', 'erro') }, 'Toast erro'), h('button', { class: 'btn', onclick: () => feedback('ok', 'Certo ✓') }, 'Feedback certo'), h('button', { class: 'btn', onclick: () => feedback('erro', 'Produto errado!') }, 'Feedback errado'))),
    sec('Camadas', h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => gaveta('Gaveta lateral', h('p', null, 'Edite sem sair da lista.')) }, 'Abrir gaveta'), h('button', { class: 'btn', onclick: () => modal('Modal', h('p', null, 'Só para confirmações.')) }, 'Abrir modal'), h('button', { class: 'btn', onclick: () => confirmar('Confirmar ação', 'Tem certeza?', { perigo: true, rotulo: 'Excluir' }) }, 'Confirmar'))));
}
