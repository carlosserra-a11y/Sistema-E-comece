-- Cadastro por e-mail com código de confirmação (substitui a verificação em duas etapas por aplicativo autenticador).
-- O e-mail fica cifrado (AES-256-GCM); a busca usa um HMAC do e-mail "canônico" (Gmail ignora pontos e +etiqueta).
-- Contas criadas pelo dono (login de 11 dígitos) continuam existindo: o e-mail delas é opcional e pode ser vinculado depois.
ALTER TABLE users ADD COLUMN email_enc TEXT;
ALTER TABLE users ADD COLUMN email_hmac TEXT;
ALTER TABLE users ADD COLUMN email_verificado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN cod_hash TEXT;                    -- HMAC do código de 6 dígitos (nunca o código)
ALTER TABLE users ADD COLUMN cod_expira BIGINT;
ALTER TABLE users ADD COLUMN cod_tentativas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN cod_enviado_em BIGINT;
ALTER TABLE users ADD COLUMN cod_envios INTEGER NOT NULL DEFAULT 0;   -- envios na janela atual (limite por hora)
ALTER TABLE users ADD COLUMN cod_envios_desde BIGINT;
ALTER TABLE users ADD COLUMN email_novo_enc TEXT;              -- e-mail aguardando confirmação (vincular e-mail a uma conta existente)
ALTER TABLE users ADD COLUMN email_novo_hmac TEXT;
CREATE UNIQUE INDEX idx_users_email ON users(email_hmac) WHERE email_hmac IS NOT NULL;
CREATE INDEX idx_users_nao_verificados ON users(criado_em) WHERE email_verificado = 0 AND papel = 'pendente';
