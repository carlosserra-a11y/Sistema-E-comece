import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HttpError } from './util.js';

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA trusted_schema = OFF;');
  return db;
}

export function migrar(db, dir) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (nome TEXT PRIMARY KEY, aplicada_em INTEGER NOT NULL)');
  const feitas = new Set(db.prepare('SELECT nome FROM schema_migrations').all().map((r) => r.nome));
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas = [];
  for (const f of arquivos) {
    if (feitas.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(nome, aplicada_em) VALUES (?, ?)').run(f, Date.now());
      db.exec('COMMIT');
      aplicadas.push(f);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migration ${f}: ${e.message}`);
    }
  }
  return aplicadas;
}

const profundidade = new WeakMap();
/** Transação síncrona com savepoints aninhados. O callback NÃO pode ser async. */
export function tx(db, fn) {
  const d = profundidade.get(db) ?? 0;
  const sp = `sp${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  profundidade.set(db, d + 1);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('tx(): o callback não pode ser assíncrono');
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    try { db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch { /* já revertida */ }
    throw e;
  } finally {
    profundidade.set(db, d);
  }
}

const cache = new WeakMap();
export function q(db, sql) {
  let m = cache.get(db);
  if (!m) cache.set(db, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = db.prepare(sql)));
  return s;
}

/** Converte erros do SQLite em respostas HTTP compreensíveis. */
export function traduzirErroSql(e) {
  const msg = String(e?.message ?? '');
  if (/UNIQUE constraint failed/.test(msg)) return new HttpError(409, 'DUPLICADO', 'Já existe um registro com esse valor.');
  if (/FOREIGN KEY constraint failed/.test(msg)) return new HttpError(409, 'REFERENCIA', 'Registro relacionado não existe ou está em uso.');
  if (/constraint failed: qtd >= 0/.test(msg)) return new HttpError(409, 'ESTOQUE_INSUFICIENTE', 'Saldo insuficiente para a operação.');
  if (/CHECK constraint failed/.test(msg)) return new HttpError(422, 'VALIDACAO', 'Valor fora dos limites permitidos.');
  if (/imutavel|somente inser/i.test(msg)) return new HttpError(409, 'IMUTAVEL', 'Este registro é imutável.');
  return null;
}
