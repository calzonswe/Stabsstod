#!/bin/sh
# restore.sh — M38: operations.
#
# Restores a backup produced by scripts/backup.sh.
#
#   scripts/restore.sh [backup-dir]
#
# Without an argument, the newest directory under data/backups/ is used.
# The backup directory must contain db.sql.gz and attachments.tar.gz.
#
# What happens, in order:
#   1. the attachments volume is swapped (the api container serves the
#      volume, so it must be running)
#   2. the api is stopped (frees the database)
#   3. the database is dropped and recreated from the dump
#   4. the api is started; its idempotent migrations run at start, so an
#      older backup (missing newer migrations) is brought up to date
#   5. the smoke test must pass
#
# Destructive: the current database and attachments are replaced. Take a
# fresh backup (scripts/backup.sh) before restoring unless you are sure
# you do not need the current state.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
DB="${POSTGRES_DB:-stabsstod}"
PG_USER="${POSTGRES_USER:-postgres}"

if [ "$#" -ge 1 ]; then
  BACKUP="$1"
else
  BACKUP="$(ls -1d data/backups/* 2>/dev/null | sort | tail -1 || true)"
fi

if [ -z "$BACKUP" ]; then
  echo "No backup found under data/backups/. Create one with scripts/backup.sh." >&2
  exit 1
fi

for f in db.sql.gz attachments.tar.gz; do
  if [ ! -f "$BACKUP/$f" ]; then
    echo "Missing $BACKUP/$f — not a complete backup." >&2
    exit 1
  fi
done
[ -f "$BACKUP/manifest.txt" ] || echo "WARNING: $BACKUP/manifest.txt is missing (older backup format?)" >&2
[ -f "$BACKUP/manifest.txt" ] && cat "$BACKUP/manifest.txt"

# The attachments volume is swapped through the api container, so the stack
# must be up first (this also starts it if it is not; on a fresh machine the
# api image is built here).
docker compose up -d

echo "==> Restoring from $BACKUP"
echo "==> Swapping the attachments volume..."
docker compose exec -T api sh -c 'find /data/attachments -mindepth 1 -delete'
docker compose exec -T api tar xzf - -C /data/attachments < "$BACKUP/attachments.tar.gz"

echo "==> Stopping the api..."
docker compose stop api

echo "==> Dropping and recreating database \"$DB\"..."
docker compose exec -T db psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
docker compose exec -T db psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $DB"
echo "==> Loading the database dump..."
gunzip -c "$BACKUP/db.sql.gz" |
  docker compose exec -T db psql -U "$PG_USER" -d "$DB" -v ON_ERROR_STOP=1

echo "==> Starting the api (migrations run at start)..."
docker compose start api

echo -n "==> Waiting for the api to become healthy..."
i=0
while [ "$i" -lt 30 ]; do
  if curl -sf http://127.0.0.1:3000/api/health | grep -q '"ok":true'; then
    echo " up"
    break
  fi
  sleep 2
  i=$((i + 1))
done

if ! curl -sf http://127.0.0.1:3000/api/health | grep -q '"ok":true'; then
  echo "The api did not become healthy — see: docker compose logs api" >&2
  exit 1
fi

echo "==> Running the smoke test..."
sh scripts/smoke.sh

echo
echo "Restore complete."
