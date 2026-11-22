-- Segurança no PostgreSQL próprio (VPS). É o equivalente de supabase/migrations/*_seguranca_supabase.sql, sem os papéis anon/authenticated
-- (que só existem na Supabase). Idempotente: pode rodar de novo a cada atualização, e deve (tabelas novas ganham as permissões).
-- Rode como superusuário (postgres) já conectado ao banco do sistema. A SENHA do papel não fica aqui: o instalar.sh a gera na VPS.
--
-- O app NÃO conecta como "postgres": usa o papel app_wms, que só mexe nas tabelas do sistema, não consegue alterar nem apagar o
-- livro-razão e a auditoria e tem limite de tempo por consulta.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_wms') THEN
    CREATE ROLE app_wms LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_wms;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_wms;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_wms;
-- Livro-razão e auditoria: só inserir e ler (além das triggers que já bloqueiam UPDATE/DELETE).
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria, movimentacoes_estoque FROM app_wms;

-- Tabelas e sequências criadas depois (por migrations futuras) já nascem com as permissões do app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_wms;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_wms;

ALTER ROLE app_wms SET statement_timeout = '20s';
ALTER ROLE app_wms SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_wms SET search_path = public;
