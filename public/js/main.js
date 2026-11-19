import { h, limpar, api, estado, icone, modal, confirmar, campo, toast, tratar, esqueleto, blocoErro, $ } from './core.js';
import { telaAcesso } from './acesso.js';

const PAGINAS = [
  ['painel', 'Início', 'home', () => import('./pg-painel.js'), null],
  ['consulta', 'Consulta', 'scan', () => import('./pg-consulta.js'), ['produtos.ver', 'estoque.ver', 'enderecos.ver', 'contagem.operar']],
  ['produtos', 'Produtos', 'box', () => import('./pg-produtos.js'), ['produtos.ver']],
  ['estoque', 'Estoque', 'layers', () => import('./pg-estoque.js'), ['estoque.ver', 'estoque.operar']],
  ['enderecos', 'Endereços', 'map', () => import('./pg-enderecos.js'), ['enderecos.ver']],
  ['integracoes', 'Integrações', 'arrows', () => import('./pg-integracoes.js'), ['integracoes.ver', 'pedidos.ver']],
  ['contagem', 'Contagem', 'clipboard', () => import('./pg-contagem.js'), ['contagem.operar']],
  ['etiquetas', 'Etiquetas', 'tag', () => import('./pg-etiquetas.js'), ['etiquetas.imprimir']],
  ['fornecedores', 'Fornecedores', 'truck', () => import('./pg-fornecedores.js'), ['fornecedores.ver']],
  ['equipe', 'Equipe', 'users', () => import('./pg-equipe.js'), ['usuarios.gerenciar']],
  ['config', 'Configurações', 'settings', () => import('./pg-config.js'), null],
  ['design', 'Design', 'sun', () => import('./pg-design.js'), null],
];
// O servidor confere tudo de novo; aqui só escondemos o que a pessoa não pode usar.
const permitida = (p) => !p[4] || p[4].some((x) => sessao?.usuario?.permissoes?.includes(x));
const visiveis = () => PAGINAS.filter(permitida);
const ABAS_CELULAR = ['painel', 'estoque', 'contagem'];
const raiz = document.getElementById('raiz');
let conteudo; let limparPagina = null; let sessao = null; let ultimaAtividade = Date.now(); let ultimoBatimento = 0;

export const rotaAtual = () => {
  const [, caminho = 'painel', consulta = ''] = /^#\/([a-z]+)(?:\?(.*))?$/.exec(location.hash) ?? [];
  return { nome: caminho, params: new URLSearchParams(consulta) };
};
export const ir = (destino) => { location.hash = `#/${destino}`; };

async function iniciar() {
  try { sessao = await api.get('/api/sessao'); } catch (e) { return limpar(raiz).append(blocoErro(e, iniciar)); }
  estado.csrf = sessao.csrf;
  document.title = sessao.appName;
  if (!sessao.autenticado) return telaAcesso(raiz, sessao, async () => { estado.csrf = null; await iniciar(); });
  montarShell();
  desenharRota();
}

function montarShell() {
  const navItens = visiveis().filter(([n]) => n !== 'design').map(([nome, rotulo, ic]) => h('a', { class: 'item', href: `#/${nome}`, dataset: undefined, 'data-rota': nome }, icone(ic), rotulo));
  const busca = h('input', { type: 'search', class: 'busca', placeholder: 'Ler código, SKU ou endereço   ( / )', 'aria-label': 'Busca global', id: 'busca-global', autocomplete: 'off',
    onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { ir(`consulta?c=${encodeURIComponent(e.target.value.trim())}`); e.target.value = ''; e.target.blur(); } } });
  const maisAba = h('button', { 'data-rota': 'mais', onclick: abrirMais }, icone('dots'), 'Mais');
  const abasCel = ABAS_CELULAR.map((n) => PAGINAS.find(([x]) => x === n)).filter(permitida).map(([n, rotulo, ic]) => h('a', { href: `#/${n}`, 'data-rota': n }, icone(ic, 22), rotulo));
  const bipar = visiveis().some(([n]) => n === 'consulta') ? h('button', { class: 'tab-bipar', 'aria-label': 'Bipar com a câmera', onclick: biparAgora }, h('span', null, icone('scan', 26)), 'Bipar') : null;
  abasCel.splice(Math.ceil(abasCel.length / 2), 0, bipar);
  conteudo = h('main', { class: 'content', id: 'conteudo', tabindex: '-1' });
  limpar(raiz).append(
    h('a', { class: 'skip', href: '#conteudo', onclick: (e) => { e.preventDefault(); conteudo.focus(); } }, 'Ir para o conteúdo'),
    h('div', { class: 'app' },
      h('nav', { class: 'nav', 'aria-label': 'Principal' }, h('div', { class: 'brand' }, h('img', { class: 'logo', src: '/icone.svg', alt: '', width: 34, height: 34 }), h('div', { class: 'brand-txt' }, h('strong', null, sessao.appName.split(' ')[0]), h('small', null, sessao.appName.split(' ').slice(1).join(' ')))), navItens, h('span', { class: 'grow' }),
        h('a', { class: 'item', href: '#/design' }, icone('sun'), 'Design'), h('button', { class: 'btn fantasma', onclick: sair }, icone('logout'), 'Sair')),
      h('div', { class: 'main' }, h('div', { id: 'faixa-offline', class: 'offline', role: 'status', hidden: true }, 'Sem conexão. As alterações não serão salvas até a internet voltar.'),
        h('header', { class: 'topbar' }, h('div', { class: 'busca' }, busca), h('button', { class: 'btn icone fantasma', 'aria-label': 'Paleta de comandos (Ctrl+K)', onclick: paleta }, icone('search')),
          h('button', { class: 'btn icone fantasma', 'aria-label': 'Alternar tema', onclick: alternarTema }, icone('moon'))), conteudo)),
    h('nav', { class: 'tabbar', 'aria-label': 'Principal (celular)' }, abasCel.filter(Boolean), maisAba));
}

function marcarNav(nome) {
  document.querySelectorAll('[data-rota]').forEach((a) => (a.dataset.rota === nome || (a.dataset.rota === 'mais' && !ABAS_CELULAR.includes(nome)) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

async function desenharRota() {
  if (!conteudo) return;
  const { nome, params } = rotaAtual();
  const pagina = PAGINAS.find(([n]) => n === nome) ?? PAGINAS[0];
  if (!permitida(pagina)) { marcarNav(''); limpar(conteudo).append(h('div', { class: 'vazio' }, icone('shield', 36), h('strong', null, 'Sem acesso a esta área'), h('p', null, 'Peça ao dono do sistema para liberar esta função para você.'), h('a', { class: 'btn', href: '#/painel' }, 'Voltar ao início'))); return; }
  marcarNav(pagina[0]);
  document.title = `${pagina[1]} · ${sessao.appName}`;
  limparPagina?.(); limparPagina = null;
  document.querySelectorAll('.overlay').forEach((o) => o.remove()); // gaveta/modal da tela anterior não deve ficar por cima
  const render = async () => {
    limpar(conteudo).append(esqueleto(5));
    try {
      const mod = await pagina[3]();
      limpar(conteudo);
      limparPagina = (await mod.renderizar(conteudo, { params, ir, sessao })) ?? null;
    } catch (e) { limpar(conteudo).append(blocoErro(e, render)); console.error(e); }
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(render); else await render();
  conteudo.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function sair() {
  try { await api.post('/api/logout'); } catch { /* sessão já encerrada */ }
  estado.csrf = null; await iniciar();
}

const TEMAS = ['escuro', 'claro', 'auto', 'contraste'];
const MAPA_TEMA = { escuro: 'dark', claro: 'light', auto: 'auto', contraste: 'contraste' };
export function definirTema(t) {
  document.documentElement.dataset.theme = MAPA_TEMA[t];
  try { localStorage.setItem('tema', t); } catch { /* sem armazenamento */ }
}
function alternarTema() {
  let atual = 'escuro'; try { atual = localStorage.getItem('tema') || 'escuro'; } catch { /* ignora */ }
  const prox = TEMAS[(TEMAS.indexOf(atual) + 1) % TEMAS.length];
  definirTema(prox); toast(`Tema: ${prox}`, 'info', 1500);
}

async function biparAgora() {
  const { abrirScanner } = await import('./scanner.js');
  abrirScanner({ titulo: 'Bipar produto, endereço ou lote', aoLer: (codigo) => { ir(`consulta?c=${encodeURIComponent(codigo)}`); } });
}

function abrirMais() {
  let m;
  m = modal('Mais', h('div', { class: 'stack' }, visiveis().filter(([n]) => !ABAS_CELULAR.includes(n)).map(([n, r, ic]) => h('a', { class: 'btn', href: `#/${n}`, onclick: () => m.fechar() }, icone(ic), r)),
    h('button', { class: 'btn', onclick: () => { m.fechar(); alternarTema(); } }, icone('moon'), 'Alternar tema'), h('button', { class: 'btn', onclick: () => { m.fechar(); sair(); } }, icone('logout'), 'Sair')));
}

function paleta() {
  const comandos = [
    ...visiveis().map(([n, r, ic]) => ({ rotulo: `Ir para ${r}`, ic, acao: () => ir(n), atalho: '' })),
    { rotulo: 'Novo produto', ic: 'plus', acao: () => ir('produtos?novo=1'), atalho: 'N' },
    { rotulo: 'Receber mercadoria', ic: 'download', acao: () => ir('estoque?op=receber') },
    { rotulo: 'Transferir / guardar', ic: 'arrows', acao: () => ir('estoque?op=transferir') },
    { rotulo: 'Nova contagem de estoque', ic: 'clipboard', acao: () => ir('contagem?novo=1') },
    { rotulo: 'Criar endereços em massa', ic: 'map', acao: () => ir('enderecos?massa=1') },
    { rotulo: 'Imprimir etiquetas', ic: 'printer', acao: () => ir('etiquetas') },
    { rotulo: 'Alternar tema', ic: 'moon', acao: alternarTema },
    { rotulo: 'Atalhos de teclado', ic: 'list', acao: atalhos, atalho: '?' },
    { rotulo: 'Sair', ic: 'logout', acao: sair },
  ];
  const entradaP = h('input', { type: 'text', placeholder: 'Digite um comando ou leia um código…', 'aria-label': 'Comando', autocomplete: 'off', autofocus: true });
  const lista = h('div', { class: 'paleta', role: 'listbox' });
  let sel = 0; let vis = [];
  let m;
  const pintar = () => {
    const t = entradaP.value.trim().toLowerCase();
    vis = comandos.filter((c) => c.rotulo.toLowerCase().includes(t));
    if (t) vis.unshift({ rotulo: `Buscar “${entradaP.value.trim()}”`, ic: 'search', acao: () => ir(`consulta?c=${encodeURIComponent(entradaP.value.trim())}`) });
    sel = Math.min(sel, Math.max(0, vis.length - 1));
    limpar(lista).append(...vis.slice(0, 9).map((c, i) => h('button', { class: 'item', role: 'option', 'aria-selected': i === sel, onclick: () => { m.fechar(); c.acao(); } }, h('span', { class: 'row' }, icone(c.ic, 18), c.rotulo), c.atalho && h('span', { class: 'atalho' }, c.atalho))));
  };
  entradaP.addEventListener('input', () => { sel = 0; pintar(); });
  entradaP.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, Math.min(vis.length, 9) - 1); pintar(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); pintar(); }
    if (e.key === 'Enter' && vis[sel]) { e.preventDefault(); m.fechar(); vis[sel].acao(); }
  });
  m = modal('Paleta de comandos', h('div', { class: 'stack' }, entradaP, lista));
  pintar();
}

function atalhos() {
  const linha = (t, d) => h('div', null, h('span', null, d), h('span', { class: 'atalho' }, t));
  modal('Atalhos de teclado', h('div', { class: 'lista' }, linha('Ctrl/⌘ + K', 'Paleta de comandos'), linha('/', 'Ir para a busca global'), linha('G depois I', 'Início'), linha('G depois P', 'Produtos'),
    linha('G depois E', 'Estoque'), linha('G depois A', 'Endereços'), linha('G depois C', 'Contagem'), linha('G depois T', 'Etiquetas'), linha('G depois Q', 'Consulta'), linha('N', 'Novo (na tela atual)'), linha('?', 'Esta lista'), linha('Esc', 'Fechar gaveta/janela')));
}

const IR_PARA = { m: 'integracoes', i: 'painel', p: 'produtos', e: 'estoque', a: 'enderecos', c: 'contagem', t: 'etiquetas', q: 'consulta', f: 'fornecedores' };
let esperandoG = 0;
document.addEventListener('keydown', (e) => {
  if (!sessao?.autenticado) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paleta(); return; }
  const alvo = e.target;
  if (alvo.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.overlay')) return;
  if (e.key === '/') { e.preventDefault(); document.getElementById('busca-global')?.focus(); }
  else if (e.key === '?') atalhos();
  else if (e.key.toLowerCase() === 'g') esperandoG = Date.now();
  else if (esperandoG && Date.now() - esperandoG < 1200 && IR_PARA[e.key.toLowerCase()]) { ir(IR_PARA[e.key.toLowerCase()]); esperandoG = 0; }
  else if (e.key.toLowerCase() === 'n') document.querySelector('[data-novo]')?.click();
});

// Sessão: batimento por atividade e aviso antes de expirar por inatividade.
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  ultimaAtividade = Date.now();
  if (sessao?.autenticado && ultimaAtividade - ultimoBatimento > 120_000) { ultimoBatimento = ultimaAtividade; api.get('/api/sessao').catch(() => {}); }
}, { passive: true }));
let avisoAberto = false;
setInterval(async () => {
  if (!sessao?.autenticado || avisoAberto || Date.now() - ultimaAtividade < 27 * 60_000) return;
  avisoAberto = true;
  const continuar = await confirmar('Sua sessão vai expirar', 'Por inatividade, você será desconectado em poucos minutos.', { rotulo: 'Continuar logado' });
  avisoAberto = false;
  if (continuar) { ultimaAtividade = Date.now(); api.get('/api/sessao').catch(() => {}); }
}, 30_000);

estado.aoExpirar = () => { if (sessao?.autenticado) { sessao = null; toast('Sua sessão expirou. Entre novamente.', 'aviso', 8000); iniciar(); } };
estado.aoReautenticar = () => new Promise((resolve) => {
  const s = h('input', { type: 'password', autocomplete: 'current-password', autofocus: true });
  const erro = h('p', { class: 'erro', role: 'alert' });
  let m; let ok = false;
  m = modal('Confirme sua senha', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try { await api.post('/api/reautenticar', { senha: s.value }); ok = true; m.fechar(); resolve(true); } catch (x) { erro.textContent = x.message; s.select(); }
  } }, h('p', { class: 'muted' }, 'Esta ação é sensível (ajuste de estoque, aprovação, códigos de recuperação). Confirme que é você.'), campo('Senha', s), erro,
  h('div', { class: 'row' }, h('button', { class: 'btn primario', type: 'submit' }, 'Confirmar'), h('button', { class: 'btn', type: 'button', onclick: () => { m.fechar(); resolve(false); } }, 'Cancelar'))));
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!ok) resolve(false); } });
  obs.observe(document.body, { childList: true });
});

window.addEventListener('hashchange', desenharRota);
window.addEventListener('online', () => document.getElementById('faixa-offline') && (document.getElementById('faixa-offline').hidden = true));
window.addEventListener('offline', () => document.getElementById('faixa-offline') && (document.getElementById('faixa-offline').hidden = false));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
iniciar();
