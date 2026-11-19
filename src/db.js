/**
 * Camada de banco com DOIS motores atrás da mesma interface assíncrona:
 *  - SQLite (node:sqlite): desenvolvimento e testes, sem rede;
 *  - PostgreSQL (pacote `pg`): produção na Supabase.
 * Os módulos escrevem SQL com `?` e usam: get, all, run, insert (devolve o id), exec, tx.
 * Dentro de `db.tx(async (db) => ...)` use SEMPRE o `db` recebido (sombreia o de fora): é ele que está na transação.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';

const limpo = (a) => a.map((v) => (v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export async function abrirBanco(cfg) {
  if (cfg.databaseUrl?.startsWith('pglite:')) return abrirPostgres(cfg, await abrirPglite()); // PostgreSQL embutido (WASM): só para testes
  return cfg.databaseUrl ? abrirPostgres(cfg) : await abrirSqlite(cfg.dbPath);
}
export const tx = (db, fn) => db.tx(fn);

// ---------------------------------------------------------------- SQLite
async function abrirSqlite(caminho) {
  const { DatabaseSync } = await import('node:sqlite');
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const raw = new DatabaseSync(caminho);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA trusted_schema = OFF;');
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) cache.set(sql, (s = raw.prepare(sql))); return s; };
  const sync = {
    get: (sql, ...a) => stmt(sql).get(...limpo(a)),
    all: (sql, ...a) => stmt(sql).all(...limpo(a)),
    run: (sql, ...a) => ({ changes: Number(stmt(sql).run(...limpo(a)).changes) }),
    insert: (sql, ...a) => Number(stmt(`${sql} RETURNING id`).get(...limpo(a)).id),
    exec: (sql) => raw.exec(sql),
  };

  // Uma conexão só: transações precisam ser exclusivas. Consultas de fora esperam a transação terminar.
  let travado = false; const fila = [];
  const adquirir = () => new Promise((ok, falha) => {
    if (!travado) { travado = true; return ok(); }
    const ir = () => { clearTimeout(t); ok(); };
    const t = setTimeout(() => { fila.splice(fila.indexOf(ir), 1); falha(new Error('Banco ocupado: houve consulta fora da transação (use o db recebido por tx).')); }, Number(process.env.DB_LOCK_MS ?? 20_000));
    fila.push(ir);
  });
  const liberar = () => { const prox = fila.shift(); if (prox) prox(); else travado = false; };
  const travada = (fn) => async (...a) => { await adquirir(); try { return fn(...a); } finally { liberar(); } };
  const livre = (fn) => async (...a) => fn(...a);

  const montar = (envolver, prof, tx) => ({
    dialeto: 'sqlite', get: envolver(sync.get), all: envolver(sync.all), run: envolver(sync.run), insert: envolver(sync.insert), exec: envolver(sync.exec),
    travar: async () => {}, tx,
  });
  const dentro = (prof) => montar(livre, prof, async (fn) => {
    const sp = `sp${prof + 1}`;
    raw.exec(`SAVEPOINT ${sp}`);
    try { const r = await fn(dentro(prof + 1)); raw.exec(`RELEASE ${sp}`); return r; } catch (e) { try { raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch { /* já revertido */ } throw e; }
  });
  const db = montar(travada, 0, async (fn) => {
    await adquirir();
    raw.exec('BEGIN IMMEDIATE');
    try { const r = await fn(dentro(0)); raw.exec('COMMIT'); return r; } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* já revertido */ } throw e; } finally { liberar(); }
  });
  db.fechar = async () => raw.close();
  return db;
}

// ---------------------------------------------------------------- PostgreSQL (Supabase)
/** PostgreSQL em WebAssembly (PGlite): uma conexão só, então serializa como o driver SQLite. Mesmo SQL e mesmas triggers do Supabase. */
async function abrirPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite({ parsers: { 20: Number, 1700: Number } });
  await pg.waitReady;
  let ocupado = false; const fila = [];
  const adquirir = () => new Promise((ok, falha) => {
    if (!ocupado) { ocupado = true; return ok(); }
    const ir = () => { clearTimeout(t); ok(); };
    const t = setTimeout(() => { fila.splice(fila.indexOf(ir), 1); falha(new Error('Banco ocupado: houve consulta fora da transação (use o db recebido por tx).')); }, Number(process.env.DB_LOCK_MS ?? 20_000));
    fila.push(ir);
  });
  const liberar = () => { const prox = fila.shift(); if (prox) prox(); else ocupado = false; };
  const rodar = async (sql, params) => {
    if (!params?.length) { const r = await pg.exec(sql); const u = r.at(-1); return { rows: u?.rows ?? [], rowCount: u?.affectedRows ?? u?.rows?.length ?? 0 }; }
    const r = await pg.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  return {
    query: async (sql, params) => { await adquirir(); try { return await rodar(sql, params); } finally { liberar(); } },
    connect: async () => { await adquirir(); return { query: rodar, release: () => liberar() }; },
    end: async () => pg.close(),
  };
}

async function abrirPostgres(cfg, embutido = null) {
  let pool = embutido;
  if (!pool) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(20, Number); // int8 (COUNT, ids grandes, timestamps em ms) vem como número
    pg.types.setTypeParser(1700, Number); // numeric (SUM)
    const local = /@(localhost|127.0.0.1)[:/]/.test(cfg.databaseUrl);
    const ssl = local ? false : cfg.databaseSslCa ? { ca: cfg.databaseSslCa, rejectUnauthorized: true } : { rejectUnauthorized: false };
    // Sem statement_timeout aqui: o pooler da Supabase recusa parâmetros de início. O limite fica no papel do banco (ver supabase/migrations).
    pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: cfg.dbPoolMax ?? 4, ssl, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, application_name: 'cds-wms' });
    pool.on('error', () => { /* conexões ociosas derrubadas pelo pooler: o pool recria */ });
  }
  const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const montar = (q, prof, tx) => ({
    dialeto: 'pg',
    get: async (sql, ...a) => (await q.query(conv(sql), limpo(a))).rows[0],
    all: async (sql, ...a) => (await q.query(conv(sql), limpo(a))).rows,
    run: async (sql, ...a) => ({ changes: (await q.query(conv(sql), limpo(a))).rowCount }),
    insert: async (sql, ...a) => (await q.query(`${conv(sql)} RETURNING id`, limpo(a))).rows[0].id,
    exec: async (sql) => { await q.query(sql); },
    travar: async (chave) => { await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(chave)]); },
    tx,
  });
  const dentro = (client, prof) => montar(client, prof, async (fn) => {
    const sp = `sp${prof + 1}`;
    await client.query(`SAVEPOINT ${sp}`);
    try { const r = await fn(dentro(client, prof + 1)); await client.query(`RELEASE ${sp}`); return r; } catch (e) { try { await client.query(`ROLLBACK TO ${sp}`); } catch { /* conexão perdida */ } throw e; }
  });
  const db = montar(pool, 0, async (fn) => {
    const client = await pool.connect();
    let falhou = false;
    try {
      await client.query('BEGIN');
      const r = await fn(dentro(client, 0));
      await client.query('COMMIT');
      return r;
    } catch (e) { falhou = true; try { await client.query('ROLLBACK'); } catch { /* conexão perdida */ } throw e; } finally { client.release(falhou ? true : undefined); }
  });
  db.fechar = () => pool.end();
  db.embutido = Boolean(embutido);
  return db;
}

// ---------------------------------------------------------------- migrations (só SQLite; no Postgres o esquema vem de supabase/migrations)
export async function migrar(db, dir) {
  if (db.dialeto === 'pg') {
    if (db.embutido) { // PostgreSQL de teste: aplica o mesmo esquema que vai para a Supabase (menos o que é só da Supabase: papéis e RLS)
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.endsWith('_supabase.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      return [];
    }
    await db.get('SELECT 1 AS ok FROM produtos LIMIT 1'); // o esquema precisa existir (aplicado pela Supabase); o app não faz DDL
    return [];
  }
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (nome TEXT PRIMARY KEY, aplicada_em INTEGER NOT NULL)');
  const feitas = new Set((await db.all('SELECT nome FROM schema_migrations')).map((r) => r.nome));
  const aplicadas = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (feitas.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      await db.tx(async (t) => { await t.exec(sql); await t.run('INSERT INTO schema_migrations(nome, aplicada_em) VALUES (?, ?)', f, Date.now()); });
      aplicadas.push(f);
    } catch (e) { throw new Error(`Falha na migration ${f}: ${e.message}`); }
  }
  return aplicadas;
}

/** Converte erros do banco (SQLite ou PostgreSQL) em respostas HTTP compreensíveis. */
export function traduzirErroSql(e) {
  const msg = String(e?.message ?? '');
  const c = e?.code; const cons = String(e?.constraint ?? '');
  if (c === '23505' || /UNIQUE constraint failed/.test(msg)) return new HttpError(409, 'DUPLICADO', 'Já existe um registro com esse valor.');
  if (c === '23503' || /FOREIGN KEY constraint failed/.test(msg)) return new HttpError(409, 'REFERENCIA', 'Registro relacionado não existe ou está em uso.');
  if (/constraint failed: qtd >= 0/.test(msg) || /saldos_por_endereco_qtd/.test(cons)) return new HttpError(409, 'ESTOQUE_INSUFICIENTE', 'Saldo insuficiente para a operação.');
  if (c === '23514' || /CHECK constraint failed/.test(msg)) return new HttpError(422, 'VALIDACAO', 'Valor fora dos limites permitidos.');
  if (/imutavel|somente inser/i.test(msg)) return new HttpError(409, 'IMUTAVEL', 'Este registro é imutável.');
  return null;
}
