-- Fase 2: fornecedores, produtos, códigos de barras. Valores em centavos; medidas em g/mm.

CREATE TABLE fornecedores (
  id                  INTEGER PRIMARY KEY,
  nome                TEXT NOT NULL,
  busca               TEXT NOT NULL,
  documento_enc       TEXT,                           -- CNPJ/CPF criptografado (AES-256-GCM)
  documento_hmac      TEXT UNIQUE,                    -- unicidade sem guardar em claro
  documento_mascarado TEXT,
  contato             TEXT,
  email               TEXT,
  telefone            TEXT,
  prazo_dias          INTEGER NOT NULL DEFAULT 0 CHECK (prazo_dias >= 0),
  observacoes         TEXT,
  ativo               INTEGER NOT NULL DEFAULT 1,
  versao              INTEGER NOT NULL DEFAULT 1,
  criado_em           INTEGER NOT NULL,
  atualizado_em       INTEGER NOT NULL
);

CREATE TABLE produtos (
  id                INTEGER PRIMARY KEY,
  sku               TEXT NOT NULL UNIQUE,
  nome              TEXT NOT NULL,
  busca             TEXT NOT NULL,
  descricao         TEXT,
  marca             TEXT,
  categoria         TEXT,
  unidade           TEXT NOT NULL DEFAULT 'UN',
  ncm               TEXT,
  custo_centavos    INTEGER NOT NULL DEFAULT 0 CHECK (custo_centavos >= 0),
  preco_centavos    INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
  peso_g            INTEGER NOT NULL DEFAULT 0 CHECK (peso_g >= 0),
  comp_mm           INTEGER NOT NULL DEFAULT 0 CHECK (comp_mm >= 0),
  larg_mm           INTEGER NOT NULL DEFAULT 0 CHECK (larg_mm >= 0),
  alt_mm            INTEGER NOT NULL DEFAULT 0 CHECK (alt_mm >= 0),
  estoque_min       INTEGER NOT NULL DEFAULT 0 CHECK (estoque_min >= 0),
  estoque_max       INTEGER NOT NULL DEFAULT 0 CHECK (estoque_max >= 0),
  ponto_pedido      INTEGER NOT NULL DEFAULT 0 CHECK (ponto_pedido >= 0),
  controla_lote     INTEGER NOT NULL DEFAULT 0,
  controla_validade INTEGER NOT NULL DEFAULT 0,
  fornecedor_id     INTEGER REFERENCES fornecedores(id),
  ativo             INTEGER NOT NULL DEFAULT 1,
  versao            INTEGER NOT NULL DEFAULT 1,
  criado_em         INTEGER NOT NULL,
  atualizado_em     INTEGER NOT NULL,
  CHECK (estoque_max = 0 OR estoque_max >= estoque_min)
);
CREATE INDEX idx_produtos_busca ON produtos(busca);
CREATE INDEX idx_produtos_ativo ON produtos(ativo);

CREATE TABLE codigos_barras (
  id         INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  codigo     TEXT NOT NULL UNIQUE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('EAN13','EAN8','UPCA','GTIN14','CODE128')),
  origem     TEXT NOT NULL CHECK (origem IN ('FABRICANTE','INTERNO')),
  principal  INTEGER NOT NULL DEFAULT 0,
  criado_em  INTEGER NOT NULL
);
CREATE INDEX idx_codigos_produto ON codigos_barras(produto_id);
CREATE UNIQUE INDEX uq_codigos_principal ON codigos_barras(produto_id) WHERE principal = 1;
