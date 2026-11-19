-- Fase 3: depósitos, endereçamento, livro-razão imutável, saldos, inventário (contagem).

CREATE TABLE depositos (
  id        INTEGER PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE CHECK (length(codigo) BETWEEN 1 AND 4 AND codigo NOT GLOB '*[^A-Z0-9]*'),
  nome      TEXT NOT NULL,
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL
);

CREATE TABLE zonas (
  id          INTEGER PRIMARY KEY,
  deposito_id INTEGER NOT NULL REFERENCES depositos(id),
  codigo      TEXT NOT NULL CHECK (length(codigo) BETWEEN 1 AND 3 AND codigo NOT GLOB '*[^A-Z]*'),
  nome        TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('RECEBIMENTO','PICKING','RESERVA','AVARIA','DEVOLUCAO','QUARENTENA','EXPEDICAO')),
  vendavel    INTEGER NOT NULL DEFAULT 0,             -- só PICKING/RESERVA contam como disponível
  UNIQUE (deposito_id, codigo)
);

CREATE TABLE enderecos (
  id                 INTEGER PRIMARY KEY,
  deposito_id        INTEGER NOT NULL REFERENCES depositos(id),
  zona_id            INTEGER NOT NULL REFERENCES zonas(id),
  codigo             TEXT NOT NULL UNIQUE,            -- D1-A-03-02-01-04
  rua                INTEGER NOT NULL CHECK (rua BETWEEN 1 AND 99),
  predio             INTEGER NOT NULL CHECK (predio BETWEEN 1 AND 99),
  nivel              INTEGER NOT NULL CHECK (nivel BETWEEN 1 AND 99),
  posicao            INTEGER NOT NULL CHECK (posicao BETWEEN 1 AND 99),
  cap_itens          INTEGER NOT NULL DEFAULT 0 CHECK (cap_itens >= 0),   -- 0 = sem limite
  cap_peso_g         INTEGER NOT NULL DEFAULT 0 CHECK (cap_peso_g >= 0),
  bloqueado          INTEGER NOT NULL DEFAULT 0,
  motivo_bloqueio    TEXT,
  ativo              INTEGER NOT NULL DEFAULT 1,
  ultima_contagem_em INTEGER,
  criado_em          INTEGER NOT NULL,
  UNIQUE (zona_id, rua, predio, nivel, posicao)
);
CREATE INDEX idx_enderecos_zona ON enderecos(zona_id, rua, predio, nivel, posicao);

-- Endereço de picking designado para cada produto (um produto, um endereço; um endereço, um produto).
CREATE TABLE produto_picking (
  produto_id  INTEGER PRIMARY KEY REFERENCES produtos(id),
  endereco_id INTEGER NOT NULL UNIQUE REFERENCES enderecos(id)
);

CREATE TABLE lotes (
  id         INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  codigo     TEXT NOT NULL,
  validade   TEXT,                                    -- AAAA-MM-DD
  criado_em  INTEGER NOT NULL,
  UNIQUE (produto_id, codigo)
);

-- Livro-razão: imutável. O saldo é consequência dele.
CREATE TABLE movimentacoes_estoque (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA','TRANSF_SAIDA','TRANSF_ENTRADA','AJUSTE','AVARIA','DEVOLUCAO','INVENTARIO')),
  produto_id    INTEGER NOT NULL REFERENCES produtos(id),
  endereco_id   INTEGER NOT NULL REFERENCES enderecos(id),
  lote_id       INTEGER NOT NULL DEFAULT 0,           -- 0 = sem lote
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  grupo         TEXT,                                 -- liga as duas pernas de uma transferência
  motivo        TEXT,
  documento     TEXT,
  user_id       INTEGER,
  inventario_id INTEGER
);
CREATE INDEX idx_mov_produto ON movimentacoes_estoque(produto_id, id);
CREATE INDEX idx_mov_endereco ON movimentacoes_estoque(endereco_id, id);
CREATE INDEX idx_mov_ts ON movimentacoes_estoque(ts);
CREATE TRIGGER trg_mov_no_update BEFORE UPDATE ON movimentacoes_estoque BEGIN SELECT RAISE(ABORT, 'livro-razao e imutavel'); END;
CREATE TRIGGER trg_mov_no_delete BEFORE DELETE ON movimentacoes_estoque BEGIN SELECT RAISE(ABORT, 'livro-razao e imutavel'); END;

CREATE TABLE saldos_por_endereco (
  produto_id    INTEGER NOT NULL REFERENCES produtos(id),
  endereco_id   INTEGER NOT NULL REFERENCES enderecos(id),
  lote_id       INTEGER NOT NULL DEFAULT 0,
  qtd           INTEGER NOT NULL CHECK (qtd >= 0),    -- NUNCA negativo
  atualizado_em INTEGER NOT NULL,
  PRIMARY KEY (produto_id, endereco_id, lote_id)
);
CREATE INDEX idx_saldos_endereco ON saldos_por_endereco(endereco_id);

-- Único caminho de escrita nos saldos: cada linha do livro-razão atualiza o saldo na mesma transação.
CREATE TRIGGER trg_mov_saldo AFTER INSERT ON movimentacoes_estoque
BEGIN
  -- UPDATE antes do INSERT: o SQLite checa o CHECK da linha proposta antes de resolver um UPSERT,
  -- o que rejeitaria toda saída (delta negativo) mesmo com saldo suficiente.
  UPDATE saldos_por_endereco SET qtd = qtd + NEW.delta, atualizado_em = NEW.ts
   WHERE produto_id = NEW.produto_id AND endereco_id = NEW.endereco_id AND lote_id = NEW.lote_id;
  INSERT INTO saldos_por_endereco (produto_id, endereco_id, lote_id, qtd, atualizado_em)
  SELECT NEW.produto_id, NEW.endereco_id, NEW.lote_id, NEW.delta, NEW.ts
   WHERE NOT EXISTS (SELECT 1 FROM saldos_por_endereco
                      WHERE produto_id = NEW.produto_id AND endereco_id = NEW.endereco_id AND lote_id = NEW.lote_id);
END;

CREATE TABLE inventarios (
  id           INTEGER PRIMARY KEY,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('CICLICO','GERAL','ENDERECOS')),
  status       TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','APROVADO','CANCELADO')),
  observacao   TEXT,
  criado_em    INTEGER NOT NULL,
  criado_por   INTEGER,
  fechado_em   INTEGER,
  aprovado_por INTEGER
);

CREATE TABLE inventario_enderecos (
  inventario_id INTEGER NOT NULL REFERENCES inventarios(id),
  endereco_id   INTEGER NOT NULL REFERENCES enderecos(id),
  concluido     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (inventario_id, endereco_id)
);

CREATE TABLE inventario_itens (
  id            INTEGER PRIMARY KEY,
  inventario_id INTEGER NOT NULL REFERENCES inventarios(id),
  endereco_id   INTEGER NOT NULL REFERENCES enderecos(id),
  produto_id    INTEGER NOT NULL REFERENCES produtos(id),
  lote_id       INTEGER NOT NULL DEFAULT 0,
  qtd_sistema   INTEGER NOT NULL,                     -- foto do saldo no início da contagem
  qtd_contada   INTEGER CHECK (qtd_contada IS NULL OR qtd_contada >= 0),
  contagens     INTEGER NOT NULL DEFAULT 0,
  mov_base      INTEGER,                              -- último id do livro-razão ao contar (detecta movimento no meio)
  contado_em    INTEGER,
  ajuste_em     INTEGER,
  UNIQUE (inventario_id, endereco_id, produto_id, lote_id)
);
CREATE INDEX idx_inv_itens ON inventario_itens(inventario_id, endereco_id);
