// Aba "Vender": leitura do código, carrinho, cliente, desconto e fechamento. O carrinho sobrevive à troca de tela e ao recarregar.
import { h, limpar, api, ApiError, pode, icone, fmt, qs, tratar, toast, campo, badge, vazio, centavos, reais, combobox, gaveta, confirmar, novaChave, feedback, debounce, esqueleto } from './core.js';
import { formulario } from './form.js';
import { abrirPagamento, pedirDados } from './balcao-pagamento.js';
import { abrirCupom } from './balcao-cupom.js';
import { CAMPOS_CLIENTE } from './pg-clientes.js';

const NOVO = () => ({ itens: [], desconto: 0, cliente: null, observacao: '', envio: null, envioOrcamento: null });

function guardador(userId) {
  const chave = `balcao-carrinho-${userId}`;
  return {
    ler() { try { const c = JSON.parse(sessionStorage.getItem(chave)); return Array.isArray(c?.itens) ? { ...NOVO(), ...c } : NOVO(); } catch { return NOVO(); } },
    gravar(c) { try { sessionStorage.setItem(chave, JSON.stringify(c)); } catch { /* sem armazenamento: o carrinho vale só nesta tela */ } },
  };
}

export async function abaVender(el, { sessao, config }) {
  const guarda = guardador(sessao.usuario?.id ?? sessao.usuario?.nome ?? '0');
  let c = guarda.ler();
  const salvar = () => guarda.gravar(c);
  const mudaPreco = pode('vendas.desconto');
  const podeDesconto = mudaPreco || config.desconto_max_pct > 0;

  // ---------- caixa ----------
  const faixaCaixa = h('div');
  let caixaAberto = false;
  async function verCaixa() {
    try {
      const { caixa } = await api.get('/api/caixa');
      caixaAberto = !!caixa;
      limpar(faixaCaixa).append(caixa ? h('p', { class: 'muted' }, badge('Caixa aberto', 'ok'), ` desde ${fmt.dataHora(caixa.aberto_em)}`)
        : h('div', { class: 'card faixa-caixa' }, h('div', null, h('strong', null, 'Seu caixa está fechado'), h('p', { class: 'muted' }, 'Para vender, abra o caixa informando o dinheiro de troco que está na gaveta.')),
          h('button', { class: 'btn primario', type: 'button', onclick: abrirCaixa }, 'Abrir caixa')));
    } catch (e) { tratar(e); }
  }
  const abrirCaixa = () => pedirDados('Abrir caixa', 'Conte o dinheiro de troco que está na gaveta agora (pode ser zero).', [['abertura_centavos', 'Dinheiro na gaveta (R$)', 'moeda', '0,00']], 'Abrir caixa', async (d, chave) => {
    await api.idem('/api/caixa/abrir', d, chave); toast('Caixa aberto.', 'ok'); await verCaixa(); busca.focus();
  });

  // ---------- busca / leitura ----------
  const busca = h('input', { type: 'search', class: 'enorme', placeholder: 'Bipe ou busque', autocomplete: 'off', autofocus: true, 'aria-label': 'Código de barras, SKU ou nome do item' });
  const resultados = h('div', { class: 'resultados', 'aria-live': 'polite' });
  let geracao = 0;

  function adicionar(item, qtd = 1) {
    const ja = c.itens.find((i) => i.tipo === item.tipo && i.id === item.id);
    if (ja) { ja.qtd += qtd; ja.disponivel = item.disponivel; }
    else c.itens.push({ tipo: item.tipo, id: item.id, codigo: item.codigo, nome: item.nome, unidade: item.unidade, tabela: item.preco_unit_centavos, preco: item.preco_unit_centavos, editado: false, disponivel: item.disponivel, qtd });
    salvar(); desenhar();
    const linha = ja ?? c.itens.at(-1);
    if (item.disponivel !== null && linha.qtd > item.disponivel) feedback('erro', `Só há ${item.disponivel} para vender`);
    else if (!item.preco_unit_centavos) feedback('erro', 'Item sem preço cadastrado');
    else feedback('ok', item.nome);
  }
  const buscarItens = (t) => api.get(`/api/balcao/buscar?${qs({ q: t })}`);
  function mostrarResultados(r) {
    const todos = [...r.produtos, ...r.servicos];
    limpar(resultados).append(todos.length ? todos.map((i) => h('button', { type: 'button', class: 'resultado', onclick: () => { adicionar(i); limpar(resultados); busca.value = ''; busca.focus(); } },
      h('span', { class: 'grow' }, h('strong', null, i.nome), h('span', { class: 'muted' }, i.tipo === 'SERVICO' ? 'Serviço' : `${i.codigo}${i.marca ? ` · ${i.marca}` : ''} · pode vender ${i.disponivel}`)),
      h('strong', null, fmt.moeda(i.preco_unit_centavos)))) : h('p', { class: 'muted' }, 'Nada encontrado.'));
  }
  async function ler(texto, { enter = false } = {}) {
    const t = texto.trim(); const g = ++geracao;
    if (!t) return limpar(resultados);
    try {
      const r = await buscarItens(t);
      if (g !== geracao && !enter) return;
      if (r.exato) { if (!enter) return mostrarResultados({ produtos: [r.exato], servicos: [] }); adicionar(r.exato); busca.value = ''; return limpar(resultados); }
      const todos = [...r.produtos, ...r.servicos];
      if (enter && todos.length === 1) { adicionar(todos[0]); busca.value = ''; return limpar(resultados); }
      if (enter && !todos.length) feedback('erro', 'Código não encontrado');
      mostrarResultados(r);
    } catch (e) { tratar(e); }
  }
  const digitando = debounce(() => ler(busca.value), 300);
  busca.addEventListener('input', () => { geracao++; if (busca.value.trim().length >= 2) digitando(); else limpar(resultados); });
  // O leitor USB/Bluetooth digita o código e envia Enter: o campo é esvaziado na hora para a próxima leitura não se misturar.
  let fila = Promise.resolve();
  busca.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = busca.value; busca.value = ''; geracao++;
    fila = fila.then(() => ler(t, { enter: true }));
  });
  let scanner = null;
  const camera = navigator.mediaDevices?.getUserMedia ? h('button', { class: 'btn', type: 'button', onclick: async () => {
    const { abrirScanner } = await import('./scanner.js');
    scanner = abrirScanner({ titulo: 'Bipe os itens da venda', continuo: true, aoLer: async (codigo) => {
      try { const r = await buscarItens(codigo); if (r.exato) adicionar(r.exato); else feedback('erro', 'Código não encontrado'); } catch (x) { tratar(x); }
      return false;
    } });
  } }, icone('camera'), 'Câmera') : null;

  // ---------- carrinho ----------
  const carrinho = h('div', { class: 'stack' });
  const totais = h('div', { class: 'stack' });
  const subtotal = () => c.itens.reduce((a, i) => a + i.qtd * i.preco, 0);
  const total = () => subtotal() - c.desconto;

  function linhaItem(i) {
    const qtd = h('input', { type: 'number', min: 1, max: 100000, step: 1, inputmode: 'numeric', value: i.qtd, 'aria-label': `Quantidade de ${i.nome}`, onchange: (e) => { const n = Math.floor(Number(e.target.value)); i.qtd = n >= 1 ? Math.min(n, 100000) : 1; salvar(); desenhar(); } });
    const passo = (d) => { i.qtd = Math.max(1, i.qtd + d); salvar(); desenhar(); };
    const preco = mudaPreco ? h('input', { type: 'text', inputmode: 'decimal', class: 'preco-item', value: reais(i.preco), 'aria-label': `Preço unitário de ${i.nome}`, onchange: (e) => { const v = centavos(e.target.value); if (v >= 0) { i.preco = v; i.editado = v !== i.tabela; salvar(); } else toast('Preço inválido.', 'erro'); desenhar(); } })
      : h('span', null, fmt.moeda(i.preco));
    const faltando = i.disponivel !== null && i.qtd > i.disponivel;
    return h('div', { class: 'carrinho-item' },
      h('div', { class: 'carrinho-nome' }, h('strong', null, i.nome), h('span', { class: 'muted' }, i.tipo === 'SERVICO' ? 'Serviço' : i.codigo), faltando && badge(`Só há ${i.disponivel}`, 'erro'), i.editado && badge('Preço alterado', 'aviso'), !i.preco && badge('Sem preço', 'erro')),
      h('div', { class: 'qtd-controle' }, h('button', { class: 'btn icone', type: 'button', 'aria-label': `Diminuir ${i.nome}`, disabled: i.qtd <= 1, onclick: () => passo(-1) }, '−'), qtd, h('button', { class: 'btn icone', type: 'button', 'aria-label': `Aumentar ${i.nome}`, onclick: () => passo(1) }, '+')),
      h('div', { class: 'carrinho-preco' }, h('label', { class: 'preco-rotulo' }, h('span', { class: 'muted' }, 'Unit.'), preco), h('strong', null, fmt.moeda(i.qtd * i.preco))),
      h('button', { class: 'btn icone fantasma', type: 'button', 'aria-label': `Tirar ${i.nome} do carrinho`, onclick: () => { c.itens.splice(c.itens.indexOf(i), 1); if (!c.itens.length) c.desconto = 0; salvar(); desenhar(); } }, icone('trash', 18)));
  }

  const desconto = h('input', { type: 'text', inputmode: 'decimal', value: reais(c.desconto), onfocus: (e) => e.target.select(), onchange: (e) => {
    const v = centavos(e.target.value);
    if (v < 0 || v >= subtotal()) { toast(v < 0 ? 'Desconto inválido.' : 'O desconto precisa ser menor que o total.', 'erro'); c.desconto = 0; } else c.desconto = v;
    salvar(); desenhar();
  } });

  function desenhar() {
    if (c.desconto >= subtotal()) c.desconto = 0;
    limpar(carrinho).append(c.itens.length ? c.itens.map(linhaItem) : vazio('Carrinho vazio', 'Bipe um produto ou busque pelo nome.'));
    desconto.value = reais(c.desconto);
    const unidades = c.itens.reduce((a, i) => a + i.qtd, 0);
    limpar(totais).append(
      h('div', { class: 'total-linha' }, h('span', { class: 'muted' }, `${fmt.num(unidades)} item(ns)`), h('span', null, fmt.moeda(subtotal()))),
      podeDesconto ? campo(`Desconto em R$${mudaPreco ? '' : ` (máximo ${config.desconto_max_pct}%)`}`, desconto) : null,
      h('div', { class: 'total-linha' }, h('strong', null, 'Total'), h('strong', { class: 'total-grande', 'aria-live': 'polite' }, fmt.moeda(total()))));
    const vazioC = !c.itens.length;
    botaoPagar.disabled = vazioC; botaoOrcamento.disabled = vazioC; botaoLimpar.disabled = vazioC && !c.cliente; botaoAtualizar.hidden = vazioC;
  }

  async function atualizarPrecos() {
    try {
      const servicos = c.itens.some((i) => i.tipo === 'SERVICO') ? (await api.get('/api/servicos')).itens : [];
      const novos = [];
      for (const i of c.itens) {
        const atual = i.tipo === 'SERVICO' ? servicos.find((s) => s.id === i.id) : (await buscarItens(i.codigo)).exato;
        if (!atual || (i.tipo === 'PRODUTO' && atual.id !== i.id)) { toast(`"${i.nome}" não está mais disponível e saiu do carrinho.`, 'aviso', 7000); continue; }
        const tabela = i.tipo === 'SERVICO' ? atual.valor_centavos : atual.preco_unit_centavos;
        novos.push({ ...i, tabela, preco: tabela, editado: false, disponivel: i.tipo === 'SERVICO' ? null : atual.disponivel, nome: atual.nome });
      }
      c = { ...c, itens: novos, envio: null }; salvar(); desenhar(); toast('Preços e quantidades atualizados.', 'ok');
    } catch (e) { tratar(e); }
  }

  // ---------- cliente ----------
  const areaCliente = h('div');
  function desenharCliente() {
    limpar(areaCliente);
    if (!pode('clientes.ver')) return;
    if (c.cliente) { areaCliente.append(h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Cliente: ', h('strong', null, c.cliente.nome)), h('button', { class: 'btn pequeno', type: 'button', onclick: () => { c.cliente = null; salvar(); desenharCliente(); } }, 'Trocar'))); return; }
    const cb = combobox({ rotulo: 'Cliente (opcional)', placeholder: 'Nome, telefone ou CPF', camera: false, buscar: async (t) => (await api.get(`/api/clientes?${qs({ q: t, por_pagina: 8 })}`)).itens.map((x) => ({ id: x.id, rotulo: x.nome, detalhe: x.telefone ?? x.documento_mascarado ?? '', dados: x })), aoEscolher: (i) => { c.cliente = { id: i.id, nome: i.dados.nome }; salvar(); desenharCliente(); } });
    areaCliente.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, cb.el), pode('clientes.editar') && h('button', { class: 'btn', type: 'button', onclick: novoCliente }, icone('plus', 18), 'Novo')));
  }
  function novoCliente() {
    let g;
    const f = formulario(CAMPOS_CLIENTE, {}, async (v) => {
      try { const n = await api.post('/api/clientes', v); c.cliente = { id: n.id, nome: n.nome }; salvar(); g.fechar(); desenharCliente(); toast('Cliente cadastrado.', 'ok'); }
      catch (e) { if (e instanceof ApiError && e.campos) f.erros(e.campos); tratar(e); }
    });
    g = gaveta('Novo cliente', f.el);
  }

  const observacao = h('input', { type: 'text', maxlength: 300, autocomplete: 'off', value: c.observacao, oninput: (e) => { c.observacao = e.target.value; salvar(); } });

  // ---------- fechar ----------
  const corpoVenda = () => ({
    itens: c.itens.map((i) => ({ tipo: i.tipo, id: i.id, qtd: i.qtd, ...(i.editado ? { preco_unit_centavos: i.preco } : {}) })),
    desconto_centavos: c.desconto, cliente_id: c.cliente?.id, observacao: c.observacao.trim() || undefined, valor_esperado_centavos: total(),
  });
  const zerar = () => { c = NOVO(); salvar(); observacao.value = ''; limpar(resultados); busca.value = ''; desenharCliente(); desenhar(); busca.focus(); };

  function pagar() {
    if (!c.itens.length || document.querySelector('.overlay')) return;
    if (!caixaAberto) return abrirCaixa();
    if (total() < 1) return toast('O total precisa ser maior que zero.', 'erro');
    const corpo = corpoVenda();
    const base = JSON.stringify(corpo);
    abrirPagamento({
      total: total(), pixAtivo: config.pix_ativo,
      // a chave fica no carrinho junto do conteúdo enviado: fechar a janela ou recarregar a página não duplica a venda
      envio: { get dados() { return c.envio?.base === base ? c.envio : null; }, gravar: (d) => { c.envio = d ? { ...d, base } : null; salvar(); } },
      enviar: (pagamentos, chave) => api.idem('/api/vendas', { ...corpo, pagamentos }, chave),
      aoConcluir: (r) => { zerar(); abrirCupom(r.id, { destaque: r.troco_centavos ? h('p', { class: 'troco' }, `Troco: ${fmt.moeda(r.troco_centavos)}`) : null, rotuloFechar: 'Próxima venda', aoFechar: () => busca.focus() }); verCaixa(); },
    });
  }
  async function orcar() {
    const corpo = corpoVenda(); const base = JSON.stringify(corpo);
    if (c.envioOrcamento?.base !== base) { c.envioOrcamento = { base, chave: novaChave() }; salvar(); }
    botaoOrcamento.disabled = true;
    try { const r = await api.idem('/api/orcamentos', corpo, c.envioOrcamento.chave); zerar(); await abrirCupom(r.id, { rotuloFechar: 'Nova venda' }); }
    catch (e) { if (e instanceof ApiError && e.status && e.status < 500) { c.envioOrcamento = null; salvar(); } tratar(e); botaoOrcamento.disabled = false; }
  }

  const botaoPagar = h('button', { class: 'btn primario enorme', type: 'button', onclick: pagar }, 'Receber pagamento (F2)');
  const botaoOrcamento = h('button', { class: 'btn', type: 'button', onclick: orcar }, 'Salvar como orçamento');
  const botaoAtualizar = h('button', { class: 'btn', type: 'button', onclick: atualizarPrecos }, icone('refresh', 18), 'Atualizar preços');
  const botaoLimpar = h('button', { class: 'btn fantasma', type: 'button', onclick: async () => { if (await confirmar('Limpar o carrinho?', 'Os itens desta venda serão retirados. Nada foi gravado ainda.', { rotulo: 'Limpar' })) zerar(); } }, 'Limpar carrinho');

  el.append(faixaCaixa, h('div', { class: 'balcao-grid' },
    h('section', { class: 'card stack' }, busca, camera && h('div', { class: 'row' }, camera), resultados, carrinho),
    h('section', { class: 'card stack balcao-resumo' }, areaCliente, campo('Observação (sai no cupom)', observacao), totais, botaoPagar, botaoOrcamento, h('div', { class: 'row' }, botaoAtualizar, botaoLimpar))));
  desenharCliente(); desenhar(); faixaCaixa.append(esqueleto(1)); await verCaixa();
  busca.focus();

  // se a pessoa trocou de tela antes de a aba terminar de abrir, o atalho se desliga sozinho (não abre pagamento em outra tela)
  const atalho = (e) => { if (!el.isConnected) return document.removeEventListener('keydown', atalho); if (e.key === 'F2') { e.preventDefault(); pagar(); } };
  document.addEventListener('keydown', atalho);
  return () => { document.removeEventListener('keydown', atalho); scanner?.fechar(); };
}
