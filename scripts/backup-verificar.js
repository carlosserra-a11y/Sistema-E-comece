// Confere um arquivo de backup: abre (com BACKUP_SENHA, se cifrado), valida a estrutura e mostra o resumo por tabela. Não grava nada.
// Uso:  npm run backup:verificar -- backups/armazem-2026-11-22-120000.json.gz.enc
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { ler, verificar } from '../src/backup.js';

const arquivo = process.argv[2];
if (!arquivo) { console.error('Informe o arquivo: npm run backup:verificar -- <arquivo>'); process.exit(1); }
try {
  const dados = ler(fs.readFileSync(arquivo), loadConfig().backupSenha);
  const r = verificar(dados);
  console.log(`Backup de ${r.criado_em} (${r.dialeto}): ${r.tabelas} tabelas, ${r.linhas} registros.`);
  for (const t of r.resumo) console.log(`  ${t.nome.padEnd(26)} ${t.linhas}`);
  if (!r.ok) { console.error('PROBLEMAS:', r.problemas.join('; ')); process.exit(2); }
  console.log('OK: o arquivo está íntegro.');
} catch (e) { console.error(e.message); process.exit(1); }
