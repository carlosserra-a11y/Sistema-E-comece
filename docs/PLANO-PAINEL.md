# Plano: painel interativo, rastreio da equipe e nova identidade (26/11/2026)

Pedido do dono, literal: "Agora vamos fazer outra atualização. Vamos focar na identidade visual agora. Eu quero que você faça um dashboard personalizado com mais interações. Eu quero que os botões da tela inicial dê para apertar e direcione para o lugar destinado. Por exemplo [...] vendas de hoje no balcão, eu quero que clique nele e vá para algum lugar direcionado. Produtos ativos, eu quero que me mostre os produtos que estão ativos. Unidade de estoque, me mostra qual produto e a unidade. E faço com que eu consiga ver quem da equipe bipou, quem da equipe conferiu, quem da equipe fez a expedição, quem da equipe estava no caixa. [...] uma coisa mais interativa, com pequenas animações, sem perder o lado profissional. Quero extremamente profissional, só que com mais atual. Pense em algo a mais, revise todos os bugs, teste completamente o sistema e salve tudo. E coloque no ar."

## Onde está
- Repositório: pasta `sistema` desta sessão; GitHub `carlosserra-a11y/Sistema-E-comece`. Base: `main` = `fe0bc37` (no ar na VPS).
- Ramo desta atualização: `feat/painel-identidade`.
- Testes: `npm test` e `npm run test:pg` (mover `.env` para `.env.teste-local` antes e devolver depois). Telas: `node <scratchpad>/imports.mjs`.
- Edições em arquivos existentes: script Python em `<scratchpad>` usando `sub.py` (troca exata); arquivos LF; `core.autocrlf=false`. GateGuard pede fatos a cada arquivo novo e comando destrutivo.
- Teste visual: preview `frio-local` (porta 3111); login de teste no `.env` (`ADMIN_LOGIN`, `ADMIN_TEST_PASSWORD`); vendedor fictício `11144477735`. A ferramenta `type` não gera teclas: usar `key` ou eventos; screenshot destrava a tela quando o painel está oculto.
- Publicar (autorizado pelo pedido): backup `deploy/vps/backup-pg.sh`; ensaio numa cópia `wms_teste` com o código clonado em `/tmp/wms-ensaio` (`APP=/tmp/wms-ensaio BANCO=wms_teste bash deploy/vps/aplicar-esquema.sh`); `git push origin <ramo>:main`; na VPS `bash /opt/wms/app/deploy/vps/atualizar.sh`; `node scripts/verificar-dados.js` com as variáveis do `/opt/wms/.env`; Os dados de acesso ao servidor ficam só na nota do projeto no cofre do Obsidian (este repositório é público). Nunca criar dados de teste no banco no ar. Vercel continua pausada.

## Escopo
1. **Rastreio** (tabela `etapas`, imutável): venda ou pedido passa por SEPARACAO → CONFERENCIA → EXPEDICAO; cada passo grava quem e quando. Separação e conferência exigem bipar os itens e bater as quantidades. Permissões `expedicao.ver` e `expedicao.operar`. Tela **Expedição**.
2. **Equipe em ação** (`atividade.ver`): por pessoa no período (bipagens de estoque, separações, conferências, expedições, vendas no caixa, caixa aberto agora) e linha do tempo.
3. **Início clicável:** cada cartão leva à tela certa; gráfico de vendas de 7 dias, fila de expedição, atalhos, atualização automática.
4. **Identidade** (`public/css/identidade.css`, carregado por último): menu agrupado, topo com a pessoa, cartões com elevação e seta, animações curtas respeitando "reduzir movimento"; tokens de cor não mudam (há teste de contraste).

## Fora do escopo
Nota fiscal, transportadora/rastreio de entrega, fontes externas (a CSP não permite).
