// PostgreSQL próprio na VPS: a segurança do banco (papel app_wms), a sintaxe dos scripts de instalação e a conferência de integridade.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const VPS = path.join(ROOT, 'deploy', 'vps');

test('postgres-seguranca.sql: o papel app_wms lê e grava, mas não altera nem apaga o livro-razão e a auditoria (e roda de novo sem erro)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.waitReady;
  const dir = path.join(ROOT, 'supabase', 'migrations');
  // o mesmo esquema do banco, sem os arquivos que só existem na Supabase (papéis anon/authenticated)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.endsWith('_supabase.sql')).sort()) await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const seguranca = fs.readFileSync(path.join(VPS, 'postgres-seguranca.sql'), 'utf8');
  await pg.exec(seguranca);
  await pg.exec(seguranca); // idempotente: a cada atualização ele roda de novo

  const papel = (await pg.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = 'app_wms'")).rows[0];
  assert.deepEqual(papel, { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true });
  const config = (await pg.query("SELECT unnest(s.setconfig) AS c FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'app_wms'")).rows.map((r) => r.c);
  assert.ok(config.includes('statement_timeout=20s') && config.includes('search_path=public'));

  const pode = async (tabela, privilegio) => (await pg.query('SELECT has_table_privilege($1, $2, $3) AS v', ['app_wms', tabela, privilegio])).rows[0].v;
  for (const [tabela, privilegio] of [['produtos', 'SELECT'], ['produtos', 'UPDATE'], ['produtos', 'DELETE'], ['empresa', 'UPDATE'], ['movimentacoes_estoque', 'INSERT'], ['movimentacoes_estoque', 'SELECT'], ['auditoria', 'INSERT']]) {
    assert.equal(await pode(tabela, privilegio), true, `${tabela}: ${privilegio} deve ser permitido`);
  }
  for (const [tabela, privilegio] of [['movimentacoes_estoque', 'UPDATE'], ['movimentacoes_estoque', 'DELETE'], ['movimentacoes_estoque', 'TRUNCATE'], ['auditoria', 'UPDATE'], ['auditoria', 'DELETE'], ['auditoria', 'TRUNCATE']]) {
    assert.equal(await pode(tabela, privilegio), false, `${tabela}: ${privilegio} deve ser negado`);
  }
  assert.equal((await pg.query("SELECT has_table_privilege('public', 'produtos', 'SELECT') AS v")).rows[0].v, false, 'ninguém além do app_wms lê as tabelas');

  // uma tabela criada numa migration futura já nasce com as permissões do app (e a segurança, rodando de novo, mantém o livro-razão travado)
  await pg.exec('CREATE TABLE tabela_futura (id SERIAL PRIMARY KEY, x TEXT)');
  await pg.exec(seguranca);
  assert.equal(await pode('tabela_futura', 'UPDATE'), true);
  assert.equal(await pode('movimentacoes_estoque', 'UPDATE'), false);
  await pg.close();
});

test('scripts de instalação: sintaxe do bash válida e quebra de linha LF (CRLF quebraria no Linux)', (t) => {
  const arquivos = fs.readdirSync(VPS).filter((f) => f.endsWith('.sh'));
  assert.ok(arquivos.length >= 5, 'instalar, atualizar, aplicar-esquema, migrar-dados-supabase e backup-pg');
  const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  for (const f of arquivos) {
    const caminho = path.join(VPS, f);
    assert.ok(!fs.readFileSync(caminho, 'utf8').includes('\r'), `${f} tem CRLF`);
    if (bash.status !== 0) continue;
    const r = spawnSync('bash', ['-n', caminho], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  if (bash.status !== 0) t.diagnostic('bash não encontrado: só a quebra de linha foi conferida');
});

test('scripts de instalação: a senha do banco é gerada na VPS (nunca escrita no script) e a migração lê a Supabase sem mostrar a URL', () => {
  const instalar = fs.readFileSync(path.join(VPS, 'instalar.sh'), 'utf8');
  assert.ok(instalar.includes('openssl rand -hex 24'), 'a senha do banco é gerada na VPS');
  assert.ok(!/postgresql:\/\/app_wms:[^$\s]/.test(instalar), 'nenhuma senha fixa no instalar.sh');
  const migrar = fs.readFileSync(path.join(VPS, 'migrar-dados-supabase.sh'), 'utf8');
  assert.ok(migrar.includes('read -rs ORIGEM'), 'a URL da Supabase é digitada sem aparecer na tela');
  assert.ok(migrar.includes('--data-only') && migrar.includes('--enable-row-security'), 'só copia dados, respeitando a segurança da origem');
  assert.ok(!/psql "\$ORIGEM"[^\n]*(INSERT|UPDATE|DELETE|DROP|TRUNCATE)/i.test(migrar), 'nada é escrito na Supabase');
});

test('npm run verificar-dados: confere saldo x livro-razão e a cadeia de auditoria e confirma que está tudo íntegro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-vd-'));
  const hex = () => crypto.randomBytes(32).toString('hex');
  const env = { ...process.env, NODE_ENV: 'development', DB_PATH: path.join(dir, 't.db'), DATABASE_URL: '', PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex(), SCRYPT_N: '1024', ADMIN_LOGIN: '52998224725', ADMIN_INITIAL_PASSWORD: 'Inicial-Teste-9x!Kq' };
  const rodar = (arq) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', arq], { cwd: ROOT, env, encoding: 'utf8' });
  try {
    assert.equal(rodar('scripts/criar-admin.js').status, 0);
    const ok = rodar('scripts/verificar-dados.js');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Estoque: OK/); assert.match(ok.stdout, /Auditoria: OK/); assert.match(ok.stdout, /Integridade OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instalar.sh: o firewall libera a porta do SSH em uso (a HostGator usa 22022), senão o servidor tranca você para fora', () => {
  const instalar = fs.readFileSync(path.join(VPS, 'instalar.sh'), 'utf8');
  assert.ok(!/ufw allow OpenSSH/.test(instalar), 'OpenSSH liberaria só a porta 22');
  assert.ok(instalar.includes('ss -H -tlnp') && instalar.includes('SSH_PORTAS'), 'detecta a porta do sshd');
  assert.ok(instalar.indexOf('SSH_PORTAS') < instalar.indexOf('ufw --force enable'), 'a porta é liberada antes de ligar o firewall');
});

test('aplicar-esquema.sh: o usuario postgres nao le /opt/wms, entao o arquivo de seguranca entra por stdin (nunca psql -f)', () => {
  const s = fs.readFileSync(path.join(VPS, 'aplicar-esquema.sh'), 'utf8').replace(/#.*$/gm, '');
  assert.ok(!/\s-f\s/.test(s), 'nada de -f: o postgres nao consegue abrir arquivos em /opt/wms');
  assert.ok(s.includes('pg < "$APP/deploy/vps/postgres-seguranca.sql"'), 'o root le o arquivo e entrega por stdin');
});

test('instalar.sh: EMAIL_DE é opcional e nunca pode nascer como PREENCHER (viraria o remetente dos e-mails de login)', () => {
  const instalar = fs.readFileSync(path.join(VPS, 'instalar.sh'), 'utf8');
  assert.ok(!instalar.includes('EMAIL_DE=PREENCHER'));
});

test('definir-segredo.sh: grava o valor exato (com caracteres especiais), preserva as outras linhas e recusa valores errados', (t) => {
  const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  if (bash.status !== 0) return t.skip('bash não encontrado');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-seg-'));
  const arq = path.join(dir, '.env');
  const rodar = (nome, entrada) => spawnSync('bash', [path.join(VPS, 'definir-segredo.sh'), nome], { input: entrada, encoding: 'utf8', env: { ...process.env, ENV_ARQ: arq } });
  try {
    fs.writeFileSync(arq, 'NODE_ENV=production\nPEPPER=PREENCHER\nSMTP_PASS=PREENCHER\nAPP_NAME=FRIO Peças e Serviços\n');
    const especial = 'a&b|c\d=e/f "x" $HOME';
    assert.equal(rodar('SMTP_PASS', `${especial}  \n`).status, 0);
    const chave = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
    assert.equal(rodar('PEPPER', `${chave}\n`).status, 0);
    const linhas = fs.readFileSync(arq, 'utf8').split('\n');
    assert.ok(linhas.includes(`SMTP_PASS=${especial}`), 'valor idêntico, sem escapes');
    assert.ok(linhas.includes(`PEPPER=${chave}`));
    assert.ok(linhas.includes('NODE_ENV=production') && linhas.includes('APP_NAME=FRIO Peças e Serviços'), 'as outras linhas ficam como estavam');
    const antes = fs.readFileSync(arq, 'utf8');
    assert.notEqual(rodar('PEPPER', 'curta\n').status, 0, 'chave curta demais é recusada');
    assert.notEqual(rodar('SMTP_USER', 'nao-e-email\n').status, 0);
    assert.notEqual(rodar('OUTRA', 'x\n').status, 0, 'só nomes conhecidos');
    assert.equal(fs.readFileSync(arq, 'utf8'), antes, 'recusar não altera o arquivo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
