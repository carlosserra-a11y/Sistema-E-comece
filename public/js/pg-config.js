import { h, limpar, api, carregar, icone, fmt, badge, tratar, toast, tabela, campo, entrada, senhaInput, selecao, paginacao, qs } from './core.js';
import { definirTema } from './main.js';

export async function renderizar(el, { sessao }) {
  const sec = (titulo, ...filhos) => h('section', { class: 'card stack' }, h('h2', null, titulo), ...filhos);
  let tema = 'escuro'; let dens = 'confortavel'; try { tema = localStorage.getItem('tema') || 'escuro'; dens = localStorage.getItem('densidade') || 'confortavel'; } catch { /* ignora */ }
  const st = selecao([['escuro', 'Escuro (padrão)'], ['claro', 'Claro'], ['auto', 'Automático (segue o sistema)'], ['contraste', 'Alto contraste']], tema, { 'aria-label': 'Tema', onchange: () => definirTema(st.value) });
  const sd = selecao([['confortavel', 'Confortável'], ['compacta', 'Compacta']], dens, { 'aria-label': 'Densidade', onchange: () => { document.documentElement.dataset.densidade = sd.value; try { localStorage.setItem('densidade', sd.value); } catch { /* ignora */ } toast('Densidade salva. Vale nas próximas listas.', 'ok', 2500); } });

  const atual = senhaInput({ autocomplete: 'current-password' }); const nova = senhaInput({ autocomplete: 'new-password' });
  const trocar = sec('Trocar senha', h('p', { class: 'muted' }, 'Mínimo de 8 caracteres (pode ser mais longa). Encerra as outras sessões.'), campo('Senha atual', atual.el), campo('Nova senha', nova.el),
    h('button', { class: 'btn primario', onclick: async () => { try { await api.post('/api/senha/trocar', { senha_atual: atual.input.value, senha_nova: nova.input.value }); atual.input.value = nova.input.value = ''; toast('Senha alterada. Outras sessões foram encerradas.', 'ok', 6000); carregarSessoes(); } catch (e) { tratar(e); } } }, 'Trocar senha'));

  // E-mail da conta: serve para entrar só com e-mail e senha. Troca/vínculo confirmado por um código enviado ao próprio e-mail.
  const u = sessao.usuario;
  const status = h('p', { class: 'row' });
  const pintarStatus = (email, ok) => limpar(status).append(email ? [h('span', { class: 'mono' }, email), badge(ok ? 'confirmado' : 'não confirmado', ok ? 'ok' : 'aviso')] : badge('sem e-mail', 'aviso'));
  pintarStatus(u?.email, u?.email_verificado);
  const caixaEmail = h('div', { class: 'stack' });
  const novoEmail = entrada({ inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', placeholder: 'voce@gmail.com' });
  const pedirCodigo = async () => {
    const para = novoEmail.value.trim();
    try { await api.post('/api/conta/email', { email: para }); } catch (e) { return tratar(e); }
    const cod = entrada({ inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', placeholder: '000000', class: 'codigo-6', autofocus: true });
    limpar(caixaEmail).append(h('p', { class: 'muted' }, `Enviamos um código de 6 dígitos para ${para}. Vale por 10 minutos.`), campo('Código', cod),
      h('button', { class: 'btn primario', onclick: async () => {
        try {
          await api.post('/api/conta/email/confirmar', { codigo: cod.value.trim() });
          const s = await api.get('/api/sessao'); pintarStatus(s.usuario?.email, s.usuario?.email_verificado);
          limpar(caixaEmail); toast('E-mail confirmado. Agora você pode entrar com ele.', 'ok', 6000);
        } catch (e) { tratar(e); cod.select(); }
      } }, 'Confirmar e-mail'));
  };
  const emailSec = sec('E-mail da conta', status,
    sessao.cadastro_disponivel
      ? [campo('Novo e-mail (Gmail)', novoEmail), h('button', { class: 'btn', onclick: pedirCodigo }, icone('mail', 18), 'Enviar código de confirmação'), caixaEmail]
      : h('p', { class: 'muted' }, 'O envio de e-mail ainda não foi ligado pelo dono do sistema.'),
    u?.dono && sessao.cadastro_disponivel ? h('button', { class: 'btn fantasma', onclick: async () => { try { await api.post('/api/email/testar', {}); toast('E-mail de teste enviado para você.', 'ok'); } catch (e) { tratar(e); } } }, 'Enviar e-mail de teste para mim') : null);

  const alvoSessoes = h('div');
  const carregarSessoes = () => carregar(alvoSessoes, () => api.get('/api/sessoes'), (d) => alvoSessoes.append(tabela([
    { titulo: 'Dispositivo', render: (s) => h('span', { class: 'quebra' }, `${s.user_agent?.slice(0, 60) || '—'}${s.atual ? ' (esta)' : ''}`) }, { titulo: 'IP', render: (s) => h('span', { class: 'mono' }, s.ip ?? '—') }, { titulo: 'Último uso', render: (s) => fmt.dataHora(s.ultimo_uso) },
    { titulo: '', render: (s) => (s.atual ? badge('atual', 'ok') : h('button', { class: 'btn pequeno', onclick: async () => { try { await api.del(`/api/sessoes/${s.id}`); carregarSessoes(); } catch (e) { tratar(e); } } }, 'Encerrar')) }], d.sessoes),
  d.sessoes.length > 1 ? h('button', { class: 'btn perigo', onclick: async () => { try { const r = await api.post('/api/sessoes/sair-todas'); toast(`${r.revogadas} sessão(ões) encerrada(s).`, 'ok'); carregarSessoes(); } catch (e) { tratar(e); } } }, 'Sair de todos os outros dispositivos') : null));

  const podeAud = !!sessao.usuario?.permissoes?.includes('auditoria.ver'); // histórico e verificação: só quem o dono liberou
  const alvoAud = h('div'); let pagAud = 1;
  const lerAud = () => carregar(alvoAud, () => api.get(`/api/auditoria?${qs({ pagina: pagAud, por_pagina: 15 })}`), (d) => alvoAud.append(tabela([{ titulo: 'Quando', render: (a) => fmt.dataHora(a.ts) }, { titulo: 'Ação', render: (a) => a.acao }, { titulo: 'Objeto', render: (a) => `${a.entidade ?? ''} ${a.entidade_id ?? ''}` }, { titulo: 'IP', render: (a) => h('span', { class: 'mono' }, a.ip ?? '') }], d.itens, { compacta: true }), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagAud = n; lerAud(); })));
  const verif = h('p', { role: 'status' });
  const auditoria = sec('Auditoria', h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
    try { const r = await api.get('/api/auditoria/verificar'); const e = sessao.usuario.permissoes.includes('estoque.ver') ? await api.get('/api/estoque/integridade') : { ok: true }; limpar(verif).append(r.ok ? badge(`Cadeia íntegra (${r.total} registros)`, 'ok') : badge(`Cadeia QUEBRADA no registro ${r.quebrouEm}`, 'erro'), ' ', e.ok ? badge('Estoque confere com o livro-razão', 'ok') : badge(`${e.divergencias.length} divergência(s) de estoque`, 'erro')); } catch (x) { tratar(x); }
  } }, icone('shield'), 'Verificar integridade')), verif, alvoAud);

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Configurações'))),
    h('div', { class: 'grid cols-2' }, sec('Aparência', campo('Tema', st), campo('Densidade das tabelas', sd)), emailSec), trocar, sec('Sessões ativas', alvoSessoes), podeAud && auditoria);
  carregarSessoes(); if (podeAud) lerAud();
}
