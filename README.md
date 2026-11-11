# Stabsstöd

Self-hosted, offline-first support system for an incident management staff ("stabsstöd").

The specification is [plan.md](plan.md); it is the source of truth. Progress is tracked in
[PROGRESS.md](PROGRESS.md); open owner questions live in [QUESTIONS.md](QUESTIONS.md).

Status: M3 scaffold complete (no reverse proxy — the organisation provides its own).

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
