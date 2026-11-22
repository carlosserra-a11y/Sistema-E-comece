// Backup e restauração do banco inteiro (SQLite ou PostgreSQL). O backup é UM arquivo: todas as tabelas em JSON, comprimido (gzip) e,
// se houver senha (BACKUP_SENHA), cifrado com AES-256-GCM (chave derivada por scrypt). Ele contém dados sensíveis (hashes de senha, campos
// cifrados, dados da empresa): guarde fora do computador/servidor e use sempre a senha. A restauração é só para um SQLite VAZIO (abrir seus
// dados numa máquina nova ou provar que o backup funciona); em produção, o backup automático do provedor (Supabase Pro) é o caminho.
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { tx } from './db.js';

export const FORMATO = 'armazem-backup-v1';
const MAGICO = Buffer.from('ARMBK1\0');
/** Tabelas que só guardam estado do momento (sessões, bloqueios, chaves de repetição): ficam de fora do backup. */
const TRANSITORIAS = new Set(['sessions', 'login_tentativas', 'idempotencia', 'oauth_estados', 'schema_migrations', 'sqlite_sequence']);
const aspas = (nome) => `"${String(nome).replace(/"/g, '""')}"`;

export async function listarTabelas(db) {
  const linhas = db.dialeto === 'pg'
    ? await db.all("SELECT tablename AS nome FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
    : await db.all("SELECT name AS nome FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY 1");
  return linhas.map((l) => l.nome).filter((n) => !TRANSITORIAS.has(n));
}

async function colunasDe(db, tabela) {
  if (db.dialeto === 'pg') return (await db.all('SELECT column_name AS nome FROM information_schema.columns WHERE table_schema = \'public\' AND table_name = ? ORDER BY ordinal_position', tabela)).map((c) => c.nome);
  return (await db.all(`PRAGMA table_info(${aspas(tabela)})`)).map((c) => c.name);
}

/** Lê todas as tabelas. No PostgreSQL usa uma transação de leitura com "foto" única, para as tabelas combinarem entre si. */
export async function exportar(db) {
  const ler = async (conn) => {
    const tabelas = {};
    for (const nome of await listarTabelas(conn)) {
      const colunas = await colunasDe(conn, nome);
      const linhas = await conn.all(`SELECT * FROM ${aspas(nome)} ORDER BY 1`);
      tabelas[nome] = { colunas, linhas: linhas.map((l) => colunas.map((c) => l[c] ?? null)) };
    }
    return tabelas;
  };
  const tabelas = db.dialeto === 'pg'
    ? await tx(db, async (conn) => { await conn.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); return await ler(conn); })
    : await ler(db);
  return { formato: FORMATO, criado_em: new Date().toISOString(), dialeto: db.dialeto, tabelas };
}

const substituto = (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v);
const revivente = (_k, v) => (v && typeof v === 'object' && typeof v.$b64 === 'string' && Object.keys(v).length === 1 ? Buffer.from(v.$b64, 'base64') : v);
const chaveDe = (senha, sal) => crypto.scryptSync(String(senha), sal, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

/** Dados -> arquivo (Buffer). Com `senha`, cifra; sem senha, só comprime. */
export function serializar(dados, senha = '') {
  const comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(dados, substituto), 'utf8'), { level: 9 });
  if (!senha) return comprimido;
  const sal = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chaveDe(senha, sal), iv);
  const miolo = Buffer.concat([cifra.update(comprimido), cifra.final()]);
  return Buffer.concat([MAGICO, sal, iv, cifra.getAuthTag(), miolo]);
}

/** Arquivo (Buffer) -> dados. Descobre sozinho se está cifrado; com senha errada ou arquivo adulterado, lança erro. */
export function ler(buffer, senha = '') {
  let corpo = buffer;
  if (buffer.subarray(0, MAGICO.length).equals(MAGICO)) {
    if (!senha) throw new Error('Este backup é cifrado: informe a senha (BACKUP_SENHA).');
    const sal = buffer.subarray(7, 23); const iv = buffer.subarray(23, 35); const tag = buffer.subarray(35, 51);
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', chaveDe(senha, sal), iv); d.setAuthTag(tag);
      corpo = Buffer.concat([d.update(buffer.subarray(51)), d.final()]);
    } catch { throw new Error('Senha errada ou arquivo de backup danificado.'); }
  }
  let dados;
  try { dados = JSON.parse(zlib.gunzipSync(corpo).toString('utf8'), revivente); } catch { throw new Error('Arquivo de backup ilegível (não é um backup deste sistema ou está corrompido).'); }
  if (dados?.formato !== FORMATO) throw new Error(`Formato de backup desconhecido: ${dados?.formato ?? '(nenhum)'}.`);
  return dados;
}

/** Confere a estrutura do backup e devolve um resumo. */
export function verificar(dados) {
  const problemas = []; let linhas = 0;
  const resumo = Object.entries(dados.tabelas ?? {}).map(([nome, t]) => {
    if (!Array.isArray(t.colunas) || !Array.isArray(t.linhas)) { problemas.push(`${nome}: estrutura inválida`); return { nome, linhas: 0 }; }
    for (const [i, l] of t.linhas.entries()) if (l.length !== t.colunas.length) { problemas.push(`${nome}: linha ${i + 1} com ${l.length} colunas (esperado ${t.colunas.length})`); break; }
    linhas += t.linhas.length;
    return { nome, linhas: t.linhas.length };
  });
  return { ok: problemas.length === 0 && resumo.length > 0, tabelas: resumo.length, linhas, resumo, problemas, criado_em: dados.criado_em, dialeto: dados.dialeto };
}

/**
 * Restaura num SQLite VAZIO (esquema já criado pelas migrations). Tudo numa transação: se algo falhar, nada é gravado.
 * Ordem: o livro-razão entra primeiro (os gatilhos recalculam os saldos) e os saldos gravados depois, por cima.
 */
export async function restaurar(db, dados) {
  if (db.dialeto !== 'sqlite') throw new Error('A restauração por arquivo é só para SQLite. Em produção (PostgreSQL) use o backup do provedor.');
  const v = verificar(dados);
  if (!v.ok) throw new Error(`Backup inválido: ${v.problemas[0] ?? 'sem tabelas'}`);
  for (const t of ['users', 'produtos', 'movimentacoes_estoque', 'auditoria']) {
    if ((await db.get(`SELECT COUNT(*) c FROM ${t}`)).c > 0) throw new Error(`O banco de destino não está vazio (${t} tem registros). Restaure num banco novo.`);
  }
  const existentes = new Set(await listarTabelas(db));
  const nomes = Object.keys(dados.tabelas).filter((n) => existentes.has(n));
  const ordem = [...nomes.filter((n) => n !== 'saldos_por_endereco'), ...nomes.filter((n) => n === 'saldos_por_endereco')];
  await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await tx(db, async (conn) => {
      for (const nome of ordem) {
        const { colunas, linhas } = dados.tabelas[nome];
        // as migrations já semeiam algumas tabelas (ex.: canais): o backup é a fonte da verdade, então a semente é trocada por ele
        if ((await conn.get(`SELECT COUNT(*) c FROM ${aspas(nome)}`)).c > 0) await conn.run(`DELETE FROM ${aspas(nome)}`);
        if (!linhas.length) continue;
        const cols = colunas.map(aspas).join(',');
        const verbo = nome === 'saldos_por_endereco' ? 'INSERT OR REPLACE' : 'INSERT'; // sem OR IGNORE: se algo não entrar, a restauração inteira é desfeita
        for (const l of linhas) await conn.run(`${verbo} INTO ${aspas(nome)} (${cols}) VALUES (${colunas.map(() => '?').join(',')})`, ...l);
      }
      for (const nome of ordem) {
        const esperado = dados.tabelas[nome].linhas.length;
        const gravado = (await conn.get(`SELECT COUNT(*) c FROM ${aspas(nome)}`)).c;
        if (gravado !== esperado) throw new Error(`Restauração desfeita: ${nome} ficou com ${gravado} registro(s), o backup tem ${esperado}.`);
      }
      const quebras = await conn.all('PRAGMA foreign_key_check');
      if (quebras.length) throw new Error(`Restauração desfeita: ${quebras.length} vínculo(s) quebrado(s) (ex.: ${quebras[0].table}).`);
    });
  } finally { await db.exec('PRAGMA foreign_keys = ON'); }
  const contagens = {};
  for (const n of nomes) contagens[n] = (await db.get(`SELECT COUNT(*) c FROM ${aspas(n)}`)).c;
  return { tabelas: nomes.length, contagens };
}
