# Operação — passo a passo do galpão

## 0. Antes de tudo (uma vez)

1. **Endereços** → *Criar em massa*: escolha a zona, ex.: Picking, Rua 1, prédios 1–10, níveis 1–4, posições 1–6 → *Ver prévia* → *Criar*.
2. **Endereços** → *Lista* → toque no endereço para definir **capacidade** e, nos de picking, o **produto designado**.
3. **Etiquetas** → escolha **Endereço** e imprima as etiquetas para colar nas prateleiras (QR + Code 128).

## 1. Chegou produto novo (etiquetar)

1. **Produtos** → *Novo produto*. Se a caixa tem código de barras do fabricante, leia no campo; senão, deixe marcada **"Gerar código interno"**.
2. **Produtos** → toque no produto → aba **Códigos e etiqueta** → escolha o formato → *Imprimir / ZPL*.
3. Produtos antigos sem código: **Gerar códigos faltantes** (mostra quantos antes de gerar).
4. Imprima: *Imprimir* (navegador, impressora térmica, margens "nenhuma", escala 100%) ou *Baixar ZPL* e envie à Zebra.

> Cole a etiqueta no produto **antes** de guardar. Teste a leitura com a **Consulta** de uma etiqueta nova.

## 2. Receber e guardar

1. **Estoque → Receber**: leia o produto, leia o endereço de destino (ou toque numa sugestão), informe a quantidade (e lote/validade, se o produto controla). *Receber*.
2. **Estoque → Guardar / transferir**: leia a **origem**, o **produto**, o **destino** (3 leituras). O sistema sugere o destino (picking do produto → já guarda o produto → reserva vazia → picking livre mais próximo).
3. Verde + bipe curto = certo. Vermelho + bipe grave = erro (mensagem explica).

## 3. Onde está?

- **Consulta**: leia qualquer código — produto mostra total, disponível e cada endereço (lote que vence primeiro no topo); endereço mostra o conteúdo; lote mostra a validade.
- **Endereços → Mapa**: digite o SKU em "Onde está" e os blocos com o produto ficam destacados.

## 4. Contar o estoque

1. **Contagem → Nova contagem**: *Cíclico* (os endereços contados há mais tempo — faça 10 por dia), *Endereços escolhidos* ou *Geral*.
2. Leia o **endereço**, depois cada **produto**, informe a **quantidade encontrada** (o saldo do sistema fica oculto até contar).
3. Vazio de verdade? **Endereço vazio**. Terminou o endereço? **Concluir endereço**.
4. **Aprovar** (pede a senha): o estoque é ajustado para o que foi contado. Se alguém movimentou o item depois da contagem, o sistema recusa e pede **nova contagem** daquele item.

## 5. Reabastecer o picking

**Estoque → Reposição** lista picking vazio (ou ≤ 25% da capacidade) com saldo na reserva. *Repor* faz a transferência.

## 6. Pedidos do Mercado Livre

1. **Integrações**: confira a bolinha de saúde (verde = ok). Pedidos entram sozinhos; **Sincronizar agora** força.
2. Pedido **Com problema**: abra e leia o motivo.
   - *SKU não mapeado*: abra o produto → aba **Anúncios ML** → informe o código do anúncio (MLB…) → volte ao pedido e **Reprocessar**.
   - *Estoque insuficiente*: receba a mercadoria (ou cancele a venda no ML) e **Reprocessar**.
3. O anúncio recebe o **disponível**: estoque vendável − reservas dos pedidos − margem. Mexeu no estoque? O anúncio é atualizado em segundos.
4. Saúde **vermelha**: leia o motivo. "Reautorizar" = a autorização expirou/foi revogada → **Reautorizar** e entre de novo no ML.

## 7. Quando algo dá errado

| Situação | O que fazer |
|---|---|
| "Código não encontrado" | confira o dígito (a mensagem avisa leitura suspeita), leia de novo; cadastre o código no produto |
| "Capacidade excedida" | guarde em outro endereço ou aumente a capacidade do endereço |
| "Saldo insuficiente" | confira o endereço de origem; use **Consulta** para ver onde o produto está |
| Estoque não bate | **Estoque → Ajustar** (motivo obrigatório, pede senha) ou abra uma **Contagem** |
| Produto avariado | **Estoque → Avaria** (mova para o endereço de avaria ou baixe) |
| Esqueceu a senha | use um código de recuperação do MFA para entrar e troque a senha em Configurações |
