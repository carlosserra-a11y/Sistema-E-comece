// Janela de pagamento: uma ou várias formas, troco na hora, QR do Pix e envio à prova de duplo clique.
import { h, limpar, api, ApiError, icone, fmt, modal, campo, toast, copiar, centavos, reais, selecao, svgDataUrl, novaChave, feedback } from './core.js';
import { FORMA } from './balcao-cupom.js';

const TROCO_MAXIMO = 2_000_00; // o mesmo limite do servidor

export async function mostrarPix(valor, { rotuloVoltar = 'Voltar ao pagamento', aviso = 'O sistema não confirma o Pix: confira no aplicativo do banco antes de concluir a venda.' } = {}) {
  try {
    const r = await api.post('/api/balcao/pix', { valor_centavos: valor });
    let m;
    m = modal('Pagamento por Pix', h('div', { class: 'stack cupom-centro' },
      h('p', null, h('strong', { class: 'total-grande' }, fmt.moeda(r.valor_centavos))),
      h('img', { class: 'qr-pix', src: svgDataUrl(r.svg), alt: 'QR Code do Pix', width: 260, height: 260 }),
      h('p', { class: 'muted' }, `Recebedor: ${r.recebedor}`),
      h('p', { class: 'aviso-txt' }, aviso),
      h('button', { class: 'btn', type: 'button', onclick: () => copiar(r.copia_e_cola) }, 'Copiar Pix copia e cola'),
      h('button', { class: 'btn primario', type: 'button', autofocus: true, onclick: () => m.fechar() }, rotuloVoltar)));
  } catch (e) { toast(e.message, 'erro', 7000); }
}

/**
 * total: centavos. enviar(pagamentos, chave) grava a venda. `envio` guarda a chave do último envio sem resposta, para a
 * mesma venda não entrar duas vezes mesmo que a janela seja fechada e aberta de novo (devolve e recebe { json, chave }).
 */
export function abrirPagamento({ total, pixAtivo, enviar, aoConcluir, envio }) {
  const linhas = [];
  const lista = h('div', { class: 'stack' });
  const situacao = h('p', { class: 'pagamento-situacao', role: 'status' });
  const erro = h('p', { class: 'erro', role: 'alert' });
  const concluir = h('button', { class: 'btn primario enorme', type: 'submit' }, 'Concluir venda');
  let enviando = false; let m;

  const pagamentos = () => linhas.map((l) => ({ forma: l.forma.value, valor_centavos: centavos(l.valor.value), ...(l.forma.value === 'CREDITO' ? { parcelas: Number(l.parcelas.value) } : {}) }));
  function conta() {
    const ps = pagamentos();
    const invalido = ps.some((p) => p.valor_centavos <= 0);
    const soma = ps.reduce((a, p) => a + Math.max(0, p.valor_centavos), 0);
    const emDinheiro = ps.filter((p) => p.forma === 'DINHEIRO').reduce((a, p) => a + Math.max(0, p.valor_centavos), 0);
    const falta = total - soma; const troco = Math.max(0, -falta);
    const excede = troco > 0 && soma - emDinheiro >= total;
    const trocoAlto = troco > TROCO_MAXIMO;
    situacao.className = `pagamento-situacao ${falta > 0 || excede || trocoAlto ? 'perigo-txt' : 'ok-txt'}`;
    situacao.textContent = !ps.length ? 'Escolha a forma de pagamento.' : invalido ? 'Confira os valores digitados.' : falta > 0 ? `Falta ${fmt.moeda(falta)}` : excede ? 'Pix e cartão não podem passar do total.' : trocoAlto ? `Troco de ${fmt.moeda(troco)}? Confira o valor recebido.` : troco ? `Troco: ${fmt.moeda(troco)}` : 'Valor exato ✓';
    concluir.disabled = enviando || !ps.length || invalido || falta > 0 || excede || trocoAlto;
    return { falta };
  }
  function desenhar() {
    limpar(lista).append(linhas.map((l) => l.el));
    conta();
  }
  function adicionar(forma) {
    const resta = Math.max(0, total - pagamentos().reduce((a, p) => a + Math.max(0, p.valor_centavos), 0));
    const l = {};
    l.forma = selecao(Object.entries(FORMA), forma, { 'aria-label': 'Forma de pagamento', onchange: () => { mostrarExtras(); conta(); } });
    l.valor = h('input', { type: 'text', inputmode: 'decimal', class: 'valor-pagamento', 'aria-label': forma === 'DINHEIRO' ? 'Valor recebido em dinheiro' : 'Valor', value: reais(resta || total), oninput: conta, onfocus: (e) => e.target.select() });
    l.parcelas = selecao(Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}x`]), 1, { 'aria-label': 'Parcelas' });
    const pix = h('button', { class: 'btn pequeno', type: 'button', onclick: () => { const v = centavos(l.valor.value); if (v > 0) mostrarPix(v); } }, 'Mostrar QR Pix');
    const mostrarExtras = () => { l.parcelas.hidden = l.forma.value !== 'CREDITO'; pix.hidden = !(pixAtivo && l.forma.value === 'PIX'); };
    l.el = h('div', { class: 'linha-pagamento' }, l.forma, l.valor, l.parcelas, pix,
      h('button', { class: 'btn icone fantasma', type: 'button', 'aria-label': 'Remover pagamento', onclick: () => { linhas.splice(linhas.indexOf(l), 1); desenhar(); } }, icone('x', 18)));
    mostrarExtras();
    linhas.push(l); desenhar();
    l.valor.focus();
  }

  const botoes = h('div', { class: 'formas' }, Object.entries(FORMA).map(([id, rotulo]) => h('button', { class: 'btn', type: 'button', 'data-forma': id, onclick: () => {
    // um toque troca a forma quando só há uma linha; com valor faltando, acrescenta outra
    if (linhas.length && conta().falta <= 0) { linhas.length = 0; }
    adicionar(id);
  } }, rotulo)));

  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    if (concluir.disabled) return;
    enviando = true; concluir.disabled = true; erro.textContent = ''; concluir.textContent = 'Gravando…';
    const ps = pagamentos(); const json = JSON.stringify(ps);
    if (envio.dados?.json !== json) envio.gravar({ json, chave: novaChave() });
    try {
      const r = await enviar(ps, envio.dados.chave);
      envio.gravar(null);
      feedback('ok', r.troco_centavos ? `Troco ${fmt.moeda(r.troco_centavos)}` : 'Venda concluída ✓');
      m.fechar();
      aoConcluir(r);
    } catch (x) {
      const semResposta = !(x instanceof ApiError) || x.status === 0 || x.status >= 500;
      if (!semResposta) envio.gravar(null); // o servidor recusou: nada foi gravado, a próxima tentativa é nova
      erro.textContent = semResposta ? 'Sem resposta do servidor: não sei se a venda foi gravada. Toque em "Concluir venda" de novo (não duplica) ou confira na aba Vendas.' : [x.message, ...Object.values(x.campos ?? {}).filter((c) => c !== x.message)].join(' ');
      feedback('erro', 'Venda não concluída');
      if (x.code === 'PRECO_MUDOU') { m.fechar(); toast(`${x.message} Use "Atualizar preços".`, 'erro', 8000); }
    } finally { enviando = false; concluir.textContent = 'Concluir venda'; conta(); }
  } }, h('p', { class: 'muted' }, 'Total a receber'), h('p', null, h('strong', { class: 'total-grande' }, fmt.moeda(total))), botoes, lista, situacao, erro, concluir,
  h('button', { class: 'btn', type: 'button', onclick: () => m.fechar() }, 'Voltar'));
  m = modal('Receber pagamento', form, { largo: true });
  desenhar();
  return m;
}

/** Janela simples para pedir um motivo/valor antes de uma ação. `campos`: [id, rótulo, tipo]. */
export function pedirDados(tituloJanela, texto, campos, rotuloOk, aoEnviar) {
  const inputs = campos.map(([id, rotulo, tipo, inicial = '']) => ({ id, rotulo, tipo, input: h('input', { type: 'text', inputmode: tipo === 'moeda' ? 'decimal' : undefined, autocomplete: 'off', maxlength: 300, value: inicial }) }));
  const erro = h('p', { class: 'erro', role: 'alert' });
  const ok = h('button', { class: 'btn primario', type: 'submit' }, rotuloOk);
  let ultimo = null; let m;
  m = modal(tituloJanela, h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = ''; ok.disabled = true;
    const dados = Object.fromEntries(inputs.map((c) => [c.id, c.tipo === 'moeda' ? (c.input.value.trim() === '' ? -1 : centavos(c.input.value)) : c.input.value.trim()]));
    const json = JSON.stringify(dados);
    if (ultimo?.json !== json) ultimo = { json, chave: novaChave() };
    try { await aoEnviar(dados, ultimo.chave); m.fechar(); }
    catch (x) { erro.textContent = [x.message, ...Object.entries(x.campos ?? {}).map(([k, v]) => `${campos.find(([id]) => id === k)?.[1] ?? k}: ${v}`)].join(' '); if (x.status && x.status < 500) ultimo = null; }
    finally { ok.disabled = false; }
  } }, texto && h('p', { class: 'muted' }, texto), inputs.map((c) => campo(c.rotulo, c.input)), erro,
  h('div', { class: 'row' }, ok, h('button', { class: 'btn', type: 'button', onclick: () => m.fechar() }, 'Voltar'))));
  return m;
}
