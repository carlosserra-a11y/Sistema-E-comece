-- Equipe e permissões: o sistema deixa de ser "usuário único". Existe UM dono (conta de desenvolvedor, todas as funções)
-- e quantas pessoas ele autorizar, cada uma com a lista de permissões que o dono escolher.
DROP INDEX IF EXISTS idx_users_unico;
ALTER TABLE users ADD COLUMN dono INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN permissoes TEXT NOT NULL DEFAULT '[]';   -- JSON: lista de permissões (ver src/permissoes.js)
ALTER TABLE users ADD COLUMN login_enc TEXT;                          -- login de 11 dígitos cifrado (AES-256-GCM): só o dono pode rever
ALTER TABLE users ADD COLUMN criado_por INTEGER REFERENCES users(id);
UPDATE users SET dono = 1 WHERE papel = 'admin';
CREATE UNIQUE INDEX idx_users_dono ON users(dono) WHERE dono = 1;      -- só pode existir um dono
