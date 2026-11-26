# Guia passo a passo — FRIO Peças e Serviços

Como usar o sistema, do primeiro acesso ao fechamento do dia. Cada tarefa em poucos passos.

> O cupom do sistema **não é nota fiscal**. A nota continua sendo emitida por fora.

## 1. Entrar

1. Abra `https://friospecaseservicos.com.br` no computador ou no celular.
2. Digite seu e-mail e senha (ou toque em **Código por e-mail**).
3. Se chegar um código de 6 dígitos no e-mail, digite-o.

No celular: abra no Chrome ou Safari e escolha **Adicionar à tela inicial**.

## 2. Preparar o balcão (só o dono, uma vez)

Faça nesta ordem, senão a venda não funciona.

| # | Onde | O que fazer |
|---|---|---|
| 1 | **Empresa** | Confira nome, CNPJ e endereço. Eles saem no cupom. |
| 2 | **Produtos** | Em cada produto, preencha o **Preço de venda**. Produto sem preço não é vendido pela equipe. |
| 3 | **Estoque → Guardar / transferir** | A mercadoria precisa estar em endereço de **picking** ou **reserva**. O que está em *recebimento* ou *avaria* não é vendido. |
| 4 | **Balcão → Serviços** | Cadastre os serviços (instalação, carga de gás, visita técnica) com preço. |
| 5 | **Balcão → Ajustes** | Chave Pix, nome e cidade de quem recebe, desconto máximo do vendedor, validade do orçamento e mensagem do cupom. Salvar pode pedir sua senha. |
| 6 | **Balcão → Ajustes → Testar o QR do Pix** | Leia o QR com o app do banco e confira o nome. Não precisa pagar. |
| 7 | **Equipe** | Libere o balcão para cada pessoa (veja o item 3). |

**Telefone no Pix:** escreva com `+55` (ex.: `+5548999990000`). Sem o `+55` o sistema entende como CPF e recusa.

## 3. Quem pode o quê

Em **Equipe**, escolha o modelo da pessoa:

| Modelo | Pode no balcão |
|---|---|
| **Vendedor de balcão** | Vender, fazer orçamento, cadastrar cliente, abrir e fechar o próprio caixa |
| **Gerente** | Tudo isso, mais desconto livre, cancelar venda, relatórios, serviços e todos os caixas |
| **Somente consulta** | Nada do balcão |
| **Personalizado** | Você marca item por item no grupo **Balcão** |

- Quem **já estava cadastrado** não ganhou o balcão sozinho: abra a pessoa em **Equipe**, escolha o modelo de novo e salve.
- Só o **dono** muda a chave Pix.
- Vendedor vê o **preço de venda**, nunca o custo nem a margem.

## 4. O dia no balcão

### 4.1 Abrir o caixa
1. **Balcão** → **Abrir caixa**.
2. Conte o troco da gaveta e digite o valor (pode ser `0`).

Cada pessoa tem o seu caixa.

### 4.2 Vender
1. Em **Vender**, bipe o produto (leitor USB ou botão **Câmera**) ou digite o nome e toque no item.
2. Ajuste a quantidade com **−** e **+**.
3. (Opcional) Escolha o cliente, escreva uma observação, dê desconto.
4. Toque em **Receber pagamento** (ou tecla **F2**).
5. Escolha a forma:
   - **Dinheiro:** digite quanto o cliente entregou; o sistema mostra o **troco**.
   - **Pix:** toque em **Mostrar QR Pix**. **Confira no app do banco** que o dinheiro caiu.
   - **Débito / Crédito:** passe na maquininha primeiro; no crédito escolha as parcelas.
   - **Duas formas:** toque na primeira, digite o valor dela (menor que o total) e toque na segunda.
6. **Concluir venda**.
7. **Imprimir**, **Abrir no WhatsApp** ou **Próxima venda**.

O estoque baixa sozinho, começando pelo lote que vence antes.

### 4.3 Orçamento
1. Monte o carrinho e toque em **Salvar como orçamento**. O estoque **não** muda.
2. Quando o cliente voltar: **Orçamentos** → toque no número → **Receber e concluir**.

O preço do orçamento vale até a data mostrada. Vencido, faça um novo.

### 4.4 Cancelar uma venda (gerente ou dono)
1. **Vendas** → toque na venda → **Cancelar venda**.
2. Escreva o motivo e confirme sua senha, se pedir.
3. Siga o aviso: devolva o dinheiro, **estorne o cartão ou o Pix por fora** e guarde as peças no endereço indicado.

O cancelamento é da venda inteira. Para devolver só uma peça, cancele e registre de novo o que o cliente ficou.

### 4.5 Tirar ou colocar dinheiro
- **Caixa → Sangria:** retirar dinheiro (depósito, pagamento).
- **Caixa → Suprimento:** colocar troco.

Escreva sempre o motivo.

### 4.6 Fechar o caixa
1. **Caixa → Fechar caixa**.
2. Conte **todo** o dinheiro da gaveta e digite.
3. Se não bater, conte de novo; se continuar, escreva a explicação.

O vendedor só vê quanto deveria ter **depois** de contar (conferência cega).

## 5. Relatórios (gerente ou dono)

**Balcão → Relatórios:** escolha o período (Hoje, 7 dias, 30 dias). Mostra total, ticket médio, descontos, cancelamentos, formas de pagamento, atendentes e itens mais vendidos. **Baixar planilha** abre no Excel. A margem aparece só para quem tem o financeiro.

## 6. Clientes

**Clientes → Novo cliente** (ou **+ Novo** na tela de venda). Só o nome é obrigatório. O CPF/CNPJ fica guardado criptografado. Ao abrir o cliente aparecem as últimas compras.

## 7. Estoque (resumo)

| Quero | Caminho |
|---|---|
| Cadastrar produto | **Produtos → Novo produto** (marque *gerar código* se não tiver código de barras) |
| Imprimir etiqueta | **Gerador de códigos** ou **Etiquetas** |
| Dar entrada | **Estoque → Receber**: produto, endereço, quantidade |
| Mudar de lugar | **Estoque → Guardar / transferir** |
| Saber onde está | **Consulta**: bipe o produto |
| Corrigir quantidade | **Estoque → Ajustar** (pede senha e motivo) |
| Contar | **Contagem** → nova contagem → um gerente aprova |

## Pedido do Mercado Livre que já saiu

Dê a baixa das peças em **Estoque** e depois abra **Integrações → Pedidos → o pedido → Marcar como enviado**. Sem isso as unidades continuam reservadas.

## 8. Quando algo dá errado

| Aviso na tela | O que fazer |
|---|---|
| **Abra o seu caixa** | Balcão → Abrir caixa |
| **Estoque insuficiente** | Leia o resto da mensagem: peça em *recebimento* precisa ser guardada; peça *reservada* é de pedido da internet; endereço bloqueado não vende |
| **Sem preço de venda** | O dono preenche o preço em Produtos |
| **O total agora é…** | O preço mudou: toque em **Atualizar preços** e confira com o cliente |
| **Venda sem resposta do servidor** (a internet caiu na hora) | O carrinho fica travado. Quando voltar, toque em **Reenviar**: se a venda já tinha sido gravada, só aparece o cupom (não duplica). Ou confira a aba **Vendas** e toque em **Já conferi** |
| **Troco alto demais** | O valor em dinheiro está errado (muitas vezes um código de barras lido no campo). Troco máximo: R$ 2.000 |
| **Você não tem permissão** | Peça ao dono em Equipe |
| **Orçamento vencido** | Faça um novo |
| **Chave Pix não cadastrada** | O dono configura em Balcão → Ajustes |
| Câmera não abre | Permita a câmera no navegador; use sempre o endereço com `https` |
| Sem internet | O sistema não vende offline; anote e registre quando voltar |

## 9. Atalhos no computador

| Tecla | Faz |
|---|---|
| `F2` | Receber pagamento |
| `G` depois `V` | Ir para o Balcão |
| `G` depois `L` | Clientes |
| `Ctrl+K` | Paleta de comandos |
| `/` | Busca geral |
| `?` | Lista de atalhos |
| `Esc` | Fecha a janela de cima |

## 10. Rotina sugerida

**Manhã:** abrir caixa. **Durante o dia:** vender, receber mercadoria, guardar. **Noite:** fechar caixa, olhar o relatório do dia. **Semana:** copiar o backup para fora do servidor (veja [VPS-HOSTGATOR.md](VPS-HOSTGATOR.md)).

## Mais detalhes

[Como usar](COMO-USAR.md) · [Operação do galpão](OPERACAO.md) · [Guia do dono](GUIA-DO-DONO.md) · [O que mudou e como publicar](ATUALIZACAO-BALCAO.md)
