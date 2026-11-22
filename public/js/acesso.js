// Telas de acesso, no layout do componente "sign-in-page": dois painéis iguais (arte à esquerda, formulário branco à direita).
// Entrar, criar conta, código de 6 dígitos (confirmar e-mail / 2ª etapa), trocar a senha provisória e aguardar a liberação do dono.
// Não existe QR Code. A conta de desenvolvedor entra só com e-mail + código (senha em branco).
import { h, limpar, api, icone, ApiError } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...filhos) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  filhos.forEach((f) => e.append(f));
  return e;
};
const msg = (x) => (x instanceof ApiError && x.campos ? Object.values(x.campos).join(' ') : x.message);
const lerLocal = (k) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const gravarLocal = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* sem armazenamento */ } };

// ---------------------------------------------------------------- ilustração do painel esquerdo (própria, em SVG, sem imagem externa)
function arte() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const stops = (...p) => p.map(([o, c]) => sv('stop', { offset: o, 'stop-color': c }));
  const grad = (id, x2, y2, ...p) => sv('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, ...stops(...p));
  const defs = sv('defs', {},
    grad('lgCeu', 0, 1, ['0', '#090c27'], ['0.4', '#17184a'], ['0.62', '#392a68'], ['0.78', '#8c3f6a'], ['0.88', '#d4623f'], ['1', '#f0903f']),
    grad('lgPele', 1, 0, ['0', '#f6c3a0'], ['0.55', '#d98b6c'], ['1', '#8a4a52']),
    grad('lgCamisa', 1, 0, ['0', '#fff0dc'], ['0.45', '#f3c9a4'], ['1', '#7a5a86']),
    grad('lgVisor', 1, 1, ['0', '#fffaf0'], ['1', '#ebcfae']),
    grad('lgAnel', 1, 0, ['0', '#ff8a3d'], ['0.5', '#ffe0b0'], ['1', '#52c7ff']),
    grad('lgBrilho', 0, 1, ['0', 'rgb(255 140 60 / 0)'], ['1', 'rgb(255 140 60 / 0.38)']),
    sv('filter', { id: 'lgDesfoque', x: '-20%', y: '-60%', width: '140%', height: '220%' }, sv('feGaussianBlur', { stdDeviation: 7 })));

  const estrelas = Array.from({ length: 64 }, () => sv('circle', { class: 'estr', cx: (rnd() * 640).toFixed(1), cy: (rnd() * 520).toFixed(1), r: (0.6 + rnd() * 1.1).toFixed(2), fill: '#fff' }));
  const nuvens = [[110, 300, 150, 26, '#6a3f8f', 0.28], [480, 240, 170, 22, '#6a3f8f', 0.24], [330, 590, 220, 28, '#b25a7a', 0.22]].map(([cx, cy, rx, ry, fill, o]) => sv('ellipse', { cx, cy, rx, ry, fill, opacity: o }));

  const predios = (base, altMin, altMax, cor, chance) => {
    const g = sv('g', { fill: cor }); const janelas = sv('g', {});
    for (let x = -10; x < 650;) {
      const w = 24 + rnd() * 26; const alt = altMin + rnd() * (altMax - altMin);
      g.append(sv('rect', { x: x.toFixed(1), y: (base - alt).toFixed(1), width: w.toFixed(1), height: alt.toFixed(1) }));
      for (let jy = base - alt + 8; jy < base - 6; jy += 10) for (let jx = x + 4; jx < x + w - 5; jx += 8) {
        if (rnd() < chance) janelas.append(sv('rect', { x: jx.toFixed(1), y: jy.toFixed(1), width: 3, height: 4, fill: rnd() < 0.78 ? '#ffcf8a' : '#7fd3ff', opacity: (0.5 + rnd() * 0.5).toFixed(2) }));
      }
      x += w + 2;
    }
    return [g, janelas];
  };
  const anel = (largura, extra = {}) => sv('ellipse', { cx: 322, cy: 430, rx: 270, ry: 100, transform: 'rotate(-16 322 430)', fill: 'none', 'stroke-width': largura, ...extra });
  const faiscas = Array.from({ length: 16 }, () => sv('circle', { class: 'estr', cx: (60 + rnd() * 520).toFixed(1), cy: (250 + rnd() * 340).toFixed(1), r: (1 + rnd() * 1.8).toFixed(2), fill: rnd() < 0.6 ? '#ffb27a' : '#8fdcff' }));

  return sv('svg', { class: 'lg-arte', viewBox: '0 0 640 877', preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': 'Pessoa com óculos de realidade virtual e um anel de luz diante de uma cidade à noite' },
    defs, sv('rect', { width: 640, height: 877, fill: 'url(#lgCeu)' }), ...estrelas, ...nuvens,
    ...predios(877, 90, 250, '#1d2257', 0.2), ...predios(877, 40, 130, '#0c0f2e', 0.26),
    sv('rect', { y: 640, width: 640, height: 237, fill: 'url(#lgBrilho)' }),
    anel(14, { class: 'anel-brilho', stroke: 'url(#lgAnel)', filter: 'url(#lgDesfoque)', opacity: 0.4 }), anel(4.5, { stroke: 'url(#lgAnel)' }),
    sv('ellipse', { cx: 314, cy: 448, rx: 70, ry: 74, fill: '#2b1a2a' }),
    sv('path', { d: 'M-30 877 C-10 790 100 722 232 696 L408 696 C540 722 650 790 670 877 Z', fill: 'url(#lgCamisa)' }),
    sv('path', { d: 'M278 600 L278 704 C298 720 342 720 362 704 L362 600 Z', fill: 'url(#lgPele)' }),
    sv('ellipse', { cx: 320, cy: 482, rx: 68, ry: 88, fill: 'url(#lgPele)' }),
    sv('path', { d: 'M252 472 C246 386 288 348 340 360 C384 370 396 422 388 474 C372 426 330 406 288 434 C272 446 260 458 252 472 Z', fill: '#2b1a2a' }),
    sv('path', { d: 'M248 454 L352 420 L404 448 L396 496 L336 522 L258 496 Z', fill: 'url(#lgVisor)' }),
    sv('path', { d: 'M258 496 L336 522 L396 496 L390 482 L332 508 L262 482 Z', fill: '#c7a07f', opacity: 0.7 }),
    sv('path', { d: 'M352 420 L404 448', stroke: '#54ccff', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }),
    sv('path', { d: 'M352 420 L336 522', stroke: '#54ccff', 'stroke-width': 2.5, fill: 'none', opacity: 0.8 }),
    sv('path', { d: 'M300 556 Q320 566 340 554', stroke: '#7a3f45', 'stroke-width': 2, fill: 'none', opacity: 0.6, 'stroke-linecap': 'round' }),
    sv('path', { d: 'M52 430 A270 100 0 0 0 592 430', transform: 'rotate(-16 322 430)', fill: 'none', stroke: 'url(#lgAnel)', 'stroke-width': 4.5 }),
    ...faiscas);
}

function senhaLg(props = {}) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha', ...props });
  const botao = h('button', { class: 'lg-olho', type: 'button', 'aria-label': 'Mostrar senha', 'aria-pressed': 'false', onclick: () => {
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    botao.setAttribute('aria-pressed', String(ver)); botao.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
    botao.replaceChildren(icone(ver ? 'eyeoff' : 'eye', 20));
    input.focus();
  } }, icone('eye', 20));
  return { el: h('div', { class: 'lg-senha' }, input, botao), input };
}
let seqId = 0;
function campoLg(rotulo, conteudo, ajuda) {
  const alvo = conteudo.matches?.('input') ? conteudo : conteudo.querySelector('input');
  alvo.id ||= `lg-${++seqId}`;
  return h('div', { class: 'lg-campo' }, h('label', { for: alvo.id }, rotulo), conteudo, ajuda && h('p', { class: 'lg-ajuda' }, ajuda));
}
const entradaLg = (props = {}) => h('input', { type: 'text', autocomplete: 'off', ...props });

function medidor(input) {
  const barra = h('span');
  const rotulo = h('p', { class: 'lg-ajuda', 'aria-live': 'polite' });
  const caixa = h('div', null, h('div', { class: 'lg-barra', role: 'presentation' }, barra), rotulo);
  const atualizar = () => {
    const n = input.value.length;
    barra.style.setProperty('--p', String(Math.min(100, Math.round((n / 12) * 100))));
    rotulo.textContent = n === 0 ? 'Use 8 ou mais caracteres. Uma frase longa é fácil de lembrar e forte.' : n < 8 ? `Faltam ${8 - n} caractere(s).` : n < 12 ? 'Boa. Mais longa fica ainda melhor.' : 'Forte.';
  };
  input.addEventListener('input', atualizar); atualizar();
  return caixa;
}

/** Monta os dois painéis e devolve o cartão onde cada tela se desenha. `definirVoltar(fn)` liga/desliga o botão redondo de voltar. */
function casca(raiz, sessao) {
  const caixa = h('div', { class: 'lg-caixa' });
  const voltarArte = h('button', { class: 'lg-voltar', type: 'button', 'aria-label': 'Voltar', hidden: true }, icone('arrowleft', 20));
  const voltarMob = h('button', { class: 'lg-voltar-mob', type: 'button', hidden: true }, icone('arrowleft', 16), 'Voltar');
  const [primeiro, ...resto] = sessao.appName.split(' ');
  limpar(raiz).append(h('main', { class: 'lg-pagina' },
    h('div', { class: 'lg-esq' }, voltarArte, arte(), h('div', { class: 'lg-marca' }, h('img', { src: '/icone.svg', alt: '', width: 40, height: 40 }), h('div', null, h('strong', null, primeiro), h('small', null, resto.join(' '))))),
    h('div', { class: 'lg-dir' }, caixa)));
  const definirVoltar = (fn) => {
    for (const b of [voltarArte, voltarMob]) { b.hidden = !fn; b.onclick = fn; }
    if (fn) caixa.prepend(voltarMob);
  };
  return { caixa, definirVoltar };
}
const cabecalho = (titulo, ...sub) => h('div', { class: 'lg-cab' }, h('h1', null, titulo), sub.length ? h('p', null, ...sub) : null);

export function telaAcesso(raiz, sessao, aoEntrar) {
  const { caixa, definirVoltar } = casca(raiz, sessao);
  const comCadastro = !!sessao.cadastro_disponivel;

  function login() {
    definirVoltar(null);
    const lembrado = lerLocal('lembrar-email');
    const l = entradaLg({ name: 'login', autocomplete: 'username', autofocus: true, autocapitalize: 'none', spellcheck: 'false', placeholder: comCadastro ? 'voce@gmail.com' : 'Código de acesso', value: lembrado });
    const s = senhaLg({ name: 'senha' });
    const lembrar = h('input', { type: 'checkbox', name: 'lembrar', checked: !!lembrado });
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const dica = h('div', { class: 'lg-info', hidden: true }, icone('shield', 20), h('p', null, 'Esqueceu a senha? Peça ao dono do sistema para redefinir em Equipe → Redefinir senha. Se você é o desenvolvedor, deixe a senha em branco e entre com o código que chega no seu e-mail.'));
    const btn = h('button', { class: 'lg-preto', type: 'submit' }, 'Entrar');
    const guardar = () => gravarLocal('lembrar-email', lembrar.checked ? l.value.trim() : '');

    async function pedirCodigoPorEmail() {
      erro.textContent = '';
      const v = l.value.trim();
      if (!v.includes('@')) { erro.textContent = 'Digite o seu e-mail para receber o código.'; l.focus(); return; }
      btn.disabled = true;
      try {
        const r = await api.post('/api/login/email', { email: v });
        guardar();
        confirmarEmail({ email: r.email, senha: null, enviado: true, modo: 'login' });
      } catch (x) {
        erro.textContent = x.code === 'CREDENCIAIS' ? 'Este e-mail não entra só com o código. Digite a senha.' : x.message;
        btn.disabled = false;
      }
    }

    limpar(caixa).append(
      cabecalho('Bem-vindo de volta', comCadastro ? 'Não tem uma conta? ' : 'Acesso restrito.', comCadastro ? h('button', { class: 'lg-link', type: 'button', onclick: criar }, 'Criar conta') : null),
      h('form', { class: 'lg-form', onsubmit: async (e) => {
        e.preventDefault(); erro.textContent = '';
        const senha = s.input.value;
        if (!senha && l.value.includes('@')) return pedirCodigoPorEmail(); // conta de desenvolvedor: senha em branco = código no e-mail
        btn.disabled = true;
        try {
          const r = await api.post('/api/login', { login: l.value.trim(), senha });
          guardar();
          if (r.estagio === 'CODIGO_EMAIL') return confirmarEmail({ email: r.email, senha, enviado: true, modo: 'login' });
          if (r.estagio === 'TROCAR_SENHA') trocarSenha(senha); else aoEntrar();
        } catch (x) {
          if (x instanceof ApiError && x.code === 'EMAIL_NAO_CONFIRMADO') return confirmarEmail({ email: l.value.trim(), senha, enviado: false });
          erro.textContent = x.message; btn.disabled = false; s.input.select();
        }
      } },
      campoLg(comCadastro ? 'E-mail ou código de acesso' : 'Código de acesso', l),
      campoLg('Senha', s.el),
      h('div', { class: 'lg-linha' }, h('label', { class: 'lg-check' }, lembrar, h('span', null, 'Lembrar de mim')),
        h('button', { class: 'lg-link pequeno', type: 'button', onclick: () => { dica.hidden = !dica.hidden; } }, 'Esqueceu a senha?')),
      dica, erro, btn,
      comCadastro ? [
        h('div', { class: 'lg-sep' }, h('span', null, 'ou')),
        h('div', { class: 'lg-sociais' },
          h('button', { class: 'lg-social', type: 'button', onclick: pedirCodigoPorEmail }, icone('mail', 20), 'Código por e-mail'),
          h('button', { class: 'lg-social', type: 'button', onclick: criar }, icone('plus', 20), 'Criar conta')),
      ] : null));
  }

  function criar() {
    definirVoltar(login);
    const nome = entradaLg({ autocomplete: 'name', autofocus: true, maxlength: 80, placeholder: 'Seu nome' });
    const email = entradaLg({ autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', placeholder: 'voce@gmail.com' });
    const s = senhaLg({ autocomplete: 'new-password' });
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const btn = h('button', { class: 'lg-preto', type: 'submit' }, 'Criar conta');
    limpar(caixa).append(
      cabecalho('Criar conta', 'Já tem uma conta? ', h('button', { class: 'lg-link', type: 'button', onclick: login }, 'Entrar')),
      h('form', { class: 'lg-form', onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; erro.textContent = '';
        const senha = s.input.value;
        try {
          await api.post('/api/cadastro', { nome: nome.value.trim(), email: email.value.trim(), senha });
          confirmarEmail({ email: email.value.trim(), senha, enviado: true });
        } catch (x) { erro.textContent = msg(x); btn.disabled = false; }
      } }, campoLg('Nome', nome), campoLg('E-mail (Gmail)', email, 'Vamos mandar um código de confirmação para ele.'), campoLg('Senha', s.el), medidor(s.input), erro, btn,
      h('p', { class: 'lg-ajuda' }, 'Depois de confirmar o e-mail, o dono do sistema precisa liberar o seu acesso.')));
  }

  /** Tela do código de 6 dígitos. modo 'cadastro' confirma o e-mail novo; modo 'login' é a 2ª etapa (`email` vem mascarado). */
  function confirmarEmail({ email, senha, enviado, modo = 'cadastro' }) {
    const doLogin = modo === 'login';
    definirVoltar(async () => { clearInterval(relogio); if (doLogin) await api.post('/api/logout').catch(() => {}); login(); });
    const c = entradaLg({ inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', autofocus: true, placeholder: '000000', class: 'lg-codigo' });
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const aviso = h('p', { class: 'lg-aviso', role: 'status' });
    const reenviar = h('button', { class: 'lg-link pequeno', type: 'button' });
    const btn = h('button', { class: 'lg-preto', type: 'submit' }, doLogin ? 'Entrar' : 'Confirmar e entrar');
    let espera = enviado ? 60 : 0; // o servidor só reenvia depois de 60 s
    const pintar = () => { reenviar.disabled = espera > 0; reenviar.textContent = espera > 0 ? `Reenviar código (${espera} s)` : 'Reenviar código'; };
    const relogio = setInterval(() => { if (!document.body.contains(reenviar)) return clearInterval(relogio); if (espera > 0) { espera -= 1; pintar(); } }, 1000);
    pintar();
    reenviar.addEventListener('click', async () => {
      erro.textContent = ''; reenviar.disabled = true;
      try { await (doLogin ? api.post('/api/login/codigo/reenviar') : api.post('/api/cadastro/reenviar', { email })); aviso.textContent = 'Enviamos um código novo. Confira também o spam.'; espera = 60; }
      catch (x) { erro.textContent = x.message; espera = x.retryAfterS ?? 60; }
      pintar();
    });
    limpar(caixa).append(
      doLogin
        ? cabecalho('Digite o código', enviado ? `Para sua segurança, enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.` : `Digite o código que enviamos para ${email}. Se não chegou, peça um novo.`)
        : cabecalho('Confirme seu e-mail', enviado ? `Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.` : `O e-mail ${email} ainda não foi confirmado. Peça um código novo e digite aqui.`),
      h('form', { class: 'lg-form', onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; erro.textContent = '';
        try {
          if (doLogin) {
            const r = await api.post('/api/login/codigo', { codigo: c.value.trim() });
            clearInterval(relogio);
            if (r.estagio === 'TROCAR_SENHA') trocarSenha(senha); else aoEntrar();
          } else { await api.post('/api/cadastro/confirmar', { email, codigo: c.value.trim(), senha }); clearInterval(relogio); aoEntrar(); }
        } catch (x) { erro.textContent = msg(x); btn.disabled = false; c.select(); }
      } }, campoLg('Código de 6 dígitos', c, 'Não achou? Olhe a caixa de spam ou promoções.'), erro, aviso, btn),
      h('div', { class: 'lg-linha' }, reenviar));
  }

  /** Conta criada pelo dono: a senha provisória vale uma vez. Se acabou de digitá-la no login, ela é reaproveitada. */
  function trocarSenha(provisoria = null) {
    definirVoltar(null);
    const atual = provisoria ? null : senhaLg({ autocomplete: 'current-password', autofocus: true, placeholder: 'Senha provisória' });
    const nova = senhaLg({ autocomplete: 'new-password', autofocus: !!provisoria, placeholder: 'Nova senha' });
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const btn = h('button', { class: 'lg-preto', type: 'submit' }, 'Salvar senha');
    limpar(caixa).append(cabecalho('Crie sua senha', 'A senha provisória só vale uma vez. Escolha uma senha sua, com 8 ou mais caracteres.'), h('form', { class: 'lg-form', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; erro.textContent = '';
      try { await api.post('/api/senha/trocar', { senha_atual: provisoria ?? atual.input.value, senha_nova: nova.input.value }); nova.input.value = ''; aoEntrar(); }
      catch (x) { erro.textContent = msg(x); btn.disabled = false; }
    } }, atual && campoLg('Senha atual (a provisória)', atual.el), campoLg('Nova senha', nova.el), medidor(nova.input), erro, btn));
  }

  if (sessao.estagio === 'TROCAR_SENHA') trocarSenha();
  else if (sessao.estagio === 'CODIGO_EMAIL') confirmarEmail({ email: sessao.usuario?.email ?? 'o seu e-mail', senha: null, enviado: false, modo: 'login' });
  else login();
}

/** Conta criada pelo e-mail e já confirmada, mas sem nenhuma permissão até o dono liberar. */
export function telaPendente(raiz, sessao, { atualizar, sair }) {
  const { caixa } = casca(raiz, sessao);
  const u = sessao.usuario;
  const btn = h('button', { class: 'lg-preto', type: 'button', onclick: async () => { btn.disabled = true; await atualizar(); } }, 'Já me liberaram, atualizar');
  limpar(caixa).append(cabecalho(`Olá, ${u.nome.split(' ')[0]}!`, 'Seu e-mail está confirmado. Falta o dono do sistema liberar o seu acesso.'),
    h('div', { class: 'lg-form' },
      h('div', { class: 'lg-info' }, icone('shield', 20), h('p', null, 'Assim que ele liberar, toque no botão abaixo para entrar. Ele escolhe exatamente o que você pode ver e fazer.')),
      u.email && h('p', { class: 'lg-aviso' }, u.email), btn,
      h('button', { class: 'lg-link pequeno', type: 'button', onclick: sair }, 'Sair')));
}
