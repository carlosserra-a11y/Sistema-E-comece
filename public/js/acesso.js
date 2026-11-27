// Telas de acesso, no layout do componente "sign-in-page": dois painéis iguais (arte à esquerda, formulário branco à direita).
// Entrar, criar conta (o código de liberação vai aos donos), código de 6 dígitos da 2ª etapa, trocar a senha provisória e aguardar liberação.
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

// ---------------------------------------------------------------- painel esquerdo: marca do cliente (logo sobre azul-marinho, com flocos e ondas)
/** Desenho do floco (o mesmo do ícone do app): 6 braços com 2 pares de ramos em V. */
function flocoPath(L) {
  const p = [];
  for (let k = 0; k < 6; k++) {
    const ang = ((90 + 60 * k) * Math.PI) / 180; const dx = Math.cos(ang); const dy = -Math.sin(ang);
    p.push(`M0 0L${(dx * L).toFixed(1)} ${(dy * L).toFixed(1)}`);
    for (const [frac, tam] of [[0.58, 0.3], [0.8, 0.2]]) {
      const bx = dx * L * frac; const by = dy * L * frac;
      for (const lado of [-1, 1]) { const a2 = ang + (lado * 50 * Math.PI) / 180; p.push(`M${bx.toFixed(1)} ${by.toFixed(1)}L${(bx + Math.cos(a2) * L * tam).toFixed(1)} ${(by - Math.sin(a2) * L * tam).toFixed(1)}`); }
    }
  }
  return p.join('');
}
function arte() {
  const stops = (...p) => p.map(([o, c, op]) => sv('stop', { offset: o, 'stop-color': c, 'stop-opacity': op ?? 1 }));
  const flocos = [[110, 160, 70, 0.1], [530, 250, 110, 0.07], [90, 560, 120, 0.06], [550, 690, 60, 0.12], [300, 800, 90, 0.07], [340, 80, 38, 0.14]].map(([x, y, L, o]) =>
    sv('g', { transform: `translate(${x} ${y})`, opacity: o }, sv('g', { class: 'floco' }, sv('path', { d: flocoPath(L), fill: 'none', stroke: '#9fe3ff', 'stroke-width': Math.max(2, L / 10), 'stroke-linecap': 'round' }))));
  const onda = (y, o) => sv('path', { d: `M-20 ${y} C120 ${y - 40} 260 ${y + 40} 400 ${y} S620 ${y - 30} 700 ${y + 10}`, fill: 'none', stroke: 'url(#frAzul)', 'stroke-width': 3, opacity: o, 'stroke-linecap': 'round' });
  return sv('svg', { class: 'lg-arte', viewBox: '0 0 640 877', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' },
    sv('defs', {},
      sv('linearGradient', { id: 'frFundo', x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#0b1430'], ['0.55', '#142a6b'], ['1', '#0a1226'])),
      sv('linearGradient', { id: 'frAzul', x1: 0, y1: 0, x2: 1, y2: 0 }, ...stops(['0', '#13c6ff', 0], ['0.5', '#13c6ff'], ['1', '#0a8fe0', 0])),
      sv('radialGradient', { id: 'frBrilho', cx: 0.5, cy: 0.45, r: 0.55 }, ...stops(['0', '#2ea8fa', 0.28], ['1', '#2ea8fa', 0]))),
    sv('rect', { width: 640, height: 877, fill: 'url(#frFundo)' }), sv('rect', { width: 640, height: 877, fill: 'url(#frBrilho)' }), ...flocos, onda(690, 0.55), onda(725, 0.3), onda(760, 0.18));
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
const SENHAS_DIFERENTES = 'Digite a mesma senha nos dois campos.';
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
  limpar(raiz).append(h('main', { class: 'lg-pagina' },
    h('div', { class: 'lg-esq' }, voltarArte, arte(),
      h('div', { class: 'lg-logo-bloco' }, h('img', { class: 'lg-logo', src: '/frio-logo.png', alt: sessao.appName, width: 420, height: 173 }), h('p', null, 'Mais que peças, soluções em refrigeração.')),
      h('div', { class: 'lg-marca' }, h('small', null, 'Sistema de estoque · desenvolvido por Carlos Desenvolvedor de Sistema'))),
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
    const l = entradaLg({ name: 'login', autocomplete: 'username', autofocus: true, autocapitalize: 'none', spellcheck: 'false', placeholder: comCadastro ? 'seuemail@gmail.com' : 'Código de acesso', value: lembrado });
    const s = senhaLg({ name: 'senha' });
    const lembrar = h('input', { type: 'checkbox', name: 'lembrar', checked: !!lembrado });
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const dica = h('div', { class: 'lg-info', hidden: true }, icone('shield', 20), h('p', null, 'Esqueceu a senha? Peça ao dono do sistema para redefinir em Equipe → Redefinir senha. Donos e desenvolvedor não precisam de senha: toque em “Entrar só com e-mail” e use o código que chega na caixa de entrada.'));
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
        erro.textContent = x.code === 'CREDENCIAIS' ? 'Não consegui entrar só com este e-mail. Confira se está escrito certo. Sem senha entram apenas os donos e o desenvolvedor; as outras contas usam a senha.' : x.message;
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
          const semSenha = comCadastro && x.code === 'CREDENCIAIS' && l.value.includes('@'); // o navegador pode ter preenchido uma senha antiga
          erro.textContent = semSenha ? `${x.message} Dono ou desenvolvedor? Toque em “Entrar só com e-mail”.` : x.message;
          btn.disabled = false; s.input.select();
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
          h('button', { class: 'lg-social', type: 'button', onclick: pedirCodigoPorEmail }, icone('mail', 20), 'Entrar só com e-mail'),
          h('button', { class: 'lg-social', type: 'button', onclick: criar }, icone('plus', 20), 'Criar conta')),
      ] : null));
  }

  function criar() {
    definirVoltar(login);
    const nome = entradaLg({ autocomplete: 'name', autofocus: true, maxlength: 80, placeholder: 'Seu nome' });
    const email = entradaLg({ autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', placeholder: 'seuemail@hotmail.com' });
    const s = senhaLg({ autocomplete: 'new-password' });
    const s2 = senhaLg({ autocomplete: 'new-password', placeholder: 'A mesma senha de novo' });
    const iguais = h('p', { class: 'lg-ajuda', role: 'status' });
    const comparar = () => {
      const ok = s.input.value === s2.input.value;
      iguais.textContent = !s2.input.value ? '' : ok ? '✓ As senhas são iguais.' : 'As senhas ainda não são iguais.';
      if (ok && erro.textContent === SENHAS_DIFERENTES) erro.textContent = ''; // já corrigiu: o aviso antigo sai
      return ok;
    };
    s.input.addEventListener('input', comparar); s2.input.addEventListener('input', comparar);
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const btn = h('button', { class: 'lg-preto', type: 'submit' }, 'Confirmar');
    limpar(caixa).append(
      cabecalho('Criar conta', 'Já tem uma conta? ', h('button', { class: 'lg-link', type: 'button', onclick: login }, 'Entrar')),
      h('form', { class: 'lg-form', onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; erro.textContent = '';
        const senha = s.input.value;
        if (!comparar() || !s2.input.value) { erro.textContent = SENHAS_DIFERENTES; btn.disabled = false; s2.input.focus(); return; }
        try {
          await api.post('/api/cadastro', { nome: nome.value.trim(), email: email.value.trim(), senha, confirmacao: s2.input.value });
          confirmarEmail({ email: email.value.trim(), senha, enviado: true });
        } catch (x) { erro.textContent = msg(x); btn.disabled = false; }
      } }, campoLg('Nome', nome), campoLg('E-mail', email, 'Gmail, Hotmail, Outlook, Yahoo ou iCloud. Confira: é com ele que você vai entrar.'), campoLg('Senha', s.el), medidor(s.input), campoLg('Repita a senha', s2.el), iguais, erro, btn,
      h('p', { class: 'lg-ajuda' }, 'Ao confirmar, um código de liberação vai para o e-mail dos donos do sistema. Peça o código a um deles.')));
  }

  /** Tela do código de 6 dígitos. modo 'cadastro' usa o código que os donos receberam; modo 'login' é a 2ª etapa (`email` vem mascarado). */
  function confirmarEmail({ email, senha, enviado, modo = 'cadastro' }) {
    const doLogin = modo === 'login';
    definirVoltar(async () => { clearInterval(relogio); if (doLogin) await api.post('/api/logout').catch(() => {}); login(); });
    const c = entradaLg({ inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', autofocus: true, placeholder: '000000', class: 'lg-codigo' });
    const erro = h('p', { class: 'lg-erro', role: 'alert' });
    const aviso = h('p', { class: 'lg-aviso', role: 'status' });
    const reenviar = h('button', { class: 'lg-link pequeno', type: 'button' });
    const btn = h('button', { class: 'lg-preto', type: 'submit' }, doLogin ? 'Entrar' : 'Criar minha conta');
    let espera = enviado ? 60 : 0; // o servidor só reenvia depois de 60 s
    const pintar = () => { reenviar.disabled = espera > 0; const rotulo = doLogin ? 'Reenviar código' : 'Mandar outro código aos donos'; reenviar.textContent = espera > 0 ? `${rotulo} (${espera} s)` : rotulo; };
    const relogio = setInterval(() => { if (!document.body.contains(reenviar)) return clearInterval(relogio); if (espera > 0) { espera -= 1; pintar(); } }, 1000);
    pintar();
    reenviar.addEventListener('click', async () => {
      erro.textContent = ''; reenviar.disabled = true;
      try { await (doLogin ? api.post('/api/login/codigo/reenviar') : api.post('/api/cadastro/reenviar', { email })); aviso.textContent = doLogin ? 'Enviamos um código novo. Confira também o spam.' : 'Enviamos um código novo aos donos.'; espera = 60; }
      catch (x) { erro.textContent = x.message; espera = x.retryAfterS ?? 60; }
      pintar();
    });
    limpar(caixa).append(
      doLogin
        ? cabecalho('Digite o código', enviado ? `Para sua segurança, enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.` : `Digite o código que enviamos para ${email}. Se não chegou, peça um novo.`)
        : cabecalho('Código de liberação', enviado ? `Enviamos um código de 6 dígitos aos donos do sistema. Peça a um deles e digite aqui. Vale por 30 minutos. Sua conta: ${email}` : `A conta ${email} ainda não foi liberada. Peça um código novo: ele vai para os donos do sistema.`),
      h('form', { class: 'lg-form', onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; erro.textContent = '';
        try {
          if (doLogin) {
            const r = await api.post('/api/login/codigo', { codigo: c.value.trim() });
            clearInterval(relogio);
            if (r.estagio === 'TROCAR_SENHA') trocarSenha(senha); else aoEntrar();
          } else { await api.post('/api/cadastro/confirmar', { email, codigo: c.value.trim(), senha }); clearInterval(relogio); aoEntrar(); }
        } catch (x) { erro.textContent = msg(x); btn.disabled = false; c.select(); }
      } }, campoLg('Código de 6 dígitos', c, doLogin ? 'Não achou? Olhe a caixa de spam ou promoções.' : 'O código chega no e-mail dos donos, não no seu.'), erro, aviso, btn),
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
