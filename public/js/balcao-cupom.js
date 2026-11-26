// Cupom do balcão (NÃO é documento fiscal): mostrar, imprimir (bobina 80 mm ou folha) e montar o texto para mandar ao cliente.
import { h, api, icone, fmt, modal, tratar, copiar } from './core.js';

export const FORMA = { DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito' };
export const SITUACAO = { ORCAMENTO: ['Orçamento', 'info'], CONCLUIDA: ['Concluída', 'ok'], CANCELADA: ['Cancelada', 'erro'], DESCARTADA: ['Descartado', ''] };

const cnpj = (v) => (v && v.length === 14 ? `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}` : v);
const titulo = (v) => (v.status === 'ORCAMENTO' || v.status === 'DESCARTADA' ? 'ORÇAMENTO' : 'VENDA');

export function montarCupom(v) {
  const loja = v.loja ?? {};
  const linha = (rotulo, valor, classe = '') => h('div', { class: `cupom-linha ${classe}` }, h('span', null, rotulo), h('span', null, valor));
  return h('div', { class: 'cupom' },
    h('div', { class: 'cupom-centro' }, h('strong', null, loja.nome ?? 'Loja'),
      loja.cnpj && h('div', null, `CNPJ ${cnpj(loja.cnpj)}`),
      loja.endereco && h('div', null, loja.endereco),
      loja.cidade && h('div', null, `${loja.cidade}${loja.uf ? ` - ${loja.uf}` : ''}`)),
    h('hr'),
    h('div', { class: 'cupom-centro' }, h('strong', null, `${titulo(v)} Nº ${v.id}`), v.status === 'CANCELADA' && h('div', null, h('strong', null, '*** CANCELADA ***')),
      h('div', null, fmt.dataHora(v.concluida_em ?? v.criado_em))),
    v.cliente_nome && linha('Cliente', v.cliente_nome),
    v.cliente_documento && linha('CPF/CNPJ', v.cliente_documento),
    linha('Atendente', v.vendedor_nome),
    h('hr'),
    v.itens.map((i) => h('div', { class: 'cupom-item' }, h('div', null, i.descricao), linha(`${i.qtd} ${i.unidade} x ${fmt.moeda(i.preco_unit_centavos)}`, fmt.moeda(i.valor_centavos)))),
    h('hr'),
    v.desconto_centavos > 0 && [linha('Subtotal', fmt.moeda(v.subtotal_centavos)), linha('Desconto', `- ${fmt.moeda(v.desconto_centavos)}`)],
    linha('TOTAL', fmt.moeda(v.valor_centavos), 'cupom-total'),
    v.pagamentos.map((p) => linha(`${FORMA[p.forma]}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}`, fmt.moeda(p.valor_centavos + (p.forma === 'DINHEIRO' ? v.troco_centavos : 0)))),
    v.troco_centavos > 0 && linha('Troco', fmt.moeda(v.troco_centavos)),
    v.status === 'ORCAMENTO' && h('div', { class: 'cupom-centro' }, `Preços válidos até ${fmt.data(v.validade)}, sujeitos a estoque.`),
    v.observacao && h('div', null, `Obs.: ${v.observacao}`),
    h('hr'),
    v.cupom_rodape && h('div', { class: 'cupom-centro' }, v.cupom_rodape),
    h('div', { class: 'cupom-centro' }, 'Este comprovante NÃO é documento fiscal.'));
}

/** Imprime só o cupom (o resto da tela fica escondido na impressão). */
export function imprimirCupom(v) {
  document.getElementById('area-impressao')?.remove();
  const area = h('div', { id: 'area-impressao' }, montarCupom(v));
  document.body.append(area);
  document.body.classList.add('imprimindo-cupom');
  const limparImpressao = () => { document.body.classList.remove('imprimindo-cupom'); area.remove(); window.removeEventListener('afterprint', limparImpressao); };
  window.addEventListener('afterprint', limparImpressao);
  window.print();
}

export function textoDoCupom(v) {
  const linhas = [`*${v.loja?.nome ?? 'Loja'}* — ${titulo(v).toLowerCase()} nº ${v.id}`, ...v.itens.map((i) => `• ${i.qtd} ${i.unidade} ${i.descricao}: ${fmt.moeda(i.valor_centavos)}`)];
  if (v.desconto_centavos > 0) linhas.push(`Desconto: ${fmt.moeda(v.desconto_centavos)}`);
  linhas.push(`*Total: ${fmt.moeda(v.valor_centavos)}*`);
  if (v.status === 'ORCAMENTO') linhas.push(`Válido até ${fmt.data(v.validade)}.`);
  return linhas.join('\n');
}

/** Endereço do WhatsApp já com o texto pronto. Quem envia é a pessoa, no próprio WhatsApp. */
export function linkWhatsApp(telefone, texto) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  const numero = d.length === 10 || d.length === 11 ? `55${d}` : d.length >= 12 ? d : '';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

export function botoesCupom(v) {
  const texto = textoDoCupom(v);
  return h('div', { class: 'row' },
    h('button', { class: 'btn primario', type: 'button', onclick: () => imprimirCupom(v) }, icone('printer', 18), 'Imprimir'),
    h('a', { class: 'btn', href: linkWhatsApp(v.cliente_telefone, texto), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no WhatsApp'),
    h('button', { class: 'btn', type: 'button', onclick: () => copiar(texto) }, 'Copiar texto'));
}

export async function abrirCupom(vendaId, { destaque = null, rotuloFechar = 'Fechar', fecharAoLer = false, aoFechar } = {}) {
  try {
    const v = await api.get(`/api/vendas/${vendaId}`);
    let m;
    m = modal(`${titulo(v) === 'VENDA' ? 'Venda' : 'Orçamento'} nº ${v.id}`, h('div', { class: 'stack' }, destaque, botoesCupom(v), h('div', { class: 'cupom-previa' }, montarCupom(v)),
      h('button', { class: 'btn', type: 'button', autofocus: true, onclick: () => { m.fechar(); aoFechar?.(); } }, rotuloFechar)));
    // o próximo cliente começa bipando: a leitura fecha o cupom e já cai na busca, sem perder o item
    if (fecharAoLer) m.el.addEventListener('keydown', (e) => { if (/^[\p{L}\p{N}]$/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.stopPropagation(); m.fechar(); aoFechar?.(); } });
  } catch (e) { tratar(e); }
}
