// Cria o usuário único a partir de ADMIN_LOGIN / ADMIN_INITIAL_PASSWORD (.env). Grava apenas hashes.
import { loadConfig } from '../src/config.js';
import { abrirBanco, migrar } from '../src/db.js';
import { garantirDeposito } from '../src/modules/deposito.js';
import { chaveLogin } from '../src/modules/acesso.js';
import { hashSenha, validarPolitica } from '../src/security/password.js';

const cfg = loadConfig();
const login = cfg.adminLogin.replace(/\D/g, '');
if (!/^\d{11}$/.test(login)) { console.error('ADMIN_LOGIN precisa ter exatamente 11 dígitos (no .env).'); process.exit(1); }
if (!cfg.adminSenha) { console.error('ADMIN_INITIAL_PASSWORD ausente (no .env).'); process.exit(1); }

const problemas = validarPolitica(cfg.adminSenha, { login });
if (problemas.length && cfg.prod) { console.error('Em produção a senha inicial precisa seguir a política:\n- ' + problemas.join('\n- ')); process.exit(1); }
if (problemas.length) console.warn('Aviso (desenvolvimento): a senha inicial é fraca. A troca será obrigatória no primeiro acesso.');

const db = abrirBanco(cfg.dbPath);
migrar(db, cfg.migrationsDir);
garantirDeposito(db, cfg.agora());
if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) { console.log('O usuário único já existe: nada foi alterado.'); db.close(); process.exit(0); }

db.prepare('INSERT INTO users (login_hmac, senha_hash, trocar_senha, criado_em) VALUES (?, ?, 1, ?)')
  .run(chaveLogin(cfg, login), await hashSenha(cfg, cfg.adminSenha), cfg.agora());
db.close();
console.log('Usuário criado. No primeiro acesso: trocar a senha e ativar o MFA. Apague ADMIN_LOGIN e ADMIN_INITIAL_PASSWORD do .env.');
