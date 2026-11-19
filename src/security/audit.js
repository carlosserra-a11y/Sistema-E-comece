import { sha256 } from './crypto.js';

const GENESIS = '0'.repeat(64);

function calcular(prev, r) {
  return sha256([prev, r.ts, r.user_id ?? '', r.acao, r.entidade ?? '', r.entidade_id ?? '', r.detalhes ?? '', r.ip ?? ''].join('|'));
}

/** Registra um evento. Deve ser chamado dentro da mesma transação da ação auditada. Nunca grave senha/token em `detalhes`. */
export async function auditar(db, ctx, acao, entidade = null, entidadeId = null, detalhes = null) {
  await db.travar('auditoria'); // no Postgres, duas transações não podem ler o mesmo "último hash" e bifurcar a cadeia
  const ult = await db.get('SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1');
  const prev = ult?.hash ?? GENESIS;
  const reg = {
    ts: ctx.agora(),
    user_id: ctx.user?.id ?? null,
    acao,
    entidade,
    entidade_id: entidadeId === null ? null : String(entidadeId),
    detalhes: detalhes === null ? null : JSON.stringify(detalhes),
    ip: ctx.ip ?? null,
  };
  const hash = calcular(prev, reg);
  await db.run('INSERT INTO auditoria (ts, user_id, acao, entidade, entidade_id, detalhes, ip, hash_prev, hash) VALUES (?,?,?,?,?,?,?,?,?)', reg.ts, reg.user_id, reg.acao, reg.entidade, reg.entidade_id, reg.detalhes, reg.ip, prev, hash);
}

/** Recalcula a cadeia inteira. Retorna { ok, total, quebrouEm }. */
export async function verificarCadeia(db) {
  let prev = GENESIS;
  let total = 0;
  for (const r of await db.all('SELECT * FROM auditoria ORDER BY id')) {
    total++;
    if (r.hash_prev !== prev || calcular(prev, r) !== r.hash) return { ok: false, total, quebrouEm: r.id };
    prev = r.hash;
  }
  return { ok: true, total, quebrouEm: null };
}
