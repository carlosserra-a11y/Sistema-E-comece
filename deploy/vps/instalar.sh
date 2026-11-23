#!/usr/bin/env bash
# Instala o sistema numa VPS Ubuntu (22.04 ou 24.04), como a da HostGator: Node 24, serviço que sobe sozinho (systemd),
# HTTPS automático (Caddy), firewall e backup diário. Rode como root, UMA vez (pode repetir: ele só completa o que falta):
#
#   DOMINIO=friospecaseservicos.com.br bash instalar.sh
#
# O banco é o PostgreSQL 17 desta própria VPS (BANCO_TIPO=local, o padrão). Para continuar na Supabase: BANCO_TIPO=supabase.
# Os segredos NÃO ficam neste script: você os cola em /opt/wms/.env (veja docs/VPS-HOSTGATOR.md). A senha do banco local é gerada aqui, na VPS.
set -euo pipefail

DOMINIO="${DOMINIO:-friospecaseservicos.com.br}"          # domínio do sistema
REPO_URL="${REPO_URL:-https://github.com/carlosserra-a11y/Sistema-E-comece.git}"
RAIZ=/opt/wms
APP="$RAIZ/app"
USUARIO=wms
BANCO_TIPO="${BANCO_TIPO:-local}"   # local = PostgreSQL nesta VPS | supabase = continua na Supabase

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "Sistema não testado: ${PRETTY_NAME:-?}. Use Ubuntu 22.04 ou 24.04."; exit 1 ;; esac

# o sudo reclama se o nome do servidor nao resolve (acontece em VPS novas); isso so registra o nome em /etc/hosts
grep -q "$(hostname)" /etc/hosts || echo "127.0.1.1 $(hostname)" >> /etc/hosts

echo "==> 1/9 Pacotes básicos"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw cron openssl apt-transport-https

echo "==> 2/9 Node.js 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> 3/9 Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> 4/9 Usuário do sistema ($USUARIO) e código"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$RAIZ" --shell /usr/sbin/nologin "$USUARIO"
if [ -d "$APP/.git" ]; then
  sudo -u "$USUARIO" git -C "$APP" pull --ff-only
else
  if ! sudo -u "$USUARIO" git clone "$REPO_URL" "$APP"; then
    echo "Não consegui baixar o código. Se o repositório for privado, veja a seção 'Repositório privado' em docs/VPS-HOSTGATOR.md."
    exit 1
  fi
fi
(cd "$APP" && sudo -u "$USUARIO" npm ci --omit=dev)

echo "==> 5/9 Arquivo de segredos ($RAIZ/.env)"
PRECISA_PREENCHER=0
if [ ! -f "$RAIZ/.env" ]; then
  ( umask 077
  cat > "$RAIZ/.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
PUBLIC_ORIGIN=https://$DOMINIO
APP_NAME=FRIO Peças e Serviços
# --- Cole aqui os MESMOS valores da Vercel (Settings > Environment Variables). Troque cada PREENCHER. ---
DATABASE_URL=PREENCHER
PEPPER=PREENCHER
HMAC_KEY=PREENCHER
FIELD_KEY=PREENCHER
DONO_EMAIL=PREENCHER
BACKUP_SENHA=PREENCHER
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=PREENCHER
SMTP_PASS=PREENCHER
DB_POOL_MAX=5
ENV
  )
  chown "$USUARIO:$USUARIO" "$RAIZ/.env"; chmod 600 "$RAIZ/.env"
fi
echo "==> 6/9 Banco de dados"
cd /
if [ "$BANCO_TIPO" = "local" ]; then
  if ! dpkg -s postgresql-17 >/dev/null 2>&1; then
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
    apt-get update -y
    apt-get install -y postgresql-17 postgresql-client-17
  fi
  systemctl enable --now postgresql
  # o PostgreSQL só escuta nesta própria máquina (localhost) e o firewall não abre a porta 5432
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'wms'" | grep -q 1 || sudo -u postgres createdb -E UTF8 -T template0 wms
  bash "$APP/deploy/vps/aplicar-esquema.sh"
  if grep -q '^DATABASE_URL=PREENCHER' "$RAIZ/.env"; then
    SENHA_DB="$(openssl rand -hex 24)"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -X -q -c "ALTER ROLE app_wms PASSWORD '$SENHA_DB'"
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://app_wms:$SENHA_DB@127.0.0.1:5432/wms|" "$RAIZ/.env"
    unset SENHA_DB
  fi
else
  echo "    o banco continua na Supabase (BANCO_TIPO=supabase): cole a DATABASE_URL no .env"
fi

# o sistema lê o .env da pasta do app: um atalho aponta para o arquivo único em /opt/wms
ln -sfn "$RAIZ/.env" "$APP/.env"
if grep -q PREENCHER "$RAIZ/.env"; then PRECISA_PREENCHER=1; fi

echo "==> 7/9 Serviço systemd (sobe sozinho e reinicia se cair)"
cat > /etc/systemd/system/wms.service <<UNIT
[Unit]
Description=Sistema FRIO (WMS)
After=network-online.target
Wants=network-online.target

[Service]
User=$USUARIO
WorkingDirectory=$APP
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable wms >/dev/null

echo "==> 8/9 HTTPS e firewall"
cat > /etc/caddy/Caddyfile <<CADDY
www.$DOMINIO {
	redir https://$DOMINIO{uri} permanent
}

$DOMINIO {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
# libera a porta do SSH que ESTÁ em uso (na HostGator é a 22022, não a 22): liberar a errada trancaria você para fora da VPS
SSH_PORTAS="$(ss -H -tlnp 2>/dev/null | awk '/sshd/ { n = split($4, a, ":"); print a[n] }' | sort -u)"
[ -n "$SSH_PORTAS" ] || SSH_PORTAS=22
for porta in $SSH_PORTAS; do ufw allow "$porta/tcp" >/dev/null; echo "    SSH liberado na porta $porta"; done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> 9/9 Backups diários (2h: arquivo do sistema; 2h30: PostgreSQL nativo)"
cat > /etc/cron.d/wms-backup <<CRON
0 2 * * * $USUARIO cd $APP && /usr/bin/npm run backup >> $RAIZ/backup.log 2>&1
CRON
if [ "$BANCO_TIPO" = "local" ]; then
  cat >> /etc/cron.d/wms-backup <<CRON
30 2 * * * root bash $APP/deploy/vps/backup-pg.sh >> $RAIZ/backup-pg.log 2>&1
CRON
fi
chmod 644 /etc/cron.d/wms-backup

echo
SEM_DADOS=0
if [ "$BANCO_TIPO" = "local" ] && [ "$(sudo -u postgres psql -d wms -tAc 'SELECT count(*) FROM users')" = "0" ]; then SEM_DADOS=1; fi
if [ "$PRECISA_PREENCHER" = "1" ]; then
  echo "1) Abra $RAIZ/.env (nano $RAIZ/.env) e troque cada PREENCHER pelos valores reais."
fi
if [ "$SEM_DADOS" = "1" ]; then
  echo "2) Copie os dados da Supabase para o banco desta VPS (uma vez):  bash $APP/deploy/vps/migrar-dados-supabase.sh"
  echo "   Ele confere tudo e, no fim, mostra o comando para ligar o sistema."
elif [ "$PRECISA_PREENCHER" = "1" ]; then
  echo "Depois:  systemctl restart wms && systemctl status wms --no-pager"
else
  systemctl restart wms
  sleep 3
  systemctl is-active wms && echo "Sistema no ar na porta 3000 (atrás do Caddy)."
fi
echo "Por último, aponte o DNS do domínio para o IP desta VPS (docs/VPS-HOSTGATOR.md, passo 7)."
