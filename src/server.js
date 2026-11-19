import { loadConfig } from './config.js';
import { criarLogger } from './log.js';
import { abrirBanco, migrar } from './db.js';
import { criarApp } from './http/app.js';
import { registrarAcesso } from './modules/acesso.js';
import { registrarCatalogo } from './modules/catalogo.js';
import { registrarDeposito, garantirDeposito } from './modules/deposito.js';
import { registrarEstoque } from './modules/estoque.js';
import { registrarInventario } from './modules/inventario.js';
import { registrarConsultas } from './modules/consultas.js';
import { fileURLToPath } from 'node:url';

/** Monta o sistema inteiro (usado pelo servidor e pelos testes). */
export function montar(cfg, { log = criarLogger({ nivel: cfg.logLevel }), db = null } = {}) {
  const banco = db ?? abrirBanco(cfg.dbPath);
  migrar(banco, cfg.migrationsDir);
  garantirDeposito(banco, cfg.agora());
  const app = criarApp({ cfg, db: banco, log });
  const deps = { cfg, db: banco, log };
  registrarAcesso(app, deps);
  registrarCatalogo(app, deps);
  registrarDeposito(app, deps);
  registrarEstoque(app, deps);
  registrarInventario(app, deps);
  registrarConsultas(app, deps);

  // Limpeza periódica: sessões vencidas, idempotência antiga, tentativas de login esquecidas.
  const faxina = setInterval(() => {
    const t = cfg.agora();
    banco.prepare('DELETE FROM sessions WHERE revogada_em IS NOT NULL AND revogada_em < ? OR expira_abs < ?').run(t - 7 * 86400_000, t - 86400_000);
    banco.prepare('DELETE FROM idempotencia WHERE criado_em < ?').run(t - 2 * 86400_000);
    banco.prepare('DELETE FROM login_tentativas WHERE atualizado_em < ? AND bloqueado_ate < ?').run(t - 86400_000, t);
  }, 10 * 60_000);
  faxina.unref();
  return { app, db: banco, log, parar: async () => { clearInterval(faxina); await app.fechar(); banco.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const log = criarLogger({ nivel: cfg.logLevel });
  const sistema = montar(cfg, { log });
  sistema.app.server.listen(cfg.port, cfg.host, () => log.info('servidor no ar', { url: `http://${cfg.host}:${cfg.port}`, ambiente: cfg.prod ? 'producao' : 'desenvolvimento' }));
  const sair = async () => { log.info('encerrando'); await sistema.parar(); process.exit(0); };
  process.on('SIGINT', sair);
  process.on('SIGTERM', sair);
}
