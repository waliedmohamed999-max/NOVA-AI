#!/usr/bin/env bash
# NOVA — restore a dump into a NEW scratch database and verify it. Never touches the source database.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/nova ./scripts/backup/pg-restore-verify.sh backups/nova-nova-….dump
#
# Steps: checksum → create <db>_restore_check → pg_restore → compare row counts of key tables with the
# source → check the migrations table → drop the scratch database (KEEP_RESTORE=1 keeps it).
# Options: PG_DOCKER=<container> to run the tools inside a container (local dev).
set -euo pipefail

DUMP="${1:?usage: pg-restore-verify.sh <file.dump>}"
: "${DATABASE_URL:?DATABASE_URL is required (the SOURCE database, read-only use)}"
URL="${DATABASE_URL%%\?*}"
DB_NAME="${URL##*/}"
SERVER_URL="${URL%/*}"
CHECK_DB="${DB_NAME}_restore_check"
CHECK_URL="$SERVER_URL/$CHECK_DB"

if [[ "$CHECK_DB" == "$DB_NAME" ]]; then echo "refusing: scratch db equals source" >&2; exit 1; fi

run() { # run a postgres client tool on the host or in the container
  if [[ -n "${PG_DOCKER:-}" ]]; then
    local args=()
    for a in "$@"; do args+=("$(echo "$a" | sed -E 's#@[^/]+/#@localhost:5432/#')"); done
    docker exec -i "$PG_DOCKER" "${args[@]}"
  else
    "$@"
  fi
}

if [[ -f "$DUMP.sha256" ]]; then
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" )
else
  echo "[verify] WARNING: no checksum file next to the dump"
fi

echo "[verify] creating scratch database $CHECK_DB"
run psql "$SERVER_URL/postgres" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$CHECK_DB\";" -c "CREATE DATABASE \"$CHECK_DB\";"
run psql "$CHECK_URL" -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "[verify] restoring"
START=$(date +%s)
run pg_restore --no-owner --no-privileges --exit-on-error --dbname="$CHECK_URL" < "$DUMP"
echo "[verify] restore took $(( $(date +%s) - START ))s"

TABLES="organizations users workspaces leads content_items social_posts integrations integration_credentials subscriptions invoices file_objects audit_logs _prisma_migrations"
FAIL=0
printf "%-26s %10s %10s\n" table source restored
for t in $TABLES; do
  SRC=$(run psql "$URL" -tA -c "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo "n/a")
  DST=$(run psql "$CHECK_URL" -tA -c "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo "n/a")
  MARK=""; if [[ "$SRC" != "$DST" ]]; then MARK="  <-- differs (source may have changed since the dump)"; [[ "$DST" == "n/a" ]] && FAIL=1; fi
  printf "%-26s %10s %10s%s\n" "$t" "$SRC" "$DST" "$MARK"
done

PENDING=$(run psql "$CHECK_URL" -tA -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;")
if [[ "$PENDING" != "0" ]]; then echo "[verify] ERROR: unfinished migrations in the restored copy" >&2; FAIL=1; fi

if [[ "${KEEP_RESTORE:-0}" != "1" ]]; then
  run psql "$SERVER_URL/postgres" -q -c "DROP DATABASE IF EXISTS \"$CHECK_DB\";"
  echo "[verify] scratch database dropped"
fi
if [[ "$FAIL" != "0" ]]; then echo "[verify] FAILED"; exit 1; fi
echo "[verify] OK — restore verified"
