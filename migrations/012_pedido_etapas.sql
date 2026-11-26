-- Rastreio dos pedidos da internet (quem separou, conferiu e expediu; só se insere).
-- Manter igual a supabase/migrations/20261126000013_pedido_etapas.sql.
CREATE TABLE pedido_etapas (
  id         INTEGER PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
  etapa      TEXT NOT NULL CHECK (etapa IN ('SEPARACAO','CONFERENCIA','EXPEDICAO')),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  ts         INTEGER NOT NULL,
  observacao TEXT,
  UNIQUE (pedido_id, etapa)
);
CREATE INDEX idx_pedido_etapas_ts ON pedido_etapas(ts);
CREATE INDEX idx_pedido_etapas_user ON pedido_etapas(user_id);
CREATE TRIGGER trg_pedido_etapas_no_update BEFORE UPDATE ON pedido_etapas BEGIN SELECT RAISE(ABORT, 'registro de etapa e imutavel'); END;
CREATE TRIGGER trg_pedido_etapas_no_delete BEFORE DELETE ON pedido_etapas BEGIN SELECT RAISE(ABORT, 'registro de etapa e imutavel'); END;
