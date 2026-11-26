-- Rastreio da venda (quem separou, conferiu e expediu; só se insere) e exclusão de contas da equipe.
-- Manter igual a supabase/migrations/20261126000010_etapas.sql.
CREATE TABLE etapas (
  id         INTEGER PRIMARY KEY,
  venda_id   INTEGER NOT NULL REFERENCES vendas(id),
  etapa      TEXT NOT NULL CHECK (etapa IN ('SEPARACAO','CONFERENCIA','EXPEDICAO')),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  ts         INTEGER NOT NULL,
  observacao TEXT,
  UNIQUE (venda_id, etapa)
);
CREATE INDEX idx_etapas_ts ON etapas(ts);
CREATE INDEX idx_etapas_user ON etapas(user_id);
CREATE TRIGGER trg_etapas_no_update BEFORE UPDATE ON etapas BEGIN SELECT RAISE(ABORT, 'registro de etapa e imutavel'); END;
CREATE TRIGGER trg_etapas_no_delete BEFORE DELETE ON etapas BEGIN SELECT RAISE(ABORT, 'registro de etapa e imutavel'); END;

-- Conta excluída: some da equipe e perde o acesso; o nome fica para o histórico.
ALTER TABLE users ADD COLUMN excluido_em INTEGER;
