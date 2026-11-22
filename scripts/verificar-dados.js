// Confere a integridade dos dados do banco configurado (SQLite ou PostgreSQL), sem gravar nada:
//   1) o saldo de cada endereço bate com a soma do livro-razão (movimentacoes_estoque) e nada está negativo;
//   2) a cadeia de hashes da auditoria está íntegra (ninguém alterou nem apagou um registro).
// Use depois de restaurar um backup ou de migrar o banco de lugar:  npm run verificar-dados
import { loadConfig } from '../src/config.js';
import { abrirBanco } from '../src/db.js';
import { integridade } from '../src/modules/estoque.js';
import { verificarCadeia } from '../src/security/audit.js';

const cfg = loadConfig();
const db = await abrirBanco(cfg);
let ok = false;
try {
  const estoque = await integridade(db);
  const auditoria = await verificarCadeia(db);
  const linhas = (await db.get('SELECT COUNT(*) c FROM movimentacoes_estoque')).c;
  const eventos = (await db.get('SELECT COUNT(*) c FROM auditoria')).c;
  console.log(`Estoque: ${estoque.ok ? 'OK' : 'DIVERGENTE'} (${linhas} movimentações; ${estoque.divergencias.length} divergência(s), ${estoque.saldos_negativos} saldo(s) negativo(s)).`);
  console.log(`Auditoria: ${auditoria.ok ? 'OK' : 'QUEBRADA'} (${eventos} registros).`);
  ok = estoque.ok && auditoria.ok;
} finally { await db.fechar(); }
if (!ok) { console.error('Integridade FALHOU.'); process.exit(2); }
console.log('Integridade OK.');
