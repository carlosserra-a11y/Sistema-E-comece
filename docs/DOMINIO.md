# Domínio próprio: friospecaseservicos.com.br

O domínio foi registrado na HostGator (22/11/2026, renovação em 22/10/2028) e o DNS já aponta para o sistema.

- Domínio do sistema: `friospecaseservicos.com.br` (e `www`, que redireciona para ele).
- O nome do sistema na tela continua **FRIO Peças e Serviços** (variável `APP_NAME` na Vercel).
- O endereço antigo `carlos-sistema-carlos-nunes.vercel.app` continua funcionando junto.

## Como está configurado

**Zona DNS (painel da HostGator → Domínios → Gerenciar → Configurar domínio → Zona avançada de DNS):**

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | `216.198.79.1` |
| A | `@` | `64.29.17.1` |
| CNAME | `www` | `cb6f3f7969d0cf7e.vercel-dns-017.com` |

Os registros `ftp` e `mail` (CNAME) e o MX que a HostGator cria por padrão foram mantidos. Os valores acima são os que a Vercel pediu para este projeto; eles mudam se o projeto mudar de conta.

**Vercel:** o domínio e o `www` estão cadastrados no projeto, e a variável `ORIGENS_EXTRAS` lista os endereços aceitos pelo servidor (o domínio, o `www` e o endereço da Vercel). O HTTPS (cadeado) é emitido sozinho pela Vercel.

## Passo final: trocar o endereço principal

Quando `https://friospecaseservicos.com.br` abrir a tela de login:

1. Na Vercel (*Settings → Environment Variables*), mude `PUBLIC_ORIGIN` para `https://friospecaseservicos.com.br` (o endereço da Vercel fica em `ORIGENS_EXTRAS`).
2. Faça um *Redeploy*.
3. Se usar o Mercado Livre, atualize a URL de redirecionamento no painel do app deles para o novo endereço.

## Hospedar na HostGator (VPS)

A decisão é rodar o sistema também na **VPS da HostGator**, neste mesmo domínio. O passo a passo está em [VPS-HOSTGATOR.md](VPS-HOSTGATOR.md) (script pronto em `deploy/vps/`).

- **Hoje:** domínio → Vercel (acima).
- **Depois da VPS:** na "virada", os dois registros `A` passam a apontar para o IP da VPS e o `www` vira um `A` com o mesmo IP. A Vercel continua ligada ao mesmo banco e serve de plano B. Para voltar atrás, devolva os registros da tabela acima.
- Um domínio só aponta para um lugar por vez: por isso a virada é uma troca de registros.
