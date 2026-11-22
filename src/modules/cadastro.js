// Cadastro por e-mail: a pessoa cria a conta com e-mail (Gmail) + senha, recebe um código de 6 dígitos no e-mail, confirma e entra.
// A conta nasce "pendente" (sem nenhuma permissão): quem libera o acesso é o dono, na tela Equipe.
// Defesas: código só vale com a senha do cadastro (evita "pré-sequestro" de e-mail alheio), 5 erros invalidam o código, reenvio a cada 60 s
// (máx. 5/hora), limite por IP e limite global de cadastros novos por hora, resposta igual para e-mail novo ou já existente.
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { erro, invalido } from '../util.js';
import { T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { hmacHex, cifrar, decifrar, iguais } from '../security/crypto.js';
import { hashSenha, verificarSenha, validarPolitica } from '../security/password.js';
import { normalizarEmail, chaveEmail, mensagemCodigo } from '../email.js';
import { criarSessao } from '../http/sessao.js';
import { chaveLogin, TENTATIVAS_MAX, espera } from './acesso.js';

const VALIDADE_MIN = 10;
const MAX_ERROS_CODIGO = 5;
const ESPERA_REENVIO_MS = 60_000;
const MAX_ENVIOS_HORA = 5;
const MAX_CADASTROS_HORA = 30; // global: protege a cota de e-mail contra enxurrada de cadastros
const MAX_PESSOAS = 50;
const MAX_NAO_CONFIRMADOS = 200; // cadastros sem e-mail confirmado (somem em 24 h) não ocupam as vagas das pessoas de verdade
const HORA = 3_600_000;

export function registrarCadastro(app, { cfg, db, email, log }) {
  const { rota, limitador } = app;
  const GENERICO = { enviado: true, minutos: VALIDADE_MIN };
  const codigoHash = (id, codigo) => hmacHex(cfg.hmacKey, `cod|${id}|${codigo}`);

  const limitar = (chave, max, janelaMs, msg) => {
    const r = limitador.bater(chave, max, janelaMs);
    if (!r.ok) throw Object.assign(erro(429, 'MUITAS_TENTATIVAS', `${msg} Aguarde ${espera(r.retryAfterS)} e tente de novo.`), { retryAfterS: r.retryAfterS });
  };
  const exigirEmail = () => { if (!email.configurado) throw erro(503, 'CADASTRO_INDISPONIVEL', 'O cadastro por e-mail ainda não está disponível. Peça ao dono do sistema.'); };

  /** Valida o e-mail digitado (formato + domínio permitido). Devolve { exibicao, canonico }. */
  function lerEmail(bruto) {
    const e = normalizarEmail(bruto);
    if (!e) throw invalido({ email: 'Digite um e-mail válido.' });
    if (!cfg.email.dominios.includes('*') && !cfg.email.dominios.includes(e.dominio)) throw invalido({ email: 'Use um e-mail do Gmail (terminado em @gmail.com).' });
    return e;
  }

  /** Confere a espera entre envios e o limite por hora (lança 429). Devolve o estado da janela de envios. */
  function cotaEnvio(u) {
    const t = cfg.agora();
    if (u.cod_enviado_em && t - u.cod_enviado_em < ESPERA_REENVIO_MS) {
      const s = Math.ceil((ESPERA_REENVIO_MS - (t - u.cod_enviado_em)) / 1000);
      throw Object.assign(erro(429, 'AGUARDE_REENVIO', `O código acabou de ser enviado. Aguarde ${espera(s)} para pedir outro.`), { retryAfterS: s });
    }
    const janelaNova = !u.cod_envios_desde || t - u.cod_envios_desde > HORA;
    const envios = janelaNova ? 0 : u.cod_envios;
    if (envios >= MAX_ENVIOS_HORA) throw erro(429, 'MUITOS_ENVIOS', 'Muitos códigos pedidos nesta hora. Tente de novo mais tarde.');
    return { t, janelaNova, envios };
  }

  /** Gera e envia um código novo para `para`. */
  async function emitirCodigo(u, para, nome) {
    const { t, janelaNova, envios } = cotaEnvio(u);
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.run('UPDATE users SET cod_hash = ?, cod_expira = ?, cod_tentativas = 0, cod_enviado_em = ?, cod_envios = ?, cod_envios_desde = ? WHERE id = ?',
      codigoHash(u.id, codigo), t + VALIDADE_MIN * 60_000, t, envios + 1, janelaNova ? t : u.cod_envios_desde, u.id);
    try {
      await email.enviar({ para, ...mensagemCodigo({ nome: nome?.split(' ')[0], codigo, minutos: VALIDADE_MIN, appName: cfg.appName }) });
    } catch (e) {
      await db.run('UPDATE users SET cod_hash = NULL, cod_enviado_em = NULL WHERE id = ?', u.id); // não deixa um código que ninguém recebeu
      log?.error?.('falha ao enviar e-mail', { erro: e?.message });
      throw erro(502, 'EMAIL_FALHOU', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
    }
  }

  /** Confere o código de `u`. Lança erro se inválido/vencido/esgotado. */
  async function conferirCodigo(u, codigo) {
    const t = cfg.agora();
    const msgGenerica = 'Código incorreto ou vencido.';
    if (!u?.cod_hash || !u.cod_expira || t > u.cod_expira) throw erro(422, 'CODIGO_INVALIDO', `${msgGenerica} Peça um novo código.`, { codigo: msgGenerica });
    if (u.cod_tentativas >= MAX_ERROS_CODIGO) throw erro(422, 'CODIGO_ESGOTADO', 'Muitos erros. Peça um novo código.', { codigo: 'Peça um novo código.' });
    const certo = typeof codigo === 'string' && /^\d{6}$/.test(codigo.trim()) && iguais(codigoHash(u.id, codigo.trim()), u.cod_hash);
    if (!certo) {
      const erros = u.cod_tentativas + 1;
      await db.run('UPDATE users SET cod_tentativas = ?, cod_hash = CASE WHEN ? >= ? THEN NULL ELSE cod_hash END WHERE id = ?', erros, erros, MAX_ERROS_CODIGO, u.id);
      const restam = MAX_ERROS_CODIGO - erros;
      throw erro(422, 'CODIGO_INVALIDO', restam > 0 ? `Código incorreto. Restam ${restam} tentativa(s).` : 'Código incorreto. Peça um novo código.', { codigo: 'Código incorreto.' });
    }
  }

  // ---------------------------------------------------------------- cadastro (público)
  rota('POST', '/api/cadastro', { auth: 'publica' }, async (ctx) => {
    exigirEmail();
    limitar(`cadastro:ip:${ctx.ip}`, 5, HORA, 'Muitos cadastros deste aparelho/rede.');
    const d = validar(ctx.corpo, { nome: T({ obrig: true, min: 2, max: 80 }), email: T({ obrig: true, max: 254 }), senha: T({ obrig: true, min: 1, max: 128 }) });
    const e = lerEmail(d.email);
    const problemas = validarPolitica(d.senha, { email: e.exibicao });
    if (problemas.length) throw invalido({ senha: problemas.join(' ') });
    const hash = await hashSenha(cfg, d.senha); // sempre calcula (mesmo tempo para e-mail novo ou existente)
    const chave = chaveEmail(cfg, e.canonico);
    const t = cfg.agora();

    const existente = await db.get('SELECT * FROM users WHERE email_hmac = ?', chave);
    if (existente?.email_verificado) return GENERICO; // já tem conta: não revela nem altera nada
    if ((await db.get("SELECT COUNT(*) c FROM users WHERE papel = 'pendente' AND email_verificado = 0 AND criado_em > ?", t - HORA)).c >= MAX_CADASTROS_HORA
      || (await db.get("SELECT COUNT(*) c FROM users WHERE papel = 'pendente' AND email_verificado = 0")).c >= MAX_NAO_CONFIRMADOS) {
      throw erro(429, 'MUITOS_CADASTROS', 'Muitos cadastros no momento. Tente de novo mais tarde.');
    }
    let u = existente;
    if (!u) {
      if ((await db.get("SELECT COUNT(*) c FROM users WHERE NOT (papel = 'pendente' AND email_verificado = 0 AND dono = 0)")).c >= MAX_PESSOAS) throw erro(409, 'LIMITE', 'O limite de contas do sistema foi atingido. Fale com o dono.');
      const id = await tx(db, async (db) => {
        const novo = await db.insert("INSERT INTO users (login_hmac, email_enc, email_hmac, email_verificado, senha_hash, papel, nome, trocar_senha, dono, permissoes, criado_em) VALUES (?,?,?,0,?,'pendente',?,0,0,'[]',?)",
          chaveLogin(cfg, `email:${e.canonico}`), cifrar(cfg.fieldKey, e.exibicao), chave, hash, d.nome, t);
        await auditar(db, ctx, 'CADASTRO_CRIADO', 'user', novo, { dominio: e.dominio });
        return novo;
      });
      u = await db.get('SELECT * FROM users WHERE id = ?', id);
    } else {
      // novo cadastro com o mesmo e-mail ainda não confirmado: vale o mais recente (senha e nome). Só troca se der para enviar outro código
      // (assim quem refaz o cadastro dentro da espera não fica sem código válido); o código novo substitui o antigo.
      cotaEnvio(u);
      await db.run('UPDATE users SET senha_hash = ?, nome = ?, email_enc = ? WHERE id = ?', hash, d.nome, cifrar(cfg.fieldKey, e.exibicao), u.id);
      u = await db.get('SELECT * FROM users WHERE id = ?', u.id);
    }
    await emitirCodigo(u, e.exibicao, d.nome);
    return GENERICO;
  });

  rota('POST', '/api/cadastro/reenviar', { auth: 'publica' }, async (ctx) => {
    exigirEmail();
    limitar(`cadastro:reenviar:ip:${ctx.ip}`, 10, HORA, 'Muitos pedidos de código.');
    const { email: bruto } = validar(ctx.corpo, { email: T({ obrig: true, max: 254 }) });
    const e = normalizarEmail(bruto);
    if (!e) return GENERICO;
    const u = await db.get('SELECT * FROM users WHERE email_hmac = ? AND email_verificado = 0 AND ativo = 1', chaveEmail(cfg, e.canonico));
    if (u) await emitirCodigo(u, decifrar(cfg.fieldKey, u.email_enc), u.nome);
    return GENERICO;
  });

  rota('POST', '/api/cadastro/confirmar', { auth: 'publica' }, async (ctx) => {
    limitar(`cadastro:confirmar:ip:${ctx.ip}`, TENTATIVAS_MAX * 3, 15 * 60_000, 'Muitas tentativas de confirmação.');
    const d = validar(ctx.corpo, { email: T({ obrig: true, max: 254 }), codigo: T({ obrig: true, max: 12 }), senha: T({ obrig: true, max: 128 }) });
    const e = normalizarEmail(d.email);
    const u = e ? await db.get('SELECT * FROM users WHERE email_hmac = ? AND email_verificado = 0 AND ativo = 1', chaveEmail(cfg, e.canonico)) : null;
    if (!u) { await hashSenha(cfg, d.senha); throw erro(422, 'CODIGO_INVALIDO', 'Código incorreto ou vencido. Peça um novo código.', { codigo: 'Código incorreto ou vencido.' }); }
    // a senha tem de ser a do cadastro mais recente: quem pré-registrou o e-mail de outra pessoa não consegue "completá-lo" pela vítima
    if (!(await verificarSenha(cfg, d.senha, u.senha_hash))) throw erro(422, 'SENHA_NAO_CONFERE', 'A senha não confere com a do cadastro. Faça o cadastro de novo.', { senha: 'Senha diferente da do cadastro.' });
    await conferirCodigo(u, d.codigo);
    await tx(db, async (db) => {
      await db.run('UPDATE users SET email_verificado = 1, cod_hash = NULL, cod_expira = NULL, cod_tentativas = 0 WHERE id = ?', u.id);
      ctx.user = { id: u.id, papel: u.papel, nome: u.nome };
      await criarSessao(cfg, db, ctx, u.id, 'COMPLETA');
      await auditar(db, ctx, 'CADASTRO_CONFIRMADO', 'user', u.id);
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
    await emitirCodigo({ ...u }, e.exibicao, u.nome);
    return GENERICO;
  });

  rota('POST', '/api/conta/email/confirmar', async (ctx) => {
    limitar(`conta:email:cod:${ctx.user.id}`, TENTATIVAS_MAX, 15 * 60_000, 'Muitas tentativas.');
    const { codigo } = validar(ctx.corpo, { codigo: T({ obrig: true, max: 12 }) });
    const u = await db.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    if (!u.email_novo_enc) throw erro(409, 'SEM_EMAIL_PENDENTE', 'Informe o e-mail primeiro.');
    await conferirCodigo(u, codigo);
    await tx(db, async (db) => {
      await db.run('UPDATE users SET email_enc = email_novo_enc, email_hmac = email_novo_hmac, email_verificado = 1, email_novo_enc = NULL, email_novo_hmac = NULL, cod_hash = NULL, cod_expira = NULL, cod_tentativas = 0 WHERE id = ?', u.id);
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
