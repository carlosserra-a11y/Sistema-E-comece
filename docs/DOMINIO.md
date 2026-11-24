# Domínio próprio: friospecaseservicos.com.br

O domínio foi registrado na HostGator (22/11/2026, renovação em 22/10/2028) e o DNS já aponta para o sistema.

- Domínio do sistema: `friospecaseservicos.com.br` (e `www`, que redireciona para ele).
- O nome do sistema na tela continua **FRIO Peças e Serviços** (variável `APP_NAME` na Vercel).
- O endereço antigo `carlos-sistema-carlos-nunes.vercel.app` continua funcionando junto.

## Como está configurado (24/11/2026: o domínio já aponta para a VPS)

**Zona DNS** (painel da HostGator → Domínios → Gerenciar → Configurar domínio → Zona avançada de DNS):

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `@` | `143.95.190.252` (IP da VPS) | 300 |
| CNAME | `www` | `friospecaseservicos.com.br` | 300 |

Os registros `ftp` e `mail` (CNAME) e o MX que a HostGator cria por padrão foram mantidos. O HTTPS é emitido e renovado sozinho pelo Caddy na VPS (Let's Encrypt).

**Banco:** o PostgreSQL da própria VPS. Os dados foram copiados da Supabase em 24/11/2026 e conferidos linha a linha. A Supabase fica parada, só como cópia de segurança, até ~24/12/2026.

**Vercel:** o endereço antigo `carlos-sistema-carlos-nunes.vercel.app` ainda existe, mas aponta para a Supabase (dados parados em 24/11). Ninguém deve usá-lo; quando quiser, pause o projeto na Vercel.


## Hospedar na HostGator (VPS)

A decisão é rodar o sistema também na **VPS da HostGator**, neste mesmo domínio. O passo a passo está em [VPS-HOSTGATOR.md](VPS-HOSTGATOR.md) (script pronto em `deploy/vps/`).

- **Hoje:** domínio → Vercel (acima).
- **Depois da VPS:** na "virada", os dois registros `A` passam a apontar para o IP da VPS e o `www` vira um `A` com o mesmo IP. O banco passa a ser o da VPS (PostgreSQL local): depois que a equipe trabalhar nele, voltar para a Vercel perderia o que foi digitado (veja a seção "Voltar atrás" em VPS-HOSTGATOR.md).
- Um domínio só aponta para um lugar por vez: por isso a virada é uma troca de registros.
