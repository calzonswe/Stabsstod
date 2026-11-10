# Stabsstöd

Self-hosted, offline-first support system for an incident management staff ("stabsstöd").

The specification is [plan.md](plan.md); it is the source of truth. Progress is tracked in
[PROGRESS.md](PROGRESS.md); open owner questions live in [QUESTIONS.md](QUESTIONS.md).

Status: M3 scaffold complete.

## Run it

1. Copy `.env.example` to `.env` and adjust values (especially passwords and
   `SESSION_SECRET`).
2. Start the stack: `docker compose up --build`
3. Open https://localhost/ (the internal self-signed CA is used — accept the
   warning, or install the CA).
4. Run the smoke test: `./scripts/smoke.sh`

The Caddy instance uses `tls internal`, so it issues its own CA. The CA
certificate lives in the `caddy_data` volume at
`/data/caddy/authority/local/root.crt` inside the caddy container. Export it and
install it on your client device to avoid browser warnings, or add a permanent
trust for `localhost`. An in-app CA diagnostic is planned for the PWA milestone.
