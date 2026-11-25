// Equipe e permissões: só o dono entra aqui. Ele cadastra pessoas, escolhe o que cada uma pode fazer (inclusive o financeiro) e pode
// desativar ou redefinir a senha, e libera o acesso de quem criou a conta sozinho pelo e-mail. Tudo é conferido de novo no servidor; esta tela é só o painel de controle.
import { h, limpar, api, carregar, icone, badge, toast, tratar, gaveta, modal, confirmar, campo, copiar, fmt, vazio } from './core.js';

const formatarLogin = (l) => (l ? `${l.slice(0, 3)}.${l.slice(3, 6)}.${l.slice(6, 9)}-${l.slice(9)}` : '—');

/** Mostra as credenciais UMA vez (a senha provisória não fica guardada em lugar nenhum). */
function mostrarCredenciais(p, titulo) {
  modal(titulo, h('div', { class: 'stack' },
    h('p', null, `Passe estes dados para ${p.nome}. Ela vai trocar a senha no primeiro acesso.`),
    h('div', { class: 'card stack' },
      h('div', { class: 'lista' },
        h('div', null, h('span', { class: 'muted' }, p.login ? 'Login (11 dígitos)' : 'Login (e-mail)'), h('strong', { class: 'mono' }, p.login ? formatarLogin(p.login) : p.email ?? '—'), h('button', { class: 'btn pequeno', onclick: () => copiar(p.login ?? p.email ?? '') }, 'Copiar')),
        h('div', null, h('span', { class: 'muted' }, 'Senha provisória'), h('strong', { class: 'mono' }, p.senha_provisoria), h('button', { class: 'btn pequeno', onclick: () => copiar(p.senha_provisoria) }, 'Copiar')))),
    h('p', { class: 'aviso-txt' }, 'A senha provisória só aparece agora. Se perder, use “Redefinir senha”.')), { largo: true });
}

export async function renderizar(el) {
  const alvo = h('div', { class: 'stack' });
  let catalogo;
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Equipe e permissões'), h('p', null, 'Só você, dono do sistema, escolhe quem entra e o que cada pessoa pode fazer.')),
    h('button', { class: 'btn primario', 'data-novo': true, onclick: () => editar(null) }, icone('plus'), 'Adicionar pessoa')), alvo);

  const rotuloPapel = (u) => (u.dono ? 'Dono' : u.pendente ? 'Criou a conta pelo e-mail' : catalogo.papeis[u.papel]?.rotulo ?? 'Personalizado');
  const temFin = (u) => u.dono || u.permissoes?.includes('financeiro.ver');

  async function listar() {
    await carregar(alvo, async () => { catalogo ??= await api.get('/api/equipe/catalogo'); return await api.get('/api/equipe'); }, (d) => {
      alvo.append(h('div', { class: 'equipe-grade' }, d.itens.map(cartao)));
    });
  }

  function cartao(u) {
    const acoes = u.dono ? [h('span', { class: 'muted' }, 'Conta principal: acesso total, não pode ser alterada.')] : [
      h('button', { class: `btn pequeno ${u.pendente ? 'primario' : ''}`, onclick: () => editar(u) }, icone('edit', 16), u.pendente ? 'Liberar acesso' : 'Permissões'),
      h('button', { class: 'btn pequeno', onclick: () => agir(u, 'redefinir-senha', 'Redefinir a senha?', `${u.nome} será desconectada de todos os aparelhos e precisará usar a nova senha provisória.`, true) }, 'Redefinir senha'),
      u.ativo ? h('button', { class: 'btn pequeno perigo', onclick: () => agir(u, 'desativar', 'Desativar acesso?', `${u.nome} perde o acesso agora e é desconectada de todos os aparelhos. Você pode reativar depois.`) }, 'Desativar')
        : h('button', { class: 'btn pequeno', onclick: () => agir(u, 'reativar', 'Reativar acesso?', `${u.nome} volta a poder entrar com a senha que já tinha.`) }, 'Reativar'),
    ];
    return h('section', { class: `card pessoa ${u.ativo ? '' : 'inativa'}` },
      h('div', { class: 'row' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.nome.slice(0, 1).toUpperCase()), h('div', { class: 'grow' }, h('strong', null, u.nome), h('div', { class: 'muted' }, rotuloPapel(u)))),
      h('div', { class: 'chips' }, u.dono ? badge('Acesso total', 'info') : u.pendente ? badge('Aguardando liberação', 'aviso') : badge(u.ativo ? 'Ativo' : 'Desativado', u.ativo ? 'ok' : 'erro'),
        !u.pendente && badge(temFin(u) ? 'Vê o financeiro' : 'Sem financeiro', temFin(u) ? 'aviso' : ''), u.email ? badge(u.email_verificado ? 'E-mail confirmado' : 'E-mail não confirmado', u.email_verificado ? 'ok' : 'aviso') : u.trocar_senha ? badge('Aguardando 1º acesso', 'aviso') : null),
      !u.dono && h('p', { class: 'muted quebra' }, `${u.pendente ? 'Sem nenhuma permissão ainda' : `${u.permissoes.length} permissão(ões)`}${u.email ? ` · ${u.email}` : ''}${u.login ? ` · login ${formatarLogin(u.login)}` : ''} · criada em ${fmt.dataHora(u.criado_em)}`),
      h('div', { class: 'row' }, acoes));
  }

  async function agir(u, acao, titulo, texto, mostrar = false) {
    if (!await confirmar(titulo, texto, { perigo: acao === 'desativar', rotulo: 'Confirmar' })) return;
    try {
      const r = await api.post(`/api/equipe/${u.id}/${acao}`, {});
      if (mostrar) mostrarCredenciais(r, 'Nova senha provisória'); else toast('Feito.', 'ok');
      listar();
    } catch (e) { tratar(e); }
  }

  function editar(u) {
    const nome = h('input', { type: 'text', maxlength: 80, value: u?.nome ?? '', autocomplete: 'off', placeholder: 'Nome da pessoa' });
    const papeis = Object.entries(catalogo.papeis);
    const papelInicial = u?.pendente ? 'consulta' : u?.papel; // quem acabou de criar a conta começa só com consulta
    const seletor = h('select', null, [...papeis.map(([id, p]) => h('option', { value: id, selected: papelInicial === id }, `${p.rotulo} — ${p.descricao}`)), h('option', { value: 'personalizado', selected: papelInicial === 'personalizado' }, 'Personalizado — escolho item por item')]);
    const marcas = new Map();
    const aplicar = (lista) => marcas.forEach((c, id) => { c.checked = lista.includes(id); });
    seletor.addEventListener('change', () => { if (seletor.value !== 'personalizado') aplicar(catalogo.papeis[seletor.value].permissoes); });
    const grupos = catalogo.grupos.map((g) => h('fieldset', { class: `permissoes ${g.id === 'financeiro' ? 'financeiro' : ''}` }, h('legend', null, g.rotulo),
      g.id === 'financeiro' && h('p', { class: 'aviso-txt' }, 'Dá acesso a custos, preços e valores de pedidos. Marque só para quem você confia.'),
      g.itens.filter(([id]) => id !== 'usuarios.gerenciar' && id !== 'vendas.configurar').map(([id, rotulo]) => {
        const c = h('input', { type: 'checkbox', checked: u && !u.pendente ? u.permissoes.includes(id) : false, onchange: () => { seletor.value = 'personalizado'; } });
        marcas.set(id, c); return h('label', { class: 'check' }, c, rotulo);
      })));
    if (!u || u.pendente) aplicar(catalogo.papeis[seletor.value].permissoes);
    const erro = h('p', { class: 'erro', role: 'alert' });
    let g;
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      const corpo = { nome: nome.value.trim(), papel: seletor.value, permissoes: [...marcas].filter(([, c]) => c.checked).map(([id]) => id) };
      try {
        const r = u ? await api.put(`/api/equipe/${u.id}`, corpo) : await api.post('/api/equipe', corpo);
        g.fechar(); listar();
        if (u?.pendente) toast(`Acesso de ${u.nome} liberado. Vale na próxima ação dela.`, 'ok', 6000); else if (u) toast('Permissões atualizadas. Valem na próxima ação da pessoa.', 'ok', 6000); else mostrarCredenciais(r, 'Pessoa cadastrada');
      } catch (x) { erro.textContent = x.campos ? Object.values(x.campos).join(' ') : x.message; }
    } }, campo('Nome', nome), campo('Modelo de acesso', seletor, { ajuda: 'Escolha um modelo e ajuste item por item se quiser.' }), grupos, erro,
    h('div', { class: 'row' }, h('button', { class: 'btn primario', type: 'submit' }, u?.pendente ? 'Liberar acesso' : u ? 'Salvar permissões' : 'Cadastrar e gerar senha'), h('button', { class: 'btn', type: 'button', onclick: () => g.fechar() }, 'Cancelar')));
    g = gaveta(u?.pendente ? `Liberar acesso de ${u.nome}` : u ? `Permissões de ${u.nome}` : 'Adicionar pessoa', form);
  }

  await listar();
  if (!alvo.querySelector('.pessoa')) alvo.append(vazio('Ninguém cadastrado ainda'));
}
