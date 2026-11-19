-- Fase 1: acesso seguro (usuário único), sessões, auditoria encadeada, idempotência.

CREATE TABLE users (
  id                 INTEGER PRIMARY KEY,
  login_hmac         TEXT NOT NULL UNIQUE,           -- o login de 11 dígitos nunca é guardado em claro
  senha_hash         TEXT NOT NULL,                  -- scrypt + pepper
  papel              TEXT NOT NULL DEFAULT 'admin',
  nome               TEXT NOT NULL DEFAULT 'Administrador',
  trocar_senha       INTEGER NOT NULL DEFAULT 1,
  mfa_ativo          INTEGER NOT NULL DEFAULT 0,
  mfa_segredo_enc    TEXT,                           -- AES-256-GCM
  mfa_pendente_enc   TEXT,                           -- segredo durante a inscrição
  mfa_ultimo_passo   INTEGER NOT NULL DEFAULT 0,     -- anti-replay do TOTP
  mfa_falhas         INTEGER NOT NULL DEFAULT 0,
  ativo              INTEGER NOT NULL DEFAULT 1,
  criado_em          INTEGER NOT NULL,
  senha_alterada_em  INTEGER
);
-- Modo usuário único: índice sobre expressão constante impede uma segunda linha.
CREATE UNIQUE INDEX idx_users_unico ON users((1));

CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,                  -- só o hash do token vai ao banco
  estagio     TEXT NOT NULL CHECK (estagio IN ('TROCAR_SENHA','MFA_INSCREVER','MFA_VERIFICAR','COMPLETA')),
  criado_em   INTEGER NOT NULL,
  ultimo_uso  INTEGER NOT NULL,
  expira_abs  INTEGER NOT NULL,
  reauth_em   INTEGER,
  ip          TEXT,
  user_agent  TEXT,
  revogada_em INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revogada_em IS NULL;

CREATE TABLE recovery_codes (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  codigo_hmac TEXT NOT NULL UNIQUE,
  usado_em    INTEGER
);

-- Bloqueio progressivo por chave (HMAC do login digitado, exista ou não: não revela se o login existe).
CREATE TABLE login_tentativas (
  chave_hmac    TEXT PRIMARY KEY,
  falhas        INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL
);

-- Auditoria só-inserção, encadeada por hash.
CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  user_id     INTEGER,
  acao        TEXT NOT NULL,
  entidade    TEXT,
  entidade_id TEXT,
  detalhes    TEXT,
  ip          TEXT,
  hash_prev   TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE INDEX idx_auditoria_ts ON auditoria(ts);
CREATE TRIGGER trg_auditoria_no_update BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'auditoria e somente insercao'); END;
CREATE TRIGGER trg_auditoria_no_delete BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'auditoria e somente insercao'); END;

-- Chaves de idempotência (duplo clique / reenvio nunca duplica uma operação).
CREATE TABLE idempotencia (
  chave      TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  rota       TEXT NOT NULL,
  corpo_hash TEXT NOT NULL,
  status     INTEGER NOT NULL,
  resposta   TEXT NOT NULL,
  criado_em  INTEGER NOT NULL,
  PRIMARY KEY (chave, user_id, rota)
);

CREATE TABLE sequencias (
  nome  TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);
