#!/bin/sh
# backup.sh — M38: operations.
#
# Backs up everything the stack holds that is not in git:
#   1. the Postgres database (pg_dump, compressed)
#   2. the attachments volume (blob files uploaded through the app)
# into data/backups/<timestamp>/:
#   db.sql.gz          — pg_dump of the database
#   attachments.tar.gz — the attachments volume
#   manifest.txt       — what was backed up and when
#
# The database is dumped online (pg_dump takes a consistent snapshot);
# the stack keeps running. Restoring is `scripts/restore.sh` (see README,
# "Backup and restore").
#
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# .env holds POSTGRES_DB/POSTGRES_PASSWORD (see .env.example); compose reads
# the same file, so the backup must target the same database.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
DB="${POSTGRES_DB:-stabsstod}"
PG_USER="${POSTGRES_USER:-postgres}"

if [ "$#" -ge 1 ]; then
  DEST="$1"
else
  DEST="data/backups/$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$DEST"

# The dump and the volume archive are taken through the containers, so the
# stack must be up (this also starts it if it is not).
docker compose up -d

echo "==> Dumping database \"$DB\" (online, stack keeps running)..."
docker compose exec -T db pg_dump -U "$PG_USER" -d "$DB" | gzip > "$DEST/db.sql.gz"

echo "==> Archiving the attachments volume..."
docker compose exec -T api tar czf - -C /data/attachments . > "$DEST/attachments.tar.gz"

{
  echo "backup: stabsstod"
  echo "created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "database: $DB"
  echo "git: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
} > "$DEST/manifest.txt"

echo
echo "Backup complete: $DEST"
