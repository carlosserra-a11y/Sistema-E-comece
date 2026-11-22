#!/usr/bin/env bash
# Aplica no PostgreSQL desta VPS (banco "wms") as migrations que ainda faltam e, em seguida, a segurança (papel app_wms e permissões).
# Idempotente: só aplica o que ainda não foi aplicado. O instalar.sh e o atualizar.sh chamam este script. Rode como root.
set -euo pipefail

APP="${APP:-/opt/wms/app}"
BANCO="${BANCO:-wms}"
cd /   # o usuário "postgres" não pode entrar na pasta do root

pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -X -q -d "$BANCO" "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }

pg -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (nome text PRIMARY KEY, aplicada_em bigint NOT NULL)"

for arquivo in $(ls "$APP"/supabase/migrations/*.sql | sort); do
  nome="$(basename "$arquivo")"
  # arquivos *_supabase.sql são só da Supabase (papéis anon/authenticated, RLS); aqui vale o postgres-seguranca.sql
  case "$nome" in *_supabase.sql) continue ;; esac
  if [ -n "$(pg -tA -c "SELECT 1 FROM public.schema_migrations WHERE nome = '$nome'")" ]; then continue; fi
  echo "  aplicando $nome"
  { echo "BEGIN;"; cat "$arquivo"; echo; echo "INSERT INTO public.schema_migrations (nome, aplicada_em) VALUES ('$nome', (extract(epoch FROM now()) * 1000)::bigint);"; echo "COMMIT;"; } | pg
done

pg -f "$APP/deploy/vps/postgres-seguranca.sql"
pg -c "GRANT CONNECT ON DATABASE \"$BANCO\" TO app_wms"
echo "Esquema do banco em dia."
