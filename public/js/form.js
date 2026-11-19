import { h, campo, centavos, reais } from './core.js';

/**
 * Formulário a partir de uma lista de campos: [chave, rótulo, tipo, opções].
 * tipos: texto | int | moeda | check | select | data | area. `valores()` devolve o corpo pronto para a API.
 */
export function formulario(campos, inicial = {}, aoEnviar, { rotuloEnviar = 'Salvar' } = {}) {
  const refs = {}; const caixas = {};
  const el = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => { e.preventDefault(); botao.disabled = true; try { await aoEnviar(valores()); } finally { botao.disabled = false; } } });
  const grade = h('div', { class: 'cols-2' });
  for (const [chave, rotulo, tipo, o = {}] of campos) {
    let input; const v = inicial[chave];
    if (tipo === 'check') input = h('input', { type: 'checkbox', checked: !!v });
    else if (tipo === 'select') input = h('select', null, o.opcoes.map(([val, r]) => h('option', { value: val, selected: String(val) === String(v ?? o.padrao ?? '') }, r)));
    else if (tipo === 'area') input = h('textarea', { rows: 3, maxlength: o.max }, v ?? '');
    else input = h('input', { type: tipo === 'data' ? 'date' : 'text', inputmode: tipo === 'int' ? 'numeric' : tipo === 'moeda' ? 'decimal' : o.inputmode, autocomplete: 'off', maxlength: o.max, value: tipo === 'moeda' ? reais(v ?? 0) : v ?? '', disabled: o.somenteLeitura });
    refs[chave] = { input, tipo };
    const alvo = tipo === 'check' ? h('label', { class: 'check' }, input, rotulo) : null;
    const bloco = alvo ?? campo(rotulo, input, { ajuda: o.ajuda });
    caixas[chave] = bloco; (o.largo || tipo === 'area' ? el : grade).append(bloco);
  }
  const botao = h('button', { class: 'btn primario', type: 'submit' }, rotuloEnviar);
  el.append(grade, botao);
  // `largo` fica antes da grade; reposiciona a grade para o início
  el.prepend(grade);
  function valores() {
    const out = {};
    for (const [k, { input, tipo }] of Object.entries(refs)) {
      if (tipo === 'check') out[k] = input.checked ? 1 : 0;
      else if (tipo === 'moeda') out[k] = centavos(input.value);
      else if (tipo === 'int') out[k] = input.value.trim() === '' ? undefined : Number(input.value);
      else out[k] = input.value;
    }
    return out;
  }
  function erros(campos = {}) {
    for (const [k, bloco] of Object.entries(caixas)) {
      bloco.querySelector('.erro')?.remove(); refs[k].input.removeAttribute('aria-invalid');
      if (campos[k]) { refs[k].input.setAttribute('aria-invalid', 'true'); bloco.append(h('span', { class: 'erro', role: 'alert' }, campos[k])); }
    }
    const primeiro = Object.keys(campos).find((k) => refs[k]); if (primeiro) refs[primeiro].input.focus();
  }
  return { el, valores, erros, refs };
}
