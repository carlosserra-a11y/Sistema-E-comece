import { tx } from '../db.js';
import { erro } from '../util.js';
import { T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { hmacHex, decifrar } from '../security/crypto.js';
import { hashSenha, verificarSenha, verificacaoFalsa, validarPolitica } from '../security/password.js';
import { normalizarEmail, chaveEmail, mascararEmail } from '../email.js';
import { permissoesDe } from '../permissoes.js';
import { criarCodigos, espera, VALIDADE_MIN } from './codigos.js';
import { criarSessao, revogarSessao, cookie, nomesCookie } from '../http/sessao.js';

const LOGIN_RE = /^\d{11}$/;
/** Quantas tentativas erradas a pessoa pode fazer (senha, código) antes de o sistema segurar. */
export const TENTATIVAS_MAX = 10;
export { espera };

/** Contas com senha provisória (criadas pelo dono) trocam a senha no 1º acesso; as demais entram direto. Não há mais 2ª etapa. */
export const proximoEstagio = (u) => (u.trocar_senha && !(u.dono && u.email_verificado) ? 'TROCAR_SENHA' : 'COMPLETA'); // o dono com e-mail confirmado entra pelo código: a senha provisória não é mais a chave dele
export const chaveLogin = (cfg, digitos) => hmacHex(cfg.hmacKey, `login|${digitos}`);

/** Quem está tentando entrar: e-mail (cadastro novo) ou código de 11 dígitos (conta criada pelo dono). `chave` é o HMAC usado no bloqueio. */
export function identificarLogin(cfg, bruto) {
  const txt = typeof bruto === 'string' ? bruto.trim() : '';
  if (txt.includes('@')) {
    const e = normalizarEmail(txt);
    if (e) return { tipo: 'email', chave: chaveEmail(cfg, e.canonico), coluna: 'email_hmac' };
  } else {
    const digitos = txt.replace(/\D/g, '');
    if (LOGIN_RE.test(digitos)) return { tipo: 'codigo', chave: chaveLogin(cfg, digitos), coluna: 'login_hmac' };
  }
  return { tipo: 'invalido', chave: chaveLogin(cfg, `invalido:${txt.slice(0, 40)}`), coluna: null };
}

export function registrarAcesso(app, { cfg, db, email, log }) {
  const { rota, limitador } = app;
  const { emitirCodigo, conferirCodigo } = criarCodigos({ cfg, db, email, log });
  /** Contas com e-mail confirmado recebem um código a cada login (2ª etapa). Sem e-mail configurado no servidor não há como enviar. */
  const exigeCodigo = (u) => cfg.loginCodigo && email.configurado && !!u.email_verificado && !!u.email_enc;
  const enviarCodigoLogin = async (u) => {
    try { await emitirCodigo(u, decifrar(cfg.fieldKey, u.email_enc), u.nome); }
    catch (x) { if (x.code !== 'AGUARDE_REENVIO') throw x; /* acabou de ser enviado: o código anterior continua valendo */ }
  };
  const usuario = async (id) => await db.get('SELECT * FROM users WHERE id = ?', id);

  /** Troca a sessão atual por outra (rotação a cada etapa). */
  async function rotacionar(db, ctx, estagio, { reauth = false } = {}) {
    const antiga = ctx.sessao?.id;
    if (antiga) await revogarSessao(cfg, db, antiga);
    await criarSessao(cfg, db, ctx, ctx.user.id, estagio);
    if (reauth) await db.run('UPDATE sessions SET reauth_em = ? WHERE token_hash = ?', cfg.agora(), ctx.sessao.token_hash);
  }
  const limitar = (chave, max, janelaMs, msg = 'Muitas tentativas.') => {
    const r = limitador.bater(chave, max, janelaMs);
    if (!r.ok) throw Object.assign(erro(429, 'MUITAS_TENTATIVAS', `${msg} Aguarde ${espera(r.retryAfterS)} e tente de novo.`), { retryAfterS: r.retryAfterS });
  };
  const respostaSessao = (ctx, extra = {}) => ({ estagio: ctx.sessao.estagio, csrf: app.csrfPara(ctx), ...extra });

  rota('GET', '/api/sessao', { auth: 'publica' }, async (ctx) => {
    if (!ctx.sessao && !ctx.cookies[nomesCookie(cfg).aid]) app.novoAid(ctx);
    const u = ctx.sessao ? await usuario(ctx.sessao.user_id) : null;
    return {
      autenticado: ctx.sessao?.estagio === 'COMPLETA',
      estagio: ctx.sessao?.estagio ?? null,
      csrf: app.csrfPara(ctx),
      appName: cfg.appName,
      cadastro_disponivel: email.configurado, // sem e-mail configurado, "Criar conta" não aparece
      dominios_email: cfg.email.dominios,
      usuario: u ? {
        nome: u.nome, papel: u.papel, dono: !!u.dono, pendente: u.papel === 'pendente' && !u.dono,
        email: u.email_enc ? mascararEmail(decifrar(cfg.fieldKey, u.email_enc)) : null, email_verificado: !!u.email_verificado,
        permissoes: [...permissoesDe(u)].sort(),
      } : null,
      expira_em: ctx.sessao ? Math.min(ctx.sessao.expira_abs, ctx.sessao.ultimo_uso + (ctx.sessao.estagio === 'COMPLETA' ? cfg.sessao.ociosoMs : cfg.sessao.preAuthMs)) : null,
    };
  });

  rota('POST', '/api/login', { auth: 'publica' }, async (ctx) => {
    limitar(`login:ip:${ctx.ip}`, TENTATIVAS_MAX * 6, 15 * 60_000, 'Muitas tentativas de entrada neste aparelho/rede.');
    const { login, senha } = ctx.corpo;
    const id = identificarLogin(cfg, login);
    const chave = id.chave;
    const t = cfg.agora();
    const tent = await db.get('SELECT * FROM login_tentativas WHERE chave_hmac = ?', chave);
    if (tent && tent.bloqueado_ate > t) {
      throw Object.assign(erro(429, 'BLOQUEADO', `Acesso temporariamente bloqueado por excesso de tentativas. Aguarde ${espera(Math.ceil((tent.bloqueado_ate - t) / 1000))}.`), { retryAfterS: Math.ceil((tent.bloqueado_ate - t) / 1000) });
    }
    const senhaOk = typeof senha === 'string' && senha.length > 0 && senha.length <= 1024;
    const user = id.coluna ? await db.get(`SELECT * FROM users WHERE ${id.coluna} = ? AND ativo = 1`, chave) : null;
    const ok = user && senhaOk ? await verificarSenha(cfg, senha, user.senha_hash) : await verificacaoFalsa(cfg, senhaOk ? senha : 'x');
    if (!ok) {
      await tx(db, async (db) => {
        const falhas = (tent?.falhas ?? 0) + 1;
        const bloq = falhas >= TENTATIVAS_MAX ? t + Math.min(60, 2 ** (falhas - TENTATIVAS_MAX)) * 60_000 : 0;
        await db.run(`INSERT INTO login_tentativas (chave_hmac, falhas, bloqueado_ate, atualizado_em) VALUES (?,?,?,?)
          ON CONFLICT (chave_hmac) DO UPDATE SET falhas = excluded.falhas, bloqueado_ate = excluded.bloqueado_ate, atualizado_em = excluded.atualizado_em`, chave, falhas, bloq, t);
        await auditar(db, ctx, 'LOGIN_FALHA', 'login', chave.slice(0, 8), { falhas });
      });
      throw erro(401, 'CREDENCIAIS', id.tipo === 'email' ? 'E-mail ou senha inválidos.' : 'Login ou senha inválidos.');
    }
    // senha certa, mas o e-mail do cadastro ainda não foi confirmado: pede o código (sem abrir sessão)
    if (id.tipo === 'email' && !user.email_verificado) {
      throw Object.assign(erro(403, 'EMAIL_NAO_CONFIRMADO', 'Confirme o seu e-mail com o código que enviamos.'), { etapa: 'CONFIRMAR_EMAIL' });
    }
    const comCodigo = exigeCodigo(user);
    if (comCodigo) await enviarCodigoLogin(user); // antes de abrir a sessão: se o e-mail falhar, nada fica aberto
    await tx(db, async (db) => {
      await db.run('DELETE FROM login_tentativas WHERE chave_hmac = ?', chave);
      ctx.user = { id: user.id, papel: user.papel, nome: user.nome };
      await criarSessao(cfg, db, ctx, user.id, comCodigo ? 'CODIGO_EMAIL' : proximoEstagio(user));
      await auditar(db, ctx, comCodigo ? 'LOGIN_SENHA_OK' : 'LOGIN_OK', 'user', user.id);
    });
    return respostaSessao(ctx, comCodigo ? { email: mascararEmail(decifrar(cfg.fieldKey, user.email_enc)) } : {});
  });

  // Conta do dono (desenvolvedor): entra só com o e-mail, sem senha. A prova é o código enviado à caixa de entrada dele (mesma etapa CODIGO_EMAIL).
  // Só vale para a conta de dono com e-mail confirmado, e só com o código ligado: sem ele (LOGIN_CODIGO=0) esta porta fecha, senão não restaria prova nenhuma.
  rota('POST', '/api/login/email', { auth: 'publica' }, async (ctx) => {
    limitar(`loginemail:ip:${ctx.ip}`, TENTATIVAS_MAX * 2, 15 * 60_000, 'Muitas tentativas neste aparelho/rede.');
    const { email: bruto } = validar(ctx.corpo, { email: T({ obrig: true, max: 254 }) });
    const e = normalizarEmail(bruto);
    const user = e && cfg.loginCodigo && email.configurado
      ? await db.get('SELECT * FROM users WHERE email_hmac = ? AND dono = 1 AND ativo = 1 AND email_verificado = 1', chaveEmail(cfg, e.canonico)) : null;
    if (!user) throw erro(401, 'CREDENCIAIS', 'E-mail ou senha inválidos.'); // mesma resposta para qualquer e-mail que não seja o do dono
    await enviarCodigoLogin(user);
    await tx(db, async (db) => {
      ctx.user = { id: user.id, papel: user.papel, nome: user.nome };
      await criarSessao(cfg, db, ctx, user.id, 'CODIGO_EMAIL');
      await auditar(db, ctx, 'LOGIN_EMAIL_DONO', 'user', user.id);
    });
    return respostaSessao(ctx, { email: mascararEmail(decifrar(cfg.fieldKey, user.email_enc)) });
  });

  // 2ª etapa: o código que foi para o e-mail da conta. A sessão só vira "completa" (ou segue para trocar a senha) depois dele.
  rota('POST', '/api/login/codigo', { auth: 'parcial', etapas: ['CODIGO_EMAIL'] }, async (ctx) => {
    limitar(`logincod:${ctx.sessao.id}`, TENTATIVAS_MAX, 10 * 60_000);
    limitar(`logincod:ip:${ctx.ip}`, TENTATIVAS_MAX * 6, 15 * 60_000, 'Muitas tentativas de código neste aparelho/rede.');
    const { codigo } = validar(ctx.corpo, { codigo: T({ obrig: true, max: 12 }) });
    const u = await usuario(ctx.user.id);
    await conferirCodigo(u, codigo);
    await tx(db, async (db) => {
      await db.run('UPDATE users SET cod_hash = NULL, cod_expira = NULL, cod_tentativas = 0, cod_enviado_em = NULL WHERE id = ?', u.id);
      await rotacionar(db, ctx, proximoEstagio(u));
      await auditar(db, ctx, 'LOGIN_OK', 'user', u.id);
    });
    return respostaSessao(ctx);
  });

  rota('POST', '/api/login/codigo/reenviar', { auth: 'parcial', etapas: ['CODIGO_EMAIL'] }, async (ctx) => {
    limitar(`logincod:reenviar:${ctx.sessao.id}`, 10, 10 * 60_000);
    const u = await usuario(ctx.user.id);
    await emitirCodigo(u, decifrar(cfg.fieldKey, u.email_enc), u.nome);
    return { enviado: true, minutos: VALIDADE_MIN };
  });

  rota('POST', '/api/senha/trocar', { auth: 'parcial', etapas: ['TROCAR_SENHA', 'COMPLETA'] }, async (ctx) => {
    const { senha_atual: atual, senha_nova: nova } = validar(ctx.corpo, { senha_atual: T({ min: 1, max: 1024 }), senha_nova: T({ min: 1, max: 1024 }) });
    const u = await usuario(ctx.user.id);
    const emailAtual = u.email_enc ? decifrar(cfg.fieldKey, u.email_enc) : '';
    const problemas = validarPolitica(nova, { email: emailAtual }); // senha fraca é só um aviso: não gasta tentativa
    if (problemas.length) throw erro(422, 'SENHA_FRACA', problemas.join(' '), { senha_nova: problemas.join(' ') });
    limitar(`senha:${ctx.sessao.id}`, TENTATIVAS_MAX, 10 * 60_000);
    if (!(await verificarSenha(cfg, atual, u.senha_hash))) throw erro(401, 'CREDENCIAIS', 'A senha atual está incorreta.');
    if (await verificarSenha(cfg, nova, u.senha_hash)) throw erro(422, 'SENHA_FRACA', 'A nova senha precisa ser diferente da atual.', { senha_nova: 'Escolha uma senha diferente.' });
    const hash = await hashSenha(cfg, nova);
    await tx(db, async (db) => {
      await db.run('UPDATE users SET senha_hash = ?, trocar_senha = 0, senha_alterada_em = ? WHERE id = ?', hash, cfg.agora(), u.id);
      await db.run('UPDATE sessions SET revogada_em = ? WHERE user_id = ? AND revogada_em IS NULL AND id <> ?', cfg.agora(), u.id, ctx.sessao.id);
      await rotacionar(db, ctx, 'COMPLETA', { reauth: true }); // acabou de provar a senha: vale como confirmação para ações sensíveis
      await auditar(db, ctx, 'SENHA_TROCADA', 'user', u.id);
    });
    return respostaSessao(ctx);
  });

  rota('POST', '/api/reautenticar', { auth: 'completa' }, async (ctx) => {
    limitar(`reauth:${ctx.sessao.id}`, TENTATIVAS_MAX, 5 * 60_000);
    const { senha } = validar(ctx.corpo, { senha: T({ min: 1, max: 1024 }) });
    if (!(await verificarSenha(cfg, senha, (await usuario(ctx.user.id)).senha_hash))) {
      await tx(db, async (db) => await auditar(db, ctx, 'REAUTENTICACAO_FALHA', 'user', ctx.user.id));
      throw erro(401, 'CREDENCIAIS', 'Senha incorreta.');
    }
    await tx(db, async (db) => {
      await db.run('UPDATE sessions SET reauth_em = ? WHERE id = ?', cfg.agora(), ctx.sessao.id);
      await auditar(db, ctx, 'REAUTENTICACAO_OK', 'user', ctx.user.id);
    });
    return { valido_ate: cfg.agora() + cfg.reauthMs };
  });

  rota('POST', '/api/logout', { auth: 'parcial', etapas: ['CODIGO_EMAIL', 'TROCAR_SENHA', 'COMPLETA'] }, async (ctx) => {
    await tx(db, async (db) => { await revogarSessao(cfg, db, ctx.sessao.id); await auditar(db, ctx, 'LOGOUT', 'user', ctx.user.id); });
    ctx.setCookies.push(cookie(cfg, nomesCookie(cfg).sid, '', { maxAgeS: 0 }));
    return { saiu: true };
  });

  rota('GET', '/api/sessoes', async (ctx) => ({
    sessoes: (await db.all('SELECT id, criado_em, ultimo_uso, ip, user_agent FROM sessions WHERE user_id = ? AND revogada_em IS NULL AND expira_abs > ? ORDER BY ultimo_uso DESC', ctx.user.id, cfg.agora())).map((s) => ({ ...s, atual: s.id === ctx.sessao.id })),
  }));
  rota('DELETE', '/api/sessoes/:id', async (ctx) => {
    const r = await db.run('UPDATE sessions SET revogada_em = ? WHERE id = ? AND user_id = ? AND revogada_em IS NULL', cfg.agora(), Number(ctx.params.id), ctx.user.id);
    if (!r.changes) throw erro(404, 'NAO_ENCONTRADO', 'Sessão não encontrada.');
    await tx(db, async (db) => await auditar(db, ctx, 'SESSAO_REVOGADA', 'sessao', ctx.params.id));
    return { revogada: true };
  });
  rota('POST', '/api/sessoes/sair-todas', async (ctx) => {
    const r = await db.run('UPDATE sessions SET revogada_em = ? WHERE user_id = ? AND id <> ? AND revogada_em IS NULL', cfg.agora(), ctx.user.id, ctx.sessao.id);
    await tx(db, async (db) => await auditar(db, ctx, 'SESSOES_REVOGADAS', 'user', ctx.user.id, { total: r.changes }));
    return { revogadas: r.changes };
  });
}
