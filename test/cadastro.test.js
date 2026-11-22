// Cadastro por e-mail: criar conta (Gmail + senha), código de 6 dígitos no e-mail, conta pendente até o dono liberar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TENTATIVAS_MAX } from '../src/modules/acesso.js';
import { criarSistema, entrarCompleto, codigoDoEmail, SENHA_FORTE } from './helpers.js';

const SENHA = 'Cavalo-Azul-77';
const EMAIL = 'ana.souza@gmail.com';

async function com(fn, opts) {
  const sis = await criarSistema(opts);
  try { await fn(sis); } finally { await sis.parar(); }
}
const visitante = async (sis) => { const c = sis.cliente(); await c.get('/api/sessao'); return c; };
async function cadastrar(sis, { nome = 'Ana Souza', email = EMAIL, senha = SENHA } = {}) {
  const c = await visitante(sis);
  const r = await c.post('/api/cadastro', { nome, email, senha });
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

test('cadastro: cria a conta, manda o código ao e-mail, confirma, fica pendente até o dono liberar', async () => await com(async (sis) => {
  assert.equal((await (await visitante(sis)).get('/api/sessao')).data.cadastro_disponivel, true);
  const { c, r } = await cadastrar(sis, { email: 'Ana.Souza+Loja@Gmail.com' });
  assert.equal(r.status, 200, r.texto);
  const para = 'ana.souza+loja@gmail.com';
  const codigo = codigoDoEmail(sis, para);
  assert.match(codigo, /^\d{6}$/, 'o código foi para o e-mail que a pessoa digitou');

  // antes de confirmar o e-mail não entra, mesmo com a senha certa
  const antes = await (await visitante(sis)).post('/api/login', { login: para, senha: SENHA });
  assert.equal(antes.status, 403);
  assert.equal(antes.erro.code, 'EMAIL_NAO_CONFIRMADO');
  assert.equal((await c.get('/api/produtos')).status, 401);

  const ok = await confirmar(c, codigo, { email: para });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(ok.data.estagio, 'COMPLETA', 'sem QR Code nem segunda etapa');

  // conta nova nasce sem nenhuma permissão
  const eu = (await c.get('/api/sessao')).data.usuario;
  assert.equal(eu.pendente, true);
  assert.deepEqual(eu.permissoes, []);
  for (const rota of ['/api/produtos', '/api/estoque/saldos', '/api/painel', '/api/pedidos', '/api/equipe']) {
    const x = await c.get(rota);
    assert.equal(x.status, 403, rota);
    assert.equal(x.erro.code, 'SEM_PERMISSAO');
  }
  assert.equal((await c.get('/api/sessoes')).status, 200, 'a própria conta continua acessível');

  // o dono vê a pessoa na equipe (com o e-mail) e libera
  const dono = await entrarCompleto(sis);
  const pessoa = (await dono.get('/api/equipe')).data.itens.find((u) => u.email === para);
  assert.ok(pessoa, 'aparece na equipe');
  assert.equal(pessoa.pendente, true);
  assert.equal(pessoa.email_verificado, true);
  const lib = await dono.put(`/api/equipe/${pessoa.id}`, { nome: 'Ana Souza', papel: 'operador' });
  assert.equal(lib.status, 200, lib.texto);
  assert.equal(lib.data.pendente, false);
  assert.equal((await c.get('/api/produtos')).status, 200, 'vale na próxima requisição, sem sair');
  assert.equal((await c.get('/api/pedidos')).status, 403, 'operador não vê pedidos');

  // depois disso entra só com e-mail e senha; pontos e +etiqueta do Gmail não criam outra identidade
  await c.post('/api/logout');
  const antesDeEntrar = sis.email.caixa.length;
  const entrada = await visitante(sis);
  const volta = await entrada.post('/api/login', { login: 'anasouza@gmail.com', senha: SENHA });
  assert.equal(volta.status, 200, volta.texto);
  assert.equal(volta.data.estagio, 'CODIGO_EMAIL', 'a cada login novo vai um código para o e-mail');
  assert.equal(sis.email.caixa.length, antesDeEntrar + 1);
  const fim = await entrada.post('/api/login/codigo', { codigo: codigoDoEmail(sis, para) });
  assert.equal(fim.data.estagio, 'COMPLETA');
  const outra = await cadastrar(sis, { email: 'a.n.a.souza@gmail.com', senha: 'Outra-Senha-99' });
  assert.equal(outra.r.status, 200, 'resposta igual para e-mail que já existe');
  assert.equal(sis.email.caixa.length, antesDeEntrar + 1, 'nenhum e-mail novo foi enviado para conta já confirmada');
  assert.equal((await (await visitante(sis)).post('/api/login', { login: EMAIL, senha: 'Outra-Senha-99' })).status, 401, 'a senha da conta existente não mudou');
}));

test('cadastro: valida e-mail, domínio e senha (8 ou mais caracteres, sem limite de 8)', async () => await com(async (sis) => {
  const c = await visitante(sis);
  const tenta = (corpo) => c.post('/api/cadastro', { nome: 'Ana Souza', email: EMAIL, senha: SENHA, ...corpo });
  let r = await tenta({ email: 'ana@outlook.com' });
  assert.equal(r.status, 422); assert.ok(r.erro.campos.email, 'só Gmail');
  r = await tenta({ email: 'isto-nao-e-email' });
  assert.equal(r.status, 422);
  r = await tenta({ senha: '12345678' });
  assert.equal(r.status, 422); assert.match(r.erro.campos.senha, /comum/);
  r = await tenta({ senha: 'curta' });
  assert.equal(r.status, 422); assert.match(r.erro.campos.senha, /8 caracteres/);
  assert.equal(sis.email.caixa.length, 0, 'nada foi enviado');
  r = await tenta({ senha: 'uma frase longa e boa de lembrar 2026 '.repeat(2) });
  assert.equal(r.status, 200, 'senha longa é aceita: o limite mínimo é 8, não máximo');
  assert.equal(sis.email.caixa.length, 1);
}));

test('código: 5 erros o invalidam, reenvio tem espera de 60 s e o código vence em 10 minutos', async () => await com(async (sis) => {
  const { c } = await cadastrar(sis);
  const certo = codigoDoEmail(sis, EMAIL);
  const errado = certo === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) {
    const r = await confirmar(c, errado);
    assert.equal(r.status, 422); assert.equal(r.erro.code, 'CODIGO_INVALIDO');
  }
  assert.match((await confirmar(c, errado)).erro.message, /novo código/);
  assert.equal((await confirmar(c, certo)).status, 422, 'depois de 5 erros nem o certo vale mais');

  assert.equal((await c.post('/api/cadastro/reenviar', { email: EMAIL })).status, 429, 'espera entre envios');
  assert.equal(sis.email.caixa.length, 1);
  sis.relogio.t += 61_000;
  assert.equal((await c.post('/api/cadastro/reenviar', { email: EMAIL })).status, 200);
  assert.equal(sis.email.caixa.length, 2);
  assert.equal((await c.post('/api/cadastro/reenviar', { email: 'ninguem@gmail.com' })).status, 200, 'não revela se o e-mail existe');
  assert.equal(sis.email.caixa.length, 2);

  sis.relogio.t += 11 * 60_000; // venceu
  const vencido = await confirmar(c, codigoDoEmail(sis, EMAIL));
  assert.equal(vencido.status, 422);
  sis.relogio.t += 61_000;
  await c.post('/api/cadastro/reenviar', { email: EMAIL });
  assert.equal((await confirmar(c, codigoDoEmail(sis, EMAIL))).status, 200, 'código novo funciona');
}));

test('segurança: quem cadastra o e-mail de outra pessoa não consegue confirmá-lo pela vítima', async () => await com(async (sis) => {
  const { c: atacante } = await cadastrar(sis, { nome: 'Atacante', senha: 'SenhaDoAtacante-1' });
  sis.relogio.t += 61_000;
  const { c: dona } = await cadastrar(sis, { senha: SENHA }); // a dona de verdade refaz o cadastro: vale o mais recente
  const codigo = codigoDoEmail(sis, EMAIL);
  const r = await confirmar(atacante, codigo, { senha: 'SenhaDoAtacante-1' });
  assert.equal(r.status, 422);
  assert.equal(r.erro.code, 'SENHA_NAO_CONFERE', 'o código sozinho não basta: precisa da senha do cadastro');
  assert.equal((await confirmar(dona, codigo)).status, 200);
  assert.equal((await (await visitante(sis)).post('/api/login', { login: EMAIL, senha: 'SenhaDoAtacante-1' })).status, 401);
}));

test('cadastro: limite por aparelho/rede e bloqueio após 10 senhas erradas no login por e-mail', async () => await com(async (sis) => {
  const c = await visitante(sis);
  for (let i = 1; i <= 5; i++) assert.equal((await c.post('/api/cadastro', { nome: 'Pessoa Teste', email: `pessoa${i}@gmail.com`, senha: SENHA })).status, 200);
  const sexto = await c.post('/api/cadastro', { nome: 'Pessoa Teste', email: 'pessoa6@gmail.com', senha: SENHA });
  assert.equal(sexto.status, 429);
  assert.match(sexto.erro.message, /Aguarde \d+ (segundos|minutos)/);

  sis.relogio.t += 61 * 60_000;
  const { c: dona } = await cadastrar(sis);
  assert.equal((await confirmar(dona, codigoDoEmail(sis, EMAIL))).status, 200);
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
  assert.equal((await dono.post('/api/conta/email', { email: 'dono@outlook.com' })).status, 422);
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
  await confirmar(ana, codigoDoEmail(sis, EMAIL));
  assert.equal((await ana.post('/api/conta/email', { email: meu })).status, 409, 'e-mail de outra conta');

  const t = await dono.post('/api/email/testar', { para: meu });
  assert.equal(t.status, 200, t.texto);
  assert.match(sis.email.caixa.at(-1).assunto, /Teste de e-mail/);
  assert.equal((await ana.post('/api/email/testar', {})).status, 403, 'só o dono testa o envio');
}));

test('dados: e-mail e código nunca ficam em texto puro; cadastro não confirmado some em 24 h', async () => await com(async (sis) => {
  const { c } = await cadastrar(sis);
  const codigo = codigoDoEmail(sis, EMAIL);
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
  const restam = await sis.db.all("SELECT email_verificado FROM users WHERE papel = 'pendente'");
  assert.deepEqual(restam.map((u) => u.email_verificado), [1], 'só a que confirmou o e-mail ficou');
}));

// ---------------------------------------------------------------- 2ª etapa: código por e-mail a cada login
async function contaConfirmada(sis) {
  const { c } = await cadastrar(sis);
  assert.equal((await confirmar(c, codigoDoEmail(sis, EMAIL))).status, 200);
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
  await confirmar(bia, codigoDoEmail(sis, 'bia.lima@gmail.com'), { email: 'bia.lima@gmail.com' });
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
