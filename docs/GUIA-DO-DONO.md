# Guia do dono — Carlos Desenvolvedor de Sistema

Tudo o que você precisa saber para ser dono deste sistema, em português simples. Para aprender a usar as telas, veja [COMO-USAR.md](COMO-USAR.md).

## 1. Onde cada coisa fica

**Endereço do sistema:** https://carlos-sistema-carlos-nunes.vercel.app

Só este endereço funciona (o sistema recusa outros nomes da Vercel, de propósito). Cada vez que o código muda no GitHub (`main`), a Vercel publica sozinha.

| Peça | Onde está | Para que serve | Custo hoje |
|---|---|---|---|
| **Código-fonte** | GitHub: `carlosserra-a11y/Sistema-E-comece` | É o "projeto". Qualquer mudança passa por aqui | grátis |
| **Site (a tela que você abre)** | **Vercel** | Entrega as telas e roda a parte que conversa com o banco | grátis (plano Hobby) |
| **Banco de dados (todos os dados)** | **Supabase**, projeto `carlos-desenvolvedor-de-sistema`, região São Paulo | Produtos, estoque, pedidos, equipe, histórico | grátis (plano Free) |
| **Segredos (chaves e senhas)** | Variáveis de ambiente da Vercel + **cópia sua** (ver seção 6) | Protegem senhas, dados cifrados e a conexão com o banco | — |

Os dados **não** ficam no GitHub nem na Vercel: ficam no Supabase. A Vercel só "executa" o sistema. O GitHub guarda o código, nunca dados nem senhas.

## 2. Como você acessa

1. Abra o endereço do sistema (o link que te enviei) no computador **ou no celular**.
2. Entre com o **login de 11 dígitos** e a **senha provisória**. O sistema pede para você criar uma senha sua (8 ou mais caracteres). Pronto: não há QR Code nem aplicativo autenticador.
3. No celular: abra o link no Chrome/Safari e use "Adicionar à tela inicial" — vira um app. O botão redondo **Bipar** (no meio da barra de baixo) abre a câmera para ler código de barras.
   - A câmera só funciona em endereço **https** (o da Vercel é). Na primeira vez, o navegador pede permissão da câmera: permita.
   - Android lê com o recurso nativo do Chrome; iPhone usa uma biblioteca incluída (ZXing). Se a câmera falhar, dá para digitar o código.

## 3. Equipe e permissões (só você)

Menu **Equipe**:
- **Adicionar pessoa**: escolha um modelo (Gerente, Estoquista, Operador de galpão, Financeiro, Somente consulta) e ajuste item por item. O sistema gera um **login** e uma **senha provisória** — mostrados **uma vez**. Passe para a pessoa.
- **Financeiro** (custos, preços, valores de pedidos, margens, exportação com valores) é uma permissão separada. Nenhum modelo, exceto "Financeiro", a inclui. Quem não tem **nem vê** esses números: o servidor os remove das respostas.
- Você pode **mudar permissões a qualquer momento** (vale na próxima ação da pessoa), **redefinir senha**, **liberar o acesso** de quem criou conta pelo e-mail (ela chega como "Aguardando liberação", sem nenhuma permissão) e **desativar** (derruba a pessoa de todos os aparelhos na hora).
- Só **você** gerencia a equipe. Isso não pode ser delegado, e a sua conta não pode ser alterada por ninguém.
- Todas as ações ficam no histórico (Configurações → Auditoria), em uma cadeia à prova de adulteração.

## 4. Limites do plano grátis (importante)

- **Supabase Free**: o projeto é **pausado após 7 dias sem uso**. Abra o sistema pelo menos uma vez por semana, ou restaure o projeto no painel (os dados são mantidos). **Não há backup automático** no plano grátis — veja a seção 5.
- **Vercel Hobby**: é para uso **pessoal/não comercial**. Quando o sistema virar operação de uma empresa, migre para o plano Pro (US$ 20/mês) ou para a Hostinger (seção 7). O cron roda **1 vez por dia** (reconciliação com o Mercado Livre); o dia a dia usa os avisos (webhooks) em tempo real.
- Esses limites mudam com o tempo: confira as páginas de preço antes de depender deles.

## 5. Backup (faça!)

O plano grátis do Supabase **não faz backup**. O caminho completo está em [BACKUP.md](BACKUP.md); o resumo:
- **Assine o Supabase Pro** (backup diário automático, 7 dias de histórico). Quem assina é você, no painel.
- **`npm run backup`** salva o banco inteiro num arquivo **cifrado** (defina `BACKUP_SENHA`). Agende por dia e guarde uma cópia **fora** do computador. `npm run backup:verificar` confere o arquivo e `npm run restaurar` abre os dados num SQLite novo.
- O **código** fica no GitHub (`git push`).
- O livro-razão (`movimentacoes_estoque`) é **imutável**: o saldo sempre pode ser reconstruído a partir dele.

## 6. Segredos — guarde em um gerenciador de senhas

O arquivo **`Carlos-Desenvolvedor-de-Sistema-SEGREDOS.txt`** (na sua pasta Documentos) tem os valores. Mova para o seu gerenciador de senhas e **apague o arquivo**.

- `PEPPER`, `HMAC_KEY`, `FIELD_KEY`: **sem elas, ninguém consegue entrar e os dados cifrados (credenciais do Mercado Livre, CNPJ dos fornecedores) ficam ilegíveis.** Se perder, é preciso recomeçar o acesso. Não troque sem plano.
- `DATABASE_URL`: contém a senha do papel `app_wms` do banco.
- `CRON_SECRET`: libera a rota de manutenção.

**Nunca** envie esses valores no WhatsApp, e-mail ou GitHub. Se vazarem: gere novos, atualize na Vercel (*Settings → Environment Variables*) e refaça o deploy. Para trocar a senha do banco: no SQL Editor do Supabase, `ALTER ROLE app_wms PASSWORD '...nova...';` e atualize a `DATABASE_URL`.

## 7. Migrar para a Hostinger (quando quiser)

> Domínio próprio (friospeçaseserviços.com.br): veja [DOMINIO.md](DOMINIO.md). Hospedagem na HostGator (VPS): veja [VPS-HOSTGATOR.md](VPS-HOSTGATOR.md).

- A **Hospedagem compartilhada** (a "Hostinger comum") **não roda Node.js** como este sistema precisa. Use **Hostinger VPS** ou o plano com **Node.js** (confira na hora da compra).
- O que muda: o **código é o mesmo**. Rode com `npm ci --omit=dev` e `npm start`, defina as mesmas variáveis de ambiente (use `TRUST_PROXY=true` atrás de um proxy), aponte o domínio com HTTPS. O banco **continua no Supabase** (ou migra para o Postgres da própria VPS usando `supabase/migrations/`).
- Coloque `PUBLIC_ORIGIN` com o novo endereço https e, se usar o Mercado Livre, atualize a URL de redirecionamento no painel do app do Mercado Livre.

## 8. Mercado Livre

Menu **Integrações**: informe o App ID e a chave do seu app (são guardados **cifrados**), clique em **Conectar**. A URL de redirecionamento a cadastrar no painel do Mercado Livre é `https://SEU-ENDEREÇO/api/integracoes/ml/callback`. O endereço do webhook aparece na própria tela de Integrações.

## 9. Se algo der errado

| Sintoma | O que fazer |
|---|---|
| "Sistema indisponível" | Supabase pausado? Abra o painel do Supabase e restaure o projeto. Depois recarregue. |
| Esqueci a senha | Ninguém redefine a conta do dono pela tela (de propósito). Quem tem as variáveis de produção roda `npm run resetar-dono`: gera uma senha provisória nova e derruba as sessões. O login continua o mesmo. |
| O código de confirmação não chega | Veja o spam. A tela do código tem **Reenviar** (a cada 60 s). Se nunca chega, o envio de e-mail pode estar desligado ou com a senha de app errada: veja "Ligar o envio de e-mail" abaixo. |
| Uma pessoa saiu | Equipe → **Desativar**. |
| Suspeita de acesso indevido | Configurações → Sessões → "sair de todos"; troque a senha; confira a Auditoria. |

## 10. Como o sistema se protege (resumo)

Senhas com hash forte + segredo fora do banco; código no e-mail a cada login (para contas com e-mail confirmado); bloqueio por tentativas; sessão com expiração; proteção contra requisições forjadas (CSRF); cabeçalhos de segurança rígidos (CSP); banco com RLS e um papel próprio sem permissão de alterar histórico; livro-razão e auditoria imutáveis; toda função nova nasce **bloqueada** até ganhar uma regra de permissão. Detalhes em `SEGURANCA.md`.

## 11. Ligar o envio de e-mail (para as pessoas criarem conta)

Enquanto isso não for feito, a tela de entrada **não mostra "Criar conta"** (o dono continua entrando normalmente). O sistema manda o código por um Gmail seu (grátis, uns 500 e-mails por dia):

1. Na conta Google que vai **enviar** os e-mails, ligue a verificação em duas etapas (o Google exige) e crie uma **senha de app**: https://myaccount.google.com/apppasswords (são 16 letras).
2. Na Vercel, projeto **carlos-sistema** → **Settings → Environment Variables**, crie no ambiente *Production*: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=<seu gmail>`, `SMTP_PASS=<a senha de app>` e, se quiser, `EMAIL_DE="Carlos Sistema" <seu gmail>`.
3. Faça um **Redeploy**. Entre como dono → **Configurações → E-mail da conta**, vincule o seu Gmail e toque em **Enviar e-mail de teste para mim**.

- A senha de app fica **só na Vercel** (e no seu gerenciador de senhas): nunca no GitHub nem no Obsidian.
- Por padrão só `@gmail.com` pode criar conta. Para liberar outros provedores: `EMAIL_DOMINIOS=gmail.com,outlook.com` (ou `*` para qualquer um).

**Entrada do dono (desenvolvedor):** a variável `DONO_EMAIL` (na Vercel) liga o *seu* Gmail à conta de dono, com todas as permissões. Na tela de entrada você digita só o e-mail, **deixa a senha em branco**, e o código de 6 dígitos chega na sua caixa de entrada. Proteja esse Gmail com a verificação em duas etapas do Google, porque ele passa a ser a chave do sistema. Se o envio de e-mail cair e você ficar sem conseguir entrar: entre com o código de 11 dígitos + a senha provisória do arquivo de segredos, ou crie `LOGIN_CODIGO=0` na Vercel e faça um Redeploy (apague depois).

## 12. Variáveis do cliente (FRIO)

Na Vercel (Production):

- `APP_NAME` — nome que aparece no sistema (ex.: `FRIO Peças e Serviços`).
- `DONO_EMAIL` — e-mail do desenvolvedor, ligado à conta de dono.
- `DONOS_EXTRAS_JSON` — outros donos, no formato `[{"email":"...","nome":"..."}]`. Entram só com e-mail + código (ninguém conhece a senha).
- `EMPRESA_JSON` e `PROVISIONAR=frio` — carga inicial **uma única vez** (empresa, endereços do galpão, produtos e estoque de teste). Depois dela, edite tudo pela tela **Empresa** e pelas telas normais; apagar a variável não desfaz nada.

Os dados do cliente ficam só no banco e nessas variáveis. **Não** vão para o GitHub nem para o Obsidian.
