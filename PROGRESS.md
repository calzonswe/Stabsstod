# PROGRESS

Milestone log per plan.md §9. One entry per milestone: what was done, what was learned,
anything left over. Newest milestone last.

## M0 — Repository scaffold — done (2026-11-10)

**Done:**
- pnpm workspace: `packages/shared`, `apps/api`, `apps/web` — empty-but-valid packages,
  each with own tsconfig (extends root), ESLint script, Vitest (`passWithNoTests`).
- Root `tsconfig.base.json` (strict), flat ESLint config (`@eslint/js` +
  `typescript-eslint` + `eslint-config-prettier`), Prettier (`.prettierrc.json` /
  `.prettierignore`).
- Root scripts: `typecheck`, `lint`, `test` (delegate to `pnpm -r …`), `format`
  (prettier over the repo).
- `.gitignore` (`data/`, `node_modules/`, `.env`, …), `.env.example` (vars from plan §8),
  `README.md`, `QUESTIONS.md`, `PROGRESS.md`.
- `git init` + first commit.

**Learned:**
- Environment: machine had no Node and no sudo → installed Node v22.23.4 (official
  tarball, SHA-256 verified) into `~/.local`, pnpm 12.18.0 via corepack. Each shell
  session needs `PATH="$HOME/.local/bin:$PATH"`.
- `pnpm -r run/test/exec` excludes the root project by default (pnpm 12 docs) → root
  scripts can safely delegate to `pnpm -r typecheck` etc.; no recursion.
- `typescript@7.0.2` (native) is not supported by `typescript-eslint@8.72.2`
  (peer: `>=4.8.4 <6.1.0`) → pinned `typescript@5.9.3`.
- ESLint 10 / Vitest 5 / Prettier 3.9 / typescript-eslint 8.72 all work together with a
  flat config; package lint scripts pass `--config ../../eslint.config.js` explicitly
  so config resolution never depends on cwd lookup.
- All three gates pass on the empty packages: `pnpm -r typecheck`, `pnpm -r lint`,
  `pnpm -r test`; `pnpm format` is idempotent.

## M1 — API skeleton — done (2026-11-10)

**Done:**
- `apps/api/src/config.ts`: zod config loader (`loadConfig(env?)`) covering all plan §8 vars
  (`SITE_ADDRESS`, `POSTGRES_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`,
  `MAX_UPLOAD_MB`, `TZ`) plus `PORT`, `HOST`, `NODE_ENV`, `DATABASE_URL`. No caching so it's
  directly testable with an env override.
- `apps/api/src/app.ts`: Fastify 5 app factory `buildApp(opts?)` returning the app instance;
  owns a `pg` Pool (injectable for tests); `GET /api/health` returns `{ok:true, db:true|false}`;
  closes the pool on `onClose` only when it owns it.
- `apps/api/drizzle.config.ts` + `src/db/schema.ts` (stub): drizzle-kit configured (pg driver),
  real schema arrives in M4.
- `apps/api/src/index.ts`: entry point (dotenv + loadConfig + buildApp + listen).
- `apps/api/Dockerfile`: node:22-alpine, corepack, pnpm install from root lockfile, `CMD ["pnpm", "--filter", "@stabsstod/api", "start"]`.
- `docker-compose.yml`: `db` service (postgres:16, `pgdata` volume, healthcheck, port 5432).
- `apps/api/src/app.test.ts`: Vitest inject test for `GET /api/health` against a real Postgres.
- `start` script added to apps/api package.json (`tsx src/index.ts`).

**Learned:**
- pnpm 12 ignores build scripts by default (`ERR_PNPM_IGNORED_BUILDS` for esbuild postinstalls
  pulled in by drizzle-kit/tsx). `pnpm approve-builds --all` records the approvals in `.npmrc`;
  afterwards `pnpm add` works normally.
- `pg@8.23` ships no TS types → added `@types/pg`; added `@types/node` for `process`.
- `verbatimModuleSyntax` requires type-only imports (`import type { FastifyInstance }`).
- Root `.prettierignore` now ignores `**/Dockerfile` (prettier has no Dockerfile parser).

**Left over:** none for M1. M3 expands docker-compose.yml (adds `api` + `caddy`,
volumes, healthchecks) and makes the api Dockerfile production-ready (migrations at start under
an advisory lock).

## M2 — Web skeleton — done (2026-11-10)

**Done:**
- `apps/web/vite.config.ts`: Vite 8 with `@tailwindcss/vite` + `@vitejs/plugin-react`,
  Vitest with jsdom environment and jest-dom matchers.
- `apps/web/index.html`, `apps/web/src/main.tsx`: entry points.
- `apps/web/src/index.css`: `@import 'tailwindcss'` + `@import '@fontsource-variable/inter'`
  (locally bundled Inter font, no Google Fonts), `@theme --font-sans`.
- `apps/web/src/App.tsx`: React Router 7 layout shell — header (app name, language switch
  button), main outlet, empty `Home` route at `/`. `createBrowserRouter` built with `useMemo`.
- `apps/web/src/i18n.ts`: i18next + react-i18next, resources from `sv.json`/`en.json`,
  default `lng: 'sv'`, fallback `'sv'`.
- `apps/web/src/locales/sv.json` / `en.json`: 8 shared keys (app name, nav, language,
  home title/subtitle).
- `apps/web/src/i18n.test.ts`: parity test — sv/en key sets match, all values non-empty.
- `apps/web/src/App.test.tsx`: renders Swedish by default; clicking the language switch
  shows English text.
- `apps/web/package.json`: added `build` script (`vite build`).

**Learned:**
- Tailwind v4 uses CSS-first config: `@import 'tailwindcss'` + `@theme` in CSS, not
  `tailwind.config.js`. JS-style `import` in CSS fails; must use CSS `@import`.
- TS 5.9 with `module: NodeNext` requires `with { type: 'json' }` (import attributes,
  not `assert`) for JSON imports.
- TS 5.9 + `moduleResolution: NodeNext` requires `.js` extensions for `.ts`/`.tsx`
  imports (`import App from './App.js'`).
- Vitest prefers `vitest.config.ts` over `vite.config.ts`; removed the M0 `vitest.config.ts`
  stub so the jsdom environment in `vite.config.ts` takes effect.
- React Router v7 `createBrowserRouter` at module scope needs `document` (jsdom env);
  test renders pass with `--environment jsdom` from `vite.config.ts`.
- Build output bundles Inter font as WOFF2 assets (self-hosted, no Google Fonts).

**Left over:** none for M2. Next: M3 (compose + Caddy — add `api` + `caddy` services to
docker-compose.yml, Caddyfile with internal TLS, smoke script).

## M3 — Compose and Caddy — done (2026-11-10)

**Done:**
- `docker-compose.yml`: full stack — `db` (postgres:16, pgdata volume, healthcheck),
  `api` (builds from apps/api/Dockerfile, depends on db healthy, healthcheck),
  `caddy` (builds from deploy/caddy/Dockerfile, depends on api healthy, maps volume).
  Volumes: pgdata, attachments, caddy_data. All config via .env (SITE_ADDRESS,
  POSTGRES_PASSWORD, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, MAX_UPLOAD_MB, TZ).
- `deploy/caddy/Dockerfile`: multi-stage — Node stage builds apps/web (Vite build),
  Caddy stage copies dist to /srv/web + Caddyfile to /etc/caddy/Caddyfile.
- `deploy/caddy/Caddyfile`: per plan §8 — tls internal, encode, security headers,
  /api/* + /api/events* reverse_proxy to api:3000 (SSE flush_interval -1), /tiles/* and
  /map-assets/* file_server from /srv/maps, SPA fallback to /srv/web.
- `apps/api/src/migrate.ts`: runs migrations at start under a pg advisory lock
  (pg_advisory_lock), reads SQL from /app/drizzle, tracks applied migrations in a
  __meta table (idempotent), closes pg connections before spawning anything else.
- `apps/api/Dockerfile`: CMD runs `tsx src/migrate.ts` then `pnpm start`; copies
  drizzle.config.ts + drizzle/ into the image.
- `drizzle.config.ts`: moved to repo root (dialect: postgresql, stub schema at
  apps/api/src/db/schema.ts).
- `drizzle/0000_init.sql`: generated stub migration (CREATE TABLE __m1_stub).
- `scripts/smoke.sh`: `curl -sk https://localhost/api/health` + `curl -sk https://localhost/`.
- README: "Run it" section (copy .env.example, docker compose up --build, smoke script,
  trust Caddy internal CA).
- `.gitignore`: ignores drizzle/meta/ (drizzle-kit cache). `.prettierignore`: ignores
  Caddyfile + Dockerfiles.

**Learned:**
- drizzle-kit 0.31's `driver` param only accepts d1-http/expo/aws-data-api/pglite/
  durable-sqlite — for plain postgres://, omit `driver` and set `dialect: 'postgresql'`,
  with `dbCredentials.url`.
- drizzle-kit's `migrate` CLI exits 1 silently when spawned from Node's
  child_process (works fine directly in a shell). Switched to running migration SQL
  directly via pg Pool under an advisory lock — simpler and more reliable.
- execSync with stdio: 'inherit' works for trivial commands but drizzle-kit's binary
  (npm cmd-shim calling node bin.cjs) is unreliable from Node; pure-pg migration
  avoids the issue entirely.

**Left over:** none for M3. Next: M4 (core schema and append-only table — real
RecordEnvelope entity schemas, drizzle schema replacing the stub, Postgres triggers
rejecting UPDATE/DELETE on records).

## M4 — Core schema and append-only table — done (2026-11-10)

**Done:**
- `packages/shared/src/record.ts`: `RecordEnvelope` type + zod schema
  (`RecordEnvelopeSchema`), `EntityType` const/object, `RetractPayload` type.
  Pure, framework-adjacent (zod only), heavily unit-testable going forward.
- `packages/shared/src/index.ts`: re-exports record model types/schema.
- `apps/api/src/db/schema.ts`: full drizzle-orm pg-core schema replacing the M1
  stub — `users`, `sessions`, `incidents`, `incident_members`, `staff_functions`,
  `function_members`, `settings`, `auth_events`, `records`. `records` mirrors the
  envelope (`server_seq` bigserial, `received_at`, indexes on
  `(incident_id, server_seq)` and `(incident_id, entity_id)`).
- `drizzle/0001_m4_core_schema.sql`: migration creating all tables + indexes +
  `reject_records_update` / `reject_records_delete` trigger functions and
  `records_no_update` / `records_no_delete` triggers (BEFORE UPDATE/DELETE,
  raise exception). Idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE,
  DROP TRIGGER IF EXISTS).
- `apps/api/src/migrate.ts` (from M3, now runs against real migration files):
  applies all `drizzle/*.sql` files under a pg advisory lock at startup; idempotent
  `__meta` tracking table; closes pg connections before migration. Confirmed running
  on startup via `docker compose up`.
- `apps/api/src/db/records.test.ts`: Vitest test against a real Postgres — applies
  the migration SQL, proves INSERT into `records` works (server_seq assigned) and
  that UPDATE and DELETE throw (append-only trigger).
- `drizzle.config.ts` dialect: `postgresql`, `dbCredentials.url`, stub schema at
  `apps/api/src/db/schema.ts`.

**Learned:**
- drizzle-kit 0.31 `generate` requires a TTY for schema-conflict prompts (no CI
  flag), so the migration SQL was written directly. `migrate.ts` applies `.sql`
  files from `drizzle/` — no drizzle-kit needed at runtime.
- drizzle-kit 0.31 `driver` param only accepts d1-http/expo/aws-data-api/pglite/
  durable-sqlite — for plain postgres:// omit `driver`, set `dialect: 'postgresql'`,
  `dbCredentials.url`.
- `bigserial(name, { mode: 'number' })` in drizzle pg-core 0.45; `mode: 'number'`
  keeps JS-side values as numbers.
- `packages/shared` needed `zod` added as a dependency (pnpm add, real version in
  lockfile).

**Left over:** none for M4. Next: M5 — Authentication (argon2, login/logout/me/
change-password endpoints, admin bootstrap, rate limiting, auth_events; web login
page + auth context + protected routes).

