// Núcleo do front-end: DOM sem innerHTML (CSP estrita), API, ícones e componentes básicos.
const NS = 'http://www.w3.org/2000/svg';

// O append/prepend nativo transforma null/undefined/false em TEXTO ("null"). Aqui eles são ignorados e listas são achatadas,
// então `el.append(cond && h(...), lista)` funciona em todas as telas.
for (const metodo of ['append', 'prepend']) {
  const original = Element.prototype[metodo];
  Element.prototype[metodo] = function (...nos) { return original.apply(this, nos.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
}

/** h('div', {class:'x', onclick: fn, 'aria-label': 'a'}, 'texto', [filhos]) */
export function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  anexar(el, filhos);
  return el;
}
export function anexar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}
export const limpar = (el) => { el.replaceChildren(); return el; };
export const $ = (sel, raiz = document) => raiz.querySelector(sel);

const ICONES = {
  home: 'M3 10.5 12 3l9 7.5V21H3z M9 21v-7h6v7', box: 'M21 8 12 3 3 8v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
  truck: 'M1 6h13v10H1z M14 9h4l3 3v4h-7z M5.5 19.5a1.5 1.5 0 1 0 .01 0 M17.5 19.5a1.5 1.5 0 1 0 .01 0',
  layers: 'M12 3 2 8l10 5 10-5z M2 13l10 5 10-5', map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  tag: 'M3 3h8l10 10-8 8L3 11z M7.5 7.5h.01', clipboard: 'M9 3h6v3H9z M7 5H5v16h14V5h-2 M9 13l2 2 4-4',
  scan: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M4 12h16', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5', plus: 'M12 5v14 M5 12h14', x: 'M6 6l12 12 M18 6 6 18',
  check: 'M5 12l5 5 9-10', alert: 'M12 3 2 21h20z M12 10v5 M12 18h.01', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M19 5l-1.5 1.5 M6.5 17.5 5 19',
  moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z', printer: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3z M12 11a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  edit: 'M4 20h4L19 9l-4-4L4 16z', refresh: 'M20 11a8 8 0 0 0-14-4L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14 4l2-2 M20 20v-5h-5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', logout: 'M9 4H4v16h5 M16 8l4 4-4 4 M20 12H9', dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  download: 'M12 3v12 M7 11l5 5 5-5 M4 21h16', upload: 'M12 16V4 M7 8l5-5 5 5 M4 21h16', list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  arrows: 'M7 7h13l-4-4 M17 17H4l4 4', activity: 'M3 12h4l3-8 4 16 3-8h4',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5 M16 4.2a3.5 3.5 0 0 1 0 6.6 M18 14.7c2.4.6 4 2.3 4 5.3',
  barcode: 'M4 5v14 M7 5v14 M11 5v14 M14 5v14 M18 5v14 M20 5v14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeoff: 'M3 3l18 18 M10.6 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1 M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  mail: 'M3 5h18v14H3z M3 7l9 6 9-6',
};
export function icone(nome, tam = 20) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: tam, height: tam, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONES[nome] ?? ICONES.dots);
  s.append(p);
  return s;
}

export class ApiError extends Error {
  constructor(status, e) { super(e?.message ?? 'Erro de rede.'); this.status = status; this.code = e?.code; this.campos = e?.campos; this.etapa = e?.etapa; this.retryAfterS = e?.retryAfterS; }
}
export const estado = { csrf: null, sessao: null, aoExpirar: null, aoReautenticar: null, permissoes: new Set() };
/** A pessoa logada tem esta permissão? ("a,b" = qualquer uma). O servidor confere de novo: aqui só escondemos o que não funcionaria. */
export const pode = (p) => !p || String(p).split(',').some((x) => estado.permissoes.has(x));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID().replaceAll('-', '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 32);

async function chamar(metodo, url, corpo, { texto = false, idem = false, tentouReauth = false } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = texto ? 'text/csv' : 'application/json';
  if (estado.csrf) headers['X-CSRF-Token'] = estado.csrf;
  if (idem) headers['Idempotency-Key'] = idem === true ? uuid() : idem;
  let r;
  try { r = await fetch(url, { method: metodo, headers, body: corpo === undefined ? undefined : texto ? corpo : JSON.stringify(corpo), credentials: 'same-origin' }); } catch { throw new ApiError(0, { message: 'Sem conexão com o servidor.', code: 'REDE' }); }
  const tipo = r.headers.get('content-type') ?? '';
  if (!tipo.includes('json')) return r.ok ? { texto: await r.text(), tipo } : Promise.reject(new ApiError(r.status, { message: 'Erro inesperado.' }));
  const j = await r.json();
  if (j.ok) { if (j.data?.csrf) estado.csrf = j.data.csrf; return j.data; }
  const err = new ApiError(r.status, j.error);
  if (err.code === 'REAUTENTICACAO' && estado.aoReautenticar && !tentouReauth) {
    if (await estado.aoReautenticar()) return chamar(metodo, url, corpo, { texto, idem, tentouReauth: true });
  }
  if (r.status === 401 && err.code === 'NAO_AUTENTICADO') estado.aoExpirar?.();
  throw err;
}
export const api = {
  get: (u) => chamar('GET', u), post: (u, b = {}, o) => chamar('POST', u, b, o), put: (u, b = {}) => chamar('PUT', u, b), del: (u) => chamar('DELETE', u),
  /** Operação de estoque: a mesma chave é reutilizada se o usuário reenviar o mesmo formulário (duplo clique, queda de rede). */
  idem: (u, b, chave) => chamar('POST', u, b, { idem: chave ?? true }), csv: (u, t) => chamar('POST', u, t, { texto: true }),
};
export const novaChave = uuid;
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();

const TZ = 'America/Sao_Paulo';
export const fmt = {
  num: (n) => new Intl.NumberFormat('pt-BR').format(n ?? 0),
  moeda: (c) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((c ?? 0) / 100),
  dataHora: (ms) => (ms ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms)) : '—'),
  hora: (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, timeStyle: 'short' }).format(new Date(ms)),
  data: (s) => (s ? s.split('-').reverse().join('/') : '—'),
};
export const centavos = (txt) => { const n = Number(String(txt).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const reais = (c) => (c / 100).toFixed(2).replace('.', ',');

// ---------- feedback (cor + som + vibração + texto) ----------
let audio;
export function bipe(tipo) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = tipo === 'ok' ? 880 : 180; o.type = tipo === 'ok' ? 'sine' : 'sawtooth';
    g.gain.value = 0.12; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (tipo === 'ok' ? 0.12 : 0.5));
  } catch { /* sem áudio */ }
  try { navigator.vibrate?.(tipo === 'ok' ? 60 : [250, 80, 250]); } catch { /* sem vibração */ }
}
export function feedback(tipo, texto) {
  bipe(tipo);
  const el = h('div', { class: `feedback ${tipo}`, role: 'status' }, texto);
  document.body.append(el);
  setTimeout(() => el.remove(), tipo === 'ok' ? 450 : 1300);
}

// ---------- toasts ----------
let areaToasts;
export function toast(msg, tipo = 'info', ms = 4500) {
  areaToasts ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${tipo}` }, msg);
  areaToasts.append(t);
  setTimeout(() => t.remove(), ms);
}
export const erroMsg = (e) => (e instanceof ApiError ? e.message : 'Algo deu errado.');
export const tratar = (e) => { toast(erroMsg(e), 'erro', 7000); };

// ---------- gaveta e modal ----------
function overlay(classe, conteudo, aoFechar) {
  const anterior = document.activeElement;
  const ov = h('div', { class: `overlay ${classe}`, onmousedown: (e) => { if (e.target === ov) fechar(); } }, conteudo);
  const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); anterior?.focus?.(); aoFechar?.(); };
  const tecla = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); fechar(); }
    if (e.key === 'Tab') {
      const f = [...ov.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', tecla, true);
  document.body.append(ov);
  setTimeout(() => (ov.querySelector('[autofocus]') ?? ov.querySelector('input,select,textarea,button'))?.focus(), 30);
  return { fechar, el: ov };
}
export function gaveta(titulo, corpo, { aoFechar } = {}) {
  let ctl;
  const corpoEl = h('div', { class: 'corpo' }, corpo);
  const d = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    h('header', null, h('h2', null, titulo), h('button', { class: 'btn icone fantasma', 'aria-label': 'Fechar', onclick: () => ctl.fechar() }, icone('x'))), corpoEl);
  ctl = overlay('', d, aoFechar);
  ctl.corpo = corpoEl;
  return ctl;
}
export function modal(titulo, corpo, { largo = false } = {}) {
  const m = h('div', { class: `modal ${largo ? 'largo' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo }, h('h2', null, titulo), corpo);
  return overlay('centro', m);
}
export function confirmar(titulo, texto, { perigo = false, rotulo = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    let ctl;
    const fim = (v) => { ctl.fechar(); resolve(v); };
    ctl = modal(titulo, h('div', { class: 'stack' }, h('p', null, texto), h('div', { class: 'row' },
      h('button', { class: `btn ${perigo ? 'perigo' : 'primario'}`, autofocus: true, onclick: () => fim(true) }, rotulo),
      h('button', { class: 'btn', onclick: () => fim(false) }, 'Cancelar'))));
  });
}

// ---------- componentes ----------
export function campo(rotulo, input, { ajuda, erro } = {}) {
  const alvo = input.matches('input,select,textarea') ? input : input.querySelector('input,select,textarea') ?? input; // aceita o campo de senha com o botão do olho
  const id = alvo.id || (alvo.id = `c-${Math.random().toString(36).slice(2, 8)}`);
  const idErro = `${id}-e`;
  if (erro) { alvo.setAttribute('aria-invalid', 'true'); alvo.setAttribute('aria-describedby', idErro); }
  return h('div', { class: 'campo' }, h('label', { for: id }, rotulo), input, ajuda && h('span', { class: 'ajuda' }, ajuda), erro && h('span', { class: 'erro', id: idErro, role: 'alert' }, erro));
}
export const entrada = (props = {}) => h('input', { type: 'text', autocomplete: 'off', ...props });
/** Campo de senha com o botão de mostrar/ocultar (olho). Devolve { el, input }: `el` vai no `campo()`, `input` tem o valor. */
export function senhaInput(props = {}) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', ...props });
  const botao = h('button', { class: 'olho', type: 'button', 'aria-label': 'Mostrar senha', 'aria-pressed': 'false', onclick: () => {
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    botao.setAttribute('aria-pressed', String(ver)); botao.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
    botao.replaceChildren(icone(ver ? 'eyeoff' : 'eye', 18));
    input.focus();
  } }, icone('eye', 18));
  return { el: h('div', { class: 'com-olho' }, input, botao), input };
}
export const selecao = (opcoes, valor, props = {}) => h('select', props, opcoes.map(([v, r]) => h('option', { value: v, selected: String(v) === String(valor) }, r)));
export function abas(todos, inicial, aoTrocar) {
  const itens = todos.filter(([, , perm]) => pode(perm)); // aba com 3º item = permissão exigida
  const barra = h('div', { class: 'abas', role: 'tablist' });
  const botoes = itens.map(([id, rotulo]) => h('button', { role: 'tab', id: `aba-${id}`, 'aria-selected': id === inicial, onclick: () => ativar(id) }, rotulo));
  botoes.forEach((b) => barra.append(b));
  const ativar = (id) => { botoes.forEach((b, i) => b.setAttribute('aria-selected', itens[i][0] === id)); aoTrocar(id); };
  barra.addEventListener('keydown', (e) => {
    const i = botoes.findIndex((b) => b === document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const n = botoes[(i + (e.key === 'ArrowRight' ? 1 : -1) + botoes.length) % botoes.length]; n.focus(); n.click();
  });
  return barra;
}
export const esqueleto = (n = 4) => h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Carregando' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));
export const vazio = (titulo, texto, acao) => h('div', { class: 'vazio' }, icone('box', 36), h('strong', null, titulo), texto && h('p', null, texto), acao);
export const blocoErro = (e, tentar) => h('div', { class: 'erro-bloco', role: 'alert' }, icone('alert', 32), h('p', null, erroMsg(e)), tentar && h('button', { class: 'btn', onclick: tentar }, 'Tentar de novo'));
export const badge = (texto, tipo = '') => h('span', { class: `badge ${tipo}` }, texto);
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Carrega dados com skeleton, erro e "tentar de novo". */
export async function carregar(alvo, buscar, desenhar) {
  limpar(alvo).append(esqueleto());
  try { const d = await buscar(); limpar(alvo); desenhar(d); } catch (e) { limpar(alvo).append(blocoErro(e, () => carregar(alvo, buscar, desenhar))); }
}

export function tabela(colunas, linhas, { aoClicar, vazioMsg = 'Nada por aqui ainda.', compacta = false } = {}) {
  if (!linhas.length) return vazio(vazioMsg);
  return h('div', { class: `tabela-wrap ${compacta ? 'compacta' : ''}`, tabindex: '0', role: 'region', 'aria-label': 'Tabela de dados' }, h('table', null,
    h('thead', null, h('tr', null, colunas.map((c) => h('th', { class: c.num ? 'num' : '', scope: 'col' }, c.titulo)))),
    h('tbody', null, linhas.map((l) => h('tr', {
      class: aoClicar ? 'clicavel' : '', tabindex: aoClicar ? '0' : undefined, onclick: aoClicar ? () => aoClicar(l) : undefined,
      onkeydown: aoClicar ? (e) => { if (e.key === 'Enter') aoClicar(l); } : undefined,
    }, colunas.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(l) : l[c.chave] ?? '—')))))));
}
export const paginacao = (total, pagina, por, ir) => {
  const ultima = Math.max(1, Math.ceil(total / por));
  return h('div', { class: 'row nao-imprimir' }, h('span', { class: 'muted' }, `${fmt.num(total)} registro(s) · página ${pagina} de ${ultima}`), h('span', { class: 'grow' }),
    h('button', { class: 'btn pequeno', disabled: pagina <= 1, onclick: () => ir(pagina - 1) }, 'Anterior'), h('button', { class: 'btn pequeno', disabled: pagina >= ultima, onclick: () => ir(pagina + 1) }, 'Próxima'));
};

/** Campo de busca com sugestões (combobox acessível). `buscar(texto)` devolve [{id, rotulo, detalhe, dados}]. */
export function combobox({ rotulo, buscar, aoEscolher, placeholder = '', valorInicial = '' }) {
  const input = h('input', { type: 'text', autocomplete: 'off', placeholder, role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', value: valorInicial });
  const lista = h('ul', { role: 'listbox', hidden: true });
  let itens = []; let ativo = -1; let escolhido = null;
  const mostrar = (r) => {
    itens = r; ativo = r.length ? 0 : -1; limpar(lista);
    r.forEach((it, i) => lista.append(h('li', { role: 'presentation' }, h('button', { type: 'button', role: 'option', 'aria-selected': i === 0, onmousedown: (e) => { e.preventDefault(); escolher(it); } }, h('span', null, it.rotulo), it.detalhe && h('span', { class: 'muted' }, it.detalhe)))));
    lista.hidden = !r.length; input.setAttribute('aria-expanded', String(!!r.length));
  };
  let geracao = 0; let timer = 0;
  // Escolher cancela buscas pendentes: sem isso, "digitar + Enter" rápido reabria a lista depois da escolha.
  const escolher = (it) => { geracao++; clearTimeout(timer); escolhido = it; input.value = it.rotulo; lista.hidden = true; input.setAttribute('aria-expanded', 'false'); aoEscolher(it); };
  const marcar = () => [...lista.querySelectorAll('[role=option]')].forEach((b, i) => b.setAttribute('aria-selected', i === ativo));
  input.addEventListener('input', () => {
    clearTimeout(timer); escolhido = null; const g = ++geracao;
    timer = setTimeout(async () => { const t = input.value.trim(); if (!t) return mostrar([]); try { const r = await buscar(t); if (g === geracao) mostrar(r); } catch { if (g === geracao) mostrar([]); } }, 200);
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' && itens.length) { e.preventDefault(); ativo = (ativo + 1) % itens.length; marcar(); }
    else if (e.key === 'ArrowUp' && itens.length) { e.preventDefault(); ativo = (ativo - 1 + itens.length) % itens.length; marcar(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (itens[ativo]) return escolher(itens[ativo]);
      const t = input.value.trim(); if (!t || escolhido) return;
      try { const r = await buscar(t); if (r[0]) escolher(r[0]); } catch { /* ignora */ }
    } else if (e.key === 'Escape') { lista.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 150));
  // Câmera do celular: lê o código e escolhe o primeiro resultado (mesma regra do Enter).
  const botaoCamera = navigator.mediaDevices?.getUserMedia ? h('button', { class: 'btn icone com-camera', type: 'button', 'aria-label': 'Ler com a câmera', onclick: async () => {
    const { abrirScanner } = await import('./scanner.js');
    abrirScanner({ titulo: rotulo || 'Aponte para o código', aoLer: async (codigo) => {
      try { const r = await buscar(codigo); if (r[0]) { escolher(r[0]); return true; } } catch { /* trata abaixo */ }
      feedback('erro', 'Código não encontrado'); return false;
    } });
  } }, icone('camera')) : null;
  return { el: h('div', { class: 'campo' }, rotulo && h('label', null, rotulo), h('div', { class: 'sugestoes' }, h('div', { class: 'com-linha' }, input, botaoCamera), lista)), input, limpar: () => { escolhido = null; input.value = ''; }, get escolhido() { return escolhido; } };
}
export const buscarProdutos = async (t) => (await api.get(`/api/produtos?${qs({ q: t, por_pagina: 8 })}`)).itens.map((p) => ({ id: p.id, rotulo: `${p.sku} — ${p.nome}`, detalhe: `${fmt.num(p.saldo_total)} un`, dados: p }));
export const buscarEnderecos = async (t) => (await api.get(`/api/enderecos?${qs({ q: t, por_pagina: 8 })}`)).itens.map((e) => ({ id: e.id, rotulo: e.codigo, detalhe: `${e.zona_nome} · ${fmt.num(e.qtd_total)} un`, dados: e }));

export const baixarArquivo = (nome, conteudo, tipo = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = h('a', { href: url, download: nome }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const copiar = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copiado.', 'ok', 1800); } catch { toast('Não foi possível copiar.', 'aviso'); } };
export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
