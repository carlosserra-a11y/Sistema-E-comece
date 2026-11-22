-- Nova etapa de sessão: CODIGO_EMAIL (a senha já foi aceita e falta digitar o código enviado ao e-mail da conta).
-- O SQLite não altera CHECK: recria a tabela copiando as sessões (as etapas antigas continuam aceitas para não derrubar quem está logado).
ALTER TABLE sessions RENAME TO sessions_antiga;
DROP INDEX IF EXISTS idx_sessions_user;
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,                  -- só o hash do token vai ao banco
  estagio     TEXT NOT NULL CHECK (estagio IN ('TROCAR_SENHA','MFA_INSCREVER','MFA_VERIFICAR','CODIGO_EMAIL','COMPLETA')),
  criado_em   INTEGER NOT NULL,
  ultimo_uso  INTEGER NOT NULL,
  expira_abs  INTEGER NOT NULL,
  reauth_em   INTEGER,
  ip          TEXT,
  user_agent  TEXT,
  revogada_em INTEGER
);
INSERT INTO sessions (id, user_id, token_hash, estagio, criado_em, ultimo_uso, expira_abs, reauth_em, ip, user_agent, revogada_em)
  SELECT id, user_id, token_hash, estagio, criado_em, ultimo_uso, expira_abs, reauth_em, ip, user_agent, revogada_em FROM sessions_antiga;
DROP TABLE sessions_antiga;
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revogada_em IS NULL;
