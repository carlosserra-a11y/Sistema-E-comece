// Dados da empresa, segundo dono (só e-mail + código), confirmação de ação sensível por código e carga inicial do cliente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, codigoDoEmail } from './helpers.js';
import { provisionar, MAPA, PRODUTOS } from '../src/provisionar.js';
import { garantirDonosExtras, vincularEmailDono } from '../src/email.js';
import { integridade } from '../src/modules/estoque.js';
import { verificarCadeia } from '../src/security/audit.js';
import { TODAS } from '../src/permissoes.js';

async function com(fn, opts) {
  const sis = await criarSistema(opts);
  try { await fn(sis); } finally { await sis.parar(); }
}
const visitante = async (sis) => { const c = sis.cliente(); await c.get('/api/sessao'); return c; };
const EMPRESA = {
  razao_social: 'Empresa Teste LTDA', nome_fantasia: 'Loja Teste', cnpj: '11.222.333/0001-81', inscricao_estadual: '12.345.678-9',
  endereco: 'Rua Exemplo, 100 – Centro', cidade: 'Macapá', uf: 'ap', cep: '68900-000', email_nf: 'Fiscal@Exemplo.com',
  compras_nome: 'Fulana de Tal', compras_email: 'compras@exemplo.com', compras_telefone: '(96) 91234-5678',
  financeiro_nome: 'Fulana de Tal', financeiro_email: 'fin@exemplo.com', financeiro_telefone: '(96) 91234-5678',
  simples_nacional: true, contribuinte_icms: 'CONTRIBUINTE', suframa_numero: '123456789', aplicacao: 'REVENDA', responsavel: 'Fulana de Tal',
};

test('empresa: o dono cadastra e edita; máscaras saem, CNPJ é conferido e a auditoria não guarda os valores', async () => await com(async (sis) => {
  const dono = await entrarCompleto(sis);
  assert.equal((await dono.get('/api/empresa')).data.empresa, null);
  const r = await dono.put('/api/empresa', EMPRESA);
  assert.equal(r.status, 200, r.texto);
  const e = r.data.empresa;
  assert.equal(e.cnpj, '11222333000181'); assert.equal(e.cep, '68900000'); assert.equal(e.uf, 'AP'); assert.equal(e.email_nf, 'fiscal@exemplo.com');
  assert.equal(e.compras_telefone, '96912345678'); assert.equal(e.simples_nacional, 1); assert.equal(e.aplicacao, 'REVENDA');

  const ruim = await dono.put('/api/empresa', { ...EMPRESA, cnpj: '11.222.333/0001-82' });
  assert.equal(ruim.status, 422); assert.ok(ruim.erro.campos.cnpj);
  assert.equal((await dono.put('/api/empresa', { ...EMPRESA, razao_social: '' })).status, 422);
  assert.equal((await dono.put('/api/empresa', { ...EMPRESA, compras_email: 'isto-nao-e-email' })).status, 422);
  assert.equal((await dono.put('/api/empresa', { ...EMPRESA, contribuinte_icms: 'TALVEZ' })).status, 422);

  assert.equal((await dono.put('/api/empresa', { ...EMPRESA, cidade: 'Santana' })).data.empresa.cidade, 'Santana');
  const trilha = JSON.stringify(await sis.db.all('SELECT acao, detalhes FROM auditoria'));
  assert.match(trilha, /EMPRESA_CADASTRADA/); assert.match(trilha, /EMPRESA_ALTERADA/);
  assert.ok(!trilha.includes('Empresa Teste') && !trilha.includes('11222333') && !trilha.includes('exemplo.com'), 'só os nomes dos campos, nunca os valores');
}));

test('empresa: quem não recebeu a permissão não vê nem edita', async () => await com(async (sis) => {
  const dono = await entrarCompleto(sis);
  await dono.put('/api/empresa', EMPRESA);
  const p = await dono.post('/api/equipe', { nome: 'Joana Operadora', papel: 'operador' });
  assert.equal(p.status, 201, p.texto);
  const c = await visitante(sis);
  await c.post('/api/login', { login: p.data.login, senha: p.data.senha_provisoria });
  await c.post('/api/senha/trocar', { senha_atual: p.data.senha_provisoria, senha_nova: 'Lume!Verde#Telhado59' });
  for (const [m, corpo] of [['GET'], ['PUT', EMPRESA]]) {
    const r = await c.req(m, '/api/empresa', corpo);
    assert.equal(r.status, 403, m); assert.equal(r.erro.code, 'SEM_PERMISSAO');
  }
  // o papel financeiro só lê (notas e cotações)
  const f = await dono.post('/api/equipe', { nome: 'Marta Financeiro', papel: 'financeiro' });
  const cf = await visitante(sis);
  await cf.post('/api/login', { login: f.data.login, senha: f.data.senha_provisoria });
  await cf.post('/api/senha/trocar', { senha_atual: f.data.senha_provisoria, senha_nova: 'Lume!Verde#Telhado59' });
  assert.equal((await cf.get('/api/empresa')).status, 200);
  assert.equal((await cf.put('/api/empresa', EMPRESA)).status, 403);
}));

test('ação sensível: quem entra só pelo e-mail confirma com um código enviado à caixa de entrada', async () => await com(async (sis) => {
  const email = 'dev.dono@gmail.com';
  sis.cfg.donoEmail = email;
  assert.equal(await vincularEmailDono(sis.cfg, sis.db), true);
  const c = await visitante(sis);
  assert.equal((await c.post('/api/login/email', { email })).data.estagio, 'CODIGO_EMAIL');
  assert.equal((await c.post('/api/login/codigo', { codigo: codigoDoEmail(sis, email) })).data.estagio, 'COMPLETA');
  sis.relogio.t += 6 * 60_000; // venceu a janela de confirmação
  assert.equal((await c.put('/api/empresa', EMPRESA)).erro.code, 'REAUTENTICACAO');
  assert.equal((await c.post('/api/reautenticar', { codigo: '000000' })).status, 422, 'sem pedir o código não há o que confirmar');
  const pedido = await c.post('/api/reautenticar/codigo');
  assert.equal(pedido.status, 200, pedido.texto);
  assert.match(pedido.data.email, /^de\*+@gmail\.com$/);
  const certo = codigoDoEmail(sis, email);
  const errado = certo === '000000' ? '000001' : '000000';
  assert.equal((await c.post('/api/reautenticar', { codigo: errado })).status, 422);
  assert.equal((await c.post('/api/reautenticar', { codigo: certo })).status, 200);
  assert.equal((await c.put('/api/empresa', EMPRESA)).status, 200, 'depois de confirmar a ação passa');
  assert.equal((await c.post('/api/reautenticar', { senha: 'qualquer-coisa-1' })).status, 401, 'a senha continua sendo o outro caminho');
}));

test('segundo dono: o responsável da empresa entra só com e-mail + código, tem tudo liberado e ninguém mexe na conta do outro', async () => await com(async (sis) => {
  const email = 'cliente.teste@hotmail.com';
  sis.cfg.donosExtras = JSON.stringify([{ email: 'Cliente.Teste@Hotmail.com', nome: 'Cliente Teste' }, { email: 'invalido' }]);
  assert.equal(await garantirDonosExtras(sis.cfg, sis.db), 1);
  assert.equal(await garantirDonosExtras(sis.cfg, sis.db), 0, 'idempotente');
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM users WHERE dono = 1')).c, 2, 'agora são dois donos');

  const c = await visitante(sis);
  assert.equal((await c.post('/api/login', { login: email, senha: 'qualquer-coisa-1' })).status, 401, 'ninguém sabe a senha: só o código do e-mail abre');
  assert.equal((await c.post('/api/login/email', { email })).data.estagio, 'CODIGO_EMAIL');
  assert.equal((await c.post('/api/login/codigo', { codigo: codigoDoEmail(sis, email) })).data.estagio, 'COMPLETA');
  const eu = (await c.get('/api/sessao')).data.usuario;
  assert.equal(eu.dono, true); assert.equal(eu.nome, 'Cliente Teste'); assert.equal(eu.permissoes.length, TODAS.length);
  for (const rota of ['/api/equipe', '/api/empresa', '/api/auditoria', '/api/produtos']) assert.equal((await c.get(rota)).status, 200, rota);

  // uma conta de dono não altera a outra (nem desativa, nem redefine a senha)
  const itens = (await c.get('/api/equipe')).data.itens;
  const original = itens.find((u) => u.dono && !u.email);
  assert.ok(original, 'o dono original aparece na equipe');
  sis.relogio.t += 6 * 60_000;
  await c.post('/api/reautenticar/codigo'); await c.post('/api/reautenticar', { codigo: codigoDoEmail(sis, email) });
  for (const [m, rota, corpo] of [['PUT', `/api/equipe/${original.id}`, { nome: 'X X', papel: 'consulta' }], ['POST', `/api/equipe/${original.id}/desativar`, {}], ['POST', `/api/equipe/${original.id}/redefinir-senha`, {}]]) {
    const r = await c.req(m, rota, corpo);
    assert.equal(r.status, 409, rota); assert.equal(r.erro.code, 'DONO');
  }
  const d1 = await entrarCompleto(sis);
  const segundo = (await d1.get('/api/equipe')).data.itens.find((u) => u.email);
  assert.equal((await d1.post(`/api/equipe/${segundo.id}/desativar`, {})).status, 409, 'e o original também não mexe no segundo dono');
}));

test('carga inicial FRIO: empresa, endereçamento, produtos e estoque entram uma única vez e o saldo bate com o livro-razão', async () => await com(async (sis) => {
  sis.cfg.provisionar = 'frio'; sis.cfg.empresaJson = JSON.stringify(EMPRESA);
  assert.equal(await provisionar(sis.cfg, sis.db), true);
  assert.equal(await provisionar(sis.cfg, sis.db), false, 'segunda partida não repete nada');

  assert.equal((await sis.db.get('SELECT razao_social, cnpj FROM empresa')).cnpj, '11222333000181');
  const esperados = (z) => MAPA.filter((m) => m.zona === z).reduce((a, m) => a + m.predios * m.niveis, 0);
  assert.equal((await sis.db.get("SELECT COUNT(*) c FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE z.codigo = 'P'")).c, esperados('P'));
  assert.equal((await sis.db.get("SELECT COUNT(*) c FROM enderecos e JOIN zonas z ON z.id = e.zona_id WHERE z.codigo = 'V'")).c, esperados('V'));
  assert.equal((await sis.db.get('SELECT COUNT(*) c FROM produtos')).c, PRODUTOS.length);
  const saldo = async (sku) => (await sis.db.get('SELECT COALESCE(SUM(s.qtd),0) q FROM saldos_por_endereco s JOIN produtos p ON p.id = s.produto_id WHERE p.sku = ?', sku)).q;
  assert.equal(await saldo('GAS-MAPP-HULTER'), 24); assert.equal(await saldo('D-31016'), 20); assert.equal(await saldo('D-31017'), 20);
  assert.equal((await integridade(sis.db)).ok, true);
  assert.equal((await verificarCadeia(sis.db)).ok, true);

  // os códigos das etiquetas (inclusive o GTIN-14 lido como EAN-13) encontram o produto no leitor
  const dono = await entrarCompleto(sis);
  for (const [codigo, sku] of [['7899733820664', 'GAS-MAPP-HULTER'], ['07899733820664', 'GAS-MAPP-HULTER'], ['7908786413850', 'D-31016'], ['D31017', 'D-31017']]) {
    const r = await dono.get(`/api/scan?codigo=${codigo}`);
    assert.equal(r.status, 200, `${codigo}: ${r.texto.slice(0, 120)}`);
    assert.ok(r.texto.includes(sku), `${codigo} deveria achar ${sku}`);
  }
}));
