-- Segurança das tabelas do balcão (só Supabase; o sufixo _supabase.sql faz o PostgreSQL da VPS e o de teste ignorarem este arquivo).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes','servicos','config_vendas','caixas','vendas','venda_itens','venda_pagamentos','caixa_movimentos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_wms_total ON public.%I', t);
    EXECUTE format('CREATE POLICY app_wms_total ON public.%I FOR ALL TO app_wms USING (true) WITH CHECK (true)', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_wms', t);
  END LOOP;
END $$;
REVOKE DELETE, TRUNCATE ON public.vendas, public.venda_itens, public.caixas FROM app_wms;
REVOKE UPDATE, DELETE, TRUNCATE ON public.venda_pagamentos, public.caixa_movimentos FROM app_wms;
