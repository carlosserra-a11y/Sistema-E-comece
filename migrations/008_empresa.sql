-- Dados cadastrais da empresa (uma linha só, id = 1): razão social, CNPJ, endereço de cobrança, contatos e perfil fiscal.
-- Também libera mais de uma conta de dono (o desenvolvedor e o responsável da empresa): o índice que limitava a uma sai.
CREATE TABLE empresa (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  razao_social        TEXT NOT NULL DEFAULT '',
  nome_fantasia       TEXT,
  cnpj                TEXT,
  inscricao_estadual  TEXT,
  endereco            TEXT,
  cidade              TEXT,
  uf                  TEXT,
  cep                 TEXT,
  email_nf            TEXT,
  compras_nome        TEXT,
  compras_email       TEXT,
  compras_telefone    TEXT,
  financeiro_nome     TEXT,
  financeiro_email    TEXT,
  financeiro_telefone TEXT,
  simples_nacional    INTEGER NOT NULL DEFAULT 0,
  contribuinte_icms   TEXT NOT NULL DEFAULT 'CONTRIBUINTE' CHECK (contribuinte_icms IN ('CONTRIBUINTE','NAO_CONTRIBUINTE','ISENTO')),
  suframa_numero      TEXT,
  aplicacao           TEXT NOT NULL DEFAULT 'REVENDA' CHECK (aplicacao IN ('INDUSTRIALIZACAO','INSTALACAO','REVENDA','USO_CONSUMO')),
  responsavel         TEXT,
  atualizado_em       BIGINT NOT NULL DEFAULT 0
);
DROP INDEX IF EXISTS idx_users_dono;
