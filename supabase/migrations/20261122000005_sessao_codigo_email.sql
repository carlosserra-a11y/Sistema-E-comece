-- Nova etapa de sessão: CODIGO_EMAIL (a senha já foi aceita e falta digitar o código enviado ao e-mail da conta).
-- As etapas antigas continuam aceitas para não derrubar quem está logado no momento da troca.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_estagio_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_estagio_check CHECK (estagio IN ('TROCAR_SENHA','MFA_INSCREVER','MFA_VERIFICAR','CODIGO_EMAIL','COMPLETA'));
