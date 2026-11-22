# Hospedar o sistema na HostGator (VPS) no domínio friospeçaseserviços.com.br

O sistema roda numa **VPS** da HostGator (hospedagem compartilhada e Cloud não rodam Node.js). O **banco continua na Supabase**; a VPS só executa o programa. O endereço técnico do domínio (por causa dos acentos) é `xn--friospeaseservios-gsbi.com.br`.

```
navegador ──HTTPS──> Caddy (VPS) ──> sistema (Node 24, porta 3000, só interna) ──> Supabase (banco)
```

> Os valores secretos (senha do root da VPS, `DATABASE_URL`, `PEPPER`, `HMAC_KEY`, `FIELD_KEY`, `BACKUP_SENHA`, senha de app do Gmail) **nunca** vão para o chat, para o GitHub nem para este repositório. Você os digita direto na VPS.

## 1. Contratar (você)

1. Na HostGator, contrate uma **VPS** (o menor plano, NVMe 2, deve bastar para começar) com **Ubuntu 22.04**.
2. Anote o **IP** da VPS e a **senha do root** que a HostGator mostrar no painel. Guarde no gerenciador de senhas.
3. Registre o domínio `friospeçaseserviços.com.br` (e, de preferência, o `friopecaseservicos.com.br` sem acento).

## 2. Entrar na VPS (você)

No PowerShell do seu computador (substitua pelo IP):

```powershell
ssh root@IP_DA_VPS
```

Digite a senha do root quando pedir (ela não aparece na tela).

## 3. Instalar (um comando)

Já dentro da VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/carlosserra-a11y/Sistema-E-comece/main/deploy/vps/instalar.sh -o instalar.sh
DOMINIO=xn--friospeaseservios-gsbi.com.br bash instalar.sh
```

Ele instala Node 24, o Caddy (HTTPS automático), o firewall, o serviço que sobe sozinho e o **backup diário às 2h** (arquivo cifrado em `/opt/wms/app/backups`). No fim ele avisa que falta preencher os segredos.

## 4. Preencher os segredos

```bash
nano /opt/wms/.env
```

Troque cada `PREENCHER` pelos **mesmos valores** que estão na Vercel (*Settings → Environment Variables*) ou no seu arquivo de segredos: `DATABASE_URL`, `PEPPER`, `HMAC_KEY`, `FIELD_KEY`, `DONO_EMAIL`, `BACKUP_SENHA`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_DE`. **`PEPPER`, `HMAC_KEY` e `FIELD_KEY` têm de ser idênticos aos da Vercel**, senão ninguém consegue entrar. Salve (`Ctrl+O`, Enter, `Ctrl+X`) e inicie:

```bash
systemctl restart wms && systemctl status wms --no-pager
```

Deve aparecer `active (running)`. Se aparecer erro, `journalctl -u wms -n 50 --no-pager` mostra o motivo.

## 5. Apontar o domínio para a VPS (você, no painel DNS)

Na zona DNS do domínio (HostGator → *Domínios* → *Zona DNS*), deixe **só** estes registros (apague os `A`/`CNAME` antigos de `@` e `www`, inclusive os da Vercel):

| Tipo | Nome | Valor |
|---|---|---|
| **A** | `@` | `IP_DA_VPS` |
| **A** | `www` | `IP_DA_VPS` |

Em alguns minutos o Caddy tira sozinho o certificado HTTPS. Teste: `https://friospeçaseserviços.com.br`.

## 6. Conferir

- A tela de login abre com o cadeado, e o seu e-mail de dono recebe o código.
- `journalctl -u caddy -n 30 --no-pager` mostra se o certificado foi emitido.
- Os dados são os mesmos de antes: o banco é o da Supabase.
- **Enquanto o DNS não for trocado, o sistema continua no ar na Vercel.** A troca do passo 5 é a "virada".

## 7. Atualizar o sistema depois

Sempre que houver versão nova no GitHub:

```bash
bash /opt/wms/app/deploy/vps/atualizar.sh
```

## 8. Backup e segurança

- O backup diário roda sozinho. **Traga uma cópia para o seu computador** de vez em quando (no PowerShell): `scp root@IP_DA_VPS:/opt/wms/app/backups/* .`
- Tire também o login do root por senha quando puder: use chave SSH. A HostGator tem a opção no painel da VPS.
- O firewall deixa abertas só as portas 22 (SSH), 80 e 443.
- O banco, o Supabase Pro e o backup do provedor continuam como em [BACKUP.md](BACKUP.md).

## 9. Voltar atrás

Se algo der errado depois da virada, basta devolver os registros `A` do passo 5 para os da Vercel (veja [DOMINIO.md](DOMINIO.md)). O sistema na Vercel continua ligado ao mesmo banco.
