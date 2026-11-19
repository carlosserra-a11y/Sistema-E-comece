// Telas de acesso: senha -> trocar senha -> MFA -> painel. Login minimalista, sem revelar se o login existe.
import { h, limpar, api, estado, icone, campo, entrada, tratar, ApiError, copiar, baixarArquivo, svgDataUrl, toast } from './core.js';

const PASSOS = [['SENHA', 'Senha'], ['TROCAR_SENHA', 'Nova senha'], ['MFA', 'Verificação']];
const passoDe = (est) => (est === 'TROCAR_SENHA' ? 1 : est === null ? 0 : 2);

function stepper(atual) {
  return h('ol', { class: 'stepper', 'aria-label': 'Etapas de acesso' }, PASSOS.map(([, r], i) => h('li', { class: i < atual ? 'feito' : '', 'aria-current': i === atual ? 'step' : undefined }, `${i < atual ? '✓ ' : ''}${r}`)));
}
function medidor(input) {
  const barra = h('span', { style: undefined });
  const rotulo = h('span', { class: 'ajuda', 'aria-live': 'polite' });
  const caixa = h('div', { class: 'stack' }, h('div', { class: 'barra', role: 'presentation' }, barra), rotulo);
  const atualizar = () => {
    const n = input.value.length;
    barra.style.setProperty('--p', String(Math.min(100, Math.round((n / 16) * 100))));
    rotulo.textContent = n === 0 ? 'Use 12 ou mais caracteres. Uma frase longa funciona bem.' : n < 12 ? `Faltam ${12 - n} caractere(s).` : n < 16 ? 'Boa. Mais longa fica ainda melhor.' : 'Forte.';
  };
  input.addEventListener('input', atualizar); atualizar();
  return caixa;
}

export function telaAcesso(raiz, sessao, aoEntrar) {
  const estagioInicial = sessao.estagio;
  const cartao = h('div', { class: 'card' });
  limpar(raiz).append(h('main', { class: 'auth' }, cartao));
  const cab = (titulo, sub) => [h('div', { class: 'brand' }, h('span', { class: 'logo' }, icone('box', 18)), sessao.appName), h('h1', null, titulo), sub && h('p', { class: 'muted' }, sub)];

  function login() {
    const l = entrada({ inputmode: 'numeric', autocomplete: 'username', autofocus: true, maxlength: 14 });
    const s = h('input', { type: 'password', autocomplete: 'current-password' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    const btn = h('button', { class: 'btn primario', type: 'submit' }, 'Entrar');
    limpar(cartao).append(...cab('Entrar', 'Acesso restrito.'), stepper(0), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; erro.textContent = '';
      try { const r = await api.post('/api/login', { login: l.value, senha: s.value }); s.value = ''; seguir(r.estagio); }
      catch (x) { erro.textContent = x instanceof ApiError && x.code === 'BLOQUEADO' ? `${x.message} Tente de novo em ${Math.ceil(x.retryAfterS / 60)} min.` : x.message; btn.disabled = false; s.select(); }
    } }, campo('Login (11 dígitos)', l), campo('Senha', s), erro, btn));
  }

  function trocarSenha() {
    const a = h('input', { type: 'password', autocomplete: 'current-password', autofocus: true });
    const n = h('input', { type: 'password', autocomplete: 'new-password' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    limpar(cartao).append(...cab('Crie sua senha', 'Por segurança, a senha inicial só vale uma vez.'), stepper(1), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      try { const r = await api.post('/api/senha/trocar', { senha_atual: a.value, senha_nova: n.value }); a.value = n.value = ''; seguir(r.estagio); } catch (x) { erro.textContent = x.message; }
    } }, campo('Senha atual (a inicial)', a), campo('Nova senha', n), medidor(n), erro, h('button', { class: 'btn primario', type: 'submit' }, 'Salvar senha')));
  }

  async function mfaInscrever() {
    limpar(cartao).append(...cab('Ative a verificação em duas etapas'), stepper(2), h('div', { class: 'skeleton' }));
    let d; try { d = await api.post('/api/mfa/iniciar'); } catch (x) { return tratar(x); }
    const c = entrada({ inputmode: 'numeric', maxlength: 7, autocomplete: 'one-time-code', autofocus: true, placeholder: '000000' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    limpar(cartao).append(...cab('Ative a verificação em duas etapas', 'Leia o QR com um aplicativo autenticador (Google Authenticator, Authy, 1Password…).'), stepper(2),
      h('img', { class: 'qr', src: svgDataUrl(d.qrSvg), alt: 'QR Code para o aplicativo autenticador', width: 220, height: 220 }),
      h('details', null, h('summary', null, 'Não consigo ler o QR'), h('p', { class: 'mono' }, d.segredo), h('button', { class: 'btn pequeno', type: 'button', onclick: () => copiar(d.segredo) }, 'Copiar chave')),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); erro.textContent = '';
        try { const r = await api.post('/api/mfa/confirmar', { codigo: c.value }); recuperacao(r.codigos_recuperacao); } catch (x) { erro.textContent = x.message; c.select(); }
      } }, campo('Código de 6 dígitos', c), erro, h('button', { class: 'btn primario', type: 'submit' }, 'Confirmar')));
  }

  function recuperacao(codigos) {
    const texto = codigos.join('\n');
    limpar(cartao).append(...cab('Guarde seus códigos de recuperação'), h('p', { class: 'muted' }, 'Cada código funciona uma única vez se você perder o celular. ', h('strong', null, 'Eles só aparecem agora.')),
      h('div', { class: 'codigos' }, codigos.map((c) => h('span', null, c))),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => copiar(texto) }, 'Copiar'), h('button', { class: 'btn', onclick: () => baixarArquivo('codigos-recuperacao.txt', `${texto}\n`) }, 'Baixar')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'guardei', onchange: (e) => { document.getElementById('seguir-rec').disabled = !e.target.checked; } }), 'Guardei em um lugar seguro'),
      h('button', { class: 'btn primario', id: 'seguir-rec', disabled: true, onclick: () => aoEntrar() }, 'Entrar no sistema'));
  }

  function mfaVerificar() {
    const c = entrada({ inputmode: 'numeric', maxlength: 7, autocomplete: 'one-time-code', autofocus: true, placeholder: '000000' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    limpar(cartao).append(...cab('Verificação em duas etapas', 'Digite o código do aplicativo autenticador.'), stepper(2), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      try { await api.post('/api/mfa/verificar', { codigo: c.value }); aoEntrar(); }
      catch (x) { erro.textContent = x.message; if (x.status === 401) return location.reload(); c.select(); }
    } }, campo('Código de 6 dígitos', c), erro, h('button', { class: 'btn primario', type: 'submit' }, 'Verificar')),
    h('button', { class: 'btn fantasma', onclick: recuperar }, 'Usar um código de recuperação'));
  }

  function recuperar() {
    const c = entrada({ autofocus: true, placeholder: 'XXXXX-XXXXX', autocapitalize: 'characters' });
    const erro = h('p', { class: 'erro', role: 'alert' });
    limpar(cartao).append(...cab('Código de recuperação'), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      try { const r = await api.post('/api/mfa/recuperar', { codigo: c.value }); toast(`Entrou. Restam ${r.codigos_restantes} código(s) de recuperação.`, 'aviso', 8000); aoEntrar(); } catch (x) { erro.textContent = x.message; }
    } }, campo('Código', c), erro, h('button', { class: 'btn primario', type: 'submit' }, 'Entrar')), h('button', { class: 'btn fantasma', onclick: mfaVerificar }, 'Voltar'));
  }

  function seguir(est) { ({ TROCAR_SENHA: trocarSenha, MFA_INSCREVER: mfaInscrever, MFA_VERIFICAR: mfaVerificar })[est]?.(); }
  if (estagioInicial) seguir(estagioInicial); else login();
}

export { passoDe };
