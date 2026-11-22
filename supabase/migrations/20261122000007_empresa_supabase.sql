-- Segurança da tabela nova (só Supabase; o sufixo _supabase.sql faz o PostgreSQL de teste ignorar este arquivo): mesmo padrão das demais tabelas.
ALTER TABLE public.empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_wms_total ON public.empresa;
CREATE POLICY app_wms_total ON public.empresa FOR ALL TO app_wms USING (true) WITH CHECK (true);
REVOKE ALL ON public.empresa FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresa TO app_wms;
