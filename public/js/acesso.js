// Telas de acesso: entrar, criar conta, confirmar o e-mail com o código, trocar a senha provisória e aguardar a liberação do dono.
// Não existe mais segunda etapa (QR Code): quem cria a conta confirma o e-mail uma vez e depois entra só com e-mail e senha.
import { h, limpar, api, icone, campo, entrada, senhaInput, ApiError } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...filhos) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  filhos.forEach((f) => e.append(f));
  return e;
};
const msg = (x) => (x instanceof ApiError && x.campos ? Object.values(x.campos).join(' ') : x.message);

/** Ilustração própria: estante de galpão com caixas e um leitor de código de barras. As cores vêm das classes do CSS. */
function ilustracao() {
  const caixa = (c, x, y, w, hh) => sv('rect', { class: c, x, y, width: w, height: hh, rx: 6 });
  const etiqueta = [...Array(10).keys()].map((i) => sv('line', { class: 'cod', x1: 232 + i * 4.4, y1: 62, x2: 232 + i * 4.4, y2: 78 }));
  return sv('svg', { class: 'ilus', viewBox: '0 0 400 280', role: 'img', 'aria-label': 'Estante de galpão com caixas sendo lidas por um leitor de código de barras' },
    sv('rect', { class: 'poste', x: 30, y: 20, width: 10, height: 240, rx: 3 }), sv('rect', { class: 'poste', x: 360, y: 20, width: 10, height: 240, rx: 3 }),
    ...[90, 170, 250].map((y) => sv('rect', { class: 'viga', x: 30, y, width: 340, height: 8, rx: 3 })),
    caixa('c1', 56, 200, 70, 50), caixa('c2', 136, 214, 56, 36), caixa('c3', 204, 196, 80, 54), caixa('c1', 296, 210, 52, 40),
    caixa('c2', 60, 122, 60, 48), caixa('c3', 132, 136, 74, 34), caixa('c1', 218, 118, 66, 52), caixa('c2', 296, 140, 54, 30),
    caixa('c3', 60, 44, 72, 46), caixa('c1', 144, 56, 56, 34), caixa('c2', 212, 40, 78, 50), caixa('c1', 302, 58, 48, 32),
    sv('rect', { class: 'etq', x: 226, y: 56, width: 52, height: 26, rx: 3 }), ...etiqueta,
    sv('rect', { class: 'laser', x: 212, y: 42, width: 78, height: 3, rx: 1.5 }));
}

function painelMarca() {
  const pontos = ['Bipe produtos e endereços com a câmera do celular', 'Cada pessoa vê só o que o dono liberar', 'Estoque, pedidos e Mercado Livre no mesmo lugar'];
  return h('aside', { class: 'auth-brand', 'aria-hidden': 'true' }, ilustracao(), h('h2', null, 'Estoque organizado, do celular ao galpão.'), h('ul', null, pontos.map((p) => h('li', null, icone('check', 20), p))));
}

/** Monta a casca (painel da marca + cartão) e devolve o cartão onde cada tela se desenha. */
function casca(raiz) {
  const cartao = h('div', { class: 'card' });
  limpar(raiz).append(h('main', { class: 'auth-split' }, painelMarca(), h('div', { class: 'auth-form' }, cartao)));
  return cartao;
}
function cabecalho(sessao, titulo, sub) {
  const [primeiro, ...resto] = sessao.appName.split(' ');
  return [h('div', { class: 'brand brand-grande' }, h('img', { class: 'logo', src: '/icone.svg', alt: '', width: 48, height: 48 }), h('div', { class: 'brand-txt' }, h('strong', null, primeiro), h('small', null, resto.join(' ')))),
    h('h1', null, titulo), sub && h('p', { class: 'muted' }, sub)];
}

/** Barra e texto que acompanham a digitação da senha nova (mínimo de 8; mais longa é melhor). */
function medidor(input) {
  const barra = h('span');
  const rotulo = h('span', { class: 'ajuda', 'aria-live': 'polite' });
  const caixa = h('div', { class: 'stack' }, h('div', { class: 'barra', role: 'presentation' }, barra), rotulo);
  const atualizar = () => {
    const n = input.value.length;
    barra.style.setProperty('--p', String(Math.min(100, Math.round((n / 12) * 100))));
    rotulo.textContent = n === 0 ? 'Use 8 ou mais caracteres. Uma frase longa é fácil de lembrar e forte.' : n < 8 ? `Faltam ${8 - n} caractere(s).` : n < 12 ? 'Boa. Mais longa fica ainda melhor.' : 'Forte.';
  };
  input.addEventListener('input', atualizar); atualizar();
  return caixa;
}

export function telaAcesso(raiz, sessao, aoEntrar) {
  const cartao = casca(raiz);
  const cab = (titulo, sub) => cabecalho(sessao, titulo, sub);
  const alternar = (ativa) => (sessao.cadastro_disponivel
    ? h('div', { class: 'alternar', role: 'group', 'aria-label': 'Entrar ou criar conta' },
      h('button', { type: 'button', 'aria-pressed': String(ativa === 'entrar'), onclick: () => login() }, 'Entrar'),
      h('button', { type: 'button', 'aria-pressed': String(ativa === 'criar'), onclick: () => criar() }, 'Criar conta'))
    : null);

  function login() {
    const l = entrada({ autocomplete: 'username', autofocus: true, autocapitalize: 'none', spellcheck: 'false', placeholder: sessao.cadastro_disponivel ? 'voce@gmail.com' : '' });
    const s = senhaInput({ autocomplete: 'current-password' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    const btn = h('button', { class: 'btn primario', type: 'submit' }, 'Entrar');
    limpar(cartao).append(...cab('Entrar', sessao.cadastro_disponivel ? 'Use o seu e-mail e a sua senha.' : 'Acesso restrito.'), alternar('entrar'), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; erro.textContent = '';
      const senha = s.input.value;
      try {
        const r = await api.post('/api/login', { login: l.value.trim(), senha });
        if (r.estagio === 'TROCAR_SENHA') trocarSenha(senha); else aoEntrar();
      } catch (x) {
        if (x instanceof ApiError && x.code === 'EMAIL_NAO_CONFIRMADO') return confirmarEmail({ email: l.value.trim(), senha, enviado: false });
        erro.textContent = x.message; btn.disabled = false; s.input.select();
      }
    } }, campo(sessao.cadastro_disponivel ? 'E-mail ou código de acesso' : 'Código de acesso', l), campo('Senha', s.el), erro, btn));
  }

  function criar() {
    const nome = entrada({ autocomplete: 'name', autofocus: true, maxlength: 80, placeholder: 'Seu nome' });
    const email = entrada({ autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', placeholder: 'voce@gmail.com' });
    const s = senhaInput({ autocomplete: 'new-password' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    const btn = h('button', { class: 'btn primario', type: 'submit' }, 'Criar conta');
    limpar(cartao).append(...cab('Criar conta', 'Use o seu Gmail. Vamos mandar um código de confirmação para ele.'), alternar('criar'), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; erro.textContent = '';
      const senha = s.input.value;
      try {
        await api.post('/api/cadastro', { nome: nome.value.trim(), email: email.value.trim(), senha });
        confirmarEmail({ email: email.value.trim(), senha, enviado: true });
      } catch (x) { erro.textContent = msg(x); btn.disabled = false; }
    } }, campo('Nome', nome), campo('E-mail (Gmail)', email), campo('Senha', s.el), medidor(s.input), erro, btn,
    h('p', { class: 'ajuda' }, 'Depois de confirmar o e-mail, o dono do sistema precisa liberar o seu acesso.')));
  }

  function confirmarEmail({ email, senha, enviado }) {
    const c = entrada({ inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', autofocus: true, placeholder: '000000', class: 'codigo-6' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    const aviso = h('p', { class: 'muted', role: 'status' });
    const reenviar = h('button', { class: 'btn fantasma', type: 'button' });
    const btn = h('button', { class: 'btn primario', type: 'submit' }, 'Confirmar e entrar');
    let espera = enviado ? 60 : 0; // o servidor só reenvia depois de 60 s
    const pintar = () => { reenviar.disabled = espera > 0; reenviar.textContent = espera > 0 ? `Reenviar código (${espera} s)` : 'Reenviar código'; };
    const relogio = setInterval(() => { if (!document.body.contains(reenviar)) return clearInterval(relogio); if (espera > 0) { espera -= 1; pintar(); } }, 1000);
    pintar();
    reenviar.addEventListener('click', async () => {
      erro.textContent = ''; reenviar.disabled = true;
      try { await api.post('/api/cadastro/reenviar', { email }); aviso.textContent = 'Enviamos um código novo. Confira também o spam.'; espera = 60; }
      catch (x) { erro.textContent = x.message; espera = x.retryAfterS ?? 60; }
      pintar();
    });
    limpar(cartao).append(...cab('Confirme seu e-mail', enviado ? `Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.` : `O e-mail ${email} ainda não foi confirmado. Peça um código novo e digite aqui.`),
      h('div', { class: 'info-bloco' }, icone('mail', 22), h('p', null, 'Não achou? Olhe a caixa de spam ou promoções.')),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; erro.textContent = '';
        try { await api.post('/api/cadastro/confirmar', { email, codigo: c.value.trim(), senha }); clearInterval(relogio); aoEntrar(); }
        catch (x) { erro.textContent = msg(x); btn.disabled = false; c.select(); }
      } }, campo('Código de 6 dígitos', c), erro, aviso, btn),
      reenviar, h('button', { class: 'btn fantasma', type: 'button', onclick: () => { clearInterval(relogio); login(); } }, 'Voltar'));
  }

  /** Conta criada pelo dono: a senha provisória vale uma vez. Se acabou de digitá-la no login, ela é reaproveitada. */
  function trocarSenha(provisoria = null) {
    const atual = provisoria ? null : senhaInput({ autocomplete: 'current-password', autofocus: true });
    const nova = senhaInput({ autocomplete: 'new-password', autofocus: !!provisoria });
    const erro = h('p', { class: 'erro', role: 'alert' });
    const btn = h('button', { class: 'btn primario', type: 'submit' }, 'Salvar senha');
    limpar(cartao).append(...cab('Crie sua senha', 'A senha provisória só vale uma vez. Escolha uma senha sua, com 8 ou mais caracteres.'), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; erro.textContent = '';
      try { await api.post('/api/senha/trocar', { senha_atual: provisoria ?? atual.input.value, senha_nova: nova.input.value }); nova.input.value = ''; aoEntrar(); }
      catch (x) { erro.textContent = msg(x); btn.disabled = false; }
    } }, atual && campo('Senha atual (a provisória)', atual.el), campo('Nova senha', nova.el), medidor(nova.input), erro, btn));
  }

  if (sessao.estagio === 'TROCAR_SENHA') trocarSenha(); else login();
}

/** Conta criada pelo e-mail e já confirmada, mas sem nenhuma permissão até o dono liberar. */
export function telaPendente(raiz, sessao, { atualizar, sair }) {
  const cartao = casca(raiz);
  const u = sessao.usuario;
  const btn = h('button', { class: 'btn primario', onclick: async () => { btn.disabled = true; await atualizar(); } }, 'Já me liberaram, atualizar');
  limpar(cartao).append(...cabecalho(sessao, `Olá, ${u.nome.split(' ')[0]}!`, 'Seu e-mail está confirmado. Falta o dono do sistema liberar o seu acesso.'),
    h('div', { class: 'info-bloco' }, icone('shield', 22), h('p', null, 'Assim que ele liberar, toque no botão abaixo para entrar. Ele escolhe exatamente o que você pode ver e fazer.')),
    u.email && h('p', { class: 'muted mono quebra' }, u.email), btn, h('button', { class: 'btn fantasma', onclick: sair }, 'Sair'));
}
