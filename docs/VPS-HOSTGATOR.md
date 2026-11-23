# Hospedar o sistema na HostGator (VPS) no domínio friospecaseservicos.com.br

O sistema roda numa **VPS** da HostGator (hospedagem compartilhada e Cloud não rodam Node.js) e o **banco também fica nela**: um PostgreSQL 17 instalado na própria VPS. Sem mensalidade de banco e sem a pausa por falta de uso do plano grátis da Supabase.

```
navegador ──HTTPS──> Caddy ──> sistema (Node 24, porta 3000) ──> PostgreSQL 17 (só acessível dentro da VPS)
```

> Os valores secretos (senha do root da VPS, `PEPPER`, `HMAC_KEY`, `FIELD_KEY`, `BACKUP_SENHA`, senha de app do Gmail, URL da Supabase) **nunca** vão para o chat, para o GitHub nem para este repositório. Você os digita direto na VPS. A senha do banco local é gerada pela própria VPS e você nunca precisa vê-la.

## 1. Contratar (você)

1. Na HostGator, contrate uma **VPS NVMe 2** (1 vCPU, 2 GB de RAM) com **Ubuntu 22.04**, sem painel. Não precisa do backup pago da VPS.
2. Anote o **IP** e a **senha do root** que aparecem no painel (*VPS e Dedicados*). Guarde no gerenciador de senhas.

## 2. Entrar na VPS (você)

No PowerShell do seu computador (troque `IP_DA_VPS`):

```powershell
ssh -p 22022 root@IP_DA_VPS
```

> **Se o SSH fechar a conexão antes de você terminar de digitar a senha** (acontece: o servidor dá poucos segundos), use uma **chave SSH** em vez da senha: no painel, *VPS e Dedicados → Gerenciar → Chaves SSH → Adicionar chave* (cole a parte **pública**, a que termina em `.pub`) e entre com `ssh -i C:UsersSEU_USUARIO.sshSUA_CHAVE -p 22022 root@IP_DA_VPS`, sem senha.

(Na HostGator o SSH usa a porta **22022**, não a 22. O IP, a porta e o usuário `root` estão no painel: *VPS e Dedicados → Gerenciar → Acesso SSH*.)

## 3. Instalar (um comando)

```bash
curl -fsSL https://raw.githubusercontent.com/carlosserra-a11y/Sistema-E-comece/main/deploy/vps/instalar.sh -o instalar.sh
bash instalar.sh
```

Ele instala Node 24, PostgreSQL 17, Caddy (HTTPS automático) e o firewall (só o SSH, 80 e 443; o banco **não** fica aberto), cria o banco com as mesmas tabelas e cria o serviço que sobe sozinho. Para continuar na Supabase em vez de usar o banco local: `BANCO_TIPO=supabase bash instalar.sh`.

## 4. Preencher os segredos

```bash
nano /opt/wms/.env
```

Troque cada `PREENCHER` pelos valores do seu arquivo de segredos: `PEPPER`, `HMAC_KEY`, `FIELD_KEY`, `DONO_EMAIL`, `BACKUP_SENHA`, `SMTP_USER`, `SMTP_PASS`. **`PEPPER`, `HMAC_KEY` e `FIELD_KEY` têm de ser idênticos aos de hoje**, senão ninguém consegue entrar. A `DATABASE_URL` já vem preenchida pela instalação (banco local). Salve com `Ctrl+O`, Enter e `Ctrl+X`.

## 5. Copiar os dados da Supabase para a VPS

> **Faça no dia da virada** (passo 7), logo antes de trocar o DNS. Tudo o que for digitado no sistema da Vercel *depois* da cópia **não** passa para a VPS. Avise a equipe para não usar o sistema nos minutos da troca.

```bash
bash /opt/wms/app/deploy/vps/migrar-dados-supabase.sh
```

Ele pede a `DATABASE_URL` da Supabase (está no seu arquivo de segredos; ela **não aparece na tela**), copia os dados, confere **tabela por tabela** se a quantidade de registros é igual e roda o teste de integridade do sistema (saldo = soma do livro-razão e cadeia de auditoria íntegra). A Supabase só é lida: nada é alterado nela. No fim ele diz o comando para ligar o sistema:

```bash
systemctl restart wms && systemctl status wms --no-pager
```

Deve aparecer `active (running)`. Se algo falhar, `journalctl -u wms -n 50 --no-pager` mostra o motivo. Se a cópia for refeita, o próprio script mostra o comando que limpa o banco da VPS antes.

## 6. Testar antes da virada

Antes de trocar o DNS, a tela de login ainda não abre no domínio; por isso o teste é feito dentro da própria VPS:

```bash
curl -s -H "Host: friospecaseservicos.com.br" http://127.0.0.1:3000/api/sessao
```

Tem de responder com um JSON (sem erro). A tela de login só abre de verdade depois do passo 7.

## 7. Virada do DNS (você, no painel da HostGator)

Na zona DNS do domínio (*Domínios → Gerenciar → Configurar domínio → Zona avançada de DNS*), troque os registros que apontam para a Vercel (peça que eu faça: abro o painel e mostro os valores antes de salvar):

| Tipo | Nome | Valor |
|---|---|---|
| **A** | `@` (apague os dois da Vercel) | `IP_DA_VPS` |
| **CNAME** | `www` | troque por `A` com `IP_DA_VPS` (ou CNAME para `friospecaseservicos.com.br`) |

Em alguns minutos o Caddy tira sozinho o certificado HTTPS. Teste `https://friospecaseservicos.com.br`: a tela de login abre com o cadeado e o seu e-mail de dono recebe o código.

## 8. Atualizar o sistema depois

```bash
bash /opt/wms/app/deploy/vps/atualizar.sh
```

Baixa a versão nova do GitHub, aplica as mudanças de banco que faltarem e reinicia.

## 9. Backups (rodam sozinhos todo dia)

| Hora | O quê | Onde fica |
|---|---|---|
| 2h00 | `npm run backup`: arquivo do sistema, cifrado, bom para conferir e abrir os dados | `/opt/wms/app/backups` |
| 2h30 | `backup-pg.sh`: backup **nativo do PostgreSQL**, cifrado com a `BACKUP_SENHA`; é o que se restaura num servidor novo | `/opt/wms/backups-pg` |

- **O servidor e o banco estão na mesma máquina.** Se a VPS for perdida, os backups que ficaram nela vão junto. Traga uma cópia para o seu computador toda semana (PowerShell): `scp -P 22022 "root@IP_DA_VPS:/opt/wms/backups-pg/*" .` — o arquivo é cifrado, pode ir para o Google Drive.
- Restaurar num PostgreSQL novo: o comando está no cabeçalho do `deploy/vps/backup-pg.sh`.
- Confira de vez em quando que existe um arquivo de hoje nas duas pastas.
- Conferir os dados a qualquer momento: `cd /opt/wms/app && sudo -u wms npm run verificar-dados`.

## 10. Voltar atrás

Depois da virada, o banco que vale é o da VPS. O da Supabase fica **parado no momento da cópia**. Por isso:

- **Nos primeiros minutos** (nada novo foi digitado): é só devolver o DNS para a Vercel (veja [DOMINIO.md](DOMINIO.md)).
- **Depois que a equipe trabalhar na VPS:** voltar para a Vercel perderia o que foi digitado. Não volte sem me chamar: dá para copiar os dados de volta.
- Mantenha o projeto da Supabase por uns 30 dias como cópia de segurança e depois apague-o. No plano grátis ele pausa sozinho e isso não afeta a VPS.
