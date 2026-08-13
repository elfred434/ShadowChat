#!/bin/sh
# Sauvegarde ShadowChat : dump PostgreSQL + médias, avec rétention.
#
# Usage :
#   BACKUP_DIR=./backups scripts/backup.sh
#   BACKUP_DIR=./backups BACKUP_KEEP=14 scripts/backup.sh   (rétention en jours)
#
# En environnement Docker Compose, utiliser :
#   docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > backup.sql.gz
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# --- Base de données (via DATABASE_URL si définie, sinon variables DB_*) ---
DB_DUMP="$BACKUP_DIR/db-$STAMP.sql.gz"
if [ -n "${DATABASE_URL:-}" ]; then
    # Analyse basique d'une URL postgres://user:pass@host:port/name
    REST="${DATABASE_URL#postgres://}"
    CRED="${REST%%@*}"; REST="${REST#*@}"
    HOSTPORT="${REST%%/*}"; NAME="${REST#*/}"
    DB_USER="${CRED%%:*}"
    DB_PASSWORD="${CRED#*:}"
    DB_HOST="${HOSTPORT%%:*}"
    DB_PORT="${HOSTPORT##*:}"
    [ "$DB_PORT" = "$HOSTPORT" ] && DB_PORT=5432
    PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc "$NAME" | gzip > "$DB_DUMP"
else
    PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
        -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" \
        -U "${DB_USER:-shadowchat}" -Fc "${DB_NAME:-shadowchat}" | gzip > "$DB_DUMP"
fi
echo "Dump base de données : $DB_DUMP"

# --- Médias (avatars, pièces jointes) ---
if [ -d "${MEDIA_DIR:-./backend/media}" ]; then
    MEDIA_ARCHIVE="$BACKUP_DIR/media-$STAMP.tar.gz"
    tar -czf "$MEDIA_ARCHIVE" -C "${MEDIA_DIR:-./backend/media}" .
    echo "Archives médias : $MEDIA_ARCHIVE"
else
    echo "Attention : dossier de médias introuvable (stockage objet ?) — ignoré."
fi

# --- Rétention ---
find "$BACKUP_DIR" -type f \( -name 'db-*.sql.gz' -o -name 'media-*.tar.gz' \) \
    -mtime "+$BACKUP_KEEP" -delete
echo "Sauvegarde terminée (rétention : $BACKUP_KEEP jours)."
