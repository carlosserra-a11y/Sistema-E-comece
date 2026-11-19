# Carlos Desenvolvedor de Sistema — WMS + vendas (Mercado Livre)

Sistema web para controlar **estoque com endereçamento físico (picking)**, **etiquetar produtos** (gerador de código de barras), **reconhecer o produto na leitura**, **contar o estoque** e preparar o caminho para marketplaces e expedição. Interface em português do Brasil, moeda BRL, fuso `America/Sao_Paulo`.

Node 22+ (testado no 24). **Dois motores de banco atrás da mesma interface:** SQLite (`node:sqlite`, desenvolvimento e testes) e **PostgreSQL na Supabase** (produção). Front-end em HTML/CSS/JS puros com CSP estrita, **PWA para celular** com leitura de código pela câmera.

## Começar

```powershell
npm run setup          # cria o .env com segredos aleatórios (não imprime nada secreto)
npm run criar-admin    # cria a conta do DONO a partir do .env (grava só o hash)
npm run seed           # opcional: dados FICTÍCIOS para treinamento
npm start              # http://127.0.0.1:3000
npm test               # testes de segurança, estoque, código de barras e contraste
```

1. Abra o `.env`, leia `ADMIN_LOGIN` (11 dígitos) e `ADMIN_INITIAL_PASSWORD`.
2. Entre. O sistema obriga a **trocar a senha** e **ativar o MFA** (QR para o aplicativo autenticador) e mostra **10 códigos de recuperação uma única vez**.
3. Depois de criar o admin, **apague essas duas linhas do `.env`**.

> O login e a senha inicial **nunca** entram em código, Git, prompt ou logs.

## O que já funciona (Fases 0 a 3)

| Área | Entregue |
|---|---|
| Acesso | usuário único, senha scrypt+pepper, troca obrigatória, MFA/TOTP com anti-replay, códigos de recuperação, sessão rotacionada a cada etapa, CSRF + Origin, bloqueio progressivo, reautenticação, lista/revogação de sessões, auditoria encadeada por hash |
| Cadastros | produtos (versão otimista), fornecedores (CNPJ/CPF cifrado), códigos de barras validados, importação/exportação CSV com prévia e proteção contra injeção de fórmula |
| **Etiquetagem** | **gerador de EAN-13 interno** (prefixo 20, dígito verificador GS1), geração em lote para quem não tem código, etiquetas 40×25, 50×30, 100×50 e 100×150 mm em SVG (impressão pelo navegador) e **ZPL** (Zebra), Code 128, EAN-13/8, UPC-A e **QR Code** |
| **Reconhecimento** | leitura universal: produto (UPC-A = EAN-13 com zero), endereço, lote; ignora CR/LF, prefixo AIM, travessão tipográfico, minúsculas; avisa leitura com dígito errado; câmera (BarcodeDetector) ou leitor USB/Bluetooth |
| **Endereçamento** | `DEPÓSITO-ZONA-RUA-PRÉDIO-NÍVEL-POSIÇÃO`, criação em massa com prévia, capacidade (itens e peso), bloqueio, picking designado por produto, sugestão de onde guardar, rota em "S", mapa do galpão com heatmap e "onde está o SKU?" |
| **Estoque** | livro-razão imutável; saldo = soma das movimentações (verificado); receber, guardar/transferir, ajustar (com senha), baixar, avaria; lotes e validade (FEFO); reposição picking ← reserva |
| **Contagem** | inventário cíclico, geral ou por endereços; **contagem cega**; detecta movimento no meio da contagem; aprovação com reautenticação |
| Design | tokens OKLCH, temas escuro/claro/automático/alto contraste (contraste ≥ 4,5:1 testado), navegação lateral + abas no celular, paleta Ctrl+K, atalhos, PWA, galeria em `/#/design` |

## Fase 5: Mercado Livre

| Área | Entregue |
|---|---|
| Conexão | OAuth 2.0 com `state` de uso único, tokens e chave do app cifrados, renovação serializada (refresh de uso único), reconexão guiada |
| Pedidos | webhook `orders_v2` (segredo na URL; o pedido é sempre buscado na API) + polling de reconciliação; importação **idempotente**; cancelamento libera a reserva |
| Estoque | reserva por pedido; envio para o anúncio de `disponível − reservas − margem`, só quando muda; pausa em zero e reativa; variações |
| Mapeamento | SKU ↔ anúncio manual (valida o dono) ou automático pelo SKU do vendedor |
| Saúde | verde/amarelo/vermelho, últimos erros, histórico de sincronizações, pedidos "com problema" (SKU não mapeado, venda acima do estoque) |

> **Ainda não foi testado contra o Mercado Livre real** (só contra um servidor falso fiel à documentação). Valide com a sua conta antes de ligar a pausa automática. Detalhes e limites em [docs/INTEGRACOES.md](docs/INTEGRACOES.md).

## Próximas fases

Shopee, NF-e (Bling/Tiny), fluxo do pedido (separação mobile, conferência, embalagem), expedição, devoluções e relatórios **ainda não existem**. Veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Documentação

[ARQUITETURA](docs/ARQUITETURA.md) · [SEGURANCA](docs/SEGURANCA.md) · [DECISOES](docs/DECISOES.md) · [OPERACAO](docs/OPERACAO.md) · [DESIGN](docs/DESIGN.md) · [INTEGRACOES](docs/INTEGRACOES.md)

## Produção: Supabase + Vercel

- **Banco:** Supabase (PostgreSQL). O esquema fica em `supabase/migrations/` (RLS ligado; o app usa o papel `app_wms`, sem poder alterar livro-razão/auditoria).
- **Site:** Vercel — a função `api/[...rota].js` roda o mesmo sistema; `public/` sai da CDN com os mesmos cabeçalhos de segurança (`vercel.json`, conferido por teste).
- **Variáveis de ambiente:** veja `.env.example` (`DATABASE_URL`, `PEPPER`, `HMAC_KEY`, `FIELD_KEY`, `PUBLIC_ORIGIN`, `TRUST_PROXY=true`, `CRON_SECRET`, `NODE_ENV=production`). **Nunca** commite valores.
- **Testes nos dois motores:** `npm test` (SQLite) e `npm run test:pg` (PostgreSQL embutido via PGlite).

## Documentação

- [Guia do dono](docs/GUIA-DO-DONO.md) — onde fica tudo, acesso, equipe/permissões, limites do plano grátis, backup, segredos, migração para a Hostinger.
- [Operação](docs/OPERACAO.md) · [Segurança](docs/SEGURANCA.md) · [Arquitetura](docs/ARQUITETURA.md) · [Integrações](docs/INTEGRACOES.md) · [Decisões](docs/DECISOES.md)
