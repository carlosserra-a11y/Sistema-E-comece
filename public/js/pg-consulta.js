// Consulta rápida: leia (ou digite) qualquer código — produto, endereço ou lote — e veja onde está e quanto tem.
import { h, limpar, api, icone, fmt, badge, qs, tratar, feedback, esqueleto, vazio, tabela, toast } from './core.js';

/** Leitura por câmera com BarcodeDetector. Se o navegador não suportar, o campo de texto (leitor USB/Bluetooth) continua funcionando. */
export function leitorCamera(aoLer) {
  const suportado = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  const video = h('video', { class: 'camera', playsinline: true, muted: true, 'aria-label': 'Câmera para leitura de código' });
  const caixa = h('div', { class: 'stack', hidden: true }, video, h('button', { class: 'btn', type: 'button', onclick: () => parar() }, 'Fechar câmera'));
  let stream = null; let ativo = false; let ultimo = ''; let ultimoEm = 0;
  async function ligar() {
    if (!suportado) return toast('Este navegador não lê código pela câmera. Use o leitor ou digite o código.', 'aviso', 7000);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play(); caixa.hidden = false; ativo = true;
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code', 'itf'] });
      const volta = async () => {
        if (!ativo) return;
        try { const r = await det.detect(video); const c = r[0]?.rawValue; if (c && (c !== ultimo || Date.now() - ultimoEm > 2500)) { ultimo = c; ultimoEm = Date.now(); aoLer(c); } } catch { /* quadro ruim */ }
        setTimeout(() => requestAnimationFrame(volta), 180);
      };
      volta();
    } catch { toast('Não consegui abrir a câmera. Verifique a permissão do navegador.', 'erro'); }
  }
  function parar() { ativo = false; stream?.getTracks().forEach((t) => t.stop()); stream = null; caixa.hidden = true; }
  return { botao: h('button', { class: 'btn', type: 'button', onclick: ligar, hidden: !suportado }, icone('camera'), 'Câmera'), caixa, parar };
}

function mostrarProduto(r) {
  const p = r.produto;
  return h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('h2', null, p.nome), p.ativo ? badge('Ativo', 'ok') : badge('Inativo', 'erro')),
    h('p', { class: 'muted' }, `SKU ${p.sku}`),
    h('div', { class: 'cols-2' },
      h('div', { class: 'card kpi' }, h('div', { class: 'rotulo' }, 'Total em estoque'), h('div', { class: 'valor' }, fmt.num(r.total))),
      h('div', { class: 'card kpi' }, h('div', { class: 'rotulo' }, 'Disponível'), h('div', { class: 'valor' }, fmt.num(r.vendavel)))),
    r.picking && h('p', null, 'Picking: ', h('strong', { class: 'mono' }, r.picking.codigo)),
    r.locais.length ? tabela([{ titulo: 'Endereço', render: (l) => h('strong', { class: 'mono' }, l.codigo) }, { titulo: 'Zona', render: (l) => badge(l.zona_tipo.toLowerCase(), l.vendavel ? 'ok' : 'aviso') }, { titulo: 'Lote', render: (l) => (l.lote ? `${l.lote}${l.validade ? ` · val ${fmt.data(l.validade)}` : ''}` : '—') }, { titulo: 'Qtd', num: true, chave: 'qtd' }], r.locais)
      : vazio('Sem estoque', 'Este produto não está em nenhum endereço.'),
    h('p', { class: 'muted' }, 'Lotes que vencem primeiro aparecem primeiro (FEFO).'));
}

export async function renderizar(el, { params }) {
  const entrada = h('input', { type: 'search', class: 'enorme', placeholder: 'Leia ou digite o código', autofocus: true, autocomplete: 'off', inputmode: 'text', 'aria-label': 'Código' });
  const saida = h('div', { class: 'stack' });
  const cam = leitorCamera((c) => consultar(c));
  async function consultar(codigo) {
    const c = String(codigo).trim(); if (!c) return;
    limpar(saida).append(esqueleto(3));
    try {
      const r = await api.get(`/api/scan?${qs({ codigo: c })}`);
      limpar(saida);
      if (r.tipo === 'DESCONHECIDO') { feedback('erro', 'Código não encontrado'); saida.append(vazio('Não encontrei este código', r.dica, h('span', { class: 'mono' }, r.codigo))); }
      else if (r.tipo === 'PRODUTO') { feedback('ok', 'Produto'); saida.append(h('section', { class: 'card' }, mostrarProduto(r))); }
      else if (r.tipo === 'ENDERECO') {
        feedback('ok', 'Endereço'); const d = await api.get(`/api/enderecos/${r.endereco.id}`);
        saida.append(h('section', { class: 'card stack' }, h('h2', { class: 'mono' }, d.codigo), h('p', { class: 'muted' }, `${d.zona_nome}${d.bloqueado ? ' · BLOQUEADO' : ''}${d.cap_itens ? ` · capacidade ${d.cap_itens}` : ''}`),
          d.conteudo.length ? tabela([{ titulo: 'SKU', chave: 'sku' }, { titulo: 'Produto', chave: 'nome' }, { titulo: 'Lote', render: (x) => x.lote ?? '—' }, { titulo: 'Qtd', num: true, chave: 'qtd' }], d.conteudo) : vazio('Endereço vazio')));
      } else if (r.tipo === 'LOTE') { feedback('ok', 'Lote'); saida.append(h('section', { class: 'card' }, h('h2', null, `Lote ${r.lote.codigo}`), h('p', null, `${r.lote.sku} — ${r.lote.nome}`), h('p', { class: 'muted' }, `Validade: ${fmt.data(r.lote.validade)}`))); }
    } catch (e) { limpar(saida); tratar(e); }
    entrada.value = ''; entrada.focus();
  }
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); consultar(entrada.value); } });
  el.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Consulta'), h('p', null, 'Onde está e quanto tem — em segundos.'))),
    h('section', { class: 'card stack' }, entrada, h('div', { class: 'row' }, cam.botao, h('span', { class: 'muted' }, 'O leitor USB/Bluetooth digita no campo e envia Enter.')), cam.caixa), saida);
  if (params.get('c')) consultar(params.get('c')); else entrada.focus();
  return () => cam.parar();
}
