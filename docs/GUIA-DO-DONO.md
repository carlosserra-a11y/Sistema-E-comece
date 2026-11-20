# Guia do dono — Carlos Desenvolvedor de Sistema

Tudo o que você precisa saber para ser dono deste sistema, em português simples. Para aprender a usar as telas, veja [COMO-USAR.md](COMO-USAR.md).

## 1. Onde cada coisa fica

| Peça | Onde está | Para que serve | Custo hoje |
|---|---|---|---|
| **Código-fonte** | GitHub: `carlosserra-a11y/Sistema-E-comece` | É o "projeto". Qualquer mudança passa por aqui | grátis |
| **Site (a tela que você abre)** | **Vercel** | Entrega as telas e roda a parte que conversa com o banco | grátis (plano Hobby) |
| **Banco de dados (todos os dados)** | **Supabase**, projeto `carlos-desenvolvedor-de-sistema`, região São Paulo | Produtos, estoque, pedidos, equipe, histórico | grátis (plano Free) |
| **Segredos (chaves e senhas)** | Variáveis de ambiente da Vercel + **cópia sua** (ver seção 6) | Protegem senhas, dados cifrados e a conexão com o banco | — |

Os dados **não** ficam no GitHub nem na Vercel: ficam no Supabase. A Vercel só "executa" o sistema. O GitHub guarda o código, nunca dados nem senhas.

## 2. Como você acessa

1. Abra o endereço do sistema (o link que te enviei) no computador **ou no celular**.
2. Entre com o **login de 11 dígitos** e a **senha provisória**. O sistema obriga a trocar a senha e cadastrar o autenticador de 2 etapas (Google Authenticator, Microsoft Authenticator, Authy…). **Guarde os 10 códigos de recuperação** que ele mostra.
3. No celular: abra o link no Chrome/Safari e use "Adicionar à tela inicial" — vira um app. O botão redondo **Bipar** (no meio da barra de baixo) abre a câmera para ler código de barras.
   - A câmera só funciona em endereço **https** (o da Vercel é). Na primeira vez, o navegador pede permissão da câmera: permita.
   - Android lê com o recurso nativo do Chrome; iPhone usa uma biblioteca incluída (ZXing). Se a câmera falhar, dá para digitar o código.

## 3. Equipe e permissões (só você)

Menu **Equipe**:
- **Adicionar pessoa**: escolha um modelo (Gerente, Estoquista, Operador de galpão, Financeiro, Somente consulta) e ajuste item por item. O sistema gera um **login** e uma **senha provisória** — mostrados **uma vez**. Passe para a pessoa.
- **Financeiro** (custos, preços, valores de pedidos, margens, exportação com valores) é uma permissão separada. Nenhum modelo, exceto "Financeiro", a inclui. Quem não tem **nem vê** esses números: o servidor os remove das respostas.
- Você pode **mudar permissões a qualquer momento** (vale na próxima ação da pessoa), **redefinir senha**, **resetar o autenticador** e **desativar** (derruba a pessoa de todos os aparelhos na hora).
- Só **você** gerencia a equipe. Isso não pode ser delegado, e a sua conta não pode ser alterada por ninguém.
- Todas as ações ficam no histórico (Configurações → Auditoria), em uma cadeia à prova de adulteração.

## 4. Limites do plano grátis (importante)

- **Supabase Free**: o projeto é **pausado após 7 dias sem uso**. Abra o sistema pelo menos uma vez por semana, ou restaure o projeto no painel (os dados são mantidos). **Não há backup automático** no plano grátis — veja a seção 5.
- **Vercel Hobby**: é para uso **pessoal/não comercial**. Quando o sistema virar operação de uma empresa, migre para o plano Pro (US$ 20/mês) ou para a Hostinger (seção 7). O cron roda **1 vez por dia** (reconciliação com o Mercado Livre); o dia a dia usa os avisos (webhooks) em tempo real.
- Esses limites mudam com o tempo: confira as páginas de preço antes de depender deles.

## 5. Backup (faça!)

O plano grátis do Supabase não faz backup. Recomendação:
- **Mensal** (ou antes de mudanças grandes): Supabase → *Database → Backups* mostra o que o plano oferece; no plano Pro há backups diários.
- Alternativa gratuita: no painel do Supabase, *SQL Editor* → exporte as tabelas importantes (`produtos`, `movimentacoes_estoque`, `saldos_por_endereco`) em CSV.
- O livro-razão (`movimentacoes_estoque`) é **imutável**: o saldo sempre pode ser reconstruído a partir dele.

## 6. Segredos — guarde em um gerenciador de senhas

O arquivo **`Carlos-Desenvolvedor-de-Sistema-SEGREDOS.txt`** (na sua pasta Documentos) tem os valores. Mova para o seu gerenciador de senhas e **apague o arquivo**.

- `PEPPER`, `HMAC_KEY`, `FIELD_KEY`: **sem elas, ninguém consegue entrar e os dados cifrados (credenciais do Mercado Livre, CNPJ dos fornecedores) ficam ilegíveis.** Se perder, é preciso recomeçar o acesso. Não troque sem plano.
- `DATABASE_URL`: contém a senha do papel `app_wms` do banco.
- `CRON_SECRET`: libera a rota de manutenção.

**Nunca** envie esses valores no WhatsApp, e-mail ou GitHub. Se vazarem: gere novos, atualize na Vercel (*Settings → Environment Variables*) e refaça o deploy. Para trocar a senha do banco: no SQL Editor do Supabase, `ALTER ROLE app_wms PASSWORD '...nova...';` e atualize a `DATABASE_URL`.

## 7. Migrar para a Hostinger (quando quiser)

- A **Hospedagem compartilhada** (a "Hostinger comum") **não roda Node.js** como este sistema precisa. Use **Hostinger VPS** ou o plano com **Node.js** (confira na hora da compra).
- O que muda: o **código é o mesmo**. Rode com `npm ci --omit=dev` e `npm start`, defina as mesmas variáveis de ambiente (use `TRUST_PROXY=true` atrás de um proxy), aponte o domínio com HTTPS. O banco **continua no Supabase** (ou migra para o Postgres da própria VPS usando `supabase/migrations/`).
- Coloque `PUBLIC_ORIGIN` com o novo endereço https e, se usar o Mercado Livre, atualize a URL de redirecionamento no painel do app do Mercado Livre.

## 8. Mercado Livre

Menu **Integrações**: informe o App ID e a chave do seu app (são guardados **cifrados**), clique em **Conectar**. A URL de redirecionamento a cadastrar no painel do Mercado Livre é `https://SEU-ENDEREÇO/api/integracoes/ml/callback`. O endereço do webhook aparece na própria tela de Integrações.

## 9. Se algo der errado

| Sintoma | O que fazer |
|---|---|
| "Sistema indisponível" | Supabase pausado? Abra o painel do Supabase e restaure o projeto. Depois recarregue. |
| Esqueci a senha (ou perdi tudo: senha, celular e códigos) | Ninguém redefine a conta do dono pela tela (de propósito). Quem tem as variáveis de produção roda `npm run resetar-dono`: gera uma senha provisória nova, zera as 2 etapas e derruba as sessões. O login continua o mesmo. |
| Perdi o celular do autenticador | Use um dos 10 códigos de recuperação. Gere novos em Configurações. |
| Uma pessoa saiu | Equipe → **Desativar**. |
| Suspeita de acesso indevido | Configurações → Sessões → "sair de todos"; troque a senha; confira a Auditoria. |

## 10. Como o sistema se protege (resumo)

Senhas com hash forte + segredo fora do banco; 2 etapas obrigatória para todos; bloqueio por tentativas; sessão com expiração; proteção contra requisições forjadas (CSRF); cabeçalhos de segurança rígidos (CSP); banco com RLS e um papel próprio sem permissão de alterar histórico; livro-razão e auditoria imutáveis; toda função nova nasce **bloqueada** até ganhar uma regra de permissão. Detalhes em `SEGURANCA.md`.
