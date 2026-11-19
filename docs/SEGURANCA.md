# Segurança

Base: OWASP ASVS nível 2 e Top 10. Tudo abaixo é coberto por testes automatizados (`test/seguranca.test.js`, `test/estoque.test.js`) salvo onde indicado.

## Controles implementados

| Tema | Controle |
|---|---|
| Identidade | usuário único (índice sobre expressão constante impede o segundo); login de 11 dígitos guardado só como HMAC; sem tela de cadastro |
| Senha | scrypt (N=32768) com pepper fora do banco; política 12–128 sem datas, sequências ou repetição; troca obrigatória; nova ≠ atual; ao trocar, as outras sessões caem |
| Enumeração | mesma resposta e mesmo tempo (verificação falsa) para login inexistente e senha errada; o bloqueio vale também para logins que não existem |
| Força bruta | limite por IP (20/15 min), bloqueio progressivo por login (5 falhas → 1, 2, 4… até 60 min), 8 tentativas de MFA por sessão e a sessão é revogada ao 5º erro |
| MFA | TOTP RFC 6238 (vetor oficial testado), janela ±1, **anti-replay** (só aceita passo maior que o último), segredo cifrado AES-256-GCM, 10 códigos de recuperação de uso único (HMAC no banco) |
| Sessão | token de 256 bits (só o SHA-256 vai ao banco); cookie `HttpOnly`, `SameSite=Strict`, `Secure` + prefixo `__Host-` em produção; **rotação a cada etapa**; ociosa 30 min, absoluta 12 h; lista e revogação |
| CSRF | token sem estado (HMAC da sessão) + checagem de `Origin` + `Sec-Fetch-Site`; JSON obrigatório (415 para outros tipos) |
| Reautenticação | ajuste de estoque, aprovação de contagem e novos códigos de recuperação exigem a senha de novo (janela de 5 min) |
| Entrada | esquema por rota com lista de campos permitidos (mass assignment), `__proto__` ignorado, limites de tamanho, SQL sempre parametrizado, `LIKE` com escape |
| Saída | nenhum `innerHTML`; SVG de etiqueta com texto escapado e `Content-Security-Policy: sandbox`; CSV neutraliza `= + - @` |
| Cabeçalhos | CSP `default-src 'none'` sem `unsafe-inline`/`unsafe-eval`, `nosniff`, `frame-ancestors`/`X-Frame-Options`, COOP/CORP, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS em produção, `no-store` na API |
| Host | lista de hosts permitidos (proteção contra DNS rebinding) |
| Arquivos | `path.resolve` + prefixo do diretório público, `..` e `%2e%2e` testados, arquivos ocultos negados |
| Auditoria | só-inserção (gatilhos), encadeada por hash, verificável; criada **na mesma transação** da ação; não guarda senha, token, login nem segredo (testado) |
| Dados | CNPJ/CPF cifrado (AES-256-GCM) + HMAC para unicidade + exibição mascarada; segredos só no `.env` (ignorado pelo Git) |
| Integridade do estoque | razão imutável, saldo por gatilho, `CHECK (qtd >= 0)`, idempotência por chave, verificação saldo × razão |

## Revisão adversarial do próprio código (bugs achados e corrigidos)

| # | Problema | Como apareceu | Correção |
|---|---|---|---|
| 1 | **Toda saída de estoque era recusada**: o SQLite checa o `CHECK` da linha proposta *antes* de resolver um UPSERT | teste de transferência | gatilho com `UPDATE` seguido de `INSERT` condicional + teste de regressão |
| 2 | Editar fornecedor com o documento em branco apagava o documento salvo | revisão | mantém o valor atual quando o campo vem vazio |
| 3 | Validador tratava a lista de endereços do inventário como texto | revisão | campo removido do esquema; lista validada à parte |
| 4 | `append(null/undefined/false)` imprimia "null"/"undefined" na tela | teste no navegador | `append`/`prepend` filtram vazios e achatam listas |
| 5 | Abas e tabelas encolhiam a altura zero dentro de gaveta/modal | teste no navegador | `grid-auto-rows: max-content` |
| 6 | Rolagem horizontal no celular em Estoque, Endereços e Configurações | medição por script | colunas `minmax(0, 1fr)` e `min-width: 0` |
| 7 | Gaveta aberta ficava por cima ao mudar de tela | teste no navegador | roteador remove sobreposições |
| 8 | "Digitar + Enter" rápido reabria a lista do combobox depois da escolha | teste no navegador | busca pendente é cancelada ao escolher |
| 9 | Duplo clique em "Receber" poderia duplicar a entrada | análise | chave de idempotência por formulário; reenvio devolve a mesma resposta |
| 10 | Dois lotes no mesmo endereço tornavam a baixa ambígua | análise | exige escolher o lote |
| 11 | Mesmo lote com validade diferente | análise | recusa (`LOTE_VALIDADE`) |
| 12 | Movimento durante a contagem gerava ajuste errado | análise | `mov_base` por item; aprovação recusa e pede recontagem |
| 13 | UPC-A lido como EAN-13 (zero à frente) não achava o produto; mesmo código em dois produtos | análise | `variantes()` na busca e na checagem de colisão |
| 15 | O fallback da SPA devolvia `index.html` para `/.env` e outros caminhos ocultos (não vazava nada, mas mascarava o 404) | teste de caminho oculto, depois de existir o `index.html` | qualquer segmento começando com `.` responde 404 antes do fallback |
| 14 | SKU igual ao código de barras de outro produto (leitura ambígua) | análise | colisão recusada nos dois sentidos; códigos livres não podem parecer endereço/lote |

## Limitações conhecidas (honestas)

- **Código de barras lido por leitor real não foi testado.** O QR foi decodificado com OpenCV (versões 1 a 10 e o QR do MFA). EAN-13, EAN-8 e Code 128 foram validados com vetores GS1, estrutura e decodificação própria; o detector de barras do OpenCV não leu as imagens sintéticas. **Imprima uma etiqueta e leia com o seu leitor antes de etiquetar o estoque.**
- scrypt no lugar de Argon2id e sem checagem de senha vazada (HIBP): exigem pacote/rede.
- Limitador de taxa em memória (um processo). Um invasor pode bloquear o login do dono por até 60 min com tentativas erradas (o IP é limitado, mas é o custo do bloqueio progressivo).
- Sem WebAuthn/Passkeys, sem alerta de novo dispositivo, sem RBAC (só o admin).
- Sem teste automatizado de acessibilidade (axe), de captura de tela em 3 larguras ou de desempenho (LCP/INP): exigem Playwright/rede. A verificação foi manual no navegador do app e por script (contraste, rolagem horizontal).
- Sem SAST/SCA/gitleaks no CI e sem backups criptografados (a fazer na Fase 9).
- Fonte Inter/Geist local não incluída (sem download): usa a pilha de fontes do sistema.

## Resposta a incidente (resumo)

1. Suspeita de vazamento: troque `PEPPER`, `HMAC_KEY` e `FIELD_KEY` (invalida sessões e códigos; refaça MFA), rode `npm run criar-admin` após limpar `users`.
2. Revogue sessões em Configurações → "Sair de todos".
3. Rode "Verificar integridade" (cadeia de auditoria + estoque) e restaure o último backup se houver divergência.
