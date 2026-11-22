# Backup: como salvar tudo, sempre

Há **três camadas**. Use as três: uma sozinha não basta.

| Camada | O que salva | Quem faz | Onde fica |
|---|---|---|---|
| 1. Backup do provedor (Supabase **Pro**) | o banco inteiro, todo dia | automático, no painel da Supabase | na Supabase (7 dias de histórico) |
| 2. Backup do sistema (`npm run backup`) | o banco inteiro num **arquivo cifrado**, que você guarda fora | você agenda (seção 3) | pasta `backups/` + uma cópia fora do computador |
| 3. O código | todo o projeto | GitHub (`git push`) | repositório no GitHub |

> O plano **grátis** da Supabase **não faz backup**. Antes de o sistema virar operação da empresa, assine o **Pro** (US$ 25/mês, confira o preço atual em supabase.com/pricing). Quem assina é você, no painel: ninguém assina por você.

## 1. Supabase Pro (backup automático do banco)

1. Entre em supabase.com → sua organização → **Billing** → **Upgrade** para o plano **Pro**.
2. Depois: projeto → **Database → Backups**. Os backups diários aparecem ali (7 dias de histórico no Pro).
3. Opcional, para empresa: o complemento **PITR** (recuperação a qualquer segundo dos últimos 7 dias) custa à parte. Vale quando perder um dia de movimentação for inaceitável.
4. Restaurar: no mesmo painel, escolha o backup e use *Restore*. Isso **substitui o banco atual**: avise a equipe antes.

## 2. Backup do sistema (arquivo cifrado)

Salva **todas as tabelas** (produtos, estoque, livro-razão, auditoria, usuários, empresa, endereços…) num único arquivo comprimido e **cifrado com AES-256**. Sessões e bloqueios de login ficam de fora (são estado do momento).

```powershell
npm run backup
```

- Funciona com o SQLite local e com o PostgreSQL da Supabase (use as mesmas variáveis da produção: `DATABASE_URL`, `PEPPER`, `HMAC_KEY`, `FIELD_KEY`).
- Cria `backups/armazem-AAAA-MM-DD-HHMMSS.json.gz.enc` e mantém os **últimos 30** (mude com `--manter 60`; mude a pasta com `--pasta D:/Backups`).
- **Defina `BACKUP_SENHA`** (no `.env`, que nunca vai para o GitHub). Sem senha o arquivo sai só comprimido, **sem cifra**, e ele contém hashes de senha e dados da empresa.
- **Guarde `BACKUP_SENHA`, `PEPPER`, `HMAC_KEY` e `FIELD_KEY` no gerenciador de senhas.** Sem elas o backup abre, mas os campos cifrados (credenciais do Mercado Livre, CNPJ de fornecedores) e os logins não funcionam.
- **Faça uma cópia fora deste computador** (outro HD, Google Drive, OneDrive). O arquivo é cifrado, então pode ir para a nuvem.

Conferir um arquivo (não grava nada):

```powershell
npm run backup:verificar -- backups/armazem-2026-11-22-120000.json.gz.enc
```

## 3. Backup automático (todo dia)

O sistema **não agenda sozinho**: quem agenda é o computador ou o servidor. No Windows, uma tarefa agendada por dia às 2h da manhã (ajuste a pasta do projeto):

```powershell
schtasks /Create /SC DAILY /ST 02:00 /TN "Backup WMS" /TR "cmd /c cd /d C:\caminho\do\projeto && npm run backup" /F
```

Na VPS (Linux), um `cron` faz o mesmo: `0 2 * * * cd /caminho/do/projeto && npm run backup`.

Confira de vez em quando: abra a pasta `backups/` e veja se há um arquivo de hoje. Backup que ninguém confere é backup que falha em silêncio.

## 4. Restaurar (abrir os dados numa máquina nova)

A restauração por arquivo vai para um **SQLite novo e vazio**: serve para abrir seus dados em outro computador ou para **provar que o backup funciona**. Ela **nunca mexe na produção** e recusa um banco que já tenha dados.

```powershell
$env:DB_PATH = "data/restaurado.db"
npm run restaurar -- backups/armazem-2026-11-22-120000.json.gz.enc --confirmar
```

Tudo ocorre numa transação: se qualquer tabela não ficar com o mesmo número de registros do backup, **nada é gravado**. Depois de restaurar, o saldo bate com o livro-razão e a cadeia de auditoria continua íntegra (os testes automáticos conferem isso).

Para recuperar a **produção** (Supabase), use o *Restore* da camada 1.

## 5. Salvar o projeto (código)

O código está no GitHub. Depois de qualquer mudança: `git push`. Os arquivos de backup (`backups/`) e os segredos (`.env`) **não** vão para o GitHub de propósito.

## 6. Quando mudar de hospedagem

O banco é PostgreSQL padrão: dá para migrar com o arquivo de backup do provedor (`pg_dump`) ou criar um banco novo com as migrations de `supabase/migrations/`. Antes de qualquer migração, faça um `npm run backup` e **confira** com `backup:verificar`.
