// Pix "copia e cola" estático com valor (padrão BR Code / EMV do Banco Central). Só monta o texto que vira QR Code:
// NÃO fala com banco, não recebe nem confirma pagamento. Quem vende confere o Pix no aplicativo do banco antes de concluir.
import { normalizarTexto } from './util.js';
import { cpfCnpjValido } from './modules/catalogo.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const ALEATORIA_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_QR_BYTES = 213; // limite do gerador de QR do sistema

/** Devolve a chave no formato que o Pix espera, ou null. Telefone precisa de "+55" para não ser confundido com CPF. */
export function normalizarChavePix(bruto) {
  const s = String(bruto ?? '').trim();
  if (!s || s.length > 77) return null;
  if (s.includes('@')) return EMAIL_RE.test(s) ? s.toLowerCase() : null;
  if (s.startsWith('+')) { const d = s.slice(1).replace(/[\s().-]/g, ''); return /^55\d{10,11}$/.test(d) ? `+${d}` : null; }
  if (ALEATORIA_RE.test(s.toLowerCase())) return s.toLowerCase();
  if (!/^[\d./\s-]+$/.test(s)) return null;
  const d = s.replace(/\D/g, '');
  return cpfCnpjValido(d) ? d : null;
}

/** Nome e cidade do recebedor: sem acento, maiúsculas, só o que o padrão aceita. */
export const limparTextoPix = (s, max) => normalizarTexto(s).toUpperCase().replace(/[^A-Z0-9 .-]/g, '').slice(0, max).trim();

const campo = (id, valor) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/** CRC16-CCITT (0x1021, início 0xFFFF), exigido no fim do código. */
export function crc16(texto) {
  let crc = 0xffff;
  for (const b of Buffer.from(texto, 'utf8')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function payloadPix({ chave, nome, cidade, valorCentavos, txid = '***' }) {
  const montar = (nomeFinal) => {
    const semCrc = campo('00', '01')
      + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave))
      + campo('52', '0000') + campo('53', '986')
      + campo('54', (valorCentavos / 100).toFixed(2))
      + campo('58', 'BR') + campo('59', nomeFinal) + campo('60', limparTextoPix(cidade, 15))
      + campo('62', campo('05', txid))
      + '6304';
    return semCrc + crc16(semCrc);
  };
  let nomeFinal = limparTextoPix(nome, 25);
  let texto = montar(nomeFinal);
  // chave de e-mail muito longa: encurta o nome (só informativo) para o texto caber no QR Code
  while (texto.length > MAX_QR_BYTES && nomeFinal.length > 1) { nomeFinal = nomeFinal.slice(0, -1).trim(); texto = montar(nomeFinal); }
  return texto;
}
