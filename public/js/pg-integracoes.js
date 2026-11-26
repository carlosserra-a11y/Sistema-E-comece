import { h, limpar, api, carregar, icone, fmt, badge, qs, tratar, toast, tabela, paginacao, abas, vazio, campo, confirmar, copiar, modal, pode } from './core.js';

const COR = { verde: 'ok', amarelo: 'aviso', vermelho: 'erro', cinza: '' };
const ROTULO_COR = { verde: 'Saudável', amarelo: 'Atenção', vermelho: 'Com problema', cinza: 'Inativa' };
const ST_PEDIDO = { NOVO: ['Novo', 'info'], PAGO: ['Pago', 'ok'], COM_PROBLEMA: ['Com problema', 'erro'], CANCELADO: ['Cancelado', ''] };
const ERROS = { estado: 'O link de autorização expirou ou já foi usado. Tente conectar de novo.', negado: 'A autorização foi negada ou cancelada no Mercado Livre.', conexao: 'Não consegui concluir a conexão. Confira o App ID e a chave secreta.' };

let veFin = false; // sem permissão financeira o servidor nem envia os valores; aqui só escondemos as colunas

export async function renderizar(el, { params, sessao }) {
  veFin = !!sessao?.usuario?.permissoes?.includes('financeiro.ver');
  if (params.get('conectado')) toast(params.get('trocou') ? 'Conectado a OUTRA conta de vendedor: a sincronização dos anúncios antigos foi desligada.' : 'Mercado Livre conectado.', params.get('trocou') ? 'aviso' : 'ok', 8000);
  if (params.get('erro')) toast(ERROS[params.get('erro')] ?? 'Falha ao conectar.', 'erro', 9000);
  const topo = h('div', { class: 'stack' }); const painel = h('div', { class: 'stack' });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Integrações'), h('p', null, 'Mercado Livre: pedidos entram sozinhos e o estoque sai para os anúncios.'))), topo, painel);
  let aba = 'pedidos';

  async function ler() {
    let d; try { d = (await api.get('/api/integracoes')).ml; } catch (e) { return limpar(topo).append(h('p', { class: 'perigo-txt' }, e.message)); }
    limpar(topo).append(cartao(d), configuracao(d));
    desenharAba(d);
  }

  function cartao(d) {
    const conectada = d.status === 'CONECTADA';
    return h('section', { class: 'card stack' },
      h('div', { class: 'row' }, h('h2', null, 'Mercado Livre'), badge(ROTULO_COR[d.saude.cor], COR[d.saude.cor]), h('span', { class: 'muted' }, d.saude.motivo)),
      h('div', { class: 'cols-2' },
        h('div', { class: 'kpi' }, h('div', { class: 'rotulo' }, 'Conta'), h('div', null, conectada || d.status === 'REAUTORIZAR' ? `Vendedor ${d.vendedor_id}` : '—')),
        h('div', { class: 'kpi' }, h('div', { class: 'rotulo' }, 'Último pedido sincronizado'), h('div', null, d.ultima_sync_pedidos_em ? fmt.dataHora(d.ultima_sync_pedidos_em) : '—')),
        h('div', { class: 'kpi' }, h('div', { class: 'rotulo' }, 'Último estoque enviado'), h('div', null, d.ultima_sync_estoque_em ? fmt.dataHora(d.ultima_sync_estoque_em) : '—')),
        h('div', { class: 'kpi' }, h('div', { class: 'rotulo' }, 'Pedidos'), h('div', { class: 'row' }, badge(`${d.pedidos.novos} novos`, 'info'), badge(`${d.pedidos.pagos} pagos`, 'ok'), badge(`${d.pedidos.com_problema} com problema`, d.pedidos.com_problema ? 'erro' : 'ok')))),
      d.sem_mapeamento ? h('p', { class: 'perigo-txt', role: 'alert' }, `${d.sem_mapeamento} item(ns) de pedido sem produto mapeado. Mapeie o anúncio na aba "Anúncios ML" do produto e reprocesse o pedido.`) : null,
      d.ultimo_erro ? h('p', { class: 'perigo-txt' }, `Último erro: ${d.ultimo_erro}`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primario', 'data-requer': 'integracoes.gerenciar', disabled: !d.app_configurado, onclick: conectar }, icone('refresh'), conectada ? 'Reconectar' : d.status === 'REAUTORIZAR' ? 'Reautorizar' : 'Conectar conta'),
        h('button', { class: 'btn', 'data-requer': 'integracoes.gerenciar', disabled: !conectada, onclick: sincronizar }, 'Sincronizar agora'),
        h('button', { class: 'btn perigo', 'data-requer': 'integracoes.gerenciar', disabled: !conectada && d.status !== 'REAUTORIZAR', onclick: desconectar }, 'Desconectar')));
  }

  async function conectar() { try { const r = await api.post('/api/integracoes/ml/conectar'); location.assign(r.url); } catch (e) { tratar(e); } }
  async function sincronizar() {
    toast('Sincronizando…', 'info', 1500);
    try { const r = await api.post('/api/integracoes/ml/sincronizar', {}); toast(`Pedidos: ${r.pedidos.novos} novo(s), ${r.pedidos.atualizados} atualizado(s). Estoque: ${r.estoque.enviados} anúncio(s) atualizado(s).`, 'ok', 6000); } catch (e) { tratar(e); }
    ler();
  }
  async function desconectar() {
    if (!(await confirmar('Desconectar o Mercado Livre', 'Os tokens são apagados deste sistema e a sincronização para. Para revogar também no Mercado Livre, remova o aplicativo em "Minha conta → Aplicativos conectados".', { perigo: true, rotulo: 'Desconectar' }))) return;
    try { await api.post('/api/integracoes/ml/desconectar', {}); toast('Desconectado.', 'ok'); } catch (e) { tratar(e); }
    ler();
  }

  function configuracao(d) {
    const appId = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 1234567890123456' });
    const segredo = h('input', { type: 'password', autocomplete: 'off', placeholder: d.app_configurado ? 'Deixe em branco para manter a atual' : 'Chave secreta do aplicativo' });
    const margem = h('input', { type: 'number', min: 0, value: d.margem_seguranca }); const pausar = h('input', { type: 'checkbox', checked: d.pausar_sem_estoque }); const sync = h('input', { type: 'checkbox', checked: d.sync_estoque });
    const linhaUrl = (rotulo, valor) => h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, rotulo), h('div', { class: 'row' }, h('code', { class: 'grow quebra' }, valor), h('button', { class: 'btn pequeno', type: 'button', onclick: () => copiar(valor) }, 'Copiar')));
    return h('details', { class: 'card', open: !d.app_configurado }, h('summary', null, h('strong', null, 'Configuração do aplicativo e do estoque')),
      h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'Crie um aplicativo em developers.mercadolivre.com.br (uso próprio) e informe abaixo. A chave fica criptografada e nunca volta para a tela.'),
        linhaUrl('URL de redirecionamento (cadastre no aplicativo)', d.redirect_uri), linhaUrl('URL de notificações — tópico orders_v2 (cadastre no aplicativo)', d.webhook_url),
        h('p', { class: 'muted' }, 'O Mercado Livre só envia notificações para um endereço público em HTTPS. Em testes locais, a sincronização periódica traz os pedidos do mesmo jeito.'),
        h('form', { class: 'stack', onsubmit: async (e) => {
          e.preventDefault();
          try { await api.put('/api/integracoes/ml/config', { app_id: appId.value || undefined, app_secret: segredo.value || undefined, margem_seguranca: Number(margem.value) || 0, pausar_sem_estoque: pausar.checked ? 1 : 0, sync_estoque: sync.checked ? 1 : 0 }); segredo.value = ''; toast('Configuração salva.', 'ok'); ler(); } catch (x) { tratar(x); }
        } },
        h('div', { class: 'cols-2' }, campo('App ID', appId, { ajuda: d.app_configurado ? 'Já configurado. Informe de novo só para alterar (alterar desconecta a conta).' : undefined }), campo('Chave secreta', segredo)),
        campo('Margem de segurança (unidades que NÃO vão para o anúncio)', margem, { ajuda: 'Anúncio recebe: disponível − reservas − margem.' }),
        h('label', { class: 'check' }, sync, 'Enviar o estoque para os anúncios'), h('label', { class: 'check' }, pausar, 'Pausar o anúncio quando o estoque chegar a zero (e reativar quando voltar)'),
        h('div', { class: 'row' }, h('button', { class: 'btn primario', 'data-requer': 'integracoes.gerenciar', type: 'submit' }, 'Salvar (pede sua senha)'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmar('Girar o segredo do webhook', 'A URL de notificações antiga deixa de funcionar. Você precisará cadastrar a nova no aplicativo.', { rotulo: 'Girar' })) { try { await api.post('/api/integracoes/ml/rotacionar-webhook', {}); toast('Novo segredo gerado.', 'ok'); ler(); } catch (x) { tratar(x); } } } }, 'Girar segredo do webhook')))));
  }

  function desenharAba(d) {
    limpar(painel).append(abas([['pedidos', 'Pedidos'], ['anuncios', 'Anúncios'], ['jobs', 'Sincronizações']], aba, (id) => { aba = id; desenharAba(d); }), h('div', { id: 'conteudo-aba' }));
    const alvo = painel.querySelector('#conteudo-aba');
    ({ pedidos: abaPedidos, anuncios: abaAnuncios, jobs: abaJobs })[aba](alvo, d);
  }

  function abaPedidos(alvo) {
    let status = ''; let pagina = 1;
    const ler2 = () => carregar(alvo, () => api.get(`/api/pedidos?${qs({ status, pagina, por_pagina: 20 })}`), (p) => alvo.append(
      h('div', { class: 'chips' }, [['', 'Todos'], ['NOVO', 'Novos'], ['PAGO', 'Pagos'], ['COM_PROBLEMA', 'Com problema'], ['CANCELADO', 'Cancelados']].map(([v, r]) => h('button', { class: 'chip', 'aria-pressed': v === status, onclick: () => { status = v; pagina = 1; alvo.replaceChildren(); ler2(); } }, r))),
      p.total ? tabela([{ titulo: 'Pedido', render: (x) => h('strong', { class: 'mono' }, x.canal_pedido_id) }, { titulo: 'Situação', render: (x) => badge(...ST_PEDIDO[x.status]) }, { titulo: 'Comprador', chave: 'comprador_apelido' }, { titulo: 'Un.', num: true, chave: 'unidades' },
        ...(veFin ? [{ titulo: 'Total', num: true, render: (x) => fmt.moeda(x.total_centavos) }] : []), { titulo: 'Data', render: (x) => fmt.dataHora(x.data_canal) }, { titulo: 'Observação', render: (x) => h('span', { class: 'quebra perigo-txt' }, x.problema ?? '') }], p.itens, { aoClicar: (x) => detalhe(x.id), compacta: true })
        : vazio('Nenhum pedido ainda', 'Os pedidos aparecem aqui quando o Mercado Livre os enviar.'), paginacao(p.total, p.pagina, p.por_pagina, (n) => { pagina = n; alvo.replaceChildren(); ler2(); })));
    ler2();
  }
  async function detalhe(id) {
    try {
      const p = await api.get(`/api/pedidos/${id}`);
      const m = modal(`Pedido ${p.canal_pedido_id}`, h('div', { class: 'stack' }, h('div', { class: 'row' }, badge(...ST_PEDIDO[p.status]), h('span', { class: 'muted' }, `Comprador ${p.comprador_apelido ?? '—'}${veFin ? ` · ${fmt.moeda(p.total_centavos)}` : ''}`)), p.problema ? h('p', { class: 'perigo-txt' }, p.problema) : null,
        tabela([{ titulo: 'Anúncio', render: (i) => h('span', { class: 'mono' }, i.item_id) }, { titulo: 'SKU do vendedor', render: (i) => i.sku_canal ?? '—' }, { titulo: 'Produto', render: (i) => i.sku_interno ?? badge('sem mapeamento', 'erro') }, { titulo: 'Qtd', num: true, chave: 'qtd' }, { titulo: 'Reserva', render: (i) => (i.reserva ? badge(i.reserva.toLowerCase(), i.reserva === 'ATIVA' ? 'ok' : '') : '—') }], p.itens, { compacta: true }),
        p.status === 'PAGO' && p.itens.every((i) => i.reserva === 'ATIVA') && pode('expedicao.ver') ? h('a', { class: 'btn primario', href: `#/expedicao?pedido=${id}` }, icone('send', 18), 'Separar na Expedição') : null,
        p.itens.some((i) => i.reserva === 'ATIVA') ? h('button', { class: 'btn', 'data-requer': 'pedidos.gerenciar', onclick: async () => { if (!await confirmar('Marcar como enviado sem a Expedição?', 'O normal é separar e expedir pela tela Expedição, que dá a baixa sozinha. Use isto só se as peças já saíram e a baixa foi feita à mão em Estoque: aqui nada é baixado.', { rotulo: 'Marcar como enviado' })) return; try { await api.post(`/api/pedidos/${id}/enviado`, {}); m.fechar(); toast('Reserva liberada.', 'ok'); } catch (e) { tratar(e); } } }, 'Já dei baixa à mão') : null,
        p.status === 'COM_PROBLEMA' ? h('button', { class: 'btn primario', 'data-requer': 'pedidos.gerenciar', onclick: async () => { try { const r = await api.post(`/api/pedidos/${id}/reprocessar`, {}); m.fechar(); toast(r.problema ? `Ainda com problema: ${r.problema}` : 'Pedido reprocessado.', r.problema ? 'aviso' : 'ok', 6000); ler(); } catch (e) { tratar(e); } } }, 'Reprocessar') : null), { largo: true });
    } catch (e) { tratar(e); }
  }

  function abaAnuncios(alvo) {
    const ler2 = () => carregar(alvo, () => api.get('/api/anuncios'), (d) => alvo.append(d.itens.length ? tabela([
      { titulo: 'SKU', render: (x) => h('strong', { class: 'mono' }, x.sku) }, { titulo: 'Anúncio', render: (x) => h('span', { class: 'mono' }, `${x.item_id}${x.variacao_id ? ` / ${x.variacao_id}` : ''}`) }, { titulo: 'Título', render: (x) => h('span', { class: 'quebra' }, x.titulo ?? '—') },
      { titulo: 'Disponível', num: true, chave: 'disponivel' }, { titulo: 'Enviado', num: true, render: (x) => x.ultima_qtd_enviada ?? '—' },
      { titulo: 'Situação', render: (x) => (x.ultimo_erro ? h('span', { class: 'perigo-txt quebra' }, x.ultimo_erro) : x.sync_ativo ? badge('sincronizando', 'ok') : badge('desligado')) },
      { titulo: '', render: (x) => h('span', { class: 'row' }, h('button', { class: 'btn pequeno', onclick: async () => { try { await api.put(`/api/anuncios/${x.id}`, { sync_ativo: x.sync_ativo ? 0 : 1 }); alvo.replaceChildren(); ler2(); } catch (e) { tratar(e); } } }, x.sync_ativo ? 'Pausar' : 'Ligar'),
        h('button', { class: 'btn pequeno fantasma', 'aria-label': `Remover ${x.item_id}`, onclick: async () => { if (await confirmar('Remover mapeamento', `O anúncio ${x.item_id} deixa de receber estoque.`, { perigo: true, rotulo: 'Remover' })) { try { await api.del(`/api/anuncios/${x.id}`); alvo.replaceChildren(); ler2(); } catch (e) { tratar(e); } } } }, icone('trash', 16))) }], d.itens, { compacta: true })
      : vazio('Nenhum anúncio mapeado', 'Abra um produto e use a aba "Anúncios ML", ou deixe o SKU do vendedor igual ao SKU daqui: o primeiro pedido mapeia sozinho.')));
    ler2();
  }
  function abaJobs(alvo, d) {
    alvo.append(d.jobs.length ? tabela([{ titulo: 'Quando', render: (j) => fmt.dataHora(j.iniciado_em) }, { titulo: 'Tipo', chave: 'tipo' }, { titulo: 'Origem', render: (j) => j.origem.toLowerCase() }, { titulo: 'Itens', num: true, chave: 'itens' },
      { titulo: 'Resultado', render: (j) => (j.ok === 1 ? badge('ok', 'ok') : j.ok === 0 ? h('span', { class: 'perigo-txt quebra' }, j.erro ?? 'falhou') : badge('em andamento')) }], d.jobs, { compacta: true }) : vazio('Nenhuma sincronização ainda'));
  }
  await ler();
}
