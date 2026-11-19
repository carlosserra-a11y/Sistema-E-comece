# Design system

Galeria viva: `/#/design` (tokens, tipografia, botões, campos, badges, abas, tabela, gráfico, estados, gaveta, modal).

## Tokens (`public/css/tokens.css`)

- Cores em **OKLCH**. Temas: **escuro (padrão)**, claro, automático (segue o sistema) e **alto contraste**; `prefers-contrast` reforça bordas.
- Todo par texto/fundo tem contraste **≥ 4,5:1**, verificado por `test/contraste.test.js` nos quatro temas.
- Escala de texto 12/14/16/20/24/32/40 px, espaçamento de 4 px, raios 8/12/16/pill, movimento 160 ms `ease-out` (desligado com `prefers-reduced-motion`).
- Camadas CSS (`@layer`), `container queries` nos cartões, `color-mix()`, `clamp()`, `dvh`, `accent-color`, `scrollbar-gutter`. View Transitions entre telas.

## Princípios aplicados

- **Cor nunca é o único sinal:** badges têm texto e ícone; o feedback de leitura combina cor, texto, bipe e vibração.
- **Operação sem erro:** campos enormes para leitura/quantidade, botão de 72 px, tela cheia verde/vermelha.
- **Mobile-first:** abas inferiores (Início, Consulta, Estoque, Contagem, Mais) com alvo ≥ 48 px e *safe-area*; sem rolagem horizontal (medido em todas as telas).
- **Estados completos:** carregando (skeleton), vazio (com ação), erro (com "tentar de novo"), sucesso (toast), offline (faixa).
- **Teclado:** `Ctrl/⌘+K` paleta, `/` busca, `G` + letra navega, `N` novo, `?` lista, foco visível, gaveta/modal prendem o foco e fecham com `Esc`; abas e combobox com setas.
- **Segurança no design:** login minimalista com *stepper*, medidor de força por comprimento, códigos de recuperação com copiar/baixar e aviso "só aparecem agora", reautenticação com explicação, aviso de sessão a expirar.
- **PWA:** manifest + service worker que guarda **só arquivos estáticos** (nunca a API).

## Critérios de aceite (4.8)

| Critério | Situação |
|---|---|
| Contraste verificado por script | ✅ |
| Sem `innerHTML`, CSP estrita sem exceções | ✅ (CSP testada) |
| Sem rolagem horizontal no celular | ✅ medido por script em 10 telas |
| Navegação por teclado | ✅ implementada; verificação manual parcial |
| Auditoria axe sem erros graves | ⏳ requer ferramenta externa |
| Capturas Playwright em 390/768/1280, claro e escuro | ⏳ requer Playwright (feito manualmente em 375 e 800 px, escuro) |
| LCP < 2 s, INP < 200 ms, JS inicial < 150 KB | ⏳ não medido (JS é carregado por tela sob demanda) |
| Fonte variável hospedada localmente | ⏳ pilha do sistema por enquanto |
