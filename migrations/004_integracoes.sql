-- Fase 5: Mercado Livre. Credenciais e tokens SEMPRE cifrados (AES-256-GCM). Dinheiro em centavos; datas em ms UTC.

CREATE TABLE canais (
  id     INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome   TEXT NOT NULL
);
INSERT INTO canais (codigo, nome) VALUES ('ML', 'Mercado Livre');

CREATE TABLE contas_canal (
  id                       INTEGER PRIMARY KEY,
  canal_id                 INTEGER NOT NULL UNIQUE REFERENCES canais(id),   -- uma conta por canal por enquanto
  app_id_enc               TEXT,
  app_secret_enc           TEXT,
  vendedor_id              TEXT,                                              -- user_id do vendedor no ML
  access_token_enc         TEXT,
  refresh_token_enc        TEXT,
  token_expira_em          INTEGER,
  status                   TEXT NOT NULL DEFAULT 'SEM_APP' CHECK (status IN ('SEM_APP','DESCONECTADA','CONECTADA','REAUTORIZAR')),
  margem_seguranca         INTEGER NOT NULL DEFAULT 0 CHECK (margem_seguranca >= 0),
  pausar_sem_estoque       INTEGER NOT NULL DEFAULT 0,
  sync_estoque             INTEGER NOT NULL DEFAULT 1,
  webhook_versao           INTEGER NOT NULL DEFAULT 1,                        -- trocar invalida a URL antiga do webhook
  ultima_sync_pedidos_em   INTEGER,
  ultima_sync_estoque_em   INTEGER,
  ultimo_erro              TEXT,
  ultimo_erro_em           INTEGER,
  falhas_seguidas          INTEGER NOT NULL DEFAULT 0,
  criado_em                INTEGER NOT NULL,
  atualizado_em            INTEGER NOT NULL
);

-- `state` do OAuth: uso único, curto, ligado ao usuário que iniciou (o cookie SameSite=Strict não volta do redirecionamento).
CREATE TABLE oauth_estados (
  state_hash TEXT PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES contas_canal(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expira_em  INTEGER NOT NULL,
  usado_em   INTEGER
);

-- Mapeamento SKU interno <-> anúncio (um produto pode ter vários anúncios).
CREATE TABLE sku_marketplace (
  id                    INTEGER PRIMARY KEY,
  conta_id              INTEGER NOT NULL REFERENCES contas_canal(id),
  produto_id            INTEGER NOT NULL REFERENCES produtos(id),
  item_id               TEXT NOT NULL,
  variacao_id           TEXT NOT NULL DEFAULT '',
  titulo                TEXT,
  sync_ativo            INTEGER NOT NULL DEFAULT 1,
  ultima_qtd_enviada    INTEGER,
  ultimo_status_enviado TEXT,
  ultimo_sync_em        INTEGER,
  ultimo_erro           TEXT,
  criado_em             INTEGER NOT NULL,
  UNIQUE (conta_id, item_id, variacao_id)
);
CREATE INDEX idx_skumkt_produto ON sku_marketplace(produto_id);

CREATE TABLE pedidos (
  id                INTEGER PRIMARY KEY,
  conta_id          INTEGER NOT NULL REFERENCES contas_canal(id),
  canal_pedido_id   TEXT NOT NULL,
  status_canal      TEXT,
  status            TEXT NOT NULL CHECK (status IN ('NOVO','PAGO','COM_PROBLEMA','CANCELADO')),
  problema          TEXT,
  comprador_id      TEXT,
  comprador_apelido TEXT,
  total_centavos    INTEGER NOT NULL DEFAULT 0 CHECK (total_centavos >= 0),
  data_canal        INTEGER,
  criado_em         INTEGER NOT NULL,
  atualizado_em     INTEGER NOT NULL,
  UNIQUE (conta_id, canal_pedido_id)                                          -- o mesmo pedido nunca entra duas vezes
);
CREATE INDEX idx_pedidos_status ON pedidos(status, data_canal);

CREATE TABLE pedido_itens (
  id             INTEGER PRIMARY KEY,
  pedido_id      INTEGER NOT NULL REFERENCES pedidos(id),
  item_id        TEXT NOT NULL,
  variacao_id    TEXT NOT NULL DEFAULT '',
  titulo         TEXT,
  sku_canal      TEXT,
  qtd            INTEGER NOT NULL CHECK (qtd > 0),
  preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
  produto_id     INTEGER REFERENCES produtos(id)
);
CREATE INDEX idx_pitens_pedido ON pedido_itens(pedido_id);

-- Reserva por produto: disponível = físico vendável - reservas ATIVAS. A baixa final é da expedição (Fase 6/7).
CREATE TABLE reservas (
  id             INTEGER PRIMARY KEY,
  pedido_item_id INTEGER NOT NULL UNIQUE REFERENCES pedido_itens(id),         -- nunca reserva duas vezes o mesmo item
  produto_id     INTEGER NOT NULL REFERENCES produtos(id),
  qtd            INTEGER NOT NULL CHECK (qtd > 0),
  status         TEXT NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA','LIBERADA','CONSUMIDA')),
  criado_em      INTEGER NOT NULL,
  atualizado_em  INTEGER NOT NULL
);
CREATE INDEX idx_reservas_ativas ON reservas(produto_id) WHERE status = 'ATIVA';

CREATE TABLE webhooks_recebidos (
  id            INTEGER PRIMARY KEY,
  conta_id      INTEGER NOT NULL REFERENCES contas_canal(id),
  topico        TEXT NOT NULL,
  recurso       TEXT NOT NULL,
  recebido_em   INTEGER NOT NULL,
  processado_em INTEGER,
  resultado     TEXT
);
CREATE INDEX idx_webhooks_pendentes ON webhooks_recebidos(conta_id, recurso) WHERE processado_em IS NULL;

CREATE TABLE jobs_sincronizacao (
  id           INTEGER PRIMARY KEY,
  conta_id     INTEGER NOT NULL REFERENCES contas_canal(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('PEDIDOS','ESTOQUE','TOKEN','WEBHOOK')),
  origem       TEXT NOT NULL CHECK (origem IN ('WEBHOOK','POLLING','MANUAL','EVENTO')),
  iniciado_em  INTEGER NOT NULL,
  concluido_em INTEGER,
  ok           INTEGER,
  itens        INTEGER NOT NULL DEFAULT 0,
  erro         TEXT
);
CREATE INDEX idx_jobs_conta ON jobs_sincronizacao(conta_id, id);
