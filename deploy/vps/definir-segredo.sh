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

# a senha de app do Gmail aparece em 4 grupos separados por espaço; o sistema usa as 16 letras juntas
if [ "$NOME" = "SMTP_PASS" ]; then VALOR="$(printf '%s' "$VALOR" | tr -d '[:space:]')"; fi

EMAIL_RE='^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'

case "$NOME" in
  PEPPER|HMAC_KEY|FIELD_KEY)
    # o sistema gera cada chave com exatamente 64 caracteres hexadecimais (0-9 e a-f)
    if ! printf '%s' "$VALOR" | grep -Eq '^[0-9a-fA-F]{64}$'; then
      echo "RECUSADO: $NOME tem de ter exatamente 64 caracteres de 0-9 e a-f (o que você colou tem ${#VALOR} caracteres e não é isso)."
      echo "Abra o arquivo de segredos no Bloco de Notas e dê DOIS CLIQUES sobre o valor da linha de $NOME: isso seleciona só o valor. Copie e cole de novo."
      echo "Nada foi alterado."; exit 1
    fi
    # cada chave é diferente das outras: um valor repetido indica que foi colada a coisa errada
    for outra in PEPPER HMAC_KEY FIELD_KEY; do
      [ "$outra" = "$NOME" ] && continue
      atual="$(grep -m1 "^$outra=" "$ENV_ARQ" | cut -d= -f2- || true)"
      if [ -n "$atual" ] && [ "$atual" = "$VALOR" ]; then
        echo "RECUSADO: esse valor é igual ao de $outra. Cada chave é diferente; confira a linha de $NOME no arquivo de segredos."
        echo "Nada foi alterado."; exit 1
      fi
    done ;;
  SMTP_PASS)
    if ! printf '%s' "$VALOR" | grep -Eq '^[A-Za-z0-9]{16}$'; then
      echo "RECUSADO: a senha de app do Gmail tem 16 letras (pode vir em 4 grupos com espaço). O que você colou tem ${#VALOR} caracteres. Nada foi alterado."; exit 1
    fi ;;
  BACKUP_SENHA)
    if [ "${#VALOR}" -lt 12 ]; then echo "Use uma senha de pelo menos 12 caracteres. Nada foi alterado."; exit 1; fi ;;
  SMTP_USER|DONO_EMAIL)
    if ! printf '%s' "$VALOR" | grep -Eq "$EMAIL_RE"; then echo "Isso não parece um e-mail. Nada foi alterado."; exit 1; fi ;;
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
