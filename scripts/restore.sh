#!/bin/sh
# Restauration ShadowChat : base PostgreSQL (format pg_dump -Fc) + médias.
#
# Usage :
#   scripts/restore.sh ./backups/db-20260101-120000.sql.gz [./backups/media-20260101-120000.tar.gz]
set -eu

DB_DUMP="${1:?Chemin du dump .sql.gz requis}"
MEDIA_ARCHIVE="${2:-}"

REST="${DATABASE_URL:-postgres://shadowchat:shadowchat@localhost:5432/shadowchat}"
REST="${REST#postgres://}"
CRED="${REST%%@*}"; REST="${REST#*@}"
HOSTPORT="${REST%%/*}"; NAME="${REST#*/}"
DB_USER="${CRED%%:*}"
DB_PASSWORD="${CRED#*:}"
DB_HOST="${HOSTPORT%%:*}"
DB_PORT="${HOSTPORT##*:}"
[ "$DB_PORT" = "$HOSTPORT" ] && DB_PORT=5432

echo "Restauration de la base '$NAME' depuis $DB_DUMP ..."
gunzip -c "$DB_DUMP" | PGPASSWORD="$DB_PASSWORD" pg_restore \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$NAME" --clean --if-exists --no-owner
echo "Base restaurée."

if [ -n "$MEDIA_ARCHIVE" ]; then
    mkdir -p "${MEDIA_DIR:-./backend/media}"
    tar -xzf "$MEDIA_ARCHIVE" -C "${MEDIA_DIR:-./backend/media}"
    echo "Médias restaurés."
fi
echo "Restauration terminée."
