# Mapa do galpão — FRIO Peças e Serviços

Endereçamento simulado a partir das fotos do estoque. Serve para testar o sistema e para etiquetar as prateleiras de verdade
(**Etiquetas → Endereço**). Se uma estante mudar de lugar ou ganhar prateleira, ajuste em **Endereços** (criar em massa, bloquear, inativar).

## Como ler um endereço

`D1-P-01-03-04-01` = **Depósito 1 · zona P (Picking) · Rua 01 · Prédio 03 · Nível 04 · Posição 01**

- **Rua** = a estante ou o conjunto de estantes. **Prédio** = o vão (coluna), contado da **esquerda para a direita**.
- **Nível** = a prateleira, contada de **baixo para cima** (1 = a mais baixa).
- **Zona P (Picking)** = prateleiras onde se pega o produto para vender. **Zona V (Reserva)** = armários, chão e mesa, onde fica o estoque de apoio.

## Ruas

| Zona | Rua | Prédios × níveis | Onde fica | Endereços |
|---|---|---|---|---|
| P | 01 | 4 × 6 | Parede principal: estante grande de 4 vãos (sob os ar-condicionados) | 24 |
| P | 02 | 3 × 5 | Estante alta do fundo: 3 colunas de prateleiras | 15 |
| P | 03 | 1 × 6 | Estante da lateral esquerda | 6 |
| P | 04 | 4 × 2 | Prateleiras de canto (parte de cima, em L) | 8 |
| V | 01 | 4 × 1 | Armários de baixo do canto | 4 |
| V | 02 | 4 × 1 | Chão ao longo do balcão (cilindros de gás refrigerante) | 4 |
| V | 03 | 2 × 2 | Mesa central (tampo e prateleira de baixo: rolos de cobre) | 4 |

Total: 53 endereços de picking e 12 de reserva. As zonas de apoio (Recebimento, Avaria, Devolução, Quarentena e Expedição) já têm um endereço cada.

## Produtos de teste (lidos das etiquetas)

| Produto | SKU | Código de barras | Onde está | Qtd. (teste) |
|---|---|---|---|---|
| Gás MAPP Hulter | GAS-MAPP-HULTER | 07899733820664 (GTIN-14; o leitor também acha pelo EAN-13 7899733820664) | P-01-03-04-01 e P-01-03-03-01 | 12 + 12 |
| Capacitor 10 MFD 440V (EOS) | D-31016 | 7908786413850 | P-02-01-02-01 | 20 |
| Capacitor 15 MFD 440V (EOS) | D-31017 | D31017 (Code 128) | P-02-01-03-01 | 20 |

As quantidades são **de teste**, estimadas pelas fotos. Para acertar o estoque real, faça uma **Contagem** (ou um ajuste em Estoque).

## Ideias para a próxima etapa

- Cilindros de gás (R410A, R134a, R22, R404A) e rolos de cobre ainda não têm código de barras fotografado: cadastre-os em **Produtos** e use **Gerar códigos** para criar etiquetas internas.
- Defina a **capacidade** dos vãos mais usados para o sistema avisar quando encher.
