#!/usr/bin/env bash
# Define UM valor no /opt/wms/.env da VPS, sem mostrar o que você cola na tela. Alternativa ao editor (nano): sem linha errada, sem aspas esquecidas.
#   bash /opt/wms/app/deploy/vps/definir-segredo.sh NOME
# NOME: PEPPER, HMAC_KEY, FIELD_KEY, BACKUP_SENHA, SMTP_USER, SMTP_PASS ou DONO_EMAIL. Rode uma vez para cada um.
set -euo pipefail

NOME="${1:-}"
ENV_ARQ="${ENV_ARQ:-/opt/wms/.env}"
case "$NOME" in
  PEPPER|HMAC_KEY|FIELD_KEY|BACKUP_SENHA|SMTP_USER|SMTP_PASS|DONO_EMAIL) ;;
  *) echo "Uso: bash definir-segredo.sh NOME   (NOME = PEPPER, HMAC_KEY, FIELD_KEY, BACKUP_SENHA, SMTP_USER, SMTP_PASS ou DONO_EMAIL)"; exit 1 ;;
esac
[ -f "$ENV_ARQ" ] || { echo "Não achei $ENV_ARQ. Rode antes o instalar.sh."; exit 1; }

read -rsp "Cole o valor de $NOME (não aparece na tela) e aperte Enter: " VALOR
echo
# copiar e colar às vezes traz quebra de linha ou espaço nas pontas
VALOR="$(printf '%s' "$VALOR" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
[ -n "$VALOR" ] || { echo "Nada colado. Nada foi alterado."; exit 1; }

case "$NOME" in
  PEPPER|HMAC_KEY|FIELD_KEY)
    # o sistema aceita hexadecimal com 64 ou mais caracteres, ou base64 com pelo menos 32 bytes
    if ! printf '%s' "$VALOR" | grep -Eq '^[0-9a-fA-F]{64,}$' && [ "${#VALOR}" -lt 43 ]; then
      echo "ATENÇÃO: esse valor parece curto demais para $NOME (${#VALOR} caracteres; o esperado tem 64). Confira se copiou o valor inteiro."
      echo "Nada foi alterado."; exit 1
    fi ;;
  BACKUP_SENHA)
    [ "${#VALOR}" -ge 12 ] || { echo "Use uma senha de pelo menos 12 caracteres. Nada foi alterado."; exit 1; } ;;
  SMTP_USER|DONO_EMAIL)
    printf '%s' "$VALOR" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' || { echo "Isso não parece um e-mail. Nada foi alterado."; exit 1; } ;;
esac

# troca só a linha NOME= (ou a acrescenta); o valor passa pelo ambiente, então nenhum caractere especial quebra nada
NOVO="$(mktemp "${ENV_ARQ}.XXXXXX")"
NOME="$NOME" VALOR="$VALOR" awk '
  BEGIN { achou = 0 }
  index($0, ENVIRON["NOME"] "=") == 1 { print ENVIRON["NOME"] "=" ENVIRON["VALOR"]; achou = 1; next }
  { print }
  END { if (!achou) print ENVIRON["NOME"] "=" ENVIRON["VALOR"] }
' "$ENV_ARQ" > "$NOVO"
chown --reference="$ENV_ARQ" "$NOVO"
chmod 600 "$NOVO"
mv "$NOVO" "$ENV_ARQ"
echo "OK: $NOME definido (${#VALOR} caracteres)."
faltam="$(grep -c '=PREENCHER$' "$ENV_ARQ" || true)"
echo "Campos que ainda faltam preencher: $faltam"
