-- Segurança no lado do banco (só Supabase; o sufixo _supabase.sql faz o PostgreSQL de teste ignorar este arquivo).
-- O app NÃO conecta como "postgres": usa o papel app_wms, que só mexe nas tabelas do sistema, não consegue alterar o livro-razão nem a
-- auditoria e está sujeito a RLS. A API pública da Supabase (anon/authenticated) não enxerga nada. A SENHA do papel não fica aqui:
-- é definida à parte (ALTER ROLE app_wms LOGIN PASSWORD ...) e guardada só nas variáveis de ambiente da hospedagem.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_wms') THEN
    CREATE ROLE app_wms NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_wms;

-- RLS ligado em todas as tabelas; a única política libera o papel do app. Sem política, anon/authenticated não leem nem escrevem nada.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_wms_total ON public.%I', t);
    EXECUTE format('CREATE POLICY app_wms_total ON public.%I FOR ALL TO app_wms USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_wms;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_wms;
-- Livro-razão e auditoria: só inserir e ler (além das triggers que já bloqueiam UPDATE/DELETE).
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria, movimentacoes_estoque FROM app_wms;

ALTER ROLE app_wms SET statement_timeout = '20s';
ALTER ROLE app_wms SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_wms SET search_path = public;
