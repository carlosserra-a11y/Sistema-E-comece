# Domínio próprio: friospeçaseserviços.com.br

O sistema já está preparado para responder neste domínio. Falta só **comprar o domínio** e **apontar o DNS** (a parte que só você pode fazer, na conta da HostGator).

- Nome do domínio: `friospeçaseserviços.com.br`
- Endereço técnico (é o que o navegador usa por baixo, por causa dos acentos): `xn--friospeaseservios-gsbi.com.br`
- O nome do sistema na tela continua **FRIO Peças e Serviços** (variável `APP_NAME` na Vercel).

> Dica: registre também a versão **sem acento**, `friopecaseservicos.com.br`. Digitar "ç" e "ã" no celular e em e-mails dá problema; o endereço sem acento evita clientes e equipe errarem. Dá para mandar as duas para o mesmo sistema.

## O que já está feito (Vercel)

- O domínio e o `www` já estão cadastrados no projeto da Vercel (o `www` redireciona para o endereço sem `www`).
- O servidor já aceita esses endereços (variável `ORIGENS_EXTRAS`). O endereço antigo `carlos-sistema-carlos-nunes.vercel.app` **continua funcionando** junto.

## O que você faz (depois de comprar o domínio)

No painel onde o domínio fica (HostGator → *Domínios* → *Zona DNS* / *Gerenciar DNS*), crie:

| Tipo | Nome (host) | Valor |
|---|---|---|
| **A** | `@` (o domínio sem nada na frente) | `216.198.79.1` |
| **A** | `@` | `64.29.17.1` |
| **CNAME** | `www` | `cb6f3f7969d0cf7e.vercel-dns-017.com.` |

- Apague antes qualquer registro `A` ou `CNAME` antigo de `@` e `www` (a HostGator costuma criar um de "página em construção").
- Os valores acima são os que a Vercel pediu para este projeto. Se a HostGator não aceitar dois `A`, crie só o primeiro, `216.198.79.1`.
- A internet leva de alguns minutos a algumas horas para enxergar a mudança.
- Se o domínio for registrado no **Registro.br** em vez da HostGator, os mesmos registros são feitos lá.

Quando o DNS pegar, a Vercel libera o HTTPS (cadeado) sozinha. Teste abrindo `https://friospeçaseserviços.com.br`.

## Passo final: trocar o endereço principal

Só **depois** de o domínio abrir com HTTPS:

1. Na Vercel (*Settings → Environment Variables*), mude `PUBLIC_ORIGIN` para `https://xn--friospeaseservios-gsbi.com.br` e deixe o endereço antigo da Vercel dentro de `ORIGENS_EXTRAS`.
2. Faça um *Redeploy*.
3. Se usar o Mercado Livre, atualize a URL de redirecionamento no painel do app deles para `https://xn--friospeaseservios-gsbi.com.br/...` (o caminho continua o mesmo de hoje).

Não troque o `PUBLIC_ORIGIN` antes: com o DNS ainda errado, o sistema para de responder.

## E a VPS da HostGator?

A decisão é hospedar o sistema também na **HostGator (VPS)**, neste mesmo domínio. O passo a passo está em [VPS-HOSTGATOR.md](VPS-HOSTGATOR.md).

- **Caminho rápido (hoje):** domínio → Vercel, com os registros acima. Funciona assim que o domínio for comprado, sem VPS.
- **Caminho final:** instalar o sistema na VPS (script pronto em `deploy/vps/`) e, na "virada", trocar os registros `A` do domínio para o IP da VPS. A Vercel continua ligada ao mesmo banco e serve de plano B.
- Um domínio só aponta para um lugar por vez: por isso a virada é uma troca de registros `A`, e voltar atrás é trocar de novo.
