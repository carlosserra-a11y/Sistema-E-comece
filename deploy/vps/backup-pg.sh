#!/usr/bin/env bash
# Backup NATIVO do PostgreSQL desta VPS (pg_dump), cifrado com a BACKUP_SENHA do /opt/wms/.env. É este arquivo que se restaura num
# PostgreSQL novo (o "npm run backup" gera o arquivo do sistema, que serve para auditoria e para abrir os dados num SQLite).
# O instalar.sh agenda este script todo dia às 2h30. Mantém os últimos 30.
#
# Restaurar num PostgreSQL novo (banco "wms" já criado e SEM tabelas):
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_SENHA -in wms-AAAA-MM-DD.dump.enc | sudo -u postgres pg_restore --dbname=wms --no-owner
#   bash /opt/wms/app/deploy/vps/aplicar-esquema.sh      # devolve o papel app_wms e as permissões
set -euo pipefail

RAIZ=/opt/wms
PASTA="${PASTA:-$RAIZ/backups-pg}"
MANTER="${MANTER:-30}"
BANCO="${BANCO:-wms}"
cd /

BACKUP_SENHA="$(grep -E '^BACKUP_SENHA=' "$RAIZ/.env" | head -n1 | cut -d= -f2-)"
if [ -z "$BACKUP_SENHA" ] || [ "$BACKUP_SENHA" = "PREENCHER" ]; then echo "Defina BACKUP_SENHA em $RAIZ/.env antes de fazer backup."; exit 1; fi
export BACKUP_SENHA

umask 077
mkdir -p "$PASTA"
carimbo="$(date +%Y-%m-%d-%H%M%S)"
destino="$PASTA/wms-$carimbo.dump.enc"
sudo -u postgres pg_dump --format=custom "$BANCO" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_SENHA -out "$destino.tmp"
mv "$destino.tmp" "$destino"
# confere que o arquivo abre e é um dump válido (lista o conteúdo sem restaurar)
# o `cat` consome o resto: o pg_restore --list para de ler cedo e, sem isso, o openssl às vezes falhava ("error writing output file") num backup bom
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_SENHA -in "$destino" | sudo -u postgres bash -c 'pg_restore --list > /dev/null; r=$?; cat > /dev/null; exit $r'
echo "Backup do PostgreSQL salvo e conferido: $destino ($(stat -c %s "$destino") bytes)"

# mantém só os últimos $MANTER
ls -1t "$PASTA"/wms-*.dump.enc 2>/dev/null | tail -n +"$((MANTER + 1))" | xargs -r rm -f
