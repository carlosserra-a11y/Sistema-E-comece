# Decisões

Registradas porque o prompt pedia perguntas e não houve resposta: valeu o padrão mais seguro e simples.

| Tema | Decisão | Motivo |
|---|---|---|
| Ponto de partida | As Fases 0–2 não existiam nesta máquina, então foram **refeitas do zero** seguindo a descrição do prompt | o prompt prevê recomeçar em pasta vazia |
| Nome | **Armazém** (`APP_NAME` no `.env`) | `[NOME_DO_SISTEMA]` não foi definido |
| Marca/cor | azul-ciano como acento, sem logotipo (ícone de caixa em SVG) | seguiu os tokens do prompt |
| Stack | Node 24 sem dependências, `node:sqlite`, front-end sem build | alvo "hoje" do prompt; sem rede para pacotes |
| Código interno | EAN-13 com prefixo **20** (circulação restrita GS1) + sequência de 10 dígitos + verificador | não conflita com códigos de fabricante e todo leitor lê |
| Códigos livres | 3–40 caracteres A–Z/0–9/`._-`, nunca parecidos com endereço (`D1-A-03-02-01-04`) ou lote (`LT-000123`) | leitura sem ambiguidade |
| Endereço | `DEPÓSITO-ZONA-RUA-PRÉDIO-NÍVEL-POSIÇÃO`, dois dígitos por parte (1–99), zona de 1–3 letras | padrão do prompt |
| Depósito inicial | `D1` com zonas R (recebimento), P (picking), V (reserva), A (avaria), D (devolução), Q (quarentena), E (expedição) e um endereço em cada zona de apoio | operação funciona no primeiro dia |
| Disponível | só picking e reserva contam como disponível | recebimento/avaria/devolução/quarentena/expedição são físicos, não vendáveis |
| Lote | `lote_id = 0` significa "sem lote"; FEFO ordena por validade | simplifica a chave do saldo |
| Capacidade | 0 = sem limite; por itens e por peso; nunca reduz abaixo do que já tem | evita estado inconsistente |
| Idempotência | obrigatória (`Idempotency-Key`) em receber/transferir/ajustar/baixar/avaria; guardada 2 dias | duplo clique e queda de rede |
| Reautenticação | senha, janela de 5 min, para ajuste, aprovação de contagem e gestão da equipe | ações críticas |
| Segunda etapa | QR/TOTP removido em 22/11/2026 a pedido do dono; no lugar, código de 6 dígitos enviado ao e-mail da conta a cada login (só contas com e-mail confirmado) | simples para a equipe; depende do envio de e-mail (interruptor `LOGIN_CODIGO=0`) |
| Entrada do dono | só e-mail + código (sem senha), via `DONO_EMAIL`, a pedido do dono em 22/11/2026 | conta de desenvolvedor sem senha para lembrar; a segurança passa a ser a do Gmail |
| Aprovação de inventário | o mesmo usuário cria e aprova (único usuário), registrado como `auto_aprovacao` na auditoria | separação de funções chega com a equipe/RBAC |
| Contagem | cega por padrão; item achado fora do sistema entra com saldo 0 | evita viés |
| Sessão | ociosa 30 min, absoluta 12 h, pré-login 15 min | equilíbrio segurança/uso |
| Bloqueio | 10 tentativas erradas → 1 min, dobrando até 60 min (constante `TENTATIVAS_MAX`) | progressivo; senha fraca na troca de senha não conta tentativa |
| CSV | aceita `;` ou `,`, `12,50` e BOM; só **cria** produtos (SKU existente é ignorado) | seguro por padrão |
| Datas | milissegundos UTC no banco; exibição em `America/Sao_Paulo` | prompt |
| Fonte | pilha do sistema (Inter/Geist local fica pendente) | sem download |
| ML: autenticação do webhook | segredo na URL (rotacionável) + buscar sempre o pedido na API | o `orders_v2` não traz assinatura; o corpo só indica qual pedido buscar |
| ML: reserva | por produto (não por endereço), ativa ao importar pedido novo/pago; baixa física fica para a expedição | evita vender o mesmo estoque duas vezes sem antecipar a Fase 6 |
| ML: estoque do anúncio | `max(0, disponível − reservas − margem)`; pausa/reativa opcional | ML já abate a venda no anúncio; reservar e descontar da mesma conta evita contar duas vezes |
| ML: polling | a cada 10 min (`ML_POLL_MIN`, 0 desliga), janela de 7 dias | reconcilia webhook perdido sem sobrecarregar a API |
| ML: pedido cancelado | estado terminal | o ML não reativa pedido cancelado; evita reservar de novo por reenvio antigo |
| ML: dados do comprador | só apelido e id | LGPD: endereço/CPF só serão guardados quando a etiqueta exigir (Fase 7) |
| Aviso de etiqueta | barras com módulo < 2 pontos geram aviso | leitores baratos falham com barras muito finas |


## Equipe, Supabase e Vercel (nov/2026)

- **Dono único + equipe:** uma conta `dono=1` (índice único parcial) com todas as funções; as demais têm lista de permissões escolhida pelo dono. Rotas sem regra em `src/permissoes.js` ficam **negadas para todos** (teste garante que nenhuma rota fica sem regra). `usuarios.gerenciar` nunca é delegável.
- **Financeiro restrito:** além de proteger as rotas, o servidor remove `custo_centavos`, `preco_centavos` e `total_centavos` de **toda** resposta de quem não tem `financeiro.ver`, e ignora esses campos na gravação.
- **Dois bancos, um código:** SQL com `?`, sem dialeto nos módulos. Diferenças ficam em `src/db.js` e no esquema (`migrations/` SQLite × `supabase/migrations/` Postgres). O Postgres de teste é o **PGlite** (Postgres real em WebAssembly) — a mesma suíte passa nos dois.
- **Saldo no Postgres:** trigger PL/pgSQL faz UPDATE antes do INSERT (o CHECK de um UPSERT rejeitaria saídas) e usa trava consultiva por chave; a cadeia de auditoria usa trava consultiva para não bifurcar.
- **Papel `app_wms`:** o app nunca usa o `postgres`. RLS ligado com política só para esse papel; `anon`/`authenticated` sem acesso; sem UPDATE/DELETE em `auditoria` e `movimentacoes_estoque`.
- **Vercel:** função catch-all reaproveita `montar()`; `waitUntil` termina o processamento em segundo plano do webhook; cron diário de manutenção (plano Hobby só permite 1x/dia). Limitador de requisições em memória é por instância (o bloqueio de login é no banco, então vale para todas).
- **Celular:** PWA (ícones PNG, atalhos), barra inferior com botão **Bipar**, leitor em tela cheia (BarcodeDetector nativo; ZXing local no iPhone, sem CDN por causa da CSP).
