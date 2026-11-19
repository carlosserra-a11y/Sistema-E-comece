// Leitura de código de barras / QR pela câmera do celular (tela cheia). Funciona em Android (BarcodeDetector nativo)
// e em iPhone/Safari e navegadores antigos (ZXing local em /vendor, sem CDN por causa da CSP). Exige HTTPS (ou localhost).
import { h, icone, bipe, toast } from './core.js';

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
const INTERVALO_MS = 140;
const REPETIDO_MS = 2200;
let zxingPronto = null;

export const cameraDisponivel = () => Boolean(navigator.mediaDevices?.getUserMedia) && (window.isSecureContext ?? true);

function carregarZxing() {
  zxingPronto ??= new Promise((ok, falha) => {
    if (window.ZXing) return ok(window.ZXing);
    const s = h('script', { src: '/vendor/zxing.min.js' });
    s.onload = () => ok(window.ZXing); s.onerror = () => { zxingPronto = null; falha(new Error('zxing')); };
    document.head.append(s);
  });
  return zxingPronto;
}

/** Devolve `ler(video)` -> texto|null, usando o detector nativo quando existir e o ZXing caso contrário. */
async function criarDecodificador() {
  if ('BarcodeDetector' in window) {
    try {
      const suportados = await BarcodeDetector.getSupportedFormats?.();
      const formats = suportados ? FORMATOS.filter((f) => suportados.includes(f)) : FORMATOS;
      const det = new BarcodeDetector({ formats });
      return async (video) => (await det.detect(video))[0]?.rawValue ?? null;
    } catch { /* cai para o ZXing */ }
  }
  const Z = await carregarZxing();
  const leitor = new Z.MultiFormatReader();
  const dicas = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]], [Z.DecodeHintType.TRY_HARDER, true]]);
  leitor.setHints(dicas);
  const tela = document.createElement('canvas');
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!video.videoWidth) return null;
    const escala = Math.min(1, 960 / video.videoWidth); // reduz para decodificar rápido em celular fraco
    tela.width = Math.round(video.videoWidth * escala); tela.height = Math.round(video.videoHeight * escala);
    ctx.drawImage(video, 0, 0, tela.width, tela.height);
    try { return leitor.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(tela)))).getText(); } catch { return null; }
  };
}

/**
 * Abre o leitor em tela cheia. `aoLer(codigo)` pode devolver `false` para manter a câmera aberta (modo contínuo, ex.: contagem)
 * ou qualquer outra coisa para fechar. Devolve { fechar }.
 */
export function abrirScanner({ titulo = 'Aponte para o código', aoLer, continuo = false } = {}) {
  if (!cameraDisponivel()) { toast('A câmera só funciona em conexão segura (https). Use o leitor ou digite o código.', 'aviso', 7000); return { fechar() {} }; }
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true, 'aria-label': 'Câmera' });
  const status = h('p', { class: 'scan-status', role: 'status' }, 'Abrindo a câmera…');
  const manual = h('input', { type: 'text', class: 'scan-manual', placeholder: 'ou digite o código', autocomplete: 'off', inputmode: 'text', 'aria-label': 'Digitar código' });
  const lanterna = h('button', { class: 'btn icone scan-btn', type: 'button', hidden: true, 'aria-label': 'Lanterna', onclick: () => alternarLanterna() }, icone('sun'));
  const tela = h('div', { class: 'scan', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    video, h('div', { class: 'scan-mira', 'aria-hidden': 'true' }, h('span')),
    h('header', { class: 'scan-topo' }, h('strong', null, titulo), h('span', { class: 'grow' }), lanterna, h('button', { class: 'btn icone scan-btn', type: 'button', 'aria-label': 'Fechar câmera', onclick: () => fechar() }, icone('x'))),
    h('footer', { class: 'scan-base' }, status, h('form', { class: 'scan-form', onsubmit: (e) => { e.preventDefault(); const c = manual.value.trim(); if (c) entregar(c); manual.value = ''; } }, manual, h('button', { class: 'btn primario', type: 'submit' }, 'OK'))));
  let stream = null; let ativo = true; let ligada = false; let ultimo = ''; let ultimoEm = 0; let timer = 0;

  async function alternarLanterna() {
    const trilha = stream?.getVideoTracks()[0];
    try { ligada = !ligada; await trilha.applyConstraints({ advanced: [{ torch: ligada }] }); } catch { ligada = false; toast('Este aparelho não permite usar a lanterna.', 'aviso'); }
  }
  function fechar() {
    if (!ativo) return; ativo = false; clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop()); stream = null; tela.remove(); document.body.classList.remove('scan-aberto');
    document.removeEventListener('keydown', tecla, true);
  }
  const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
  async function entregar(codigo) {
    const agora = Date.now();
    if (codigo === ultimo && agora - ultimoEm < REPETIDO_MS) return; // mesmo código ainda na mira: ignora
    ultimo = codigo; ultimoEm = agora; bipe('ok');
    status.textContent = `Lido: ${codigo}`;
    const r = await aoLer?.(codigo);
    if (!continuo && r !== false) fechar();
  }

  document.body.append(tela); document.body.classList.add('scan-aberto'); document.addEventListener('keydown', tecla, true);
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!ativo) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream; await video.play();
      lanterna.hidden = !stream.getVideoTracks()[0]?.getCapabilities?.().torch;
      status.textContent = 'Procurando código…';
      const ler = await criarDecodificador();
      const volta = async () => {
        if (!ativo) return;
        try { const c = await ler(video); if (c) await entregar(c); } catch { /* quadro ruim */ }
        if (ativo) timer = setTimeout(() => requestAnimationFrame(volta), INTERVALO_MS);
      };
      volta();
    } catch (e) {
      status.textContent = e?.name === 'NotAllowedError' ? 'Permita o uso da câmera no navegador e tente de novo.' : 'Não consegui abrir a câmera. Digite o código abaixo.';
      manual.focus();
    }
  })();
  return { fechar };
}

/** Compatível com o antigo `leitorCamera`: devolve { botao, caixa, parar } para as telas que já o usam. */
export function leitorCamera(aoLer, opcoes = {}) {
  let aberto = null;
  const botao = h('button', { class: 'btn', type: 'button', onclick: () => { aberto = abrirScanner({ aoLer, ...opcoes }); } }, icone('camera'), 'Câmera');
  return { botao, caixa: h('div', { hidden: true }), parar: () => aberto?.fechar() };
}
