// BACKUP: salva o banco inteiro num único arquivo (JSON comprimido; cifrado se BACKUP_SENHA estiver definida) e guarda só os últimos N.
// Funciona com o SQLite local e com o PostgreSQL da Supabase (use as mesmas variáveis de produção: DATABASE_URL, PEPPER, HMAC_KEY, FIELD_KEY).
// Uso:  npm run backup                     (pasta "backups", mantém 30)
//       npm run backup -- --pasta D:/Backups --manter 60
// O arquivo tem dados sensíveis: defina BACKUP_SENHA e guarde uma cópia FORA deste computador/servidor.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { abrirBanco } from '../src/db.js';
import { exportar, serializar, verificar } from '../src/backup.js';

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : padrao; };
const pasta = path.resolve(arg('pasta', 'backups'));
const manter = Math.max(1, Number(arg('manter', 30)));
const cfg = loadConfig();
const senha = cfg.backupSenha;
if (senha === 'PREENCHER') { console.error('BACKUP_SENHA ainda está como "PREENCHER": defina a senha dos backups (bash /opt/wms/app/deploy/vps/definir-segredo.sh BACKUP_SENHA). Nenhum backup foi feito.'); process.exit(1); }
const db = await abrirBanco(cfg);
try {
  const dados = await exportar(db);
  const resumo = verificar(dados);
  if (!resumo.ok) throw new Error(`Backup inconsistente: ${resumo.problemas[0] ?? 'sem tabelas'}`);
  const arquivo = serializar(dados, senha);
  fs.mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const destino = path.join(pasta, `armazem-${carimbo}.json.gz${senha ? '.enc' : ''}`);
  fs.writeFileSync(destino, arquivo, { mode: 0o600 });
  const antigos = fs.readdirSync(pasta).filter((f) => /^armazem-.*\.json\.gz(\.enc)?$/.test(f)).sort();
  for (const f of antigos.slice(0, Math.max(0, antigos.length - manter))) fs.rmSync(path.join(pasta, f));
  console.log(`Backup salvo: ${destino}`);
  console.log(`  ${resumo.tabelas} tabelas, ${resumo.linhas} registros, ${(arquivo.length / 1024).toFixed(1)} KB, ${senha ? 'CIFRADO' : 'SEM SENHA (defina BACKUP_SENHA)'}`);
  console.log(`  sha256: ${crypto.createHash('sha256').update(arquivo).digest('hex')}`);
  console.log(`  Mantidos os últimos ${Math.min(manter, antigos.length)} backup(s) em ${pasta}`);
  if (!senha) console.warn('ATENÇÃO: este arquivo guarda hashes de senha e dados da empresa sem cifra. Guarde-o em local seguro.');
} finally { await db.fechar(); }
