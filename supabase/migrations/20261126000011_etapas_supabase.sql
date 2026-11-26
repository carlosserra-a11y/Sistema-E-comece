-- Segurança da tabela de etapas (só Supabase; o PostgreSQL da VPS e o de teste ignoram este arquivo).
ALTER TABLE public.etapas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_wms_total ON public.etapas;
CREATE POLICY app_wms_total ON public.etapas FOR ALL TO app_wms USING (true) WITH CHECK (true);
REVOKE ALL ON public.etapas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.etapas TO app_wms;
REVOKE UPDATE, DELETE, TRUNCATE ON public.etapas FROM app_wms;
