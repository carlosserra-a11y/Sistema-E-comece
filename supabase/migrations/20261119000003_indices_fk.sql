-- Índices nas chaves estrangeiras que ainda não tinham (recomendação do linter de desempenho da Supabase).
CREATE INDEX IF NOT EXISTS idx_enderecos_deposito ON enderecos(deposito_id);
CREATE INDEX IF NOT EXISTS idx_invend_endereco ON inventario_enderecos(endereco_id);
CREATE INDEX IF NOT EXISTS idx_invitens_endereco ON inventario_itens(endereco_id);
CREATE INDEX IF NOT EXISTS idx_invitens_produto ON inventario_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_oauth_conta ON oauth_estados(conta_id);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_estados(user_id);
CREATE INDEX IF NOT EXISTS idx_pitens_produto ON pedido_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_produtos_fornecedor ON produtos(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_users_criado_por ON users(criado_por);
