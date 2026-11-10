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

## M3 — Compose and Caddy — revised (2026-11-10)

**Change:** Removed the Caddy reverse proxy per organisational requirement — the
organisation runs its own reverse proxy in front of the api. `docker-compose.yml`
now contains only the app and its required dependencies:

- `db` (postgres:16, pgdata volume, healthcheck, port 5432 on loopback)
- `api` (builds from apps/api/Dockerfile, runs migrations at start under a pg
  advisory lock, healthcheck, port 3000 on loopback)
- Volumes: pgdata, attachments. All configuration through `.env`
  (SITE_ADDRESS, TZ, POSTGRES_PASSWORD, POSTGRES_DB, ADMIN_USERNAME,
  ADMIN_PASSWORD, SESSION_SECRET, MAX_UPLOAD_MB).
- `scripts/smoke.sh`: curls `http://127.0.0.1:3000/api/health` (no HTTPS, no
  Caddy).
- `deploy/caddy/` directory removed.
- README "Run it" section updated: organisation provides its own reverse proxy
  forwarding to `api:3000`.

**Verified:** `docker compose up --build` brings up db + api, both healthy;
`scripts/smoke.sh` passes; `GET http://127.0.0.1:3000/api/health` returns
`{"ok":true,"db":true}`.

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

**Left over:** none for M5. Next: M6 — User administration (list/create/disable
users, reset password, display name, preferred language, GET/PUT /api/settings).

## M6 — User administration — done (2026-11-10)

**Done — API (apps/api):**
- `apps/api/src/admin.ts`: `registerAdmin(app, pool)` registers admin routes, all
  guarded by `requireAdmin` (returns 401 if unauthenticated, 403 if non-admin):
  - `GET /api/admin/users` — list all users (id, username, display_name, role,
    disabled, preferred_language, must_change_password, created_at)
  - `POST /api/admin/users` — create user (username, password, displayName,
    role)
  - `PATCH /api/admin/users/:id/disable` — disable/enable a user
  - `POST /api/admin/users/:id/reset-password` — generates a temporary password
    and sets must_change_password = true; returns the temp password
  - `PATCH /api/admin/users/:id` — update displayName, role, preferredLanguage
  - `GET /api/settings` — timezone, map.onlineTileUrl, maxUploadMB
  - `PUT /api/settings` — upsert settings
- `apps/api/src/db/schema.ts`: added `disabled` (boolean, default false) and
  `preferred_language` (text, default 'sv') to users.
- `drizzle/0003_m6_user_admin.sql`: adds the two columns + seeds default system
  settings (timezone, map.onlineTileUrl, maxUploadMB).
- `apps/api/src/auth.ts`: login rejects disabled users; `sessionId` exported for
  reuse by admin middleware.
- `apps/api/src/admin.test.ts`: Vitest tests against a real Postgres — list
  (admin 200 / non-admin 403 / no session 401), create (admin 201 / non-admin
  403 / duplicate 409), disable (admin + verify disabled user can't log in),
  reset-password (admin returns temp password that works), update (admin +
  verify changes persisted), settings GET/PUT (admin + non-admin 403).
- Migrations serialized across test files with a pg advisory lock to avoid
  deadlocks; unique usernames per test run.

**Done — Web (apps/web):**
- `apps/web/src/contexts/AuthContext.tsx`: added `RequireAdmin` component
  (renders 403 page when not authenticated or non-admin).
- `apps/web/src/pages/Users.tsx`: users list table (username, display name,
  role, status, actions), inline create-user form, per-user disable toggle,
  per-user reset-password (shows temp password in alert).
- `apps/web/src/pages/Settings.tsx`: settings form (timezone, onlineTileUrl,
  maxUploadMB) with current-values display.
- `apps/web/src/App.tsx`: `/users` and `/settings` routes (RequireAdmin +
  RequireAuth), admin-only nav links (Users, Settings).
- `apps/web/src/locales/{sv,en}.json`: all new users/settings strings added to
  both locales (parity test passes).

**Verified end-to-end:** `docker compose up --build` (db + api only), smoke
script passes, `/api/health` → `{"ok":true,"db":true}`, `/users` and `/settings`
render for admin, API returns 403 for non-admin on admin endpoints.

**Left over:** none for M6. Next: M7 — Incidents, members, functions (create
incident, function presets, members, "My incidents" list).

## M7 — Incidents, members, functions — done (2026-11-10)

**Done — API (apps/api):**
- `apps/api/src/db/schema.ts`: incidents table extended with `type`, `started_at`,
  `status` (active|winding_down|closed).
- `drizzle/0004_m7_incidents.sql`: adds the three columns + status check constraint.
- `apps/api/src/incidents.ts`: `registerIncidents(app, pool)` registers:
  - `GET /api/presets` — small (4), medium (6), continental (9) with function counts
  - `POST /api/incidents` — admin only: create incident, copy preset into
    `staff_functions`, auto-add creator as chief_of_staff, add optional members
  - `GET /api/incidents` — auth required: list only incidents user is a member of
  - `GET /api/incidents/:id` — auth required (member): incident detail + functions + members
  - `POST /api/incidents/:id/members` — admin only: add member with role + functions
  - `PATCH /api/incidents/:id/functions/:functionId` — chief/deputy/admin: rename function
  - `PATCH /api/incidents/:id/members/:userId` — admin only: update role + functions
- `apps/api/src/app.ts`: wires `registerIncidents`.
- `apps/api/src/incidents.test.ts`: Vitest tests against real Postgres — presets
  endpoint, incident creation with each preset (verifies staff_functions count),
  non-admin rejection (403), member-only incident listing, incident detail access
  control (403 for non-members), function rename (chief/deputy can, regular member
  gets 403), member add (admin + 403 for non-admin).

**Done — Shared (packages/shared):**
- `packages/shared/src/presets.ts`: `FUNCTION_PRESETS` (small/medium/continental
  with function names from MSB handbook), `TEMPLATE_TEXTS` (5 template agenda /
  question sets in sv + en), `getPreset`, `getTemplate`, type exports.
- `packages/shared/src/index.ts`: re-exports presets.

**Done — Web (apps/web):**
- `apps/web/src/pages/Incidents.tsx`: "My incidents" list table with status badges.
- `apps/web/src/pages/CreateIncident.tsx`: admin create-incident form with preset
  selection, name, type, status, start time.
- `apps/web/src/pages/IncidentDetail.tsx`: incident detail with editable function
  names (chief/deputy/admin), members table, add-member form (chief/deputy/admin).
- `apps/web/src/App.tsx`: `/incidents`, `/incidents/create`, `/incidents/:id`
  routes with appropriate auth guards.
- `apps/web/src/locales/{sv,en}.json`: all incidents strings added to both locales.

**Verified end-to-end:** `docker compose up --build` (db + api only), smoke script
passes, `/incidents` and `/incidents/create` render for admin, API enforcement of
403 for non-admin on admin endpoints.

**Left over:** none for M7. Next: M8 — Permission module (`can()` in
packages/shared with table-driven test).

## M8 — Permission module — done (2026-11-10)

**Done:**
- `packages/shared/src/permissions.ts`: pure `can(actor, action, recordOrDraft, context)`
  implementing plan.md §7:
  - `read`: any incident member can read any record of that incident.
  - `write`: default rule = own functionId or chief_of_staff/deputy_chief (any
    functionId, including null); observers write nothing.
  - `retract`: record's author or chief_of_staff/deputy_chief.
  - Type gates override the default: mission (decision_maker/chief/deputy),
    decision (decision_maker; chief only with mandate=delegated_chief),
    decision_request (default), timeline_event (chief/deputy any; function_lead
    own function), task (chief/deputy/function_lead any; others only proposed +
    own function), briefing/shift/direction/closurePlan (chief/deputy only),
    briefingReport/handoverNote (default).
- `packages/shared/src/index.ts`: re-exports `can`, `Actor`, `IncidentRole`,
  `Action`, `RecordLike`, `CanContext`.
- `packages/shared/src/permissions.test.ts`: table-driven Vitest matrix covering
  roles × entity types × own/foreign function × action (write/retract/read) — 81
  tests, all passing, including mandate edge cases and task proposed-status rule.
- `record.ts` EntityType aligned to plan.md §6 (snake_case values: log_entry,
  fact_item, situation_snapshot, briefing_report, closure_plan, etc.).

**Verified:** full quality gate green (typecheck, lint, test, web build, format)
on all three packages. No server/UI wiring yet — M8 is `can()` export only, to be
consumed by the API (M9+) and client UI (later).

**Left over:** none for M8. Next: M9 — Shared record model — HARD (RecordEnvelope,
HLC tick/receive, materialize, entity schemas; test-first).




## M5 — Authentication — done (2026-11-10)

**Done — API (apps/api):**
- `apps/api/src/auth.ts`: `registerAuth(app, config, pool)` registers
  `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`,
  `POST /api/auth/change-password`.
- Password hashing with `@node-rs/argon2` (hash on write, `verify` on read).
- Session cookie `session` = random token; only its SHA-256 hash is stored in
  `sessions` (raw token never persisted); httpOnly, SameSite=Lax, 30-day
  sliding expiry, Secure in production. Sessions refreshed on each `me` call.
- Admin bootstrap in `apps/api/src/index.ts`: on first start, if `users` is
  empty, creates the admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD` with
  `mustChangePassword = true`.
- Login rate limiting: max 5 failed attempts per IP+username per minute
  (in-memory sliding window, failed attempts only consume the budget);
  every attempt written to `auth_events`.
- `apps/api/src/db/schema.ts`: added `password_hash` to `users`.
- `drizzle/0002_m5_auth.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS
  password_hash text` (idempotent).
- `apps/api/src/migrate.ts`: applies all `drizzle/*.sql` under a pg advisory
  lock at startup (idempotent `__meta` tracking table).
- `apps/api/src/app.ts`: registers `@fastify/cookie`, serves the built web app
  (`fastify-static` at `/assets` + SPA fallback `/*` → index.html), wires auth.
- `apps/api/Dockerfile`: single-stage build — installs workspace deps, builds
  `apps/web` into `apps/web/dist`, runs migrations then starts the api.
- `apps/api/src/auth.test.ts`: Vitest tests against a real Postgres —
  login (correct/wrong/unknown user), rate-limit (5 failures then 429),
  me (no cookie / valid session / invalid session), change-password
  (wrong current / success / no cookie), logout.

**Done — Web (apps/web):**
- `apps/web/src/contexts/AuthContext.tsx`: `AuthProvider` + `useAuth` —
  `user`, `loading`, `login`, `logout`, `changePassword`, `isAuthenticated`;
  fetches `/api/auth/me` with `credentials: 'include'` on mount.
- `apps/web/src/pages/Login.tsx`: login form, redirects to `/` on success,
  redirects already-authed users to `/`.
- `apps/web/src/pages/ChangePassword.tsx`: change-password form.
- `apps/web/src/App.tsx`: `AuthProvider` wrapping the router, `/login` and
  `/change-password` routes, `RequireAuth` wrapper (redirects unauthenticated
  to `/login`, `mustChangePassword` users to `/change-password`), header shows
  username + logout when authed.
- `apps/web/src/locales/{sv,en}.json`: auth strings added to both (parity test
  passes).
- `apps/web/src/App.test.tsx`: fetch stubbed so the app renders authenticated;
  language-switch tests pass.

**Verified end-to-end:** `docker compose up --build` (db + api only), smoke
script passes, `GET /api/health` → `{"ok":true,"db":true}`, manual login via
curl sets the `session` cookie (HttpOnly/SameSite=Lax/Secure/30-day) and
`/api/auth/me` returns the user.


