#!/usr/bin/env bash
# Instala o sistema numa VPS Ubuntu (22.04 ou 24.04), como a da HostGator: Node 24, serviço que sobe sozinho (systemd),
# HTTPS automático (Caddy), firewall e backup diário. Rode como root, UMA vez (pode repetir: ele só completa o que falta):
#
#   DOMINIO=xn--friospeaseservios-gsbi.com.br bash instalar.sh
#
# O banco continua na Supabase. Os segredos NÃO ficam neste script: você os cola em /opt/wms/.env (veja docs/VPS-HOSTGATOR.md).
set -euo pipefail

DOMINIO="${DOMINIO:-xn--friospeaseservios-gsbi.com.br}"          # endereço técnico (punycode) do domínio com acentos
REPO_URL="${REPO_URL:-https://github.com/carlosserra-a11y/Sistema-E-comece.git}"
RAIZ=/opt/wms
APP="$RAIZ/app"
USUARIO=wms

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "Sistema não testado: ${PRETTY_NAME:-?}. Use Ubuntu 22.04 ou 24.04."; exit 1 ;; esac

echo "==> 1/8 Pacotes básicos"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw cron debian-keyring debian-archive-keyring apt-transport-https

echo "==> 2/8 Node.js 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> 3/8 Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> 4/8 Usuário do sistema ($USUARIO) e código"
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

echo "==> 5/8 Arquivo de segredos ($RAIZ/.env)"
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
EMAIL_DE=PREENCHER
DB_POOL_MAX=5
ENV
  )
  chown "$USUARIO:$USUARIO" "$RAIZ/.env"; chmod 600 "$RAIZ/.env"
fi
# o sistema lê o .env da pasta do app: um atalho aponta para o arquivo único em /opt/wms
ln -sfn "$RAIZ/.env" "$APP/.env"
if grep -q PREENCHER "$RAIZ/.env"; then PRECISA_PREENCHER=1; fi

echo "==> 6/8 Serviço systemd (sobe sozinho e reinicia se cair)"
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

echo "==> 7/8 HTTPS e firewall"
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
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> 8/8 Backup diário às 2h (arquivo cifrado em $APP/backups)"
cat > /etc/cron.d/wms-backup <<CRON
0 2 * * * $USUARIO cd $APP && /usr/bin/npm run backup >> $RAIZ/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/wms-backup

echo
if [ "$PRECISA_PREENCHER" = "1" ]; then
  echo "FALTA UM PASSO: abra $RAIZ/.env (nano $RAIZ/.env), troque cada PREENCHER pelos valores reais e depois rode:"
  echo "    systemctl restart wms && systemctl status wms --no-pager"
else
  systemctl restart wms
  sleep 3
  systemctl is-active wms && echo "Sistema no ar na porta 3000 (atrás do Caddy)."
fi
echo "Depois aponte o DNS do domínio para o IP desta VPS (docs/VPS-HOSTGATOR.md, passo 5)."
