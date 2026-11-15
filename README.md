# Stabsstöd

Self-hosted, offline-first support system for an incident management staff ("stabsstöd").

The specification is [plan.md](plan.md); it is the source of truth. Progress is tracked in
[PROGRESS.md](PROGRESS.md); open owner questions live in [QUESTIONS.md](QUESTIONS.md).

Status: M38 complete — operations (backup/restore, air-gapped install, password
policy, security headers, session management) implemented and verified.

## Run it

The organisation is expected to run its own reverse proxy in front of the api
(forwarding to `api:3000` internally, or to `127.0.0.1:3000` when run locally).

1. Copy `.env.example` to `.env` and adjust values (especially passwords and
   `SESSION_SECRET`).
2. Start the stack: `docker compose up --build`
3. The api is reachable at http://localhost:3000 (published on loopback only).
4. Run the smoke test: `./scripts/smoke.sh`

The api runs database migrations at start under a Postgres advisory lock, so only
one instance migrates at a time.

## Backup and restore

Everything that is not in git lives in the `db` and `attachments` Docker
volumes. `scripts/backup.sh` backs both up:

```
scripts/backup.sh
# → data/backups/<YYYYMMDD-HHMMSS>/
#     db.sql.gz          pg_dump of the database
#     attachments.tar.gz the attachments volume
#     manifest.txt       what was backed up, when, and from which git commit
```

The backup is taken online through the running containers — the stack keeps
serving during the backup. `data/backups/` is git-ignored; copy the backup
directory off the server for real backup purposes.

Restore with `scripts/restore.sh` (the newest backup is used unless you pass a
directory):

```
scripts/restore.sh [data/backups/<YYYYMMDD-HHMMSS>]
```

The restore is **destructive**: the current database and attachments are
replaced by the backup. It swaps the attachments volume, stops the api, drops
and recreates the database from the dump, starts the api (its idempotent
migrations bring an older backup up to the current schema), and finishes by
running the smoke test. A few seconds of downtime.

Notes:

- `.env` is **not** part of the backup — keep it (or the values in it)
  separately, it is the configuration.
- The documented restore was run once during M38 and is noted in
  [PROGRESS.md](PROGRESS.md).

## Air-gapped install

The stack can be installed on a machine with no internet access. On a
connected machine:

```
docker compose build                  # builds stabsstod/api:latest
scripts/fetch-map.sh                  # downloads data/maps/ (a few GB)
docker save stabsstod/api:latest postgres:16 -o stabsstod-images.tar
```

Move to the target: the repo, `stabsstod-images.tar`, `data/maps/`, and the
`.env` file. On the target (no internet needed):

```
docker load -i stabsstod-images.tar
docker compose up -d                  # no --build: images are already present
```

Because the api service has an explicit `image: stabsstod/api:latest` tag in
`docker-compose.yml`, the loaded image satisfies compose without a build. The
map is served from `data/maps/` (see `scripts/fetch-map.sh` for what it
contains), so the map works with no internet at all.

## Password policy

Passwords must be at least 12 characters long, contain at least one letter and
one digit, and must not be identical to the username. When changing a
password, it must also differ from the current password. The policy is enforced
by the API when:

- a user changes their password (`POST /api/auth/change-password`),
- an admin creates a user (`POST /api/admin/users`),
- an admin resets a password (the generated temporary password always
  satisfies the policy).

The bootstrap admin created from the `ADMIN_PASSWORD` env var on first start
is not policy-checked at start (the env value is the organisation's choice);
that user is forced to change the password at first login, which enforces the
policy.

## Security headers

The api sets these headers on every response (static assets included), verified
by tests in M38:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'` |

The organisation's reverse proxy terminates TLS in front of the api; HSTS is
harmless over plain HTTP and takes effect once the site is served over HTTPS.

## PWA and offline mode

The web app is a Progressive Web App (PWA) that works offline:

- The app shell and static assets are precached by a service worker
- All data writes go to local Dexie (IndexedDB) first, then sync when online
- When offline, the header shows an "Offline" indicator
- When back online, pending changes are pushed to the server automatically

Service workers require a secure context (HTTPS or localhost). In production, the
organisation's reverse proxy must provide HTTPS. For local development, `localhost`
is treated as secure by browsers.

## Offline CA note

If your organisation runs its own reverse proxy with HTTPS, ensure client devices
trust the proxy's CA certificate so service workers can install and the PWA can
work offline.
