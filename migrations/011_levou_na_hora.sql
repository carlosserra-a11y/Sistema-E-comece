-- "Cliente levou na hora": a expedição fica registrada num passo só, marcado aqui (sem separação nem conferência).
-- Manter igual a supabase/migrations/20261126000012_levou_na_hora.sql.
ALTER TABLE etapas ADD COLUMN na_hora INTEGER NOT NULL DEFAULT 0 CHECK (na_hora IN (0, 1));
