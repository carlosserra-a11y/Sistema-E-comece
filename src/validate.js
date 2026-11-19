import { invalido } from './util.js';

const conversores = {
  texto(s, v) {
    if (typeof v !== 'string') throw new Error('Deve ser texto.');
    let t = v.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (s.upper) t = t.toUpperCase();
    if (t.length < (s.min ?? 1)) throw new Error(s.min > 1 ? `Use pelo menos ${s.min} caracteres.` : 'Obrigatório.');
    if (t.length > (s.max ?? 200)) throw new Error(`Use no máximo ${s.max ?? 200} caracteres.`);
    if (s.regex && !s.regex.test(t)) throw new Error(s.msg ?? 'Formato inválido.');
    return t;
  },
  int(s, v) {
    const x = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
    if (!Number.isSafeInteger(x)) throw new Error('Deve ser um número inteiro.');
    if (x < (s.min ?? 0)) throw new Error(`Mínimo ${s.min ?? 0}.`);
    if (x > (s.max ?? 2_000_000_000)) throw new Error(`Máximo ${s.max ?? 2_000_000_000}.`);
    return x;
  },
  bool(_s, v) {
    if (v === true || v === 1 || v === 'true' || v === '1') return 1;
    if (v === false || v === 0 || v === 'false' || v === '0') return 0;
    throw new Error('Deve ser verdadeiro ou falso.');
  },
  enum(s, v) {
    if (!s.valores.includes(v)) throw new Error(`Use um destes: ${s.valores.join(', ')}.`);
    return v;
  },
  data(_s, v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Use o formato AAAA-MM-DD.');
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new Error('Data inexistente.');
    return v;
  },
};

/** Valida o corpo contra um esquema. Só os campos do esquema passam (protege contra mass assignment). */
export function validar(corpo, spec) {
  const entrada = corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo : {};
  const limpo = {};
  const campos = {};
  for (const [k, s] of Object.entries(spec)) {
    let v = Object.hasOwn(entrada, k) ? entrada[k] : undefined;
    if (v === '' || v === null) v = undefined;
    if (v === undefined) {
      if (s.obrig) campos[k] = 'Obrigatório.';
      else if ('padrao' in s) limpo[k] = s.padrao;
      continue;
    }
    try { limpo[k] = conversores[s.tipo](s, v); } catch (e) { campos[k] = e.message; }
  }
  if (Object.keys(campos).length) throw invalido(campos);
  return limpo;
}

export const T = (o = {}) => ({ tipo: 'texto', ...o });
export const I = (o = {}) => ({ tipo: 'int', ...o });
export const B = (o = {}) => ({ tipo: 'bool', ...o });
export const E = (valores, o = {}) => ({ tipo: 'enum', valores, ...o });
export const D = (o = {}) => ({ tipo: 'data', ...o });
export const ID = (o = {}) => ({ tipo: 'int', min: 1, ...o });
