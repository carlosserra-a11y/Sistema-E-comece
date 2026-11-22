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
import { registrarPedidos } from './modules/pedidos.js';
import { registrarIntegracoes } from './modules/integracoes.js';
import { registrarEquipe } from './modules/equipe.js';
import { registrarCadastro } from './modules/cadastro.js';
import { criarEmail } from './email.js';
import { fileURLToPath } from 'node:url';
import { iguais } from './security/crypto.js';
import { erro } from './util.js';

/** Monta o sistema inteiro (usado pelo servidor e pelos testes). */
export async function montar(cfg, { log = criarLogger({ nivel: cfg.logLevel }), db = null } = {}) {
  const banco = db ?? await abrirBanco(cfg);
  await migrar(banco, cfg.migrationsDir);
  await garantirDeposito(banco, cfg.agora());
  const app = criarApp({ cfg, db: banco, log });
  const email = criarEmail(cfg);
  const deps = { cfg, db: banco, log, email };
  registrarAcesso(app, deps);
  registrarCatalogo(app, deps);
  registrarDeposito(app, deps);
  registrarEstoque(app, deps);
  registrarInventario(app, deps);
  registrarConsultas(app, deps);
  registrarPedidos(app, deps);
  registrarEquipe(app, deps);
  registrarCadastro(app, deps);
  const integracoes = await registrarIntegracoes(app, deps);

  // Limpeza: sessões vencidas, idempotência antiga, tentativas de login esquecidas. Roda a cada 10 min (servidor fixo) ou pelo cron (Vercel).
  const limpar = async () => {
    try {
      const t = cfg.agora();
      await banco.run('DELETE FROM sessions WHERE revogada_em IS NOT NULL AND revogada_em < ? OR expira_abs < ?', t - 7 * 86400_000, t - 86400_000);
      await banco.run('DELETE FROM idempotencia WHERE criado_em < ?', t - 2 * 86400_000);
      await banco.run('DELETE FROM login_tentativas WHERE atualizado_em < ? AND bloqueado_ate < ?', t - 86400_000, t);
      await banco.run("DELETE FROM users WHERE papel = 'pendente' AND dono = 0 AND email_verificado = 0 AND criado_em < ?", t - 86400_000); // cadastro que ninguém confirmou em 24 h
    } catch { /* tenta de novo no próximo ciclo */ }
  };
  const faxina = setInterval(limpar, 10 * 60_000);
  faxina.unref();

  // Manutenção chamada pelo cron da Vercel (Authorization: Bearer CRON_SECRET): faxina + reconciliação com o Mercado Livre.
  const segredoCron = process.env.CRON_SECRET || '';
  app.rota('GET', '/api/cron/manutencao', { auth: 'publica', externa: true }, async (ctx) => {
    const enviado = String(ctx.req.headers.authorization ?? '');
    if (!segredoCron || !iguais(enviado, `Bearer ${segredoCron}`)) throw erro(401, 'CRON', 'Não autorizado.');
    await limpar();
    const ml = { pedidos: await integracoes.sincronizarPedidos('POLLING').catch((e) => ({ erro: e.message })), estoque: await integracoes.sincronizarEstoque('POLLING').catch((e) => ({ erro: e.message })) };
    await integracoes.drenar();
    return { ok: true, ml };
  });
  return { app, db: banco, log, integracoes, email, limpar, parar: async () => { clearInterval(faxina); await integracoes.drenar().catch(() => {}); await app.fechar(); await banco.fechar(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const log = criarLogger({ nivel: cfg.logLevel });
  const sistema = await montar(cfg, { log });
  sistema.integracoes.iniciarAgendador(); // polling de reconciliação (a cada ML_POLL_MIN minutos; 0 desliga)
  sistema.app.server.listen(cfg.port, cfg.host, () => log.info('servidor no ar', { url: `http://${cfg.host}:${cfg.port}`, ambiente: cfg.prod ? 'producao' : 'desenvolvimento' }));
  const sair = async () => { log.info('encerrando'); await sistema.parar(); process.exit(0); };
  process.on('SIGINT', sair);
  process.on('SIGTERM', sair);
}
