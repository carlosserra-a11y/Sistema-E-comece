# Integrações (planejado — Fases 5 a 7)

**Nada disto está implementado ainda.** Este documento fixa as regras para quando for.

## Padrão adapter

Uma interface única (`listarPedidos`, `buscarPedido`, `atualizarStatus`, `sincronizarEstoque`, `parseWebhook`) e um adapter por canal, para adicionar canais sem mexer no núcleo.

Ordem: 1) Mercado Livre → 2) Shopee → 3) Bling/Tiny (capturar a NF-e emitida, não emitir) → 4) Melhor Envio/Correios/Jadlog/Loggi → 5) Amazon, Magalu, Shein.

## Regras para todo canal

- **Somente APIs oficiais**, respeitando termos e limites. Sem scraping.
- **OAuth 2.0** com renovação automática; tokens **cifrados (AES-256-GCM)** com `FIELD_KEY`; escopo mínimo; revogação ao desativar.
- **Webhook principal + polling de reconciliação**; **HMAC e timestamp validados**, replay rejeitado.
- **Idempotência**: tabela `webhooks_recebidos` (chave externa única) + a tabela `idempotencia` já existente. O mesmo pedido nunca é importado, reservado ou baixado duas vezes.
- **Sincronização de estoque** = disponível − margem de segurança, sobre `zonas.vendavel`; pausa automática de anúncio opcional.
- **SSRF**: lista de domínios permitidos por canal; nenhuma URL vinda do payload é buscada.
- Erros: *backoff* exponencial, *rate limit*, fila de falhas, alerta quando a integração cair, modo contingência.
- Painel "Saúde das integrações" e mapeamento SKU ↔ anúncio (`sku_marketplace`).

## Tabelas previstas (migrations futuras)

`canais`, `contas_canal` (credenciais cifradas), `sku_marketplace`, `pedidos`, `pedido_itens`, `clientes`, `enderecos_entrega`, `reservas`, `webhooks_recebidos`, `jobs_sincronizacao`, `notas_fiscais`, `ondas_de_separacao`, `tarefas_de_separacao`, `conferencias`, `embalagens`, `etiquetas`, `volumes`, `romaneios`, `coletas`, `rastreios`, `eventos_rastreio`, `devolucoes`, `devolucao_itens`.

## Máquina de estados do pedido (Fase 6)

`NOVO → PAGO → AGUARDANDO NF-e → LIBERADO → EM SEPARAÇÃO → SEPARADO → EM CONFERÊNCIA → CONFERIDO → EM EMBALAGEM → EMBALADO → ETIQUETADO → AGUARDANDO COLETA → EXPEDIDO → EM TRÂNSITO → ENTREGUE` (desvios: `CANCELADO`, `DEVOLVIDO`, `COM PROBLEMA`). Transições validadas no servidor e auditadas; é impossível expedir sem conferência 100% correta.

## O que o núcleo atual já entrega para isso

Livro-razão com `SAIDA`/`DEVOLUCAO`, picking designado, reposição, FEFO, leitura universal, ZPL e idempotência.
