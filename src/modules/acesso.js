import { tx } from '../db.js';
import { erro } from '../util.js';
import { T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { hmacHex, cifrar, decifrar } from '../security/crypto.js';
import { hashSenha, verificarSenha, verificacaoFalsa, validarPolitica } from '../security/password.js';
import { novoSegredo, uriOtpauth, verificarTotp, gerarCodigosRecuperacao, normalizarCodigoRecuperacao } from '../security/totp.js';
import { qrSvg } from '../barcode/qr.js';
import { permissoesDe } from '../permissoes.js';
import { criarSessao, revogarSessao, cookie, nomesCookie } from '../http/sessao.js';

const LOGIN_RE = /^\d{11}$/;
/** Quantas tentativas erradas a pessoa pode fazer (senha, código de 2 etapas) antes de o sistema segurar. */
export const TENTATIVAS_MAX = 10;
const MAX_FALHAS_MFA = TENTATIVAS_MAX;
const espera = (s) => (s >= 90 ? `${Math.ceil(s / 60)} minutos` : `${Math.max(1, s)} segundos`);

export const proximoEstagio = (u) => (u.trocar_senha ? 'TROCAR_SENHA' : !u.mfa_ativo ? 'MFA_INSCREVER' : 'MFA_VERIFICAR');
export const chaveLogin = (cfg, digitos) => hmacHex(cfg.hmacKey, `login|${digitos}`);

export function registrarAcesso(app, { cfg, db }) {
  const { rota, limitador } = app;
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
      usuario: u ? { nome: u.nome, papel: u.papel, dono: !!u.dono, mfa_ativo: !!u.mfa_ativo, permissoes: [...permissoesDe(u)].sort() } : null,
      expira_em: ctx.sessao ? Math.min(ctx.sessao.expira_abs, ctx.sessao.ultimo_uso + (ctx.sessao.estagio === 'COMPLETA' ? cfg.sessao.ociosoMs : cfg.sessao.preAuthMs)) : null,
    };
  });

  rota('POST', '/api/login', { auth: 'publica' }, async (ctx) => {
    limitar(`login:ip:${ctx.ip}`, TENTATIVAS_MAX * 6, 15 * 60_000, 'Muitas tentativas de entrada neste aparelho/rede.');
    const { login, senha } = ctx.corpo;
    const digitos = typeof login === 'string' ? login.replace(/\D/g, '') : '';
    const chave = chaveLogin(cfg, LOGIN_RE.test(digitos) ? digitos : `invalido:${String(login).slice(0, 40)}`);
    const t = cfg.agora();
    const tent = await db.get('SELECT * FROM login_tentativas WHERE chave_hmac = ?', chave);
    if (tent && tent.bloqueado_ate > t) {
      throw Object.assign(erro(429, 'BLOQUEADO', `Acesso temporariamente bloqueado por excesso de tentativas. Aguarde ${espera(Math.ceil((tent.bloqueado_ate - t) / 1000))}.`), { retryAfterS: Math.ceil((tent.bloqueado_ate - t) / 1000) });
    }
    const senhaOk = typeof senha === 'string' && senha.length > 0 && senha.length <= 1024;
    const user = LOGIN_RE.test(digitos) ? await db.get('SELECT * FROM users WHERE login_hmac = ? AND ativo = 1', chave) : null;
    const ok = user && senhaOk ? await verificarSenha(cfg, senha, user.senha_hash) : await verificacaoFalsa(cfg, senhaOk ? senha : 'x');
    if (!ok) {
      await tx(db, async (db) => {
        const falhas = (tent?.falhas ?? 0) + 1;
        const bloq = falhas >= TENTATIVAS_MAX ? t + Math.min(60, 2 ** (falhas - TENTATIVAS_MAX)) * 60_000 : 0;
        await db.run(`INSERT INTO login_tentativas (chave_hmac, falhas, bloqueado_ate, atualizado_em) VALUES (?,?,?,?)
          ON CONFLICT (chave_hmac) DO UPDATE SET falhas = excluded.falhas, bloqueado_ate = excluded.bloqueado_ate, atualizado_em = excluded.atualizado_em`, chave, falhas, bloq, t);
        await auditar(db, ctx, 'LOGIN_FALHA', 'login', chave.slice(0, 8), { falhas });
      });
      throw erro(401, 'CREDENCIAIS', 'Login ou senha inválidos.');
    }
    await tx(db, async (db) => {
      await db.run('DELETE FROM login_tentativas WHERE chave_hmac = ?', chave);
      ctx.user = { id: user.id, papel: user.papel, nome: user.nome };
      await criarSessao(cfg, db, ctx, user.id, proximoEstagio(user));
      await auditar(db, ctx, 'LOGIN_SENHA_OK', 'user', user.id);
    });
    return respostaSessao(ctx);
  });

  rota('POST', '/api/senha/trocar', { auth: 'parcial', etapas: ['TROCAR_SENHA', 'COMPLETA'] }, async (ctx) => {
    const { senha_atual: atual, senha_nova: nova } = validar(ctx.corpo, { senha_atual: T({ min: 1, max: 1024 }), senha_nova: T({ min: 1, max: 1024 }) });
    const problemas = validarPolitica(nova); // senha fraca é só um aviso: não gasta tentativa
    if (problemas.length) throw erro(422, 'SENHA_FRACA', problemas.join(' '), { senha_nova: problemas.join(' ') });
    limitar(`senha:${ctx.sessao.id}`, TENTATIVAS_MAX, 10 * 60_000);
    const u = await usuario(ctx.user.id);
    if (!(await verificarSenha(cfg, atual, u.senha_hash))) throw erro(401, 'CREDENCIAIS', 'A senha atual (a provisória) está incorreta. Confira o arquivo de segredos.');
    if (await verificarSenha(cfg, nova, u.senha_hash)) throw erro(422, 'SENHA_FRACA', 'A nova senha precisa ser diferente da atual.', { senha_nova: 'Escolha uma senha diferente.' });
    const hash = await hashSenha(cfg, nova);
    const eraInicial = ctx.sessao.estagio === 'TROCAR_SENHA';
    await tx(db, async (db) => {
      await db.run('UPDATE users SET senha_hash = ?, trocar_senha = 0, senha_alterada_em = ? WHERE id = ?', hash, cfg.agora(), u.id);
      await db.run('UPDATE sessions SET revogada_em = ? WHERE user_id = ? AND revogada_em IS NULL AND id <> ?', cfg.agora(), u.id, ctx.sessao.id);
      await rotacionar(db, ctx, eraInicial ? (u.mfa_ativo ? 'MFA_VERIFICAR' : 'MFA_INSCREVER') : 'COMPLETA', { reauth: !eraInicial });
      await auditar(db, ctx, 'SENHA_TROCADA', 'user', u.id);
    });
    return respostaSessao(ctx);
  });

  rota('POST', '/api/mfa/iniciar', { auth: 'parcial', etapas: ['MFA_INSCREVER'] }, async (ctx) => {
    const u = await usuario(ctx.user.id);
    let segredo;
    if (u.mfa_pendente_enc) segredo = decifrar(cfg.fieldKey, u.mfa_pendente_enc);
    else {
      segredo = novoSegredo();
      await db.run('UPDATE users SET mfa_pendente_enc = ? WHERE id = ?', cifrar(cfg.fieldKey, segredo), u.id);
    }
    const uri = uriOtpauth(cfg.appName, u.dono ? 'dono' : `equipe-${u.id}`, segredo);
    return { segredo, uri, qrSvg: qrSvg(uri, { borda: 2 }) };
  });

  rota('POST', '/api/mfa/confirmar', { auth: 'parcial', etapas: ['MFA_INSCREVER'] }, async (ctx) => {
    limitar(`mfa:${ctx.sessao.id}`, TENTATIVAS_MAX + 5, 10 * 60_000);
    const { codigo } = validar(ctx.corpo, { codigo: T({ min: 6, max: 10 }) });
    const u = await usuario(ctx.user.id);
    if (!u.mfa_pendente_enc) throw erro(409, 'MFA', 'Inicie a configuração do MFA primeiro.');
    const segredo = decifrar(cfg.fieldKey, u.mfa_pendente_enc);
    const passo = verificarTotp(segredo, codigo, cfg.agora(), 0);
    if (!passo) throw erro(422, 'MFA_INVALIDO', 'Código incorreto. Confira o horário do celular e tente de novo.', { codigo: 'Código incorreto.' });
    const codigos = gerarCodigosRecuperacao(10);
    await tx(db, async (db) => {
      await db.run('UPDATE users SET mfa_segredo_enc = mfa_pendente_enc, mfa_pendente_enc = NULL, mfa_ativo = 1, mfa_ultimo_passo = ?, mfa_falhas = 0 WHERE id = ?', passo, u.id);
      await db.run('DELETE FROM recovery_codes WHERE user_id = ?', u.id);
      for (const c of codigos) await db.run('INSERT INTO recovery_codes (user_id, codigo_hmac) VALUES (?, ?)', u.id, hmacHex(cfg.hmacKey, `rec|${normalizarCodigoRecuperacao(c)}`));
      await rotacionar(db, ctx, 'COMPLETA', { reauth: true });
      await auditar(db, ctx, 'MFA_ATIVADO', 'user', u.id);
    });
    return respostaSessao(ctx, { codigos_recuperacao: codigos });
  });

  rota('POST', '/api/mfa/verificar', { auth: 'parcial', etapas: ['MFA_VERIFICAR'] }, async (ctx) => {
    limitar(`mfa:${ctx.sessao.id}`, TENTATIVAS_MAX + 5, 10 * 60_000);
    const { codigo } = validar(ctx.corpo, { codigo: T({ min: 6, max: 10 }) });
    const u = await usuario(ctx.user.id);
    const passo = verificarTotp(decifrar(cfg.fieldKey, u.mfa_segredo_enc), codigo, cfg.agora(), u.mfa_ultimo_passo);
    if (!passo) {
      const falhas = u.mfa_falhas + 1;
      await tx(db, async (db) => {
        await db.run('UPDATE users SET mfa_falhas = ? WHERE id = ?', falhas >= MAX_FALHAS_MFA ? 0 : falhas, u.id);
        if (falhas >= MAX_FALHAS_MFA) await revogarSessao(cfg, db, ctx.sessao.id);
        await auditar(db, ctx, 'MFA_FALHA', 'user', u.id, { falhas });
      });
      throw erro(falhas >= MAX_FALHAS_MFA ? 401 : 422, falhas >= MAX_FALHAS_MFA ? 'NAO_AUTENTICADO' : 'MFA_INVALIDO',
        falhas >= MAX_FALHAS_MFA ? 'Muitas tentativas. Entre novamente.' : 'Código incorreto ou já utilizado.', { codigo: 'Código incorreto.' });
    }
    await tx(db, async (db) => {
      await db.run('UPDATE users SET mfa_ultimo_passo = ?, mfa_falhas = 0 WHERE id = ?', passo, u.id);
      await rotacionar(db, ctx, 'COMPLETA', { reauth: true });
      await auditar(db, ctx, 'LOGIN_OK', 'user', u.id);
    });
    return respostaSessao(ctx);
  });

  rota('POST', '/api/mfa/recuperar', { auth: 'parcial', etapas: ['MFA_VERIFICAR'] }, async (ctx) => {
    limitar(`mfa:${ctx.sessao.id}`, TENTATIVAS_MAX + 5, 10 * 60_000);
    const { codigo } = validar(ctx.corpo, { codigo: T({ min: 8, max: 20 }) });
    const h = hmacHex(cfg.hmacKey, `rec|${normalizarCodigoRecuperacao(codigo)}`);
    const rc = await db.get('SELECT * FROM recovery_codes WHERE user_id = ? AND codigo_hmac = ? AND usado_em IS NULL', ctx.user.id, h);
    if (!rc) {
      await tx(db, async (db) => await auditar(db, ctx, 'MFA_RECUPERACAO_FALHA', 'user', ctx.user.id));
      throw erro(422, 'MFA_INVALIDO', 'Código de recuperação inválido ou já usado.', { codigo: 'Código inválido.' });
    }
    let restantes = 0;
    await tx(db, async (db) => {
      await db.run('UPDATE recovery_codes SET usado_em = ? WHERE id = ?', cfg.agora(), rc.id);
      restantes = (await db.get('SELECT COUNT(*) c FROM recovery_codes WHERE user_id = ? AND usado_em IS NULL', ctx.user.id)).c;
      await rotacionar(db, ctx, 'COMPLETA', { reauth: true });
      await auditar(db, ctx, 'MFA_RECUPERACAO_USADA', 'user', ctx.user.id, { restantes });
    });
    return respostaSessao(ctx, { codigos_restantes: restantes });
  });

  rota('POST', '/api/mfa/regenerar', { auth: 'completa', reauth: true }, async (ctx) => {
    const codigos = gerarCodigosRecuperacao(10);
    await tx(db, async (db) => {
      await db.run('DELETE FROM recovery_codes WHERE user_id = ?', ctx.user.id);
      for (const c of codigos) await db.run('INSERT INTO recovery_codes (user_id, codigo_hmac) VALUES (?, ?)', ctx.user.id, hmacHex(cfg.hmacKey, `rec|${normalizarCodigoRecuperacao(c)}`));
      await auditar(db, ctx, 'MFA_CODIGOS_REGENERADOS', 'user', ctx.user.id);
    });
    return { codigos_recuperacao: codigos };
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

  rota('POST', '/api/logout', { auth: 'parcial', etapas: ['TROCAR_SENHA', 'MFA_INSCREVER', 'MFA_VERIFICAR', 'COMPLETA'] }, async (ctx) => {
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
