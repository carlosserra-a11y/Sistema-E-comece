# Atualização "Balcão" (25/11/2026): o que mudou e como publicar

## Novidades

| Área | O que entrou |
|---|---|
| Venda presencial | Carrinho com leitor e câmera, dinheiro/Pix/débito/crédito (também combinados), troco, cupom para imprimir ou mandar no WhatsApp, baixa automática do estoque (FEFO) |
| Caixa | Abertura, sangria, suprimento, devolução, fechamento com conferência cega; um caixa por pessoa |
| Orçamento | Preço congelado até a validade; vira venda sem redigitar |
| Clientes e serviços | Cadastros novos; CPF/CNPJ cifrado |
| Pix | QR Code e "copia e cola" com o valor (não confirma o pagamento) |
| Relatórios | Período, forma de pagamento, atendente, mais vendidos, margem, planilha |
| Permissões | Grupo **Balcão** e modelo **Vendedor de balcão**; chave Pix só do dono |
| Painel | Vendas do dia e botão **Nova venda** |

## Defeitos corrigidos

| Defeito | Efeito antes | Agora |
|---|---|---|
| Preço em planilha | Exportar produtos e importar de volta **multiplicava preço e custo por 100** | Mesma leitura na tela e na planilha; valor ambíguo é recusado |
| Campo de preço | Digitar `35.90` gravava R$ 3.590,00; texto inválido virava R$ 0,00 sem aviso | `35.90` = R$ 35,90; inválido dá erro |
| Aba e filtro ativos | Não ficavam marcados ao abrir a tela | Marcados |
| Janela sobre janela | `Esc` fechava as duas e o `Tab` pulava para a de baixo | Só a de cima responde |
| Repetição segura | A mesma chave em outro registro devolvia a resposta antiga sem executar | A chave vale por registro |
| Disputa no PostgreSQL | Duas operações simultâneas podiam virar "erro interno" | Mensagem pedindo para tentar de novo |

> **Confira os preços em produção:** se alguma planilha de produtos já foi exportada e importada de volta (ou um preço digitado com ponto), há preços 100 vezes maiores. Abra **Produtos → Exportar** e procure valores fora do normal.

## Banco de dados

Migration nova: `supabase/migrations/20261125000008_vendas.sql` (SQLite: `migrations/009_vendas.sql`). Só **cria** tabelas (`clientes`, `servicos`, `config_vendas`, `caixas`, `vendas`, `venda_itens`, `venda_pagamentos`, `caixa_movimentos`) e um índice. Não altera nem apaga dados existentes. O backup passa a incluir essas tabelas.

## Publicar na VPS

Publicar muda o sistema que está no ar. Faça fora do horário de atendimento.

1. Juntar o ramo `feat/venda-balcao` ao `main` no GitHub.
2. Entrar na VPS (o IP, a porta e a chave estão no painel da HostGator; veja [VPS-HOSTGATOR.md](VPS-HOSTGATOR.md), passo 2):

```powershell
ssh -i CAMINHO_DA_SUA_CHAVE -p PORTA_SSH root@IP_DA_VPS
```

3. Fazer um backup **antes**:

```bash
bash /opt/wms/app/deploy/vps/backup-pg.sh
```

4. Anotar a versão atual (para voltar, se preciso):

```bash
sudo -u wms git -C /opt/wms/app rev-parse --short HEAD
```

5. Atualizar (baixa o código, aplica a migration e as permissões do banco, reinicia):

```bash
bash /opt/wms/app/deploy/vps/atualizar.sh
```

6. Conferir: entrar no site, abrir **Balcão**, abrir um caixa com `0`, fazer uma venda de teste, cancelá-la e fechar o caixa.
7. Preparar o balcão pelo [guia](GUIA-PASSO-A-PASSO.md), item 2.

A Vercel publica sozinha a cada envio ao `main`, mas o banco antigo (Supabase) **não** recebe a migration: as telas novas dariam erro lá. Pause o projeto na Vercel antes (ele já não é o sistema oficial).

## Voltar atrás

As tabelas novas não atrapalham a versão antiga. Para voltar o código, use a versão anotada no passo 4 (antes desta atualização era `e4e8b43`):

```bash
sudo -u wms git -C /opt/wms/app reset --hard e4e8b43
systemctl restart wms
```

Vendas já registradas continuam no banco, mas a versão antiga não as mostra.

## Limites conhecidos

- **Sem nota fiscal** (NFC-e/NF-e): exige certificado digital e um emissor contratado.
- **Sem maquininha integrada** e **sem confirmação automática de Pix**: quem vende confere.
- **Cancelamento é da venda inteira** (sem devolução parcial).
- **Sem venda a prazo/fiado** e sem contas a receber.
- **Sem venda sem internet.**
- Quantidades são inteiras (não vende 1,5 metro de tubo; cadastre a unidade menor).
- Preço e desconto de um orçamento valem para quem for concluí-lo, mesmo sem permissão de desconto (quem criou tinha).
