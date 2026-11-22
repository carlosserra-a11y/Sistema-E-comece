#!/usr/bin/env bash
# Copia os dados da Supabase para o PostgreSQL desta VPS. Rode UMA vez, como root, depois do instalar.sh e ANTES de ligar o sistema aqui.
# A Supabase só é lida: nada é alterado nem apagado nela. Se algo não bater, o script para e o banco da VPS pode ser refeito.
#
#   bash /opt/wms/app/deploy/vps/migrar-dados-supabase.sh
set -euo pipefail

APP="${APP:-/opt/wms/app}"
BANCO="${BANCO:-wms}"
cd /   # o usuário "postgres" não pode entrar na pasta do root
[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }

local_pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -X -q -tA -d "$BANCO" "$@"; }

if [ "$(local_pg -c 'SELECT count(*) FROM users')" != "0" ]; then
  echo "O banco desta VPS já tem dados (tabela users não está vazia). Para refazer do zero:"
  echo "  sudo -u postgres dropdb $BANCO && sudo -u postgres createdb -E UTF8 $BANCO && bash $APP/deploy/vps/aplicar-esquema.sh"
  exit 1
fi

echo "Cole a DATABASE_URL da Supabase (a mesma que está na Vercel). Ela NÃO aparece na tela e não é gravada em lugar nenhum:"
read -rs ORIGEM
echo
[ -n "$ORIGEM" ] || { echo "Nada colado."; exit 1; }
# a cópia precisa da conexão "session" (porta 5432) do mesmo endereço; a 6543 é a de transação, que não serve para cópia
ORIGEM="${ORIGEM/:6543\//:5432/}"
ORIGEM="${ORIGEM%%\?*}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

echo "==> 1/4 Baixando os dados da Supabase"
pg_dump "$ORIGEM" --data-only --enable-row-security --no-owner --no-privileges --format=custom --file="$TMP/dados.dump"
ls -l "$TMP/dados.dump" | awk '{print "    arquivo temporário: " $5 " bytes"}'

echo "==> 2/4 Gravando no PostgreSQL desta VPS (gatilhos e chaves ficam desligados só durante a carga)"
sudo -u postgres pg_restore --dbname="$BANCO" --data-only --disable-triggers --no-owner --exit-on-error < "$TMP/dados.dump"

echo "==> 3/4 Conferindo, tabela por tabela, se a quantidade de registros é igual"
DIFERENTES=0
for tabela in $(local_pg -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1"); do
  origem_n="$(psql "$ORIGEM" -X -q -tA -c "SELECT count(*) FROM public.\"$tabela\"")"
  destino_n="$(local_pg -c "SELECT count(*) FROM public.\"$tabela\"")"
  if [ "$origem_n" = "$destino_n" ]; then printf '    ok   %-28s %s\n' "$tabela" "$destino_n"; else printf '    ERRO %-28s Supabase=%s VPS=%s\n' "$tabela" "$origem_n" "$destino_n"; DIFERENTES=1; fi
done
if [ "$DIFERENTES" = "1" ]; then echo "Há tabelas com quantidades diferentes. Nada foi ligado. Refaça (comando no topo deste script) ou me chame."; exit 1; fi
local_pg -c "ANALYZE" >/dev/null

echo "==> 4/4 Conferindo o saldo contra o livro-razão e a cadeia de auditoria (o mesmo teste de integridade do sistema)"
if sudo -u wms bash -c "cd $APP && node --disable-warning=ExperimentalWarning scripts/verificar-dados.js"; then
  echo
  echo "Dados copiados e conferidos. Agora ligue o sistema:  systemctl restart wms && systemctl status wms --no-pager"
else
  echo "A conferência de integridade falhou. NÃO ligue o sistema; refaça a cópia ou me chame."
  exit 1
fi
