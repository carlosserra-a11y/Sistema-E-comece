# Integrações

## Mercado Livre (Fase 5) — implementado

Somente a **API oficial**. Código: `src/integracoes/mercadolivre.js` (adapter) e `src/modules/integracoes.js` + `src/modules/pedidos.js` (regras). Tela: **Integrações**.

### Como conectar (uma vez)

1. Em developers.mercadolivre.com.br, crie um aplicativo (uso próprio).
2. No sistema: **Integrações → Configuração**. Copie as duas URLs mostradas e cadastre no aplicativo:
   - **URL de redirecionamento:** `<origem>/api/integracoes/ml/callback`. O Mercado Livre exige que seja idêntica à cadastrada.
   - **URL de notificações** (tópico `orders_v2`): contém um segredo. Só funciona com endereço **público em HTTPS**; em teste local, o polling traz os pedidos.
3. Informe **App ID** e **chave secreta** (pede a senha; ficam cifradas e nunca voltam para a tela) → **Conectar conta** → autorize no Mercado Livre.
4. Defina a **margem de segurança** e se o anúncio deve **pausar** em zero.

### Fluxo

```
ML --notificação orders_v2--> /webhook/<segredo>  (responde 200 na hora)
                                   └─ busca o pedido na API com o token (o corpo NUNCA é confiado)
polling a cada ML_POLL_MIN min ──────┘   (reconcilia o que o webhook perdeu; 0 desliga)
                                   ▼
                        importarPedido (idempotente) → reserva estoque → status
                                   ▼
        disponível − reservas − margem ──PUT──> anúncio (só quando muda; pausa/reativa)
```

- **Idempotência:** `UNIQUE(conta, pedido)` + `UNIQUE(pedido_item)` nas reservas. O mesmo pedido nunca entra, reserva ou cancela duas vezes (webhook duplicado, reenvio tardio e polling juntos).
- **Reserva:** `disponível = físico vendável − reservas ATIVAS`. Cancelado é **terminal** (o ML não "descancela") e libera a reserva.
- **Problemas visíveis:** SKU não mapeado e venda acima do estoque viram `COM_PROBLEMA` com o motivo; **Reprocessar** resolve depois de mapear ou receber estoque.
- **Mapeamento SKU ↔ anúncio:** manual (aba *Anúncios ML* do produto, valida que o anúncio é do vendedor conectado) ou automático quando o SKU do vendedor no ML for igual ao SKU interno.
- **Estoque → anúncio:** a cada movimento de estoque (com *debounce*), após importar pedido e no polling. Variações enviam `variations[].available_quantity`.
- **Token:** access token renovado antes de vencer (< 5 min); o refresh token do ML é de **uso único**, então a renovação é **serializada** (duas sincronizações simultâneas = uma renovação); `401` renova e repete uma vez; refresh recusado → conta `REAUTORIZAR` e saúde vermelha.
- **Falhas:** recuo exponencial (500 ms × 2ⁿ + jitter, `Retry-After` respeitado, 4 tentativas) em 429/5xx/rede; `falhas_seguidas` → saúde amarela (1–2) e vermelha (≥ 3); volta a verde sozinha.
- **Troca de conta do vendedor:** a sincronização dos anúncios mapeados é **desligada** (nunca envia estoque para anúncios de outro dono) e registrada na auditoria.

### Segurança da integração

| Risco | Controle |
|---|---|
| Notificação forjada | o ML **não assina** o `orders_v2`; por isso há segredo na URL (`HMAC(hmacKey, conta+versão)`, rotacionável) **e** o pedido é sempre buscado na API; corpo fora do padrão ou de outro `user_id` é ignorado; pedido de outro vendedor é descartado |
| Roubo de credenciais | App ID, chave secreta e tokens cifrados (AES-256-GCM); a API da tela nunca devolve segredos; auditoria e logs sem segredos (testado) |
| CSRF no OAuth | `state` aleatório, **uso único**, expira em 10 min, ligado ao usuário (o cookie `SameSite=Strict` não volta do redirecionamento) |
| SSRF | hosts fixos em produção (`ML_API_BASE`/`ML_AUTH_BASE` só funcionam fora de produção), caminhos e IDs validados por regex, `redirect: 'error'`, sem URL vinda do payload |
| Abuso do webhook | corpo ≤ 16 KB (excesso descartado, sem derrubar o socket), JSON obrigatório, limite de taxa, resposta rápida e processamento em segundo plano |
| Ações sensíveis | configurar, desconectar e girar o segredo exigem a senha de novo |

### Limitações e o que falta validar (honestamente)

- **Nunca falou com o Mercado Livre real.** Os testes usam um servidor falso (`test/ml-falso.js`) que reproduz OAuth, pedidos, anúncios, 401 e 429. A documentação oficial confirma OAuth/refresh e `orders_v2`; **o formato exato de `PUT /items/{id}` (quantidade, `status` e variações) e o campo do SKU do vendedor (`seller_sku`/`seller_custom_field`) devem ser validados com a sua conta** antes de ligar a pausa automática.
- Sem endereço de entrega, CPF ou telefone do comprador (guarda só apelido e id do ML, por LGPD); a etiqueta e a expedição entram nas Fases 6–7.
- Uma conta por canal; sem Mercado Envios, perguntas, devoluções ou mensagens.
- O pedido pago **reserva** as unidades; a baixa **física** acontece quando ele é expedido na tela **Expedição** (separar → conferir → expedir). "Já dei baixa à mão" só libera a reserva.
- O polling roda no processo do servidor (`ML_POLL_MIN`, padrão 10 min); sem fila externa.

## Demais canais (planejado)

Shopee → Bling/Tiny (capturar a NF-e emitida) → Melhor Envio/Correios/Jadlog/Loggi → Amazon, Magalu, Shein. Mesmo padrão adapter e as mesmas regras: API oficial, OAuth com tokens cifrados, webhook + polling, idempotência, estoque disponível − margem, SSRF.

## Máquina de estados do pedido (Fase 6)

`NOVO → PAGO → AGUARDANDO NF-e → LIBERADO → EM SEPARAÇÃO → SEPARADO → EM CONFERÊNCIA → CONFERIDO → EM EMBALAGEM → EMBALADO → ETIQUETADO → AGUARDANDO COLETA → EXPEDIDO → EM TRÂNSITO → ENTREGUE` (desvios: `CANCELADO`, `DEVOLVIDO`, `COM PROBLEMA`). Hoje existem `NOVO`, `PAGO`, `COM_PROBLEMA` e `CANCELADO`.
