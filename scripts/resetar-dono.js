// EMERGÊNCIA: o dono perdeu a senha, o celular do autenticador e os códigos de recuperação.
// Gera uma NOVA senha provisória para a conta do dono, zera o autenticador e derruba as sessões. No próximo acesso o sistema obriga
// a trocar a senha e cadastrar o autenticador de novo. Só funciona para quem tem as variáveis de produção (DATABASE_URL, PEPPER, HMAC_KEY, FIELD_KEY).
// Uso:  npm run resetar-dono
import { loadConfig } from '../src/config.js';
import { abrirBanco, tx } from '../src/db.js';
import { hashSenha } from '../src/security/password.js';
import { auditar } from '../src/security/audit.js';
import { senhaProvisoria } from '../src/modules/equipe.js';

const cfg = loadConfig();
const db = await abrirBanco(cfg);
try {
  const dono = await db.get('SELECT id FROM users WHERE dono = 1');
  if (!dono) { console.error('Não existe conta de dono neste banco. Use: npm run criar-admin'); process.exitCode = 1; } else {
    const senha = senhaProvisoria();
    const hash = await hashSenha(cfg, senha);
    await tx(db, async (db) => {
      await db.run('UPDATE users SET senha_hash = ?, trocar_senha = 1, senha_alterada_em = ?, mfa_ativo = 0, mfa_segredo_enc = NULL, mfa_pendente_enc = NULL, mfa_ultimo_passo = 0, mfa_falhas = 0, ativo = 1 WHERE id = ?', hash, cfg.agora(), dono.id);
      await db.run('DELETE FROM recovery_codes WHERE user_id = ?', dono.id);
      await db.run('UPDATE sessions SET revogada_em = ? WHERE user_id = ? AND revogada_em IS NULL', cfg.agora(), dono.id);
      await db.run('DELETE FROM login_tentativas');
      await auditar(db, { agora: cfg.agora, user: { id: dono.id }, ip: 'script:resetar-dono' }, 'DONO_RESETADO', 'user', dono.id);
    });
    console.log('Conta do dono redefinida.');
    console.log(`Nova senha provisória (use uma vez, o sistema pede a troca): ${senha}`);
    console.log('O login (11 dígitos) continua o mesmo. O autenticador será cadastrado de novo no próximo acesso.');
  }
} finally { await db.fechar(); }
