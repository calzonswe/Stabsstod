# Stabsstöd

Self-hosted, offline-first support system for an incident management staff ("stabsstöd").

The specification is [plan.md](plan.md); it is the source of truth. Progress is tracked in
[PROGRESS.md](PROGRESS.md); open owner questions live in [QUESTIONS.md](QUESTIONS.md).

Status: M40 complete — documentation and polish (README, admin guide, user guides sv/en,
known limitations, accessibility pass, empty/loading/error states, shared Dialog and
ErrorNotice components). See [docs/](docs/).

## Run it

The stack is Caddy (TLS, reverse proxy) + the Fastify API + Postgres. The web app is
built inside the `stabsstod/api:latest` image and served by Caddy. No CDN, no external
fonts or tiles — everything is self-hosted.

### 1. Clone and configure

```
git clone <repo>
cd stabsstod
cp .env.example .env
```

Edit `.env` — set at minimum `ADMIN_PASSWORD` (the bootstrap admin's first password) and
`SESSION_SECRET`. The bootstrap admin is forced to change this password at first login.

### 2. Start the stack

```
docker compose up --build
```

The API is reachable at http://localhost:3000 (published on loopback only by Caddy).
Run the smoke test:

```
./scripts/smoke.sh
```

The API runs database migrations at start under a Postgres advisory lock, so only one
instance migrates at a time.

### 3. First login

1. Open http://localhost:3000 in the browser.
2. Log in as `admin` with the `ADMIN_PASSWORD` from `.env`.
3. You are forced to set a new password (min 12 chars, letter + digit, not the username).
4. After the change, you land on the home page. Navigate to **Insatser** → **Skapa insats**
   to create your first incident.

### 4. Create an incident

1. From **Insatser**, click **Skapa insats**.
2. Fill in name, type, start time, and choose which functions to pre-populate.
3. Click **Skapa insats**.
4. You are redirected to the incident workspace (Läge / Inriktning / Samordning / Logg /
   Karta / Stab / Rapporter).

### 5. Add users (admin only)

From **Inställningar** → **Användarhantering**:
1. Click **Skapa användare**, enter username, password (policy applies), optional display
   name and role.
2. Click **Skapa**.
3. From inside an incident, use **Stab → Lägg till medlem** to add users to that incident.

### 6. Offline behaviour

The web app is a Progressive Web App (PWA). All writes go to local Dexie (IndexedDB)
first and sync to the server when the connection returns:

- The header shows an "Offline" indicator when the browser has no network.
- Create/edit/retract actions work offline; they are queued in the outbox.
- When back online, pending changes are pushed automatically, and new records from other
  devices are pulled. Conflicts (concurrent edits to the same item) show a badge and can
  be resolved by choosing a version.
- The service worker caches the app shell; installed on the home screen, the app opens
  even when offline.

### 7. Trust the Caddy CA (offline mode on devices)

Service workers require a secure context (HTTPS). Caddy uses `tls internal`, issuing its
own root CA. For the PWA to install and work offline on client devices, those devices
must trust the Caddy CA:

1. From a device on the same network, fetch the CA certificate from the Caddy instance
   (the admin guide has the exact path: see [docs/admin.md](docs/admin.md)).
2. Install it as a trusted root CA on the device.
3. Open the app over `https://<server-hostname>/` — the service worker installs and
   offline mode is available.
4. An in-app diagnostic ("Offline support: active / not available — why") shows whether
   the service worker is active.

Without the CA, the app still works over plain HTTP on `localhost`, but service workers
—and therefore offline mode—will not install.

### 8. Backup and restore

Everything that is not in git lives in the `db` and `attachments` Docker volumes.
`scripts/backup.sh` backs both up:

```
scripts/backup.sh
# → data/backups/<YYYYMMDD-HHMMSS>/
#     db.sql.gz          pg_dump of the database
#     attachments.tar.gz the attachments volume
#     manifest.txt       what was backed up, when, and from which git commit
```

The backup is taken online through the running containers — the stack keeps serving.

Restore with `scripts/restore.sh` (newest backup unless you pass a directory):

```
scripts/restore.sh [data/backups/<YYYYMMDD-HHMMSS>]
```

The restore is **destructive**: the current database and attachments are replaced by the
backup. `.env` is **not** part of the backup — keep it separately.

### 9. Air-gapped install

On a connected machine:

```
docker compose build                  # builds stabsstod/api:latest
scripts/fetch-map.sh                  # downloads data/maps/ (a few GB)
docker save stabsstod/api:latest postgres:16 -o stabsstod-images.tar
```

Move the repo, `stabsstod-images.tar`, `data/maps/`, and `.env` to the target. On the
target (no internet needed):

```
docker load -i stabsstod-images.tar
docker compose up -d                  # no --build: images are already present
```

### Password policy

Passwords must be at least 12 characters, contain at least one letter and one digit, and
must not equal the username. Changes must also differ from the current password. Enforced
on password change, user creation, and password reset (temporary passwords always satisfy
the policy).

### Security headers

The API sets HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
a strict CSP (no remote origins) on every response.

## Documentation

- [docs/admin.md](docs/admin.md) — admin guide (CA, users, incidents, sync, backup)
- [docs/user-guide-sv.md](docs/user-guide-sv.md) — användarhandbok (svenska)
- [docs/user-guide-en.md](docs/user-guide-en.md) — user guide (English)
- [docs/known-limitations.md](docs/known-limitations.md) — known limits and what's not in v1
