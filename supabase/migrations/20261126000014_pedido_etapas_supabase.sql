-- Segurança da tabela de etapas dos pedidos (só Supabase; o PostgreSQL da VPS e o de teste ignoram este arquivo).
ALTER TABLE public.pedido_etapas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_wms_total ON public.pedido_etapas;
CREATE POLICY app_wms_total ON public.pedido_etapas FOR ALL TO app_wms USING (true) WITH CHECK (true);
REVOKE ALL ON public.pedido_etapas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.pedido_etapas TO app_wms;
REVOKE UPDATE, DELETE, TRUNCATE ON public.pedido_etapas FROM app_wms;
