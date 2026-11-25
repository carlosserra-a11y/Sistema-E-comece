-- Venda presencial (balcão): clientes, serviços, caixa, vendas/orçamentos e configuração do Pix. Dinheiro em centavos; datas em ms UTC.
-- Manter igual a supabase/migrations/20261125000008_vendas.sql (PostgreSQL).

CREATE TABLE clientes (
  id                  INTEGER PRIMARY KEY,
  nome                TEXT NOT NULL,
  busca               TEXT NOT NULL,
  documento_enc       TEXT,                          -- CPF/CNPJ criptografado (AES-256-GCM)
  documento_hmac      TEXT UNIQUE,
  documento_mascarado TEXT,
  telefone            TEXT,
  email               TEXT,
  endereco            TEXT,
  observacoes         TEXT,
  ativo               INTEGER NOT NULL DEFAULT 1,
  versao              INTEGER NOT NULL DEFAULT 1,
  criado_em           INTEGER NOT NULL,
  atualizado_em       INTEGER NOT NULL
);
CREATE INDEX idx_clientes_busca ON clientes(busca);

CREATE TABLE servicos (
  id             INTEGER PRIMARY KEY,
  nome           TEXT NOT NULL,
  busca          TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),   -- preço de venda (não é campo restrito)
  ativo          INTEGER NOT NULL DEFAULT 1,
  versao         INTEGER NOT NULL DEFAULT 1,
  criado_em      INTEGER NOT NULL,
  atualizado_em  INTEGER NOT NULL
);

CREATE TABLE config_vendas (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  pix_chave               TEXT,
  pix_nome                TEXT,
  pix_cidade              TEXT,
  desconto_max_pct        INTEGER NOT NULL DEFAULT 0 CHECK (desconto_max_pct BETWEEN 0 AND 100),
  validade_orcamento_dias INTEGER NOT NULL DEFAULT 7 CHECK (validade_orcamento_dias BETWEEN 1 AND 90),
  cupom_rodape            TEXT,
  atualizado_em           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE caixas (
  id                INTEGER PRIMARY KEY,
  aberto_por        INTEGER NOT NULL REFERENCES users(id),
  aberto_em         INTEGER NOT NULL,
  abertura_centavos INTEGER NOT NULL CHECK (abertura_centavos >= 0),
  status            TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','FECHADO')),
  fechado_por       INTEGER REFERENCES users(id),
  fechado_em        INTEGER,
  contado_centavos  INTEGER CHECK (contado_centavos IS NULL OR contado_centavos >= 0),
  esperado_centavos INTEGER,
  resumo            TEXT,                             -- foto dos totais no fechamento (não muda depois)
  observacao        TEXT
);
CREATE UNIQUE INDEX uq_caixa_aberto ON caixas(aberto_por) WHERE status = 'ABERTO';   -- um caixa aberto por pessoa

CREATE TABLE vendas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,   -- número da venda: nunca é reaproveitado
  status              TEXT NOT NULL CHECK (status IN ('ORCAMENTO','CONCLUIDA','CANCELADA','DESCARTADA')),
  cliente_id          INTEGER REFERENCES clientes(id),
  vendedor_id         INTEGER NOT NULL REFERENCES users(id),
  caixa_id            INTEGER REFERENCES caixas(id),
  subtotal_centavos   INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  desconto_centavos   INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  valor_centavos      INTEGER NOT NULL CHECK (valor_centavos > 0),
  troco_centavos      INTEGER NOT NULL DEFAULT 0 CHECK (troco_centavos >= 0),
  observacao          TEXT,
  validade            TEXT,                              -- AAAA-MM-DD (orçamento)
  criado_em           INTEGER NOT NULL,
  concluida_em        INTEGER,
  cancelada_em        INTEGER,
  cancelada_por       INTEGER REFERENCES users(id),
  motivo_cancelamento TEXT,
  CHECK (valor_centavos = subtotal_centavos - desconto_centavos),
  CHECK (status NOT IN ('CONCLUIDA','CANCELADA') OR (caixa_id IS NOT NULL AND concluida_em IS NOT NULL))
);
CREATE INDEX idx_vendas_status ON vendas(status, concluida_em);
CREATE INDEX idx_vendas_caixa ON vendas(caixa_id);
CREATE INDEX idx_vendas_cliente ON vendas(cliente_id);
CREATE INDEX idx_vendas_vendedor ON vendas(vendedor_id);

CREATE TABLE venda_itens (
  id                    INTEGER PRIMARY KEY,
  venda_id              INTEGER NOT NULL REFERENCES vendas(id),
  tipo                  TEXT NOT NULL CHECK (tipo IN ('PRODUTO','SERVICO')),
  produto_id            INTEGER REFERENCES produtos(id),
  servico_id            INTEGER REFERENCES servicos(id),
  codigo                TEXT,
  descricao             TEXT NOT NULL,
  unidade               TEXT NOT NULL DEFAULT 'UN',
  qtd                   INTEGER NOT NULL CHECK (qtd > 0),
  preco_tabela_centavos INTEGER NOT NULL CHECK (preco_tabela_centavos >= 0),
  preco_unit_centavos   INTEGER NOT NULL CHECK (preco_unit_centavos >= 0),
  custo_unit_centavos   INTEGER NOT NULL DEFAULT 0 CHECK (custo_unit_centavos >= 0),
  CHECK ((tipo = 'PRODUTO' AND produto_id IS NOT NULL AND servico_id IS NULL) OR (tipo = 'SERVICO' AND servico_id IS NOT NULL AND produto_id IS NULL))
);
CREATE INDEX idx_venda_itens_venda ON venda_itens(venda_id);
CREATE INDEX idx_venda_itens_produto ON venda_itens(produto_id);

CREATE TABLE venda_pagamentos (
  id             INTEGER PRIMARY KEY,
  venda_id       INTEGER NOT NULL REFERENCES vendas(id),
  forma          TEXT NOT NULL CHECK (forma IN ('DINHEIRO','PIX','DEBITO','CREDITO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),   -- valor que ficou (dinheiro já sem o troco)
  parcelas       INTEGER NOT NULL DEFAULT 1 CHECK (parcelas BETWEEN 1 AND 24)
);
CREATE INDEX idx_venda_pag_venda ON venda_pagamentos(venda_id);

CREATE TABLE caixa_movimentos (
  id             INTEGER PRIMARY KEY,
  caixa_id       INTEGER NOT NULL REFERENCES caixas(id),
  ts             INTEGER NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('SUPRIMENTO','SANGRIA','ESTORNO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  motivo         TEXT NOT NULL,
  venda_id       INTEGER REFERENCES vendas(id),
  user_id        INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_caixa_mov ON caixa_movimentos(caixa_id);

-- Dinheiro registrado não se reescreve nem se apaga.
CREATE TRIGGER trg_venda_pag_no_update BEFORE UPDATE ON venda_pagamentos BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;
CREATE TRIGGER trg_venda_pag_no_delete BEFORE DELETE ON venda_pagamentos BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;
CREATE TRIGGER trg_caixa_mov_no_update BEFORE UPDATE ON caixa_movimentos BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;
CREATE TRIGGER trg_caixa_mov_no_delete BEFORE DELETE ON caixa_movimentos BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;
CREATE TRIGGER trg_vendas_no_delete BEFORE DELETE ON vendas BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;
CREATE TRIGGER trg_venda_itens_no_delete BEFORE DELETE ON venda_itens BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;
CREATE TRIGGER trg_caixas_no_delete BEFORE DELETE ON caixas BEGIN SELECT RAISE(ABORT, 'registro de venda e imutavel'); END;

-- A devolução de uma venda cancelada procura as baixas pelo grupo.
CREATE INDEX idx_mov_grupo ON movimentacoes_estoque(grupo);
