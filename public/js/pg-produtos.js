import { h, limpar, api, carregar, icone, fmt, badge, qs, tratar, toast, tabela, paginacao, gaveta, modal, abas, confirmar, vazio, copiar, svgDataUrl, ApiError, esqueleto } from './core.js';
import { formulario } from './form.js';

const UNIDADES = ['UN', 'CX', 'KG', 'PC', 'PAR', 'LT', 'MT'].map((u) => [u, u]);
const CAMPOS = [
  ['sku', 'SKU', 'texto', { max: 40, ajuda: 'Letras, números, . _ -' }], ['nome', 'Nome', 'texto', { max: 160 }],
  ['marca', 'Marca', 'texto', { max: 80 }], ['categoria', 'Categoria', 'texto', { max: 80 }],
  ['unidade', 'Unidade', 'select', { opcoes: UNIDADES, padrao: 'UN' }], ['ncm', 'NCM', 'texto', { max: 8, inputmode: 'numeric' }],
  ['custo_centavos', 'Custo (R$)', 'moeda'], ['preco_centavos', 'Preço (R$)', 'moeda'],
  ['peso_g', 'Peso (g)', 'int'], ['comp_mm', 'Comprimento (mm)', 'int'], ['larg_mm', 'Largura (mm)', 'int'], ['alt_mm', 'Altura (mm)', 'int'],
  ['estoque_min', 'Estoque mínimo', 'int'], ['estoque_max', 'Estoque máximo', 'int'], ['ponto_pedido', 'Ponto de pedido', 'int'],
  ['controla_lote', 'Controla lote', 'check'], ['controla_validade', 'Controla validade', 'check'],
  ['descricao', 'Descrição', 'area', { max: 2000 }],
];

let veFinanceiro = false; // preenchido em renderizar: sem a permissão, custo e preço nem aparecem no formulário
const campos = () => (veFinanceiro ? CAMPOS : CAMPOS.filter(([k]) => k !== 'custo_centavos' && k !== 'preco_centavos'));

export async function renderizar(el, { params, sessao }) {
  veFinanceiro = !!sessao?.usuario?.permissoes?.includes('financeiro.ver');
  let filtro = 'ativos'; let q = ''; let pagina = 1;
  const alvo = h('div', { class: 'stack' });
  const busca = h('input', { type: 'search', placeholder: 'Buscar por nome, SKU ou código de barras', 'aria-label': 'Buscar produtos', autocomplete: 'off' });
  let t; busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = busca.value; pagina = 1; listar(); }, 250); });
  const FILTROS = [['ativos', 'Ativos'], ['sem_codigo', 'Sem código'], ['abaixo', 'Abaixo do mínimo'], ['zerados', 'Sem estoque'], ['inativos', 'Inativos']];
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtros' }, FILTROS.map(([id, r]) => h('button', { class: 'chip', 'aria-pressed': id === filtro, onclick: (e) => { filtro = id; pagina = 1; chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === e.currentTarget)); listar(); } }, r)));

  function listar() {
    const p = { q, pagina, por_pagina: 25, ativo: filtro === 'inativos' ? '0' : '', sem_codigo: filtro === 'sem_codigo' ? 1 : '', abaixo_minimo: filtro === 'abaixo' ? 1 : '', zerados: filtro === 'zerados' ? 1 : '' };
    carregar(alvo, () => api.get(`/api/produtos?${qs(p)}`), (d) => {
      alvo.append(d.total === 0 ? vazio('Nenhum produto encontrado', q ? 'Tente outra busca.' : 'Cadastre o primeiro produto.', h('button', { class: 'btn primario', 'data-requer': 'produtos.editar', onclick: () => novo() }, 'Novo produto'))
        : tabela([
          { titulo: 'SKU', render: (x) => h('strong', { class: 'mono' }, x.sku) }, { titulo: 'Produto', render: (x) => h('span', { class: 'quebra' }, x.nome) },
          { titulo: 'Código', render: (x) => (x.codigo_principal ? h('span', { class: 'mono' }, x.codigo_principal) : badge('sem código', 'aviso')) },
          { titulo: 'Disponível', num: true, render: (x) => (x.estoque_min > 0 && x.saldo_vendavel < x.estoque_min ? badge(`${fmt.num(x.saldo_vendavel)} ↓`, x.saldo_vendavel === 0 ? 'erro' : 'aviso') : fmt.num(x.saldo_vendavel)) },
          { titulo: 'Total', num: true, render: (x) => fmt.num(x.saldo_total) },
        ], d.itens, { aoClicar: (x) => abrir(x.id), compacta: document.documentElement.dataset.densidade === 'compacta' }), paginacao(d.total, d.pagina, d.por_pagina, (n) => { pagina = n; listar(); }));
    });
  }

  function novo() {
    let g;
    const f = formulario(campos(), { unidade: 'UN' }, async (v) => {
      try { const r = await api.post('/api/produtos', { ...v, gerar_codigo: gerar.checked ? 1 : 0, codigo_barras: cod.value.trim() || undefined }); g.fechar(); toast('Produto criado.', 'ok'); listar(); abrir(r.id); }
      catch (e) { if (e instanceof ApiError && e.campos) f.erros(e.campos); tratar(e); }
    }, { rotuloEnviar: 'Criar produto', perm: 'produtos.editar' });
    const cod = h('input', { type: 'text', placeholder: 'Opcional: leia o código do fabricante', autocomplete: 'off', 'aria-label': 'Código de barras do fabricante' });
    const gerar = h('input', { type: 'checkbox', checked: true });
    g = gaveta('Novo produto', [
      h('section', { class: 'card stack' }, h('h3', null, 'Código de barras'), h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Código do fabricante (EAN/GTIN)'), cod),
        h('label', { class: 'check' }, gerar, 'Gerar código interno se não informar (para etiquetar o produto)')), f.el]);
  }

  async function abrir(id) {
    const g = gaveta('Produto', esqueleto(6));
    const recarregar = async (aba = 'dados') => {
      let p; try { p = await api.get(`/api/produtos/${id}`); } catch (e) { return tratar(e); }
      limpar(g.corpo);
      const painel = h('div', { class: 'stack' });
      const desenhar = (id2) => { limpar(painel); ({ dados: dadosAba, estoque: estoqueAba, codigos: codigosAba, anuncios: anunciosAba })[id2](painel, p, () => recarregar(id2), g); };
      g.corpo.append(h('div', { class: 'row' }, h('h2', null, p.nome), p.ativo ? badge('Ativo', 'ok') : badge('Inativo', 'erro')), h('p', { class: 'muted mono' }, p.sku),
        abas([['dados', 'Dados'], ['estoque', 'Estoque por endereço'], ['codigos', 'Códigos e etiqueta'], ['anuncios', 'Anúncios ML', 'integracoes.ver']], aba, desenhar), painel);
      desenhar(aba);
    };
    await recarregar();
  }

  function dadosAba(painel, p, recarregar, g) {
    const f = formulario(campos(), p, async (v) => {
      try { await api.put(`/api/produtos/${p.id}`, { ...v, versao: p.versao }); toast('Salvo.', 'ok'); listar(); recarregar(); }
      catch (e) { if (e instanceof ApiError && e.campos) f.erros(e.campos); tratar(e); if (e.code === 'VERSAO') recarregar(); }
    }, { perm: 'produtos.editar' });
    painel.append(f.el, h('button', { class: `btn ${p.ativo ? 'perigo' : ''}`, 'data-requer': 'produtos.editar', onclick: async () => {
      if (p.ativo && !(await confirmar('Inativar produto', 'O produto some das listas e não pode receber estoque. O histórico é mantido.', { perigo: true, rotulo: 'Inativar' }))) return;
      try { await api.post(`/api/produtos/${p.id}/${p.ativo ? 'inativar' : 'reativar'}`); toast(p.ativo ? 'Produto inativado.' : 'Produto reativado.', 'ok'); listar(); recarregar(); } catch (e) { tratar(e); }
    } }, p.ativo ? 'Inativar produto' : 'Reativar produto'));
  }

  function estoqueAba(painel, p) {
    painel.append(h('div', { class: 'cols-2' }, h('div', { class: 'card kpi' }, h('div', { class: 'rotulo' }, 'Total'), h('div', { class: 'valor' }, fmt.num(p.saldo_total))), h('div', { class: 'card kpi' }, h('div', { class: 'rotulo' }, 'Disponível'), h('div', { class: 'valor' }, fmt.num(p.saldo_vendavel)))),
      h('p', null, 'Endereço de picking: ', p.picking ? h('strong', { class: 'mono' }, p.picking.codigo) : h('span', { class: 'muted' }, 'não definido (use Endereços para designar)')),
      p.saldos.length ? tabela([{ titulo: 'Endereço', render: (s) => h('strong', { class: 'mono' }, s.endereco) }, { titulo: 'Zona', render: (s) => s.zona_tipo.toLowerCase() }, { titulo: 'Lote', render: (s) => (s.lote ? `${s.lote}${s.validade ? ` · ${fmt.data(s.validade)}` : ''}` : '—') }, { titulo: 'Qtd', num: true, chave: 'qtd' }], p.saldos) : vazio('Sem estoque'),
      h('a', { class: 'btn', href: `#/estoque?op=receber&produto=${p.id}` }, icone('download'), 'Receber este produto'));
  }

  async function anunciosAba(painel, p, recarregar) {
    const item = h('input', { type: 'text', placeholder: 'Ex.: MLB1234567890', autocomplete: 'off', 'aria-label': 'Código do anúncio' }); const vari = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Variação (se tiver)', autocomplete: 'off', 'aria-label': 'Variação' });
    let lista; try { lista = (await api.get(`/api/produtos/${p.id}/anuncios`)).itens; } catch (e) { return painel.append(h('p', { class: 'perigo-txt' }, e.message)); }
    painel.append(h('p', { class: 'muted' }, 'O anúncio recebe: disponível − reservas dos pedidos − margem de segurança. O SKU do vendedor no Mercado Livre pode ser igual a este SKU para mapear sozinho no primeiro pedido.'),
      lista.length ? tabela([{ titulo: 'Anúncio', render: (x) => h('span', { class: 'mono' }, `${x.item_id}${x.variacao_id ? ` / ${x.variacao_id}` : ''}`) }, { titulo: 'Disponível', num: true, chave: 'disponivel' }, { titulo: 'Reservado', num: true, chave: 'reservado' }, { titulo: 'Enviado', num: true, render: (x) => x.ultima_qtd_enviada ?? '—' },
        { titulo: 'Situação', render: (x) => (x.ultimo_erro ? h('span', { class: 'perigo-txt quebra' }, x.ultimo_erro) : x.sync_ativo ? badge('sincronizando', 'ok') : badge('desligado')) },
        { titulo: '', render: (x) => h('button', { class: 'btn pequeno fantasma', 'aria-label': `Remover ${x.item_id}`, onclick: async () => { try { await api.del(`/api/anuncios/${x.id}`); recarregar(); } catch (e) { tratar(e); } } }, icone('trash', 16)) }], lista, { compacta: true }) : vazio('Nenhum anúncio mapeado'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, item), vari, h('button', { class: 'btn primario', onclick: async () => { try { await api.post(`/api/produtos/${p.id}/anuncios`, { item_id: item.value, variacao_id: vari.value || undefined }); toast('Anúncio mapeado.', 'ok'); recarregar(); } catch (e) { tratar(e); } } }, 'Mapear')));
  }

  function codigosAba(painel, p, recarregar) {
    const novoCod = h('input', { type: 'text', placeholder: 'Leia ou digite o código', autocomplete: 'off', 'aria-label': 'Novo código' });
    const prev = h('div', { class: 'row' });
    const mostrarEtiqueta = (formato = '50x30') => {
      if (!p.codigos.length) return limpar(prev).append(h('p', { class: 'muted' }, 'Gere ou cadastre um código para ver a etiqueta.'));
      limpar(prev).append(h('img', { class: `f-${formato}`, src: `/api/etiquetas/svg?tipo=produto&id=${p.id}&formato=${formato}&t=${Date.now()}`, alt: `Etiqueta ${formato} do produto ${p.sku}`, style: undefined, width: formato.split('x')[0] * 3.78, height: formato.split('x')[1] * 3.78 }));
    };
    const fm = h('select', { 'aria-label': 'Formato da etiqueta', onchange: () => mostrarEtiqueta(fm.value) }, ['50x30', '40x25', '100x50', '100x150'].map((f) => h('option', { value: f }, `${f.replace('x', ' × ')} mm`)));
    painel.append(
      p.codigos.length ? h('div', { class: 'lista' }, p.codigos.map((c) => h('div', null, h('span', { class: 'row' }, h('strong', { class: 'mono' }, c.codigo), badge(c.tipo), c.origem === 'INTERNO' ? badge('interno', 'info') : null, c.principal ? badge('principal', 'ok') : null),
        h('span', { class: 'row' }, !c.principal && h('button', { class: 'btn pequeno', 'data-requer': 'produtos.editar', onclick: async () => { try { await api.post(`/api/produtos/${p.id}/codigos/${c.id}/principal`); recarregar(); } catch (e) { tratar(e); } } }, 'Tornar principal'),
          h('button', { class: 'btn pequeno fantasma', 'data-requer': 'produtos.editar', 'aria-label': `Remover ${c.codigo}`, onclick: async () => { if (await confirmar('Remover código', `Remover ${c.codigo}? A etiqueta já impressa deixa de ser reconhecida.`, { perigo: true, rotulo: 'Remover' })) { try { await api.del(`/api/produtos/${p.id}/codigos/${c.id}`); recarregar(); } catch (e) { tratar(e); } } } }, icone('trash', 16)))))) : vazio('Sem código de barras', 'Cadastre o do fabricante ou gere um código interno para etiquetar.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, novoCod), h('button', { class: 'btn', 'data-requer': 'produtos.editar', onclick: async () => { try { await api.post(`/api/produtos/${p.id}/codigos`, { codigo: novoCod.value }); toast('Código adicionado.', 'ok'); recarregar(); } catch (e) { tratar(e); } } }, 'Adicionar')),
      h('button', { class: 'btn primario', 'data-requer': 'produtos.editar', onclick: async () => { try { const c = await api.post(`/api/produtos/${p.id}/codigos/gerar`); toast(`Código ${c.codigo} gerado.`, 'ok'); recarregar(); } catch (e) { tratar(e); } } }, icone('tag'), 'Gerar código interno (EAN-13)'),
      h('h3', null, 'Etiqueta'), h('div', { class: 'row' }, fm, h('a', { class: 'btn', href: `#/etiquetas?produto=${p.id}` }, icone('printer'), 'Imprimir / ZPL')), prev);
    mostrarEtiqueta();
  }

  // Importação por planilha com prévia
  function importar() {
    const arq = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', 'aria-label': 'Arquivo CSV' });
    const saida = h('div', { class: 'stack' });
    let texto = '';
    const m = modal('Importar produtos (CSV)', h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Colunas: sku;nome;marca;categoria;unidade;ncm;custo;preco;peso_g;estoque_min;estoque_max;codigo_barras. Aceita ; ou , e valores como 12,50.'),
      arq, saida), { largo: true });
    arq.addEventListener('change', async () => {
      texto = await arq.files[0].text(); limpar(saida).append(esqueleto(3));
      try {
        const r = await api.csv('/api/produtos/importar', texto); limpar(saida);
        saida.append(h('p', null, badge(`${r.validos} válido(s)`, 'ok'), ' ', badge(`${r.com_erro} com erro`, r.com_erro ? 'erro' : 'ok')),
          tabela([{ titulo: 'Linha', chave: 'linha' }, { titulo: 'SKU', chave: 'sku' }, { titulo: 'Produto', chave: 'nome' }, { titulo: 'Situação', render: (x) => (x.ok ? badge('ok', 'ok') : h('span', { class: 'perigo-txt quebra' }, x.erro)) }], r.linhas.slice(0, 200), { compacta: true }),
          r.validos ? h('button', { class: 'btn primario', onclick: async () => { try { const f = await api.csv('/api/produtos/importar?confirmar=1', texto); m.fechar(); toast(`${f.validos} produto(s) importado(s).`, 'ok'); listar(); } catch (e) { tratar(e); } } }, `Importar ${r.validos} produto(s)`) : null);
      } catch (e) { limpar(saida); tratar(e); }
    });
  }

  async function gerarFaltantes() {
    try {
      const p = await api.post('/api/codigos/gerar-faltantes', {});
      if (!p.total) return toast('Todos os produtos ativos já têm código.', 'ok');
      if (!(await confirmar('Gerar códigos internos', `${p.total} produto(s) estão sem código de barras. Gerar um EAN-13 interno para cada um?`, { rotulo: 'Gerar' }))) return;
      const r = await api.post('/api/codigos/gerar-faltantes', { confirmar: 1 }); toast(`${r.total} código(s) gerado(s). Agora é só imprimir as etiquetas.`, 'ok', 7000); listar();
    } catch (e) { tratar(e); }
  }

  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Produtos'), h('p', null, 'Cadastro, códigos de barras e etiquetas.')),
    h('div', { class: 'row' }, h('button', { class: 'btn', 'data-requer': 'produtos.editar', onclick: gerarFaltantes }, icone('tag'), 'Gerar códigos faltantes'), h('button', { class: 'btn', 'data-requer': 'produtos.editar', onclick: importar }, icone('upload'), 'Importar CSV'),
      h('a', { class: 'btn', href: '/api/produtos-exportar', download: 'produtos.csv' }, icone('download'), 'Exportar'), h('button', { class: 'btn primario', 'data-requer': 'produtos.editar', 'data-novo': true, onclick: novo }, icone('plus'), 'Novo produto'))),
  h('div', { class: 'stack' }, busca, chips), alvo);
  listar();
  if (params.get('novo')) novo();
  if (params.get('abrir')) abrir(Number(params.get('abrir')));
}
