// RESTAURA um backup num banco SQLite NOVO (vazio): serve para abrir seus dados numa máquina nova ou para provar que o backup funciona.
// Nunca mexe em PostgreSQL/produção e recusa banco que já tenha dados. Precisa das mesmas chaves do sistema (PEPPER, HMAC_KEY, FIELD_KEY).
// Uso:  DB_PATH=data/restaurado.db BACKUP_SENHA=... npm run restaurar -- backups/armazem-....json.gz.enc --confirmar
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { abrirBanco, migrar } from '../src/db.js';
import { ler, restaurar } from '../src/backup.js';

const arquivo = process.argv[2];
if (!arquivo || !process.argv.includes('--confirmar')) { console.error('Uso: npm run restaurar -- <arquivo> --confirmar   (restaura em DB_PATH, que deve ser um banco novo)'); process.exit(1); }
const cfg = loadConfig();
if (cfg.databaseUrl) { console.error('DATABASE_URL está definida: este comando só restaura em SQLite local. Remova a variável e use DB_PATH.'); process.exit(1); }
try {
  const dados = ler(fs.readFileSync(arquivo), cfg.backupSenha);
  const db = await abrirBanco(cfg);
  try {
    await migrar(db, path.join(ROOT, 'migrations'));
    const r = await restaurar(db, dados);
    console.log(`Restaurado em ${cfg.dbPath}: ${r.tabelas} tabelas.`);
    for (const [t, n] of Object.entries(r.contagens)) if (n) console.log(`  ${t.padEnd(26)} ${n}`);
  } finally { await db.fechar(); }
} catch (e) { console.error(e.message); process.exit(1); }
