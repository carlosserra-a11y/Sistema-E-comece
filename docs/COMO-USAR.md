# Como usar — primeiro dia e tour pelo sistema

Para o dia a dia do galpão (etiquetar, receber, contar) veja também [OPERACAO.md](OPERACAO.md). Para hospedagem, segredos e planos, [GUIA-DO-DONO.md](GUIA-DO-DONO.md). Endereços do galpão: [MAPA-DO-GALPAO.md](MAPA-DO-GALPAO.md).

## 1. Entrar pela primeira vez (5 minutos)

1. Abra o endereço do sistema no computador **ou no celular**.
2. **Login:** os 11 dígitos que estão no seu arquivo de segredos (conta do dono). **Senha:** a provisória do mesmo arquivo. Quem criou conta pelo e-mail usa o próprio Gmail.
3. **Nova senha:** o sistema pede para trocar. Use 8 ou mais caracteres; uma frase longa funciona bem ("cafe-quente-na-janela" serve). Não use senhas óbvias como 12345678.
4. **Código no e-mail:** se a sua conta tem e-mail confirmado, a cada login chega um código de 6 dígitos (vale 10 minutos); digite para entrar. Não há QR Code nem aplicativo autenticador.
5. **Criar conta (para a equipe):** na tela de entrada, toque em **Criar conta**, digite nome, e-mail (Gmail, Hotmail, Outlook…), a senha e a senha de novo, e confirme. Um **código de 6 dígitos** vai para o e-mail dos **donos**; um deles passa o código (vale 30 minutos). Com ele a pessoa entra como **Vendedor de balcão**; mude as funções em **Equipe**.
6. Pronto: você cai na tela **Início**.

Dica: com a aba aberta o sistema **não desconecta** (dá para ficar bipando por horas); ele só pede o login de novo depois que você fecha a aba ou o navegador. Para ações sensíveis (ajustar estoque, aprovar contagem, mexer na equipe) ele pede a senha de novo — é proposital.

## 2. Mapa do sistema (menu da esquerda; no celular, barra de baixo + "Mais")

| Tela | Para que serve |
|---|---|
| **Início** | Visão do galpão agora: produtos, unidades, ocupação, alertas e atividade |
| **Balcão** | Venda presencial, caixa, orçamentos e relatórios ([guia passo a passo](GUIA-PASSO-A-PASSO.md)) |
| **Clientes** | Cadastro e histórico de compras |
| **Consulta** | Leia qualquer código (produto, endereço, lote) e veja **onde está e quanto tem** |
| **Produtos** | Cadastro, códigos de barras, importar/exportar planilha, anúncios do Mercado Livre |
| **Estoque** | Receber, guardar/transferir, baixar, avaria, ajustar, saldos, movimentações, reposição |
| **Endereços** | Lista, **mapa do galpão**, criar endereços em massa, zonas |
| **Integrações** | Mercado Livre: conexão, pedidos, anúncios, sincronizações |
| **Contagem** | Inventário cíclico/geral com aprovação |
| **Etiquetas** | Gerar e imprimir etiquetas (PDF/navegador ou ZPL para impressora térmica) |
| **Fornecedores** | Cadastro (CNPJ/CPF guardado cifrado) |
| **Equipe** | **Só você:** cadastrar pessoas e escolher o que cada uma pode |
| **Configurações** | Tema, e-mail da conta, senha, sessões, auditoria |

Atalhos no computador: `Ctrl+K` abre a paleta de comandos, `/` vai para a busca, `G` e depois `I/P/E/A/C/T/Q` navega, `?` lista os atalhos.

## 3. Primeiro dia — roteiro sugerido

1. **Equipe** → *Adicionar pessoa*: crie quem vai trabalhar com você e escolha o modelo (Operador, Estoquista, Financeiro…). Passe o login e a senha provisória para cada um — mostrados uma vez.
2. **Endereços** → *Criar em massa*: gere os endereços do galpão (ex.: rua 1, prédios 1–10, níveis 1–4, posições 1–4). O sistema mostra uma prévia antes de criar.
3. **Produtos** → *Novo produto* (ou *Importar* uma planilha). Marque **"Gerar código interno"** se o produto não tem código de barras.
4. **Etiquetas** → imprima as etiquetas dos produtos e dos endereços.
5. **Estoque** → *Receber*: leia o produto, leia o endereço, informe a quantidade. O sistema sugere onde guardar.
6. **Consulta**: bipe o produto e confira se mostra o endereço e a quantidade certos.

## 4. Usando no celular

- Abra o endereço no Chrome (Android) ou Safari (iPhone) → **Adicionar à tela inicial**. Vira um app.
- O botão redondo **Bipar** (meio da barra de baixo) abre a câmera em tela cheia: aponte para o código de barras ou QR. Ele toca um bipe e mostra o resultado na Consulta. Tem **lanterna** (se o aparelho permitir) e um campo para **digitar** o código se a leitura falhar.
- Em **Receber**, **Guardar**, **Baixar** e **Contagem** cada campo de produto/endereço tem um ícone de **câmera** ao lado.
- Na primeira vez o navegador pede permissão da câmera: permita. Funciona só em endereço seguro (https), que é o caso.

## 5. Equipe e financeiro

- Modelos: **Gerente** (tudo, menos financeiro e equipe), **Estoquista**, **Operador de galpão**, **Financeiro** (vê custos/preços/valores; não mexe no estoque), **Somente consulta**, ou **Personalizado** (você marca item por item).
- **Financeiro** é uma permissão separada. Quem não tem não vê custo, preço nem valor de pedido — nem por exportação de planilha.
- Mudou as permissões? Vale na próxima ação da pessoa, sem ela precisar sair.
- Alguém saiu? **Desativar** derruba a pessoa de todos os aparelhos na hora. Esqueceu a senha? **Redefinir senha** gera uma nova provisória. Alguém criou a conta pelo e-mail? Ela aparece como **Aguardando liberação**: toque em **Liberar acesso** e escolha o que a pessoa pode fazer.

## 6. Mercado Livre

1. Em developers.mercadolivre.com.br crie um aplicativo e cadastre, como URL de redirecionamento, o endereço mostrado na tela **Integrações**.
2. Em **Integrações** informe App ID e chave (guardados cifrados) e clique **Conectar conta**; autorize no Mercado Livre.
3. Em **Produtos → [produto] → Anúncios ML** vincule cada produto ao anúncio. A partir daí: pedido novo reserva estoque, o estoque disponível vai para o anúncio e a reconciliação roda sozinha.

## 7. Se você trancar a própria conta

Perdeu a senha do dono? Quem tem as variáveis de produção roda `npm run resetar-dono`: ele gera uma senha provisória nova e derruba as sessões. O login continua o mesmo. (Detalhes no GUIA-DO-DONO.)

## 8. Pequenos cuidados

- Conferir saldo: **Início** mostra "Integridade do estoque: ✓ Confere" (saldo = soma do livro-razão). Se aparecer divergência, abra **Configurações → Verificar integridade**.
- Nunca "apague" estoque: use **Ajustar** (pede senha e motivo) — tudo fica no histórico imutável.
- Uma vez por semana, abra o sistema (o plano grátis do banco pausa após 7 dias sem uso).
