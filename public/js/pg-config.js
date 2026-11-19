import { h, limpar, api, carregar, icone, fmt, badge, tratar, toast, tabela, campo, confirmar, copiar, baixarArquivo, selecao, vazio, paginacao, qs } from './core.js';
import { definirTema } from './main.js';

export async function renderizar(el, { sessao }) {
  const sec = (titulo, ...filhos) => h('section', { class: 'card stack' }, h('h2', null, titulo), ...filhos);
  let tema = 'escuro'; let dens = 'confortavel'; try { tema = localStorage.getItem('tema') || 'escuro'; dens = localStorage.getItem('densidade') || 'confortavel'; } catch { /* ignora */ }
  const st = selecao([['escuro', 'Escuro (padrão)'], ['claro', 'Claro'], ['auto', 'Automático (segue o sistema)'], ['contraste', 'Alto contraste']], tema, { 'aria-label': 'Tema', onchange: () => definirTema(st.value) });
  const sd = selecao([['confortavel', 'Confortável'], ['compacta', 'Compacta']], dens, { 'aria-label': 'Densidade', onchange: () => { document.documentElement.dataset.densidade = sd.value; try { localStorage.setItem('densidade', sd.value); } catch { /* ignora */ } toast('Densidade salva. Vale nas próximas listas.', 'ok', 2500); } });

  const atual = h('input', { type: 'password', autocomplete: 'current-password' }); const nova = h('input', { type: 'password', autocomplete: 'new-password' });
  const trocar = sec('Trocar senha', h('p', { class: 'muted' }, 'Mínimo de 12 caracteres, sem datas nem sequências. Encerra as outras sessões.'), campo('Senha atual', atual), campo('Nova senha', nova),
    h('button', { class: 'btn primario', onclick: async () => { try { await api.post('/api/senha/trocar', { senha_atual: atual.value, senha_nova: nova.value }); atual.value = nova.value = ''; toast('Senha alterada. Outras sessões foram encerradas.', 'ok', 6000); carregarSessoes(); } catch (e) { tratar(e); } } }, 'Trocar senha'));

  const codigos = h('div', { class: 'stack' });
  const mfa = sec('Verificação em duas etapas', h('p', null, sessao.usuario?.mfa_ativo ? badge('ativa', 'ok') : badge('desligada', 'erro')),
    h('button', { class: 'btn', onclick: async () => {
      if (!(await confirmar('Gerar novos códigos de recuperação', 'Os códigos antigos deixam de valer. Os novos aparecem uma única vez.', { rotulo: 'Gerar' }))) return;
      try { const r = await api.post('/api/mfa/regenerar'); const t = r.codigos_recuperacao.join('\n'); limpar(codigos).append(h('p', { class: 'muted' }, 'Mostrados só agora:'), h('div', { class: 'codigos' }, r.codigos_recuperacao.map((c) => h('span', null, c))), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => copiar(t) }, 'Copiar'), h('button', { class: 'btn', onclick: () => baixarArquivo('codigos-recuperacao.txt', `${t}\n`) }, 'Baixar'))); } catch (e) { tratar(e); }
    } }, 'Gerar novos códigos de recuperação'), codigos);

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
    h('div', { class: 'grid cols-2' }, sec('Aparência', campo('Tema', st), campo('Densidade das tabelas', sd)), mfa), trocar, sec('Sessões ativas', alvoSessoes), podeAud && auditoria);
  carregarSessoes(); if (podeAud) lerAud();
}
