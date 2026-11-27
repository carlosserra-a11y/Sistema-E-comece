// Cadastro por e-mail: criar conta (e-mail + senha duas vezes), código de liberação no e-mail dos donos, entrada como Vendedor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TENTATIVAS_MAX } from '../src/modules/acesso.js';
import { criarSistema, entrarCompleto, codigoDoEmail, SENHA_FORTE } from './helpers.js';
import { vincularEmailDono, garantirDonosExtras } from '../src/email.js';
import { PAPEIS } from '../src/permissoes.js';

const SENHA = 'Cavalo-Azul-77';
const EMAIL = 'ana.souza@gmail.com';

const DONOS = ['xavier.dono@gmail.com', 'carla.dono@gmail.com', 'carlos.dono@gmail.com'];
const EXTRAS = JSON.stringify(DONOS.map((email, i) => ({ email, nome: `Dono ${i + 1}` })));
async function com(fn, { extras = EXTRAS, ...opts } = {}) {
  const sis = await criarSistema(opts);
  // como no servidor de verdade: os donos adicionais entram depois que a conta principal já existe
  sis.cfg.donosExtras = extras;
  try { await garantirDonosExtras(sis.cfg, sis.db); await fn(sis); } finally { await sis.parar(); }
}
/** O código que libera a conta nova chega aos donos, não a quem pediu. */
const liberacao = (sis) => codigoDoEmail(sis, DONOS[0]);
const visitante = async (sis) => { const c = sis.cliente(); await c.get('/api/sessao'); return c; };
async function cadastrar(sis, { nome = 'Ana Souza', email = EMAIL, senha = SENHA } = {}) {
  const c = await visitante(sis);
  const r = await c.post('/api/cadastro', { nome, email, senha, confirmacao: senha });
  return { c, r };
}
const confirmar = (c, codigo, { email = EMAIL, senha = SENHA } = {}) => c.post('/api/cadastro/confirmar', { email, codigo, senha });

test('sem e-mail configurado o cadastro fica desligado (a tela nem oferece "Criar conta")', async () => await com(async (sis) => {
  const c = await visitante(sis);
  assert.equal((await c.get('/api/sessao')).data.cadastro_disponivel, false);
  const r = await c.post('/api/cadastro', { nome: 'Ana Souza', email: EMAIL, senha: SENHA });
  assert.equal(r.status, 503);
  assert.equal(r.erro.code, 'CADASTRO_INDISPONIVEL');
}, { env: { EMAIL_TRANSPORTE: 'nenhum' } }));

test('cadastro: o código vai só para os três donos; com ele a pessoa entra como Vendedor', async () => await com(async (sis) => {
  const para = 'ana.souza+loja@hotmail.com';
  const { c, r } = await cadastrar(sis, { email: 'Ana.Souza+Loja@Hotmail.com' });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(sis.email.caixa.map((m) => m.para).sort(), [...DONOS].sort(), 'um e-mail para cada dono e nenhum para quem pediu');
  const codigo = liberacao(sis);
  assert.match(codigo, /^\d{6}$/);
  assert.deepEqual(DONOS.map((d) => codigoDoEmail(sis, d)), [codigo, codigo, codigo]);
  for (const trechoDoTexto of [/Ana Souza/, /ana\.souza\+loja@hotmail\.com/, /Vendedor/, /30 minutos/]) assert.match(sis.email.caixa[0].texto, trechoDoTexto);

  const antes = await (await visitante(sis)).post('/api/login', { login: para, senha: SENHA });
  assert.equal(antes.status, 403, 'antes do código não entra, mesmo com a senha certa');
  assert.equal(antes.erro.code, 'EMAIL_NAO_CONFIRMADO');
  assert.equal((await c.get('/api/produtos')).status, 401);

  const ok = await confirmar(c, codigo, { email: para });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(ok.data.estagio, 'COMPLETA');
  const eu = (await c.get('/api/sessao')).data.usuario;
  assert.deepEqual([eu.papel, eu.pendente, eu.dono], ['vendedor', false, false]);
  assert.deepEqual(eu.permissoes, [...PAPEIS.vendedor.permissoes].sort());
  assert.equal((await c.get('/api/produtos')).status, 200);
  for (const rota of ['/api/equipe', '/api/pedidos', '/api/auditoria']) assert.equal((await c.get(rota)).status, 403, rota);
  const dono = await entrarCompleto(sis);
  const pessoa = (await dono.get('/api/equipe')).data.itens.find((u) => u.email === para);
  assert.deepEqual([pessoa.papel, pessoa.email_verificado], ['vendedor', true]);

  // depois disso o código de cada entrada vai para o e-mail da própria pessoa
  await c.post('/api/logout');
  const quantos = sis.email.caixa.length;
  const entrada = await visitante(sis);
  const volta = await entrada.post('/api/login', { login: para, senha: SENHA });
  assert.equal(volta.data.estagio, 'CODIGO_EMAIL', volta.texto);
  assert.equal(sis.email.caixa.length, quantos + 1);
  assert.equal((await entrada.post('/api/login/codigo', { codigo: codigoDoEmail(sis, para) })).data.estagio, 'COMPLETA');
  const outra = await cadastrar(sis, { email: para, senha: 'Outra-Senha-99' });
  assert.equal(outra.r.status, 200, 'resposta igual para e-mail que já existe');
  assert.equal(sis.email.caixa.length, quantos + 1, 'nenhum e-mail sai para conta que já existe');
  assert.equal((await (await visitante(sis)).post('/api/login', { login: para, senha: 'Outra-Senha-99' })).status, 401);
}));

test('cadastro: Gmail sem pontos é o mesmo e-mail; sem dono com e-mail confirmado o cadastro não anda', async () => {
  await com(async (sis) => {
    const { c } = await cadastrar(sis);
    assert.equal((await confirmar(c, liberacao(sis))).status, 200);
    const antes = sis.email.caixa.length;
    sis.relogio.t += 61_000;
    assert.equal((await cadastrar(sis, { email: 'a.n.a.souza@gmail.com' })).r.status, 200);
    assert.equal(sis.email.caixa.length, antes);
  });
  await com(async (sis) => {
    const { r } = await cadastrar(sis);
    assert.equal(r.status, 503);
    assert.equal(r.erro.code, 'CADASTRO_INDISPONIVEL');
    assert.equal(sis.email.caixa.length, 0);
  }, { extras: '' });
});

test('cadastro: valida e-mail, domínio e senha (8 ou mais caracteres, sem limite de 8)', async () => await com(async (sis) => {
  const c = await visitante(sis);
  const tenta = (corpo) => { const d = { nome: 'Ana Souza', email: EMAIL, senha: SENHA, ...corpo }; return c.post('/api/cadastro', { confirmacao: d.senha, ...d }); };
  let r = await tenta({ email: 'ana@empresa-qualquer.com' });
  assert.equal(r.status, 422); assert.ok(r.erro.campos.email, 'só os provedores da lista');
  r = await tenta({ email: 'isto-nao-e-email' });
  assert.equal(r.status, 422);
  r = await tenta({ senha: '12345678' });
  assert.equal(r.status, 422); assert.match(r.erro.campos.senha, /comum/);
  r = await tenta({ senha: 'curta' });
  assert.equal(r.status, 422); assert.match(r.erro.campos.senha, /8 caracteres/);
  assert.equal(sis.email.caixa.length, 0, 'nada foi enviado');
  r = await tenta({ senha: 'uma frase longa e boa de lembrar 2026 '.repeat(2) });
  assert.equal(r.status, 200, 'senha longa é aceita: o limite mínimo é 8, não máximo');
  assert.equal(sis.email.caixa.length, DONOS.length);
}));

test('cadastro: a senha precisa ser repetida igual', async () => await com(async (sis) => {
  const c = await visitante(sis);
  const base = { nome: 'Ana Souza', email: EMAIL, senha: SENHA };
  const diferente = await c.post('/api/cadastro', { ...base, confirmacao: 'Outra-Coisa-12' });
  assert.equal(diferente.status, 422); assert.match(diferente.erro.campos.confirmacao, /não são iguais/);
  assert.equal((await c.post('/api/cadastro', base)).status, 422, 'sem repetir a senha não passa');
  assert.equal(sis.email.caixa.length, 0);
  assert.equal((await sis.db.get("SELECT COUNT(*) c FROM users WHERE papel = 'pendente'")).c, 0, 'nenhuma conta foi criada');
}));

test('Equipe: conta sem o código não muda de função nem de senha, só pode ser excluída', async () => await com(async (sis) => {
  const { c } = await cadastrar(sis);
  const dono = await entrarCompleto(sis);
  assert.equal((await dono.post('/api/reautenticar', { senha: SENHA_FORTE })).status, 200);
  const conta = (await dono.get('/api/equipe')).data.itens.find((u) => u.pendente);
  for (const r of [await dono.put(`/api/equipe/${conta.id}`, { nome: 'Ana Souza', papel: 'vendedor', permissoes: [...PAPEIS.vendedor.permissoes] }), await dono.post(`/api/equipe/${conta.id}/redefinir-senha`)]) {
    assert.equal(r.status, 409, r.texto); assert.equal(r.erro.code, 'SEM_CODIGO');
  }
  assert.equal((await confirmar(c, liberacao(sis))).status, 200, 'o código continua valendo');
}));

test('segurança: tentativas em paralelo não furam o limite de 5 erros do código', async () => await com(async (sis) => {
  const { c } = await cadastrar(sis);
  const certo = liberacao(sis);
  const errados = Array.from({ length: 25 }, (_, i) => String((Number(certo) + i + 1) % 1_000_000).padStart(6, '0'));
  const respostas = await Promise.all(errados.map((codigo) => confirmar(c, codigo)));
  assert.equal(respostas.filter((r) => /Restam|Código incorreto\. Peça/.test(r.erro.message)).length, 5, 'só 5 códigos foram comparados');
  assert.equal((await confirmar(c, certo)).status, 422, 'esgotado: nem o certo vale');
  assert.equal((await sis.db.get("SELECT cod_hash FROM users WHERE papel = 'pendente'")).cod_hash, null);
}));

test('segurança: conta desativada pelo dono não é refeita pelo cadastro público', async () => await com(async (sis) => {
  await cadastrar(sis);
  await sis.db.run("UPDATE users SET ativo = 0 WHERE papel = 'pendente'");
  const antes = [sis.email.caixa.length, (await sis.db.get("SELECT senha_hash FROM users WHERE papel = 'pendente'")).senha_hash];
  sis.relogio.t += 61_000;
  assert.equal((await cadastrar(sis, { senha: 'Outra-Senha-99' })).r.status, 200);
  assert.deepEqual([sis.email.caixa.length, (await sis.db.get("SELECT senha_hash FROM users WHERE papel = 'pendente'")).senha_hash], antes);
}));

test('segurança: teto de pedidos por hora e por dia, igual para e-mail novo ou existente; recusa por espera não gasta o teto', async () => await com(async (sis) => {
  const { c: ana } = await cadastrar(sis);
  assert.equal((await confirmar(ana, liberacao(sis))).status, 200);
  const pedidos = async () => Number((await sis.db.get("SELECT COUNT(*) c FROM auditoria WHERE acao = 'CADASTRO_PEDIDO'")).c);
  await cadastrar(sis, { email: 'bia.lima@gmail.com' });
  const visita = await visitante(sis);
  assert.equal((await visita.post('/api/cadastro/reenviar', { email: 'bia.lima@gmail.com' })).status, 429);
  assert.equal(await pedidos(), 2);
  let numero = 0;
  const lote = async () => { sis.relogio.t += 61 * 60_000; const s = []; for (let i = 0; i < 5; i++) s.push((await cadastrar(sis, { email: `lote${++numero}@gmail.com` })).r.status); return s; };
  for (let h = 0; h < 12 && await pedidos() < 60; h++) await lote(); // 5 por hora: bate no teto do dia
  assert.equal(await pedidos(), 60);
  sis.relogio.t += 61 * 60_000;
  for (const email of ['mais.um@gmail.com', EMAIL]) assert.equal((await cadastrar(sis, { email })).r.status, 429, email);
  assert.equal(sis.email.caixa.length, 60 * DONOS.length);
}));

test('segurança: virar dono por configuração derruba a senha e as sessões de quem usou o e-mail', async () => await com(async (sis) => {
  const alvo = 'futuro.dono@gmail.com';
  const { c } = await cadastrar(sis, { email: alvo });
  assert.equal((await confirmar(c, liberacao(sis), { email: alvo })).status, 200);
  sis.cfg.donosExtras = JSON.stringify([{ email: alvo }]);
  await garantirDonosExtras(sis.cfg, sis.db);
  assert.equal((await c.get('/api/equipe')).status, 401, 'a sessão antiga caiu');
  assert.equal((await (await visitante(sis)).post('/api/login', { login: alvo, senha: SENHA })).status, 401, 'a senha antiga não vale');
  assert.equal((await (await visitante(sis)).post('/api/login/email', { email: alvo })).status, 200, 'o dono entra pelo código no e-mail');
}));

test('segurança: código pedido para uma coisa não serve para outra', async () => await com(async (sis) => {
  const dono = await entrarCompleto(sis);
  const meu = 'dono.sistema@gmail.com';
  assert.equal((await dono.post('/api/conta/email', { email: meu })).status, 200);
  assert.equal((await dono.post('/api/conta/email/confirmar', { codigo: codigoDoEmail(sis, meu) })).status, 200);
  sis.relogio.t += 61_000;
  assert.equal((await dono.post('/api/reautenticar/codigo')).status, 200);
  const deAcao = codigoDoEmail(sis, meu);
  sis.relogio.t += 1000;
  assert.equal((await dono.post('/api/conta/email', { email: 'outro.endereco@gmail.com' })).status, 429);
  sis.relogio.t += 61_000;
  assert.equal((await dono.post('/api/conta/email', { email: 'outro.endereco@gmail.com' })).status, 200);
  assert.equal((await dono.post('/api/reautenticar', { codigo: codigoDoEmail(sis, 'outro.endereco@gmail.com') })).status, 422, 'código de vínculo não confirma ação');
  assert.equal((await dono.post('/api/conta/email/confirmar', { codigo: deAcao })).status, 422, 'código de ação não vincula e-mail');
}));

test('código: 5 erros o invalidam, reenvio tem espera de 60 s e o código vence em 30 minutos', async () => await com(async (sis) => {
  const { c } = await cadastrar(sis);
  const certo = liberacao(sis);
  const errado = certo === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) {
    const r = await confirmar(c, errado);
    assert.equal(r.status, 422); assert.equal(r.erro.code, 'CODIGO_INVALIDO');
  }
  assert.match((await confirmar(c, errado)).erro.message, /novo código/);
  assert.equal((await confirmar(c, certo)).status, 422, 'depois de 5 erros nem o certo vale mais');

  assert.equal((await c.post('/api/cadastro/reenviar', { email: EMAIL })).status, 429, 'espera entre envios');
  assert.equal(sis.email.caixa.length, DONOS.length);
  sis.relogio.t += 61_000;
  assert.equal((await c.post('/api/cadastro/reenviar', { email: EMAIL })).status, 200);
  assert.equal(sis.email.caixa.length, 2 * DONOS.length);
  assert.equal((await c.post('/api/cadastro/reenviar', { email: 'ninguem@gmail.com' })).status, 200, 'não revela se o e-mail existe');
  assert.equal(sis.email.caixa.length, 2 * DONOS.length);

  sis.relogio.t += 31 * 60_000; // venceu
  const vencido = await confirmar(c, liberacao(sis));
  assert.equal(vencido.status, 422);
  sis.relogio.t += 61_000;
  await c.post('/api/cadastro/reenviar', { email: EMAIL });
  assert.equal((await confirmar(c, liberacao(sis))).status, 200, 'código novo funciona');
}));

test('segurança: quem cadastra o e-mail de outra pessoa não consegue confirmá-lo pela vítima', async () => await com(async (sis) => {
  const { c: atacante } = await cadastrar(sis, { nome: 'Atacante', senha: 'SenhaDoAtacante-1' });
  sis.relogio.t += 61_000;
  const { c: dona } = await cadastrar(sis, { senha: SENHA }); // a dona de verdade refaz o cadastro: vale o mais recente
  const codigo = liberacao(sis);
  const r = await confirmar(atacante, codigo, { senha: 'SenhaDoAtacante-1' });
  assert.equal(r.status, 422);
  assert.equal(r.erro.code, 'SENHA_NAO_CONFERE', 'o código sozinho não basta: precisa da senha do cadastro');
  assert.equal((await confirmar(dona, codigo)).status, 200);
  assert.equal((await (await visitante(sis)).post('/api/login', { login: EMAIL, senha: 'SenhaDoAtacante-1' })).status, 401);
}));

test('cadastro: limite por aparelho/rede e bloqueio após 10 senhas erradas no login por e-mail', async () => await com(async (sis) => {
  const c = await visitante(sis);
  for (let i = 1; i <= 5; i++) assert.equal((await c.post('/api/cadastro', { nome: 'Pessoa Teste', email: `pessoa${i}@gmail.com`, senha: SENHA, confirmacao: SENHA })).status, 200);
  const sexto = await c.post('/api/cadastro', { nome: 'Pessoa Teste', email: 'pessoa6@gmail.com', senha: SENHA, confirmacao: SENHA });
  assert.equal(sexto.status, 429);
  assert.match(sexto.erro.message, /Aguarde \d+ (segundos|minutos)/);

  sis.relogio.t += 61 * 60_000;
  const { c: dona } = await cadastrar(sis);
  assert.equal((await confirmar(dona, liberacao(sis))).status, 200);
  const a = await visitante(sis);
  for (let i = 0; i < TENTATIVAS_MAX; i++) assert.equal((await a.post('/api/login', { login: EMAIL, senha: 'errada-errada-1' })).status, 401);
  const bloq = await a.post('/api/login', { login: EMAIL, senha: SENHA });
  assert.equal(bloq.status, 429, 'mesmo com a senha certa, fica bloqueado um tempo');
  assert.match(bloq.erro.message, /Aguarde \d+ (segundos|minutos)/);
}));

test('conta criada pelo dono pode vincular um e-mail (com código) e entrar por ele; e-mail em uso é recusado', async () => await com(async (sis) => {
  const dono = await entrarCompleto(sis);
  const meu = 'dono.sistema@gmail.com';
  assert.equal((await dono.post('/api/conta/email/confirmar', { codigo: '123456' })).status, 409, 'sem e-mail pendente');
  assert.equal((await dono.post('/api/conta/email', { email: 'dono@empresa-qualquer.com' })).status, 422);
  assert.equal((await dono.post('/api/conta/email', { email: meu })).status, 200);
  assert.equal((await dono.post('/api/conta/email/confirmar', { codigo: '000000' })).status, 422);
  const ok = await dono.post('/api/conta/email/confirmar', { codigo: codigoDoEmail(sis, meu) });
  assert.equal(ok.status, 200, ok.texto);
  assert.match((await dono.get('/api/sessao')).data.usuario.email, /^do\*+@gmail\.com$/, 'e-mail aparece mascarado');

  const porEmailC = await visitante(sis);
  const porEmail = await porEmailC.post('/api/login', { login: meu, senha: SENHA_FORTE });
  assert.equal(porEmail.status, 200, porEmail.texto);
  assert.equal(porEmail.data.estagio, 'CODIGO_EMAIL', 'com e-mail vinculado, o login passa a pedir o código');
  assert.equal((await porEmailC.post('/api/login/codigo', { codigo: codigoDoEmail(sis, meu) })).data.estagio, 'COMPLETA');

  const { c: ana } = await cadastrar(sis);
  await confirmar(ana, liberacao(sis));
  assert.equal((await ana.post('/api/conta/email', { email: meu })).status, 409, 'e-mail de outra conta');

  const t = await dono.post('/api/email/testar', { para: meu });
  assert.equal(t.status, 200, t.texto);
  assert.match(sis.email.caixa.at(-1).assunto, /Teste de e-mail/);
  assert.equal((await ana.post('/api/email/testar', {})).status, 403, 'só o dono testa o envio');
}));

test('dados: e-mail e código nunca ficam em texto puro; cadastro não confirmado some em 24 h', async () => await com(async (sis) => {
  const { c } = await cadastrar(sis);
  const codigo = liberacao(sis);
  const antes = JSON.stringify(await sis.db.all('SELECT * FROM users'));
  assert.ok(!antes.includes(EMAIL) && !antes.includes(SENHA) && !antes.includes(`"${codigo}"`), 'só cifrado/HMAC no banco');
  assert.equal((await confirmar(c, codigo)).status, 200);
  const { c: segunda } = await cadastrar(sis, { nome: 'Bia Lima', email: 'bia.lima@gmail.com' });
  assert.equal(segunda.cookies.size > 0, true);
  const trilha = JSON.stringify(await sis.db.all('SELECT acao, detalhes FROM auditoria'));
  assert.match(trilha, /CADASTRO_CRIADO/); assert.match(trilha, /CADASTRO_CONFIRMADO/);
  assert.ok(!trilha.includes('ana.souza') && !trilha.includes(SENHA));

  sis.relogio.t += 25 * 3_600_000;
  await sis.limpar();
  const restam = await sis.db.all("SELECT papel, email_verificado FROM users WHERE papel IN ('pendente', 'vendedor')");
  assert.deepEqual(restam.map((u) => [u.papel, u.email_verificado]), [['vendedor', 1]], 'só a que foi liberada ficou');
}));

test('conta pendente excluída pelo dono não trava a faxina de cadastros e continua no histórico', async () => await com(async (sis) => {
  const dono = await entrarCompleto(sis);
  const { c } = await cadastrar(sis);
  assert.equal((await confirmar(c, liberacao(sis))).status, 200);
  await sis.db.run("UPDATE users SET papel = 'pendente', permissoes = '[]' WHERE papel = 'vendedor'"); // conta do jeito antigo, aguardando liberação
  const ana = await sis.db.get("SELECT id FROM users WHERE papel = 'pendente'");
  assert.equal((await dono.post('/api/reautenticar', { senha: SENHA_FORTE })).status, 200);
  assert.equal((await dono.post(`/api/equipe/${ana.id}/excluir`)).status, 200);
  await cadastrar(sis, { nome: 'Bia Lima', email: 'bia.lima@gmail.com' }); // nunca confirma
  sis.relogio.t += 25 * 3_600_000;
  await sis.limpar();
  const restam = await sis.db.all("SELECT id, excluido_em FROM users WHERE papel = 'pendente'");
  assert.deepEqual(restam.map((u) => [u.id, u.excluido_em > 0]), [[ana.id, true]]);
  const nova = await cadastrar(sis); // o mesmo e-mail pode criar outra conta
  assert.equal(nova.r.status, 200, nova.r.texto);
}));

// ---------------------------------------------------------------- 2ª etapa: código por e-mail a cada login
async function contaConfirmada(sis) {
  const { c } = await cadastrar(sis);
  assert.equal((await confirmar(c, liberacao(sis))).status, 200);
  await c.post('/api/logout');
}

test('login com código: a cada login o e-mail recebe um código e a sessão só abre depois dele', async () => await com(async (sis) => {
  await contaConfirmada(sis);
  const c = await visitante(sis);
  const r = await c.post('/api/login', { login: EMAIL, senha: SENHA });
  assert.equal(r.data.estagio, 'CODIGO_EMAIL');
  assert.match(r.data.email, /^an\*+@gmail\.com$/, 'só o e-mail mascarado volta na resposta');
  const bloq = await c.get('/api/produtos');
  assert.equal(bloq.status, 403);
  assert.equal(bloq.erro.code, 'ETAPA_INVALIDA', 'sem o código a sessão não vale nada');
  assert.equal((await c.get('/api/sessoes')).status, 403);

  const certo = codigoDoEmail(sis, EMAIL);
  const errado = certo === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/login/codigo', { codigo: errado })).erro.code, 'CODIGO_INVALIDO');
  assert.match((await c.post('/api/login/codigo', { codigo: errado })).erro.message, /novo código/);
  assert.equal((await c.post('/api/login/codigo', { codigo: certo })).status, 422, 'depois de 5 erros nem o certo vale');

  assert.equal((await c.post('/api/login/codigo/reenviar')).status, 429, 'espera de 60 s entre envios');
  sis.relogio.t += 61_000;
  assert.equal((await c.post('/api/login/codigo/reenviar')).status, 200);
  const ok = await c.post('/api/login/codigo', { codigo: codigoDoEmail(sis, EMAIL) });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(ok.data.estagio, 'COMPLETA');
  assert.equal((await c.get('/api/sessoes')).status, 200);
  assert.equal((await c.post('/api/login/codigo', { codigo: '123456' })).status, 403, 'depois de entrar a rota do código não serve mais');
}));

test('login com código: o código vence em 10 minutos, sair cancela e cada login manda um código novo', async () => await com(async (sis) => {
  await contaConfirmada(sis);
  const c = await visitante(sis);
  await c.post('/api/login', { login: EMAIL, senha: SENHA });
  const primeiro = codigoDoEmail(sis, EMAIL);
  sis.relogio.t += 11 * 60_000;
  assert.equal((await c.post('/api/login/codigo', { codigo: primeiro })).erro.code, 'CODIGO_INVALIDO', 'vencido');
  assert.equal((await c.post('/api/logout')).status, 200, 'dá para desistir na etapa do código');
  assert.equal((await c.get('/api/sessao')).data.estagio, null);

  const d = await visitante(sis);
  const antes = sis.email.caixa.length;
  await d.post('/api/login', { login: EMAIL, senha: SENHA });
  assert.equal(sis.email.caixa.length, antes + 1, 'novo login, novo código');
  assert.equal((await d.post('/api/login/codigo', { codigo: codigoDoEmail(sis, EMAIL) })).status, 200);
}));

test('login com código: senha errada não envia e-mail e código de outra conta não serve', async () => await com(async (sis) => {
  await contaConfirmada(sis);
  const antes = sis.email.caixa.length;
  const c = await visitante(sis);
  assert.equal((await c.post('/api/login', { login: EMAIL, senha: 'errada-errada-1' })).status, 401);
  assert.equal(sis.email.caixa.length, antes, 'sem a senha certa ninguém dispara e-mail para a vítima');

  const { c: bia } = await cadastrar(sis, { nome: 'Bia Lima', email: 'bia.lima@gmail.com' });
  sis.relogio.t += 61 * 60_000; // limpa o limite por aparelho
  await confirmar(bia, liberacao(sis), { email: 'bia.lima@gmail.com' });
  await (await visitante(sis)).post('/api/login', { login: 'bia.lima@gmail.com', senha: SENHA }); // gera o código de entrada dela
  const d = await visitante(sis);
  await d.post('/api/login', { login: EMAIL, senha: SENHA });
  const deBia = codigoDoEmail(sis, 'bia.lima@gmail.com');
  const doDono = codigoDoEmail(sis, EMAIL);
  if (deBia !== doDono) assert.equal((await d.post('/api/login/codigo', { codigo: deBia })).status, 422, 'o código de outra pessoa não abre esta conta');
}));

test('login com código: e-mail fora do ar = erro claro e nenhuma sessão aberta; LOGIN_CODIGO=0 desliga a etapa', async () => {
  await com(async (sis) => {
    await contaConfirmada(sis);
    sis.email.enviar = async () => { throw new Error('smtp fora do ar'); };
    const c = await visitante(sis);
    const r = await c.post('/api/login', { login: EMAIL, senha: SENHA });
    assert.equal(r.status, 502);
    assert.equal(r.erro.code, 'EMAIL_FALHOU');
    assert.equal((await c.get('/api/sessao')).data.estagio, null, 'nada ficou aberto');
  });
  await com(async (sis) => {
    await contaConfirmada(sis);
    const c = await visitante(sis);
    const r = await c.post('/api/login', { login: EMAIL, senha: SENHA });
    assert.equal(r.data.estagio, 'COMPLETA', 'interruptor de emergência');
  }, { env: { LOGIN_CODIGO: '0' } });
});

test('login com código: conta com senha provisória confirma o código e depois troca a senha', async () => await com(async (sis) => {
  await contaConfirmada(sis);
  const dono = await entrarCompleto(sis);
  const ana = (await dono.get('/api/equipe')).data.itens.find((u) => u.email === EMAIL);
  const red = await dono.post(`/api/equipe/${ana.id}/redefinir-senha`);
  assert.equal(red.status, 200, red.texto);
  const c = await visitante(sis);
  assert.equal((await c.post('/api/login', { login: EMAIL, senha: red.data.senha_provisoria })).data.estagio, 'CODIGO_EMAIL');
  const r = await c.post('/api/login/codigo', { codigo: codigoDoEmail(sis, EMAIL) });
  assert.equal(r.data.estagio, 'TROCAR_SENHA');
  const nova = 'Outro-Cavalo-88';
  assert.equal((await c.post('/api/senha/trocar', { senha_atual: red.data.senha_provisoria, senha_nova: nova })).data.estagio, 'COMPLETA');
}));

// ---------------------------------------------------------------- conta do dono: só e-mail + código, sem senha
const DONO = 'dev.dono@gmail.com';
const comDono = (fn) => com(async (sis) => { assert.equal(await vincularEmailDono(sis.cfg, sis.db), true); await fn(sis); }, { env: { DONO_EMAIL: DONO } });

test('dono: o e-mail do desenvolvedor entra só com o código (sem senha) e já tem tudo liberado', async () => await comDono(async (sis) => {
  assert.equal(await vincularEmailDono(sis.cfg, sis.db), false, 'idempotente');
  const c = await visitante(sis);
  const r = await c.post('/api/login/email', { email: 'Dev.Dono@Gmail.com' });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.data.estagio, 'CODIGO_EMAIL');
  assert.equal((await c.get('/api/equipe')).erro.code, 'ETAPA_INVALIDA', 'sem o código nada abre');
  assert.equal((await c.post('/api/login/codigo', { codigo: '000000' })).status, 422);
  const ok = await c.post('/api/login/codigo', { codigo: codigoDoEmail(sis, DONO) });
  assert.equal(ok.data.estagio, 'COMPLETA', 'mesmo com a senha provisória ainda pendente, o dono não é obrigado a trocá-la');
  const eu = (await c.get('/api/sessao')).data.usuario;
  assert.equal(eu.dono, true);
  for (const rota of ['/api/equipe', '/api/auditoria', '/api/pedidos', '/api/produtos', '/api/integracoes']) assert.equal((await c.get(rota)).status, 200, rota);
}));

test('dono: só o e-mail do dono entra sem senha; os outros continuam precisando de senha', async () => await comDono(async (sis) => {
  const { c: ana } = await cadastrar(sis);
  await confirmar(ana, liberacao(sis));
  await ana.post('/api/logout');
  const antes = sis.email.caixa.length;
  for (const email of [EMAIL, 'ninguem@gmail.com', 'isto-nao-e-email']) {
    const r = await (await visitante(sis)).post('/api/login/email', { email });
    assert.equal(r.status, 401, email);
    assert.equal(r.erro.message, 'E-mail ou senha inválidos.');
  }
  assert.equal(sis.email.caixa.length, antes, 'nenhum e-mail sai para quem não é o dono');
}));

test('dono: 5 códigos errados invalidam o código e LOGIN_CODIGO=0 fecha a porta sem senha', async () => {
  await comDono(async (sis) => {
    const c = await visitante(sis);
    await c.post('/api/login/email', { email: DONO });
    const certo = codigoDoEmail(sis, DONO);
    const errado = certo === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/login/codigo', { codigo: errado })).status, 422);
    assert.equal((await c.post('/api/login/codigo', { codigo: certo })).status, 422, 'esgotado: nem o certo vale');
  });
  await com(async (sis) => {
    await vincularEmailDono(sis.cfg, sis.db);
    const r = await (await visitante(sis)).post('/api/login/email', { email: DONO });
    assert.equal(r.status, 401, 'sem o código ligado não existe entrada sem senha');
  }, { env: { DONO_EMAIL: DONO, LOGIN_CODIGO: '0' } });
});

test('dono: DONO_EMAIL tira da frente quem reservou o e-mail e respeita conta confirmada de outra pessoa', async () => {
  await com(async (sis) => {
    await cadastrar(sis, { nome: 'Invasor', email: DONO }); // cadastro não confirmado "reservando" o e-mail do dono
    assert.equal(await vincularEmailDono(sis.cfg, sis.db), true);
    const donos = await sis.db.all('SELECT dono, email_verificado FROM users WHERE email_hmac IS NOT NULL');
    assert.deepEqual(donos.map((u) => [u.dono, u.email_verificado]), Array(DONOS.length + 1).fill([1, 1]), 'sobram só donos');
  }, { env: { DONO_EMAIL: DONO } });
  await com(async (sis) => {
    const { c } = await cadastrar(sis, { email: DONO });
    await confirmar(c, liberacao(sis), { email: DONO }); // conta de verdade já liberada com esse e-mail
    assert.equal(await vincularEmailDono(sis.cfg, sis.db), false, 'não rouba o e-mail de uma conta confirmada');
  }, { env: { DONO_EMAIL: DONO } });
});

test('desenvolvedor: a conta do DONO_EMAIL entra só com o e-mail e aparece como desenvolvedor; os donos continuam donos', async () => await com(async (sis) => {
  await vincularEmailDono(sis.cfg, sis.db);
  const entrarSoComEmail = async (email) => {
    const c = await visitante(sis);
    const r = await c.post('/api/login/email', { email });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await c.post('/api/login/codigo', { codigo: codigoDoEmail(sis, email) })).data.estagio, 'COMPLETA');
    return c;
  };
  const dev = await entrarSoComEmail(DONO);
  const eu = (await dev.get('/api/sessao')).data.usuario;
  assert.deepEqual([eu.dono, eu.desenvolvedor], [true, true]);
  const equipe = (await dev.get('/api/equipe')).data.itens;
  assert.deepEqual(equipe.filter((u) => u.desenvolvedor).map((u) => u.email), [DONO]);
  assert.deepEqual(equipe.filter((u) => u.dono && !u.desenvolvedor).map((u) => u.email).sort(), [...DONOS].sort());
  assert.equal((await dev.get('/api/atividade')).data.pessoas.filter((p) => p.desenvolvedor).length, 1);
  sis.relogio.t += 61_000;
  assert.equal((await dev.post('/api/reautenticar/codigo')).status, 200);
  assert.equal((await dev.post('/api/reautenticar', { codigo: codigoDoEmail(sis, DONO) })).status, 200, 'confirma ação sensível sem senha');
  const dono = await entrarSoComEmail(DONOS[0]);
  const outro = (await dono.get('/api/sessao')).data.usuario;
  assert.deepEqual([outro.dono, outro.desenvolvedor], [true, false]);
}, { env: { DONO_EMAIL: DONO } }));
