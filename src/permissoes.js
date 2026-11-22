/**
 * Permissões do sistema. O DONO (conta de desenvolvedor) tem todas e é o único que escolhe o que cada pessoa pode.
 * Regra de ouro: tudo que não está liberado é NEGADO (o servidor confere em toda rota; esconder botão na tela é só conforto).
 */
export const GRUPOS = [
  { id: 'estoque', rotulo: 'Produtos e estoque', itens: [
    ['produtos.ver', 'Ver produtos (sem custo e preço)'], ['produtos.editar', 'Cadastrar e editar produtos e códigos de barras'],
    ['estoque.ver', 'Ver saldos, movimentações e onde está cada item'], ['estoque.operar', 'Receber, guardar, transferir, baixar e registrar avaria'],
    ['estoque.ajustar', 'Corrigir quantidade no estoque (pede a senha)'], ['etiquetas.imprimir', 'Gerar e imprimir etiquetas'],
    ['enderecos.ver', 'Ver endereços e o mapa do galpão'], ['enderecos.gerenciar', 'Criar, bloquear e alterar endereços'],
    ['contagem.operar', 'Fazer contagens de estoque'], ['contagem.aprovar', 'Aprovar contagens (ajusta o estoque; pede a senha)'],
    ['fornecedores.ver', 'Ver fornecedores'], ['fornecedores.editar', 'Cadastrar e editar fornecedores'],
  ] },
  { id: 'vendas', rotulo: 'Vendas e integrações', itens: [
    ['pedidos.ver', 'Ver pedidos'], ['pedidos.gerenciar', 'Reprocessar pedidos com problema'],
    ['integracoes.ver', 'Ver o estado do Mercado Livre e dos anúncios'], ['integracoes.gerenciar', 'Conectar, configurar e sincronizar o Mercado Livre'],
  ] },
  { id: 'financeiro', rotulo: 'Financeiro (restrito)', itens: [
    ['financeiro.ver', 'Ver custos, preços, valores de pedidos e margens; exportar com valores'],
  ] },
  { id: 'admin', rotulo: 'Administração', itens: [
    ['auditoria.ver', 'Ver o histórico de ações e verificar a integridade'],
    ['usuarios.gerenciar', 'Gerenciar a equipe e as permissões (somente o dono)'],
  ] },
];
export const TODAS = GRUPOS.flatMap((g) => g.itens.map(([id]) => id));
export const SO_DONO = new Set(['usuarios.gerenciar']); // nunca delegável: evita escalada de privilégio

const sem = (...fora) => TODAS.filter((p) => !fora.includes(p));
export const PAPEIS = {
  gerente: { rotulo: 'Gerente', descricao: 'Tudo, menos financeiro e equipe', permissoes: sem('financeiro.ver', 'usuarios.gerenciar') },
  estoquista: { rotulo: 'Estoquista', descricao: 'Cadastra, recebe, guarda, endereça e conta', permissoes: ['produtos.ver', 'produtos.editar', 'estoque.ver', 'estoque.operar', 'etiquetas.imprimir', 'enderecos.ver', 'enderecos.gerenciar', 'contagem.operar', 'fornecedores.ver'] },
  operador: { rotulo: 'Operador de galpão', descricao: 'Celular: bipar, guardar, transferir e contar', permissoes: ['produtos.ver', 'estoque.ver', 'estoque.operar', 'etiquetas.imprimir', 'enderecos.ver', 'contagem.operar'] },
  financeiro: { rotulo: 'Financeiro', descricao: 'Vê custos, preços e valores; não mexe no estoque', permissoes: ['financeiro.ver', 'produtos.ver', 'estoque.ver', 'pedidos.ver', 'fornecedores.ver', 'integracoes.ver'] },
  consulta: { rotulo: 'Somente consulta', descricao: 'Só olha, sem alterar nada', permissoes: ['produtos.ver', 'estoque.ver', 'enderecos.ver', 'pedidos.ver'] },
};

/** Normaliza uma lista vinda da tela: só permissões que existem e nunca as exclusivas do dono. */
export const limparPermissoes = (lista) => [...new Set((Array.isArray(lista) ? lista : []).filter((p) => TODAS.includes(p) && !SO_DONO.has(p)))].sort();

export function permissoesDe(usuario) {
  if (!usuario) return new Set();
  if (usuario.dono) return new Set(TODAS);
  let lista = [];
  try { lista = JSON.parse(usuario.permissoes || '[]'); } catch { /* lista inválida = sem permissões */ }
  return new Set(limparPermissoes(lista));
}

/** Campos de dinheiro: removidos de TODA resposta de quem não tem `financeiro.ver` (cinto e suspensório além do filtro por rota). */
export const CAMPOS_FINANCEIROS = new Set(['custo_centavos', 'preco_centavos', 'total_centavos']);
export function semFinanceiro(v) {
  if (Array.isArray(v)) return v.map(semFinanceiro);
  if (v && typeof v === 'object') {
    const saida = {};
    for (const [k, x] of Object.entries(v)) if (!CAMPOS_FINANCEIROS.has(k)) saida[k] = semFinanceiro(x);
    return saida;
  }
  return v;
}
/** Para código que roda também fora de uma requisição (seed, scripts): sem `ctx.pode` vale como dono. */
export const podeFinanceiro = (ctx) => (typeof ctx?.pode === 'function' ? ctx.pode('financeiro.ver') : true);

/** Rota -> permissão exigida. 'qualquer' = basta estar logado. Array = qualquer uma das listadas. */
const R = (metodo, padrao, perm) => [`${metodo} ${padrao}`, perm];
export const REGRAS = new Map([
  // sessão e conta própria
  R('GET', '/api/sessoes', 'qualquer'), R('DELETE', '/api/sessoes/:id', 'qualquer'), R('POST', '/api/sessoes/sair-todas', 'qualquer'),
  R('POST', '/api/conta/email', 'qualquer'), R('POST', '/api/conta/email/confirmar', 'qualquer'), R('POST', '/api/reautenticar', 'qualquer'), R('GET', '/api/painel', ['produtos.ver', 'estoque.ver', 'enderecos.ver', 'pedidos.ver', 'contagem.operar', 'fornecedores.ver', 'integracoes.ver']),
  // produtos e fornecedores
  R('GET', '/api/produtos', 'produtos.ver'), R('GET', '/api/produtos/:id', 'produtos.ver'), R('GET', '/api/produtos-exportar', 'produtos.ver'),
  R('POST', '/api/produtos', 'produtos.editar'), R('PUT', '/api/produtos/:id', 'produtos.editar'), R('POST', '/api/produtos/:id/inativar', 'produtos.editar'), R('POST', '/api/produtos/:id/reativar', 'produtos.editar'),
  R('POST', '/api/produtos/:id/codigos', 'produtos.editar'), R('POST', '/api/produtos/:id/codigos/gerar', 'produtos.editar'), R('POST', '/api/produtos/:id/codigos/:cid/principal', 'produtos.editar'),
  R('DELETE', '/api/produtos/:id/codigos/:cid', 'produtos.editar'), R('POST', '/api/codigos/gerar-faltantes', 'produtos.editar'), R('POST', '/api/produtos/importar', 'produtos.editar'),
  R('GET', '/api/fornecedores', 'fornecedores.ver'), R('GET', '/api/fornecedores/:id', 'fornecedores.ver'),
  R('POST', '/api/fornecedores', 'fornecedores.editar'), R('PUT', '/api/fornecedores/:id', 'fornecedores.editar'), R('POST', '/api/fornecedores/:id/inativar', 'fornecedores.editar'), R('POST', '/api/fornecedores/:id/reativar', 'fornecedores.editar'),
  // endereços
  R('GET', '/api/depositos', 'enderecos.ver'), R('GET', '/api/enderecos', 'enderecos.ver'), R('GET', '/api/enderecos/:id', 'enderecos.ver'), R('GET', '/api/mapa', 'enderecos.ver'),
  R('POST', '/api/depositos', 'enderecos.gerenciar'), R('POST', '/api/zonas', 'enderecos.gerenciar'), R('POST', '/api/enderecos/lote', 'enderecos.gerenciar'), R('PUT', '/api/enderecos/:id', 'enderecos.gerenciar'),
  R('POST', '/api/enderecos/:id/inativar', 'enderecos.gerenciar'), R('POST', '/api/enderecos/:id/reativar', 'enderecos.gerenciar'), R('PUT', '/api/produtos/:id/picking', 'enderecos.gerenciar'),
  // estoque
  R('POST', '/api/estoque/receber', 'estoque.operar'), R('POST', '/api/estoque/transferir', 'estoque.operar'), R('POST', '/api/estoque/baixar', 'estoque.operar'), R('POST', '/api/estoque/avaria', 'estoque.operar'),
  R('POST', '/api/estoque/ajustar', 'estoque.ajustar'),
  R('GET', '/api/estoque/onde/:produto_id', 'estoque.ver'), R('GET', '/api/estoque/sugestao', 'estoque.ver'), R('GET', '/api/estoque/integridade', 'estoque.ver'),
  R('GET', '/api/reposicao', 'estoque.ver'), R('GET', '/api/estoque/saldos', 'estoque.ver'), R('GET', '/api/estoque/movimentos', 'estoque.ver'),
  R('GET', '/api/scan', ['produtos.ver', 'estoque.ver', 'enderecos.ver', 'contagem.operar']),
  // etiquetas
  R('GET', '/api/etiquetas/svg', 'etiquetas.imprimir'), R('POST', '/api/etiquetas/zpl', 'etiquetas.imprimir'), R('GET', '/api/barcode.svg', 'etiquetas.imprimir'),
  // contagem
  R('GET', '/api/inventarios', 'contagem.operar'), R('POST', '/api/inventarios', 'contagem.operar'), R('GET', '/api/inventarios/:id', 'contagem.operar'), R('POST', '/api/inventarios/:id/contar', 'contagem.operar'),
  R('POST', '/api/inventarios/:id/vazio', 'contagem.operar'), R('POST', '/api/inventarios/:id/concluir-endereco', 'contagem.operar'), R('POST', '/api/inventarios/:id/cancelar', 'contagem.operar'),
  R('POST', '/api/inventarios/:id/aprovar', 'contagem.aprovar'),
  // pedidos e Mercado Livre
  R('GET', '/api/pedidos', 'pedidos.ver'), R('GET', '/api/pedidos/:id', 'pedidos.ver'), R('POST', '/api/pedidos/:id/reprocessar', 'pedidos.gerenciar'),
  R('GET', '/api/integracoes', 'integracoes.ver'), R('GET', '/api/anuncios', 'integracoes.ver'), R('GET', '/api/produtos/:id/anuncios', 'integracoes.ver'),
  R('PUT', '/api/integracoes/ml/config', 'integracoes.gerenciar'), R('POST', '/api/integracoes/ml/conectar', 'integracoes.gerenciar'), R('POST', '/api/integracoes/ml/desconectar', 'integracoes.gerenciar'),
  R('POST', '/api/integracoes/ml/sincronizar', 'integracoes.gerenciar'), R('POST', '/api/integracoes/ml/rotacionar-webhook', 'integracoes.gerenciar'),
  R('POST', '/api/produtos/:id/anuncios', 'integracoes.gerenciar'), R('PUT', '/api/anuncios/:id', 'integracoes.gerenciar'), R('DELETE', '/api/anuncios/:id', 'integracoes.gerenciar'),
  // administração
  R('GET', '/api/auditoria', 'auditoria.ver'), R('GET', '/api/auditoria/verificar', 'auditoria.ver'),
  R('GET', '/api/equipe', 'usuarios.gerenciar'), R('GET', '/api/equipe/catalogo', 'usuarios.gerenciar'), R('POST', '/api/equipe', 'usuarios.gerenciar'), R('PUT', '/api/equipe/:id', 'usuarios.gerenciar'),
  R('POST', '/api/equipe/:id/desativar', 'usuarios.gerenciar'), R('POST', '/api/equipe/:id/reativar', 'usuarios.gerenciar'), R('POST', '/api/equipe/:id/redefinir-senha', 'usuarios.gerenciar'), R('POST', '/api/email/testar', 'usuarios.gerenciar'),
]);
