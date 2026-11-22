#!/usr/bin/env bash
# Atualiza o sistema na VPS para a última versão do GitHub, reinicia e confere se respondeu. Rode como root:
#   bash /opt/wms/app/deploy/vps/atualizar.sh
set -euo pipefail

DOMINIO="${DOMINIO:-friospecaseservicos.com.br}"
APP=/opt/wms/app
USUARIO=wms

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }

sudo -u "$USUARIO" git -C "$APP" pull --ff-only
(cd "$APP" && sudo -u "$USUARIO" npm ci --omit=dev)
systemctl restart wms
sleep 3
systemctl is-active wms
# o servidor só atende o endereço do domínio: por isso o cabeçalho Host
curl -fsS -H "Host: $DOMINIO" http://127.0.0.1:3000/api/sessao >/dev/null && echo "OK: o sistema respondeu."
