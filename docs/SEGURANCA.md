# Segurança

Base: OWASP ASVS nível 2 e Top 10. Tudo abaixo é coberto por testes automatizados (`test/seguranca.test.js`, `test/estoque.test.js`) salvo onde indicado.

## Controles implementados

| Tema | Controle |
|---|---|
| Identidade | login por e-mail (Gmail), guardado só cifrado (AES-256-GCM) + HMAC; pontos e `+etiqueta` do Gmail contam como o mesmo e-mail; a conta do dono entra com o código de 11 dígitos (só HMAC) |
| Senha | scrypt (N=32768) com pepper fora do banco; política 12–128 sem datas, sequências ou repetição; troca obrigatória; nova ≠ atual; ao trocar, as outras sessões caem |
| Enumeração | mesma resposta e mesmo tempo (verificação falsa) para login inexistente e senha errada; o bloqueio vale também para logins que não existem |
| Força bruta | limite por IP (60/15 min), bloqueio progressivo por login/e-mail (10 falhas → 1, 2, 4… até 60 min), cadastro limitado por aparelho (5/h) e no total (30/h) |
| Confirmação do e-mail | código de 6 dígitos sorteado com `crypto.randomInt`, guardado só como HMAC, vale 10 min, 5 erros o invalidam, reenvio a cada 60 s (máx. 5/h). O código só vale **junto com a senha do cadastro** (ninguém "pré-registra" o e-mail de outra pessoa e o confirma por ela). Conta nova fica **pendente, sem nenhuma permissão**, até o dono liberar; cadastro não confirmado some em 24 h |
| Sessão | token de 256 bits (só o SHA-256 vai ao banco); cookie `HttpOnly`, `SameSite=Strict`, `Secure` + prefixo `__Host-` em produção; **rotação a cada etapa**; ociosa 30 min, absoluta 12 h; lista e revogação |
| CSRF | token sem estado (HMAC da sessão) + checagem de `Origin` + `Sec-Fetch-Site`; JSON obrigatório (415 para outros tipos) |
| Reautenticação | ajuste de estoque, aprovação de contagem e gestão da equipe exigem a senha de novo (janela de 5 min) |
| Entrada | esquema por rota com lista de campos permitidos (mass assignment), `__proto__` ignorado, limites de tamanho, SQL sempre parametrizado, `LIKE` com escape |
| Saída | nenhum `innerHTML`; SVG de etiqueta com texto escapado e `Content-Security-Policy: sandbox`; CSV neutraliza `= + - @` |
| Cabeçalhos | CSP `default-src 'none'` sem `unsafe-inline`/`unsafe-eval`, `nosniff`, `frame-ancestors`/`X-Frame-Options`, COOP/CORP, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS em produção, `no-store` na API |
| Host | lista de hosts permitidos (proteção contra DNS rebinding) |
| Arquivos | `path.resolve` + prefixo do diretório público, `..` e `%2e%2e` testados, arquivos ocultos negados |
| Auditoria | só-inserção (gatilhos), encadeada por hash, verificável; criada **na mesma transação** da ação; não guarda senha, token, login nem segredo (testado) |
| Dados | CNPJ/CPF cifrado (AES-256-GCM) + HMAC para unicidade + exibição mascarada; segredos só no `.env` (ignorado pelo Git) |
| Integração (ML) | OAuth com `state` de uso único; credenciais e tokens cifrados; webhook por segredo rotacionável que **nunca confia no corpo**; hosts fixos e IDs validados (SSRF); sem token em erro, log ou auditoria — detalhes em [INTEGRACOES](INTEGRACOES.md) |
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
| 16 | Corpo grande demais no webhook derrubava o socket (o cliente via erro de rede, não `413`) | teste do webhook | o excesso é descartado sem memória e a resposta `413` sai; só quem insiste é cortado |
| 17 | O refresh token do ML é de uso único: duas sincronizações simultâneas poderiam gastar o mesmo e derrubar a conexão | análise | renovação serializada por trava; teste com duas chamadas simultâneas = uma renovação |
| 18 | Trocar a conta do vendedor deixaria enviar estoque para anúncios de outro dono | análise | sincronização dos anúncios antigos é desligada e auditada |
| 14 | SKU igual ao código de barras de outro produto (leitura ambígua) | análise | colisão recusada nos dois sentidos; códigos livres não podem parecer endereço/lote |

## Limitações conhecidas (honestas)

- **Cadastro liberado pelos donos (26/11/2026).** O código de conta nova vai só para o e-mail dos donos ativos (vale 30 min, 5 erros o invalidam, contados também em pedidos simultâneos; no total, 20 pedidos/hora e 60/dia). Cada código serve só para o seu uso (cadastro, entrada, confirmação de ação, vínculo de e-mail) e só funciona junto com a senha do cadastro. Com ele a conta nasce como **Vendedor de balcão**. O e-mail digitado **não é testado** nesse passo: o primeiro código de entrada é que prova que ele está certo.
- **Segunda etapa por e-mail (22/11/2026).** Quem tem e-mail confirmado recebe um código de 6 dígitos a cada login (10 min, 5 erros o invalidam, reenvio a cada 60 s) e a sessão só abre depois dele. A conta do dono só passa a ter essa etapa depois de **vincular um e-mail** em Configurações. Quem tiver a senha **e** o e-mail entra: ligue a verificação em duas etapas do Google no e-mail. Interruptor de emergência: `LOGIN_CODIGO=0` na Vercel (desliga a etapa se o envio de e-mail cair). **Conta do dono:** a variável `DONO_EMAIL` liga o e-mail do desenvolvedor à conta de dono (já confirmado, porque quem controla a Vercel é o dono) e essa conta entra **só com e-mail + código, sem senha** (`/api/login/email`; resposta igual para qualquer outro e-mail). A prova passa a ser a caixa de entrada: proteja esse Gmail com a verificação em duas etapas do Google. Com `LOGIN_CODIGO=0` essa porta fecha; a senha provisória do dono continua como entrada de emergência. **Mais de um dono:** `DONOS_EXTRAS_JSON` cria donos adicionais (e-mail confirmado, senha aleatória que ninguém conhece); ações sensíveis deles se confirmam com um código enviado ao e-mail (`/api/reautenticar/codigo`). Um dono não altera, desativa nem redefine a conta do outro.
- O envio do código depende de um Gmail com "senha de app" configurado na Vercel; sem isso o cadastro fica desligado (a tela nem mostra "Criar conta").

- **Código de barras lido por leitor real não foi testado.** O QR foi decodificado com OpenCV (versões 1 a 10 ). EAN-13, EAN-8 e Code 128 foram validados com vetores GS1, estrutura e decodificação própria; o detector de barras do OpenCV não leu as imagens sintéticas. **Imprima uma etiqueta e leia com o seu leitor antes de etiquetar o estoque.**
- scrypt no lugar de Argon2id e sem checagem de senha vazada (HIBP): exigem pacote/rede.
- Limitador de taxa em memória (um processo). Um invasor pode bloquear o login do dono por até 60 min com tentativas erradas (o IP é limitado, mas é o custo do bloqueio progressivo).
- Sem WebAuthn/Passkeys, sem alerta de novo dispositivo, sem RBAC (só o admin).
- Sem teste automatizado de acessibilidade (axe), de captura de tela em 3 larguras ou de desempenho (LCP/INP): exigem Playwright/rede. A verificação foi manual no navegador do app e por script (contraste, rolagem horizontal).
- Sem SAST/SCA/gitleaks no CI e sem backups criptografados (a fazer na Fase 9).
- Fonte Inter/Geist local não incluída (sem download): usa a pilha de fontes do sistema.

## Resposta a incidente (resumo)

1. Suspeita de vazamento: troque `PEPPER`, `HMAC_KEY` e `FIELD_KEY` (invalida sessões e códigos de confirmação pendentes), rode `npm run criar-admin` após limpar `users`.
2. Revogue sessões em Configurações → "Sair de todos".
3. Rode "Verificar integridade" (cadeia de auditoria + estoque) e restaure o último backup se houver divergência.
