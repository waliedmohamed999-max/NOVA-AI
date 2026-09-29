#!/usr/bin/env bash
# NOVA — PostgreSQL logical backup (custom format) with checksum and retention.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/nova BACKUP_DIR=/var/backups/nova ./scripts/backup/pg-backup.sh
#
# Options (env):
#   BACKUP_DIR          where dumps go (default ./backups)
#   RETENTION_DAYS      delete dumps older than this (default 14)
#   PG_DUMP_EXTRA       extra pg_dump flags, e.g. "--schema=public" on Supabase
#   PG_DOCKER           run pg_dump inside this container instead of the host (local dev), e.g. nova-postgres
#
# Output: nova-<db>-<UTC timestamp>.dump + .sha256. Exit code != 0 on any failure (use it in cron/alerts).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

# Strip Prisma's ?schema=… — libpq doesn't understand it.
URL="${DATABASE_URL%%\?*}"
DB_NAME="${URL##*/}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/nova-$DB_NAME-$STAMP.dump"

echo "[backup] dumping $DB_NAME → $FILE"
if [[ -n "${PG_DOCKER:-}" ]]; then
  # Inside the container the database is on localhost:5432.
  IN_URL="$(echo "$URL" | sed -E 's#@[^/]+/#@localhost:5432/#')"
  docker exec "$PG_DOCKER" pg_dump --format=custom --no-owner --no-privileges --compress=6 ${PG_DUMP_EXTRA:-} "$IN_URL" > "$FILE"
else
  pg_dump --format=custom --no-owner --no-privileges --compress=6 ${PG_DUMP_EXTRA:-} "$URL" > "$FILE"
fi

SIZE="$(wc -c < "$FILE")"
if [[ "$SIZE" -lt 1024 ]]; then
  echo "[backup] ERROR: dump is suspiciously small ($SIZE bytes)" >&2
  exit 1
fi
( cd "$BACKUP_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
echo "[backup] ok: $SIZE bytes, sha256 written"

# Retention: only our own dump files, only older than RETENTION_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "nova-$DB_NAME-*.dump" -o -name "nova-$DB_NAME-*.dump.sha256" \) -mtime "+$RETENTION_DAYS" -print -delete | sed 's/^/[backup] retention removed: /'
echo "$FILE"
