// Cadastro por e-mail: a pessoa informa e-mail + senha (duas vezes). O código de 6 dígitos NÃO vai para ela: vai para o e-mail dos
// donos, e um deles passa o código se quiser liberar. Com o código a conta nasce como Vendedor de balcão.
// Defesas: código só vale com a senha do cadastro, 5 erros invalidam o código, reenvio a cada 60 s (máx. 5/hora), limite por IP e
// limite global de pedidos por hora (cada pedido manda e-mail aos donos), resposta igual para e-mail novo ou já existente.
import { tx } from '../db.js';
import { erro, invalido } from '../util.js';
import { T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { cifrar, decifrar } from '../security/crypto.js';
import { hashSenha, verificarSenha, validarPolitica } from '../security/password.js';
import { normalizarEmail, chaveEmail, mensagemAprovacao } from '../email.js';
import { PAPEIS, limparPermissoes } from '../permissoes.js';
import { criarSessao } from '../http/sessao.js';
import { chaveLogin, TENTATIVAS_MAX } from './acesso.js';
import { criarCodigos, espera, VALIDADE_MIN, HORA } from './codigos.js';

// Tetos globais de pedidos de conta (cadastros + reenvios). Cada pedido manda e-mail a todos os donos: os tetos protegem a caixa deles
// e a cota do SMTP (que também entrega os códigos de entrada) e limitam quantos códigos dá para tentar adivinhar. Contados no banco.
const MAX_PEDIDOS_HORA = 20;
const MAX_PEDIDOS_DIA = 60;
const VALIDADE_APROVACAO_MIN = 30; // dá tempo de um dono ver o e-mail e passar o código
const APROVACAO = 'aprovacao|';
const PAPEL_NOVO = 'vendedor'; // com o que a pessoa entra depois do código; o dono muda em Equipe
const MAX_PESSOAS = 50;
const MAX_NAO_CONFIRMADOS = 200; // cadastros sem e-mail confirmado (somem em 24 h) não ocupam as vagas das pessoas de verdade

export function registrarCadastro(app, { cfg, db, email, log }) {
  const { rota, limitador } = app;
  const GENERICO = { enviado: true, minutos: VALIDADE_MIN };
  const PEDIDO = { enviado: true, minutos: VALIDADE_APROVACAO_MIN };

  const limitar = (chave, max, janelaMs, msg) => {
    const r = limitador.bater(chave, max, janelaMs);
    if (!r.ok) throw Object.assign(erro(429, 'MUITAS_TENTATIVAS', `${msg} Aguarde ${espera(r.retryAfterS)} e tente de novo.`), { retryAfterS: r.retryAfterS });
  };
  const exigirEmail = () => { if (!email.configurado) throw erro(503, 'CADASTRO_INDISPONIVEL', 'O cadastro por e-mail ainda não está disponível. Peça ao dono do sistema.'); };

  /** Valida o e-mail digitado (formato + domínio permitido). Devolve { exibicao, canonico }. */
  function lerEmail(bruto) {
    const e = normalizarEmail(bruto);
    if (!e) throw invalido({ email: 'Digite um e-mail válido.' });
    if (!cfg.email.dominios.includes('*') && !cfg.email.dominios.includes(e.dominio)) throw invalido({ email: 'Use um e-mail do Gmail, Hotmail, Outlook, Yahoo ou iCloud.' });
    return e;
  }

  const { cotaEnvio, emitirCodigo, conferirCodigo } = criarCodigos({ cfg, db, email, log });

  async function exigirVaga(db) {
    const desde = async (ms) => Number((await db.get("SELECT COUNT(*) c FROM auditoria WHERE acao = 'CADASTRO_PEDIDO' AND ts > ?", cfg.agora() - ms)).c);
    if (await desde(HORA) >= MAX_PEDIDOS_HORA || await desde(24 * HORA) >= MAX_PEDIDOS_DIA) throw erro(429, 'MUITOS_CADASTROS', 'Muitos pedidos de conta nova no momento. Tente de novo mais tarde.');
  }
  /** Conta o pedido dentro da transação, com trava: pedidos simultâneos não furam o teto. */
  async function contarPedido(db, ctx, userId) {
    await db.travar('cadastro|pedidos');
    await exigirVaga(db);
    await auditar(db, ctx, 'CADASTRO_PEDIDO', 'user', userId);
  }

  /** E-mails confirmados dos donos ativos: são eles que recebem o código que libera uma conta nova. */
  async function exigirDonos() {
    const linhas = await db.all('SELECT email_enc FROM users WHERE dono = 1 AND ativo = 1 AND email_verificado = 1 AND excluido_em IS NULL AND email_enc IS NOT NULL ORDER BY id');
    if (!linhas.length) throw erro(503, 'CADASTRO_INDISPONIVEL', 'Nenhum dono tem e-mail confirmado para liberar contas. Fale com o dono do sistema.');
    return linhas.map((l) => decifrar(cfg.fieldKey, l.email_enc));
  }
  const pedirAprovacao = async (u, donos, nome, emailNovo) => await emitirCodigo(u, donos, nome, { minutos: VALIDADE_APROVACAO_MIN, finalidade: APROVACAO, mensagem: (codigo, minutos) => mensagemAprovacao({ nome, emailNovo, codigo, minutos, appName: cfg.appName }) });

  // ---------------------------------------------------------------- cadastro (público)
  rota('POST', '/api/cadastro', { auth: 'publica' }, async (ctx) => {
    exigirEmail();
    limitar(`cadastro:ip:${ctx.ip}`, 5, HORA, 'Muitos cadastros deste aparelho/rede.');
    const d = validar(ctx.corpo, { nome: T({ obrig: true, min: 2, max: 80 }), email: T({ obrig: true, max: 254 }), senha: T({ obrig: true, min: 1, max: 128 }), confirmacao: T({ obrig: true, min: 1, max: 128 }) });
    const e = lerEmail(d.email);
    if (d.senha !== d.confirmacao) throw invalido({ confirmacao: 'As duas senhas não são iguais.' }, 'As duas senhas não são iguais.');
    const problemas = validarPolitica(d.senha, { email: e.exibicao });
    if (problemas.length) throw invalido({ senha: problemas.join(' ') });
    const donos = await exigirDonos();
    const hash = await hashSenha(cfg, d.senha); // sempre calcula (mesmo tempo para e-mail novo ou existente)
    const chave = chaveEmail(cfg, e.canonico);
    const t = cfg.agora();

    const existente = await db.get('SELECT * FROM users WHERE email_hmac = ?', chave);
    await exigirVaga(db); // antes de olhar a conta: com o teto cheio, a resposta é a mesma para e-mail novo ou existente
    // já tem conta, ou foi desativada pelo dono: não revela nem altera nada
    if (existente && (existente.email_verificado || !existente.ativo || existente.papel !== 'pendente')) return PEDIDO;
    if (!existente && (await db.get("SELECT COUNT(*) c FROM users WHERE papel = 'pendente' AND email_verificado = 0 AND excluido_em IS NULL")).c >= MAX_NAO_CONFIRMADOS) {
      throw erro(429, 'MUITOS_CADASTROS', 'Muitos cadastros no momento. Tente de novo mais tarde.');
    }
    let u = existente;
    if (!u) {
      if ((await db.get("SELECT COUNT(*) c FROM users WHERE excluido_em IS NULL AND NOT (papel = 'pendente' AND email_verificado = 0 AND dono = 0)")).c >= MAX_PESSOAS) throw erro(409, 'LIMITE', 'O limite de contas do sistema foi atingido. Fale com o dono.');
      const id = await tx(db, async (db) => {
        const novo = await db.insert("INSERT INTO users (login_hmac, email_enc, email_hmac, email_verificado, senha_hash, papel, nome, trocar_senha, dono, permissoes, criado_em) VALUES (?,?,?,0,?,'pendente',?,0,0,'[]',?)",
          chaveLogin(cfg, `email:${e.canonico}`), cifrar(cfg.fieldKey, e.exibicao), chave, hash, d.nome, t);
        await auditar(db, ctx, 'CADASTRO_CRIADO', 'user', novo, { dominio: e.dominio });
        await contarPedido(db, ctx, novo);
        return novo;
      });
      u = await db.get('SELECT * FROM users WHERE id = ?', id);
    } else {
      // novo cadastro com o mesmo e-mail ainda não confirmado: vale o mais recente (senha e nome). Só troca se der para enviar outro código
      // (assim quem refaz o cadastro dentro da espera não fica sem código válido); o código novo substitui o antigo.
      cotaEnvio(u);
      const mudou = await tx(db, async (db) => {
        const r = await db.run("UPDATE users SET senha_hash = ?, nome = ?, email_enc = ? WHERE id = ? AND email_verificado = 0 AND ativo = 1 AND papel = 'pendente'", hash, d.nome, cifrar(cfg.fieldKey, e.exibicao), u.id);
        if (r.changes) await contarPedido(db, ctx, u.id);
        return r.changes;
      });
      if (!mudou) return PEDIDO; // a conta mudou neste meio tempo (liberada ou desativada)
      u = await db.get('SELECT * FROM users WHERE id = ?', u.id);
    }
    await pedirAprovacao(u, donos, d.nome, e.exibicao);
    return PEDIDO;
  });

  rota('POST', '/api/cadastro/reenviar', { auth: 'publica' }, async (ctx) => {
    exigirEmail();
    limitar(`cadastro:reenviar:ip:${ctx.ip}`, 10, HORA, 'Muitos pedidos de código.');
    const { email: bruto } = validar(ctx.corpo, { email: T({ obrig: true, max: 254 }) });
    const e = normalizarEmail(bruto);
    if (!e) return PEDIDO;
    const donos = await exigirDonos();
    await exigirVaga(db);
    const u = await db.get("SELECT * FROM users WHERE email_hmac = ? AND email_verificado = 0 AND ativo = 1 AND papel = 'pendente'", chaveEmail(cfg, e.canonico));
    if (u) {
      cotaEnvio(u); // pedido recusado por espera não gasta o teto global
      await tx(db, async (db) => await contarPedido(db, ctx, u.id));
      await pedirAprovacao(u, donos, u.nome, decifrar(cfg.fieldKey, u.email_enc));
    }
    return PEDIDO;
  });

  rota('POST', '/api/cadastro/confirmar', { auth: 'publica' }, async (ctx) => {
    limitar(`cadastro:confirmar:ip:${ctx.ip}`, TENTATIVAS_MAX * 3, 15 * 60_000, 'Muitas tentativas de confirmação.');
    const d = validar(ctx.corpo, { email: T({ obrig: true, max: 254 }), codigo: T({ obrig: true, max: 12 }), senha: T({ obrig: true, max: 128 }) });
    const e = normalizarEmail(d.email);
    const u = e ? await db.get("SELECT * FROM users WHERE email_hmac = ? AND email_verificado = 0 AND ativo = 1 AND papel = 'pendente'", chaveEmail(cfg, e.canonico)) : null;
    if (!u) { await hashSenha(cfg, d.senha); throw erro(422, 'CODIGO_INVALIDO', 'Código incorreto ou vencido. Peça um novo código.', { codigo: 'Código incorreto ou vencido.' }); }
    // a senha tem de ser a do cadastro mais recente: quem pré-registrou o e-mail de outra pessoa não consegue "completá-lo" pela vítima
    if (!(await verificarSenha(cfg, d.senha, u.senha_hash))) throw erro(422, 'SENHA_NAO_CONFERE', 'A senha não confere com a do cadastro. Faça o cadastro de novo.', { senha: 'Senha diferente da do cadastro.' });
    try { await conferirCodigo(u, d.codigo, { finalidade: APROVACAO }); } catch (x) {
      await tx(db, async (db) => await auditar(db, ctx, 'CADASTRO_CODIGO_RECUSADO', 'user', u.id));
      throw x;
    }
    await tx(db, async (db) => {
      // só libera se nada mudou desde a leitura (senha do cadastro, código, situação da conta)
      const r = await db.run("UPDATE users SET email_verificado = 1, papel = ?, permissoes = ?, cod_hash = NULL, cod_expira = NULL, cod_tentativas = 0, cod_enviado_em = NULL WHERE id = ? AND email_verificado = 0 AND ativo = 1 AND papel = 'pendente' AND senha_hash = ? AND cod_hash = ?",
        PAPEL_NOVO, JSON.stringify(limparPermissoes(PAPEIS[PAPEL_NOVO].permissoes)), u.id, u.senha_hash, u.cod_hash);
      if (!r.changes) throw erro(409, 'PEDIDO_MUDOU', 'Este pedido mudou enquanto você confirmava. Faça o cadastro de novo.');
      ctx.user = { id: u.id, papel: PAPEL_NOVO, nome: u.nome };
      await criarSessao(cfg, db, ctx, u.id, 'COMPLETA');
      await auditar(db, ctx, 'CADASTRO_CONFIRMADO', 'user', u.id, { papel: PAPEL_NOVO, liberado_por: 'código enviado aos donos' });
    });
    return { estagio: ctx.sessao.estagio, csrf: app.csrfPara(ctx) };
  });

  // ---------------------------------------------------------------- vincular e-mail a uma conta que já existe (conta criada pelo dono)
  rota('POST', '/api/conta/email', async (ctx) => {
    exigirEmail();
    limitar(`conta:email:${ctx.user.id}`, 10, HORA, 'Muitos pedidos de código.');
    const { email: bruto } = validar(ctx.corpo, { email: T({ obrig: true, max: 254 }) });
    const e = lerEmail(bruto);
    const chave = chaveEmail(cfg, e.canonico);
    const em = await db.get('SELECT id FROM users WHERE email_hmac = ? AND id <> ?', chave, ctx.user.id);
    if (em) throw erro(409, 'EMAIL_EM_USO', 'Este e-mail já está ligado a outra conta.');
    const u = await db.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    await db.run('UPDATE users SET email_novo_enc = ?, email_novo_hmac = ? WHERE id = ?', cifrar(cfg.fieldKey, e.exibicao), chave, u.id);
    await emitirCodigo({ ...u }, e.exibicao, u.nome, { finalidade: `vincular|${chave}|` });
    return GENERICO;
  });

  rota('POST', '/api/conta/email/confirmar', async (ctx) => {
    limitar(`conta:email:cod:${ctx.user.id}`, TENTATIVAS_MAX, 15 * 60_000, 'Muitas tentativas.');
    const { codigo } = validar(ctx.corpo, { codigo: T({ obrig: true, max: 12 }) });
    const u = await db.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    if (!u.email_novo_enc) throw erro(409, 'SEM_EMAIL_PENDENTE', 'Informe o e-mail primeiro.');
    await conferirCodigo(u, codigo, { finalidade: `vincular|${u.email_novo_hmac}|` });
    await tx(db, async (db) => {
      await db.run('UPDATE users SET email_enc = email_novo_enc, email_hmac = email_novo_hmac, email_verificado = 1, email_novo_enc = NULL, email_novo_hmac = NULL, cod_hash = NULL, cod_expira = NULL, cod_tentativas = 0, cod_enviado_em = NULL WHERE id = ?', u.id);
      await auditar(db, ctx, 'EMAIL_VINCULADO', 'user', u.id);
    });
    return { vinculado: true };
  });

  // ---------------------------------------------------------------- teste de envio (só o dono)
  rota('POST', '/api/email/testar', { reauth: true }, async (ctx) => {
    exigirEmail();
    const { para } = validar(ctx.corpo, { para: T({ max: 254 }) });
    let destino = para;
    if (!destino) {
      const u = await db.get('SELECT email_enc FROM users WHERE id = ?', ctx.user.id);
      if (!u.email_enc) throw invalido({ para: 'Informe um e-mail ou vincule um à sua conta em Configurações.' });
      destino = decifrar(cfg.fieldKey, u.email_enc);
    }
    const e = normalizarEmail(destino);
    if (!e) throw invalido({ para: 'E-mail inválido.' });
    try { await email.enviar({ para: e.exibicao, assunto: `Teste de e-mail — ${cfg.appName}`, texto: `Este é um e-mail de teste do ${cfg.appName}.\nSe você o recebeu, o envio de códigos de confirmação está funcionando.\n` }); } catch (x) {
      throw erro(502, 'EMAIL_FALHOU', `Não consegui enviar: ${String(x?.message ?? 'erro').slice(0, 120)}`);
    }
    await tx(db, async (db) => await auditar(db, ctx, 'EMAIL_TESTE', 'user', ctx.user.id));
    return { enviado: true };
  });
}
