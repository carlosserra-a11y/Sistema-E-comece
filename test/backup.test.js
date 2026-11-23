// Backup completo: arquivo único, cifrado, verificável e restaurável (saldo, livro-razão e cadeia de auditoria voltam idênticos).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { criarSistema, entrarCompleto, novoProduto, criarEnderecos } from './helpers.js';
import { exportar, serializar, ler, verificar, restaurar } from '../src/backup.js';
import { abrirBanco, migrar } from '../src/db.js';
import { ROOT } from '../src/config.js';
import { integridade } from '../src/modules/estoque.js';
import { verificarCadeia } from '../src/security/audit.js';

async function com(fn) {
  const sis = await criarSistema();
  try { await fn(sis); } finally { await sis.parar(); }
}
/** Sistema com um produto de nome reconhecível, estoque recebido e uma baixa (para o livro-razão ter mais de uma linha). */
async function popular(sis) {
  const c = await entrarCompleto(sis);
  const p = await novoProduto(c, { nome: 'Produto Segredo Backup' });
  const [e1] = await criarEnderecos(c, 'PICKING');
  assert.equal((await c.idem('/api/estoque/receber', { produto_id: p.id, endereco_id: e1.id, qtd: 12 })).status, 201);
  assert.equal((await c.idem('/api/estoque/baixar', { produto_id: p.id, endereco_id: e1.id, qtd: 5, motivo: 'Venda de teste' })).status, 201);
  return { c, p, e1 };
}
const bancoNovo = async () => {
  const db = await abrirBanco({ dbPath: ':memory:' });
  await migrar(db, path.join(ROOT, 'migrations'));
  return db;
};

test('backup: exporta tudo, cifra com senha, detecta senha errada e arquivo adulterado; sessões ficam de fora', async () => await com(async (sis) => {
  await popular(sis);
  const dados = await exportar(sis.db);
  assert.ok(dados.tabelas.produtos && dados.tabelas.movimentacoes_estoque && dados.tabelas.users && dados.tabelas.auditoria);
  assert.ok(!dados.tabelas.sessions && !dados.tabelas.login_tentativas && !dados.tabelas.idempotencia, 'estado transitório não entra no backup');
  const v = verificar(dados);
  assert.equal(v.ok, true); assert.ok(v.linhas > 10);

  const arq = serializar(dados, 'senha-de-teste-123');
  assert.ok(!arq.includes('Produto Segredo Backup'), 'nada legível no arquivo cifrado');
  const volta = ler(arq, 'senha-de-teste-123');
  assert.deepEqual(verificar(volta).resumo, v.resumo);
  assert.throws(() => ler(arq, 'senha-errada'), /Senha errada/);
  assert.throws(() => ler(arq, ''), /cifrado/);
  const adulterado = Buffer.from(arq); adulterado[adulterado.length - 3] ^= 0xff;
  assert.throws(() => ler(adulterado, 'senha-de-teste-123'), /Senha errada ou arquivo/);

  const semSenha = serializar(dados);
  assert.equal(verificar(ler(semSenha)).ok, true, 'sem senha só comprime');
  assert.throws(() => ler(Buffer.from('isto não é um backup')), /ilegível/);
}));

test('restauração: num banco novo os dados voltam idênticos (saldos, livro-razão e cadeia de auditoria)', async () => await com(async (sis) => {
  const { p } = await popular(sis);
  const dados = ler(serializar(await exportar(sis.db), 'senha-x'), 'senha-x');
  const novo = await bancoNovo();
  try {
    const r = await restaurar(novo, dados);
    for (const [nome, t] of Object.entries(dados.tabelas)) assert.equal(r.contagens[nome], t.linhas.length, `${nome}: mesma quantidade de registros`);
    const saldo = async (db) => (await db.get('SELECT COALESCE(SUM(qtd),0) q FROM saldos_por_endereco WHERE produto_id = ?', p.id)).q;
    assert.equal(await saldo(novo), 7); assert.equal(await saldo(novo), await saldo(sis.db));
    assert.equal((await integridade(novo)).ok, true, 'saldo bate com o livro-razão');
    assert.equal((await verificarCadeia(novo)).ok, true, 'a cadeia de hashes da auditoria continua íntegra');
    assert.equal((await novo.get('SELECT nome FROM produtos WHERE id = ?', p.id)).nome, 'Produto Segredo Backup');
    // um banco que já tem dados nunca é sobrescrito
    await assert.rejects(() => restaurar(novo, dados), /não está vazio/);
  } finally { await novo.fechar(); }
  const vazio = await bancoNovo();
  try { await assert.rejects(() => restaurar(vazio, { formato: 'outro', tabelas: {} }), /inválido|desconhecido/); } finally { await vazio.fechar(); }
}));

test('comandos: npm run backup / backup:verificar / restaurar funcionam de ponta a ponta e guardam só os últimos N', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-bk-'));
  const hex = () => crypto.randomBytes(32).toString('hex');
  const base = { ...process.env, NODE_ENV: 'development', DATABASE_URL: '', PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex(), SCRYPT_N: '1024', ADMIN_LOGIN: '52998224725', ADMIN_INITIAL_PASSWORD: 'Inicial-Teste-9x!Kq', BACKUP_SENHA: 'senha-do-backup-teste' };
  const rodar = (arq, args = [], extra = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', arq, ...args], { cwd: ROOT, env: { ...base, DB_PATH: path.join(dir, 'origem.db'), ...extra }, encoding: 'utf8' });
  try {
    assert.equal(rodar('scripts/criar-admin.js').status, 0);
    const pasta = path.join(dir, 'bk');
    fs.mkdirSync(pasta);
    for (const n of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.writeFileSync(path.join(pasta, `armazem-${n}-000000.json.gz.enc`), 'antigo');
    const b = rodar('scripts/backup.js', ['--pasta', pasta, '--manter', '2']);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /CIFRADO/); assert.match(b.stdout, /sha256: [0-9a-f]{64}/);
    const arquivos = fs.readdirSync(pasta).sort();
    assert.equal(arquivos.length, 2, 'só os 2 mais recentes ficam');
    const novo = path.join(pasta, arquivos.at(-1));
    assert.ok(/\.json\.gz\.enc$/.test(novo) && !arquivos.includes('armazem-2020-01-01-000000.json.gz.enc'));

    const ok = rodar('scripts/backup-verificar.js', [novo]);
    assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /OK: o arquivo está íntegro/);
    assert.notEqual(rodar('scripts/backup-verificar.js', [novo], { BACKUP_SENHA: 'errada' }).status, 0, 'senha errada não abre');

    const destino = path.join(dir, 'restaurado.db');
    const r = rodar('scripts/restaurar-backup.js', [novo, '--confirmar'], { DB_PATH: destino });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Restaurado em/);
    assert.notEqual(rodar('scripts/restaurar-backup.js', [novo, '--confirmar'], { DB_PATH: destino }).status, 0, 'não restaura por cima de um banco com dados');
    assert.notEqual(rodar('scripts/restaurar-backup.js', [novo], { DB_PATH: path.join(dir, 'x.db') }).status, 0, 'exige --confirmar');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('npm run backup: recusa a BACKUP_SENHA que ainda é o texto PREENCHER (não cifra com um valor de modelo)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-bkp-'));
  const hex = () => crypto.randomBytes(32).toString('hex');
  const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: '', DB_PATH: path.join(dir, 't.db'), PEPPER: hex(), HMAC_KEY: hex(), FIELD_KEY: hex(), SCRYPT_N: '1024', BACKUP_SENHA: 'PREENCHER' };
  try {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/backup.js', '--pasta', path.join(dir, 'bk')], { cwd: ROOT, env, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /PREENCHER/);
    assert.ok(!fs.existsSync(path.join(dir, 'bk')), 'nenhum arquivo de backup é criado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
