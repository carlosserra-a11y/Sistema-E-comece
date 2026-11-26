import crypto from 'node:crypto';
import { tx } from '../db.js';
import { conflito, invalido, naoEncontrado } from '../util.js';
import { E, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { cifrar, decifrar } from '../security/crypto.js';
import { hashSenha, validarPolitica } from '../security/password.js';
import { GRUPOS, PAPEIS, limparPermissoes } from '../permissoes.js';
import { chaveLogin } from './acesso.js';

const MAX_PESSOAS = 50;
const PAPEIS_VALIDOS = [...Object.keys(PAPEIS), 'personalizado'];
const ESPEC = { nome: T({ obrig: true, min: 2, max: 80 }), papel: E(PAPEIS_VALIDOS, { obrig: true }) };
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // sem caracteres ambíguos (0/O, 1/l/I)

/** Senha provisória forte (passa a mesma política do sistema); a pessoa é obrigada a trocar no primeiro acesso. */
export function senhaProvisoria() {
  for (;;) {
    const s = Array.from({ length: 16 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
    const formatada = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
    if (!validarPolitica(formatada).length) return formatada;
  }
}

/** Código de acesso de 11 dígitos sorteado (não é CPF de ninguém, então não há dado pessoal a proteger). */
const sortearLogin = () => String(crypto.randomInt(10_000_000_000, 100_000_000_000));

/** Papel + lista final de permissões. Sem lista explícita vale o modelo do papel; lista diferente do modelo vira "personalizado". */
function resolver(papel, bruto) {
  const modelo = papel === 'personalizado' ? null : limparPermissoes(PAPEIS[papel].permissoes);
  const lista = Array.isArray(bruto) ? limparPermissoes(bruto) : modelo ?? [];
  const igual = modelo && JSON.stringify(modelo) === JSON.stringify(lista);
  return { papel: igual ? papel : 'personalizado', permissoes: lista };
}

/** Excluir: a pessoa some da equipe e perde todo o acesso. O nome fica, porque vendas, caixas e bipagens apontam para a conta. */
export async function excluirConta(db, ctx, id) {
  return await tx(db, async (db) => {
    await db.travar(`abrir-caixa|${id}`); // a mesma trava da abertura de caixa: ninguém abre um caixa enquanto a conta é excluída
    const u = await db.get('SELECT id, dono FROM users WHERE id = ? AND excluido_em IS NULL', id);
    if (!u) throw naoEncontrado('Pessoa');
    if (u.dono) throw conflito('DONO', 'A conta do dono não pode ser excluída.');
    if (u.id === ctx.user.id) throw conflito('PROPRIA', 'Você não pode excluir a própria conta.');
    if (await db.get("SELECT 1 AS ok FROM caixas WHERE aberto_por = ? AND status = 'ABERTO'", u.id)) throw conflito('CAIXA_ABERTO', 'Esta pessoa tem um caixa aberto: feche-o em Balcão → Caixa antes de excluir.');
    await db.run('UPDATE sessions SET revogada_em = ? WHERE user_id = ? AND revogada_em IS NULL', ctx.agora(), u.id);
    await db.run('DELETE FROM recovery_codes WHERE user_id = ?', u.id);
    await db.run("UPDATE users SET ativo = 0, excluido_em = ?, login_hmac = ?, senha_hash = 'excluida', login_enc = NULL, email_enc = NULL, email_hmac = NULL, email_verificado = 0, email_novo_enc = NULL, email_novo_hmac = NULL, permissoes = '[]', cod_hash = NULL, cod_expira = NULL WHERE id = ?", ctx.agora(), `excluido:${u.id}:${crypto.randomBytes(16).toString('hex')}`, u.id);
    await auditar(db, ctx, 'EQUIPE_EXCLUIDA', 'user', u.id);
    return { id: u.id, excluida: true };
  });
}

export function registrarEquipe(app, { cfg, db }) {
  const { rota } = app;

  const publico = (u) => ({
    id: u.id, nome: u.nome, papel: u.papel, dono: !!u.dono, ativo: !!u.ativo, trocar_senha: !!u.trocar_senha,
    pendente: u.papel === 'pendente' && !u.dono, // criou a conta sozinha e aguarda o dono liberar o acesso
    permissoes: u.dono ? null : limparPermissoes(JSON.parse(u.permissoes || '[]')), // dono = todas
    login: u.login_enc ? decifrar(cfg.fieldKey, u.login_enc) : null,
    email: u.email_enc ? decifrar(cfg.fieldKey, u.email_enc) : null, email_verificado: !!u.email_verificado, criado_em: u.criado_em,
  });
  const pessoa = async (db, id) => {
    const u = await db.get('SELECT * FROM users WHERE id = ? AND excluido_em IS NULL', id);
    if (!u) throw naoEncontrado('Pessoa');
    return u;
  };
  const naoDono = (u) => { if (u.dono) throw conflito('DONO', 'A conta do dono não pode ser alterada por aqui.'); };
  const revogarTodas = async (db, id) => { await db.run('UPDATE sessions SET revogada_em = ? WHERE user_id = ? AND revogada_em IS NULL', cfg.agora(), id); };

  rota('POST', '/api/equipe/:id/excluir', { reauth: true }, async (ctx) => await excluirConta(db, ctx, Number(ctx.params.id)));

  rota('GET', '/api/equipe/catalogo', async () => ({ grupos: GRUPOS, papeis: PAPEIS }));

  rota('GET', '/api/equipe', async () => ({ itens: (await db.all('SELECT * FROM users WHERE excluido_em IS NULL ORDER BY dono DESC, ativo DESC, LOWER(nome), id')).map(publico) }));

  rota('POST', '/api/equipe', { reauth: true }, async (ctx) => {
    const d = validar(ctx.corpo, ESPEC);
    const { papel, permissoes } = resolver(d.papel, ctx.corpo.permissoes);
    const senha = senhaProvisoria();
    const hash = await hashSenha(cfg, senha);
    return await tx(db, async (db) => {
      if ((await db.get("SELECT COUNT(*) c FROM users WHERE excluido_em IS NULL AND NOT (papel = 'pendente' AND email_verificado = 0 AND dono = 0)")).c >= MAX_PESSOAS) throw invalido({ nome: `Limite de ${MAX_PESSOAS} pessoas atingido.` });
      let login; let chave;
      do { login = sortearLogin(); chave = chaveLogin(cfg, login); } while (await db.get('SELECT 1 FROM users WHERE login_hmac = ?', chave));
      const id = await db.insert('INSERT INTO users (login_hmac, login_enc, senha_hash, papel, nome, trocar_senha, dono, permissoes, criado_por, criado_em) VALUES (?,?,?,?,?,1,0,?,?,?)',
        chave, cifrar(cfg.fieldKey, login), hash, papel, d.nome, JSON.stringify(permissoes), ctx.user.id, cfg.agora());
      await auditar(db, ctx, 'EQUIPE_CRIADA', 'user', id, { nome: d.nome, papel, permissoes });
      ctx.status = 201;
      return { ...publico(await pessoa(db, id)), senha_provisoria: senha }; // a senha só aparece agora
    });
  });

  rota('PUT', '/api/equipe/:id', { reauth: true }, async (ctx) => {
    const d = validar(ctx.corpo, ESPEC);
    const { papel, permissoes } = resolver(d.papel, ctx.corpo.permissoes);
    return await tx(db, async (db) => {
      const u = await pessoa(db, Number(ctx.params.id));
      naoDono(u);
      await db.run('UPDATE users SET nome = ?, papel = ?, permissoes = ? WHERE id = ?', d.nome, papel, JSON.stringify(permissoes), u.id);
      await auditar(db, ctx, 'EQUIPE_ALTERADA', 'user', u.id, { de: limparPermissoes(JSON.parse(u.permissoes || '[]')), para: permissoes, papel });
      return publico(await pessoa(db, u.id));
    });
  });

  for (const [acao, ativo, evento] of [['desativar', 0, 'EQUIPE_DESATIVADA'], ['reativar', 1, 'EQUIPE_REATIVADA']]) {
    rota('POST', `/api/equipe/:id/${acao}`, { reauth: true }, async (ctx) => await tx(db, async (db) => {
      const u = await pessoa(db, Number(ctx.params.id));
      naoDono(u);
      await db.run('UPDATE users SET ativo = ? WHERE id = ?', ativo, u.id);
      if (!ativo) await revogarTodas(db, u.id); // sai de todos os aparelhos na hora
      await auditar(db, ctx, evento, 'user', u.id);
      return publico(await pessoa(db, u.id));
    }));
  }

  rota('POST', '/api/equipe/:id/redefinir-senha', { reauth: true }, async (ctx) => {
    const senha = senhaProvisoria();
    const hash = await hashSenha(cfg, senha);
    return await tx(db, async (db) => {
      const u = await pessoa(db, Number(ctx.params.id));
      naoDono(u);
      await db.run('UPDATE users SET senha_hash = ?, trocar_senha = 1, senha_alterada_em = ? WHERE id = ?', hash, cfg.agora(), u.id);
      await revogarTodas(db, u.id);
      if (u.login_enc) await db.run('DELETE FROM login_tentativas WHERE chave_hmac = ?', chaveLogin(cfg, decifrar(cfg.fieldKey, u.login_enc))); // tira o bloqueio por tentativas
      if (u.email_hmac) await db.run('DELETE FROM login_tentativas WHERE chave_hmac = ?', u.email_hmac); // no login por e-mail a chave do bloqueio é o próprio HMAC do e-mail
      await auditar(db, ctx, 'EQUIPE_SENHA_REDEFINIDA', 'user', u.id);
      return { ...publico(await pessoa(db, u.id)), senha_provisoria: senha };
    });
  });
}
