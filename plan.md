# plan.md — Stabsstöd (working name)

A self-hosted, browser-based support system for an incident management staff ("stab"), based on the MSB handbook *Stabsmetodik – Grund* (MSB2017, rev. Feb 2023) and NATO-style staff functions. It gives the staff a shared situational awareness: what has happened, what it means, what we are trying to achieve, and who does what, when and where.

---

## 0. How to read this file (for the coding agent)

This file is long. Your context window is small. **Do not load the whole file.**

1. Read sections 1–3 once at the start of the project (they are short).
2. For each work session read only: section 4 (stack), the part of section 5 relevant to the milestone, and **the current milestone** in section 10.
3. Find a milestone with: `grep -n '^## M' plan.md` then `sed -n '<start>,<end>p' plan.md`.
4. Progress is tracked in `PROGRESS.md` (repo root), not in this file. Never edit this file unless a milestone says so.
5. Rules for how to behave are in `AGENTS.md` (repo root). Follow them.

---

## 1. Purpose and users

- Used by an incident management team (the "staff") during a societal disturbance (samhällsstörning) or a planned event.
- **Chief of staff (stabschef)** gets a dashboard overview of the whole incident.
- **Every other staff function** has its own login and its own workspace.
- The **decision-maker (beslutsfattare)** can log in to read everything, give the mission, and record decisions.
- One installation = one organisation, **several incidents in parallel**.
- Expected load: 20–100 simultaneous users per incident.
- Runs in a normal web browser (desktop first, usable on tablet and phone). No local installation for users (an installable PWA is optional for the user, never required).

## 2. Non-negotiable requirements

1. **Self-hosted with `docker compose up`.** Intranet only. At runtime it must work with **no internet at all**: no CDN scripts, no Google Fonts, no external map tiles, no telemetry, no external APIs. All fonts, icons, map glyphs and map sprites are served locally.
2. **Offline-first.** Everything (read and write) keeps working in the browser when the network is down or unreliable. Writes are stored locally and synced when the connection returns. Two people editing offline must never silently lose data.
3. **Append-only data.** Operational data (log, facts, decisions, tasks, …) is never overwritten or deleted. Every change is a new versioned record with author and time. "Delete" means a *retract* record with a reason. The database must enforce this (triggers).
4. **Swedish and English UI** from day one (i18n). Swedish is the default. No hard-coded user-facing strings.
5. **Local accounts managed by an admin.** No SSO in v1.
6. **Read-everything / write-own-area permissions** inside an incident; chief of staff can edit all (section 7).
7. **Public-record awareness.** Documentation may be requested as public records (allmänna handlingar). Show a short reminder on log and decision forms and keep everything exportable for archiving.
8. Several incidents in parallel; users can be members of several incidents with different roles/functions in each.

## 3. Mapping the MSB handbook to the app

The handbook organises staff work around **three kinds of questions**. The incident workspace navigation mirrors this.

| Handbook concept | App area |
|---|---|
| Situation: what has happened / is happening / is about to happen / could happen — and what does it mean | **Läge**: situation picture, facts & assumptions & information needs, FIS, scenarios |
| Direction (inriktning): what must be achieved, options, what we choose | **Inriktning**: mission, desired vs actual direction, decision requests, decisions |
| Coordination (samordning): who does what, where, when | **Samordning**: tasks / staff work plan, resources, shifts |
| Staff briefings (stabsorientering), operative rhythm | Briefings with agenda templates and per-function reports |
| Logbook (loggbok) | Logbook |
| Timeline (tidslinjal) | Timeline |
| Actor analysis (aktörsanalys) | Actor analysis |
| Shifts and handovers (max 8 h, 30–60 min overlap) | Shift planner and handover notes |
| Wind-down and evaluation (AAR) | Closure and evaluation |
| Reporting to other organisations | Reports and exports |

### Glossary (use these in `sv.json`)

Stab, Stabschef, Biträdande stabschef, Funktionsledare, Stabsmedlem, Beslutsfattare, Observatör, Stabsfunktion, Lägesbild, Inriktning (önskad / faktisk), Samordning, Uppdrag, Underlag, Beslut, Stabsorientering, Stabsarbetsplan, Tidslinjal, Loggbok, Avlösning, Överlämning, Omfallsplanering, Aktörsanalys, Samverkan, Kriskommunikation, Skyddsvärden, Fakta / Antaganden / Informationsbehov, FIS (Fakta, Innebörd, Slutsatser), Avveckling, Utvärdering (After Action Review).

**Skyddsvärden** (protected values threatened, from the handbook): människors liv och hälsa; samhällets funktionalitet; demokrati, rättssäkerhet och mänskliga fri- och rättigheter; miljö och ekonomiska värden; nationell suveränitet.

---

## 4. Technology stack (fixed — do not substitute)

Chosen because it is widely known by coding models, fast, and good for offline-first.

| Area | Choice |
|---|---|
| Language | TypeScript everywhere (strict mode), Node.js 22 LTS |
| Package manager | pnpm workspaces |
| Backend | Fastify 5, zod for validation, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/multipart` |
| Database | PostgreSQL 16, Drizzle ORM + drizzle-kit migrations. **No PostGIS in v1.** |
| Password hashing | `@node-rs/argon2` |
| Frontend | React 18/19 + Vite + React Router + Tailwind CSS. Own small components (no UI kit that needs a CLI/network). |
| Local store | Dexie (IndexedDB) + `dexie-react-hooks` |
| PWA | `vite-plugin-pwa` (Workbox) |
| i18n | `i18next` + `react-i18next`, resources in `apps/web/src/locales/{sv,en}.json` |
| Map | MapLibre GL JS + PMTiles (`pmtiles` npm package) + `terra-draw` with the MapLibre adapter for drawing |
| Live updates | Server-Sent Events (SSE) |
| Reverse proxy | Caddy 2 (internal TLS, static files, map file serving) |
| Tests | Vitest (unit/integration), `fake-indexeddb`, Playwright (one offline E2E suite only) |
| Lint/format | ESLint + Prettier |
| IDs | UUIDv7 (`uuidv7` package) |

**Package rule:** install dependencies with `pnpm add <pkg>` so the lockfile gets real versions. Never write version numbers from memory into `package.json`. If you are unsure of a library's API, read its `.d.ts` files in `node_modules` before writing code.

---

## 5. Architecture

### 5.1 Repo layout

```
stabsstod/
  AGENTS.md  PROGRESS.md  QUESTIONS.md  plan.md  README.md
  docker-compose.yml  .env.example
  deploy/caddy/{Dockerfile,Caddyfile}
  scripts/            # fetch-map.sh, backup.sh, restore.sh, import-places.ts
  data/               # git-ignored: maps/, backups/
  packages/shared/    # types, zod schemas, HLC, permissions, entity registry, i18n key helpers
  apps/api/           # Fastify server, drizzle schema, migrations
  apps/web/           # React PWA
  e2e/                # Playwright tests
```

### 5.2 The record model (heart of the system)

Every operational change is one immutable **record**:

```ts
type RecordEnvelope = {
  id: string;            // uuidv7, generated on the client
  entityId: string;      // uuidv7, stable id of the thing (log entry, task, …)
  entityType: EntityType;// see 6
  incidentId: string;
  parentIds: string[];   // record ids this version was based on ([] for the first version)
  functionId: string | null; // owning staff function; null = incident-wide
  authorId: string;
  deviceId: string;      // random id kept in localStorage per browser profile
  hlc: string;           // hybrid logical clock, sortable string
  createdAtClient: string; // ISO UTC
  kind: 'put' | 'retract';
  schemaVersion: number;
  payload: unknown;      // validated by the zod schema of entityType (for 'retract': { reason: string })
  // server-only fields, added on ingest:
  serverSeq?: number;    // global bigserial, defines pull order
  receivedAt?: string;
};
```

**Materialising current state of an entity** (in `packages/shared`, pure function, heavily unit-tested):

- Group records by `entityId`.
- **Heads** = records that are not listed in any other record's `parentIds` (within the entity).
- **Current** = the head with the greatest `hlc` (tie-break: `deviceId`).
- **Conflict** = more than one head. The UI shows the current version plus a conflict badge. Anyone with write access to that area can resolve by creating a new record whose `parentIds` contains **all** heads.
- A `retract` record as current means the entity is shown as retracted (struck through, reason visible, still searchable). Retracting is allowed for the author and the chief of staff.
- History view = all records of the entity ordered by `hlc`.

**HLC:** `"<wallClockMs zero-padded to 15>-<counter zero-padded to 5>-<deviceId>"`. Implement `tick(local)` and `receive(local, remote)` per the standard algorithm. Wall clock may be wrong on a device; HLC prevents going backwards.

### 5.3 Sync protocol

- `POST /api/sync/push` body `{ incidentId, records: RecordEnvelope[] }` (≤100 records, sorted by hlc). Per-record result: `accepted | duplicate | rejected(reason)`. **Idempotent** on `id`. A parent id that is not yet known is **not** an error (parents may arrive later). Server validates: membership, permission (section 7), zod payload, `incidentId` match, size limits. Server assigns `serverSeq` on insert.
- `GET /api/sync/pull?incidentId=…&since=<serverSeq>&limit=500` → `{ records, nextSince, hasMore }`.
- `GET /api/events?incidentId=…` → SSE. Events: `records` (with `maxSeq`), heartbeat every 20 s. On `records` the client pulls.
- Client: all writes go **first** to local Dexie (`records` + `outbox`), UI updates immediately from local data, a sync loop pushes the outbox and pulls new records. Exponential backoff (1 s → 30 s) when offline; also trigger on browser `online` event and on tab focus.
- Rejected records stay locally, are marked `rejected` with the reason and are shown in a "Sync problems" panel (never silently dropped).
- Dexie tables: `records` (PK `id`, indexes `[incidentId+entityId]`, `serverSeq`), `outbox` (PK `id`), `entities` (derived cache, PK `entityId`), `meta` (sync cursors per incident), `blobs` (attachment bytes awaiting upload, PK `hash`).
- Local DB name includes the user id: `stabsstod-<userId>` so users sharing a device do not see each other's data.

### 5.4 Database (server)

Non-operational tables (normal mutable tables): `users`, `sessions`, `incidents`, `incident_members`, `staff_functions`, `function_members`, `settings`, `auth_events`, `attachments_meta` (hash, size, mime — the *record* about an attachment is an operational record).

Operational table: `records` — columns mirror the envelope plus `server_seq bigserial`, `received_at`. **Triggers raise an exception on UPDATE and DELETE.** Unique on `id`. Indexes on `(incident_id, server_seq)` and `(incident_id, entity_id)`.

Presets and templates are seed data in `packages/shared/src/presets.ts` and copied into an incident when it is created (so later edits to presets never change old incidents).

### 5.5 Auth and sessions

- Admin bootstrap: on first start, if no users exist, create admin from env `ADMIN_USERNAME` / `ADMIN_PASSWORD` with `mustChangePassword = true`.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`.
- Session cookie: httpOnly, Secure, SameSite=Lax, 30-day sliding expiry, stored hashed in `sessions`.
- Rate-limit login per IP and username; write `auth_events`.
- **Offline behaviour:** the user must have logged in online once on that device. If offline, the app opens from the service-worker cache and local Dexie data and shows an "Offline" indicator. If an API call returns 401 while online, show a re-login dialog **without** clearing the outbox.
- System roles: `admin` | `user`. Admin manages users and creates incidents and assigns members; **admin does not automatically see incident content** (must be a member).

### 5.6 Files / attachments

- `POST /api/attachments` (multipart, sha256 computed client-side and verified server-side), stored at `/data/attachments/<hash>` (docker volume). `GET /api/attachments/:hash` requires session + membership of an incident that references the hash. Default max 25 MB (setting).
- The attachment *record* (`entityType: 'attachment'`: filename, mime, size, hash, linkedEntityIds) is a normal synced record. The **bytes** are queued in Dexie `blobs` while offline and uploaded when connected; UI shows "waiting to upload".
- Phone cameras: `<input type="file" accept="image/*" capture>`.

### 5.7 Map

- Basemap: **PMTiles** file of Sweden at `data/maps/sweden.pmtiles`, served by Caddy at `/tiles/sweden.pmtiles` (supports HTTP range requests). MapLibre uses the `pmtiles://` protocol. Basemap style built with `protomaps-themes-base` (check the installed version's API).
- **Glyphs (fonts) and sprites must be self-hosted** under `/map-assets/` (downloaded once by `scripts/fetch-map.sh` from the Protomaps `basemaps-assets` repository). A MapLibre style that points at an external glyph URL breaks offline.
- `scripts/fetch-map.sh` (needs internet, run once at install) downloads the `pmtiles` CLI, extracts Sweden with a bounding box (about lon 10.9–24.2, lat 55.3–69.1) from the latest Protomaps build at a sensible max zoom (about 14; file likely 1–3 GB — measure and document), and fetches glyphs/sprites. The script must be re-runnable and print clear errors.
- If the map file is missing, the map screen shows an instruction instead of crashing.
- **Optional online source:** admin setting `map.onlineTileUrl` (empty by default). When set and the browser is online, a layer switch "Online map" appears.
- **Drawing:** points, lines, polygons, circles via terra-draw. Each drawn feature is a `map_feature` record (GeoJSON geometry + properties). Circles are stored as a polygon approximation plus `props.circle = {center, radiusM}`. Layers: free-text layer name (default "Berört område"), status/severity colour, label, valid-from/to, link to a situation snapshot.
- **Scale:** zoom from a single address up to a whole kommun/län. Kommun/län boundaries and place/address search come from an offline import (milestone M31).
- Attribution: show "© OpenStreetMap contributors" and Protomaps credit on the map.

### 5.8 Notifications

No chat in v1. Notifications are derived **on the client** from local data so they work offline: new task assigned to me, task overdue, briefing starts in 10 minutes, shift change in 30 minutes, decision awaiting me, conflict on my function's entity. Shown in a bell menu; also via the browser Notification API if the user grants permission.

### 5.9 i18n and time

- Every string via `t('key')`. A unit test fails when `sv.json` and `en.json` have different key sets.
- Store UTC; display in `Europe/Stockholm` by default (admin setting), 24-hour clock, ISO-style dates.
- Date/number formatting via `Intl`.

### 5.10 Security basics

Caddy sets HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and a strict Content-Security-Policy (`default-src 'self'`; allow `blob:` and `data:` for images/workers as needed; no remote origins). Zod-validate every input. Parameterised queries only (Drizzle). Escape/sanitise rendered text (React default; never use `dangerouslySetInnerHTML`). Service workers need a secure context: the Caddy `tls internal` root CA must be installed on client devices — document this in the README.

---

## 6. Entity catalogue

All are `entityType` values with a zod schema in `packages/shared/src/entities/`. `functionId` follows the owning function unless stated. Every payload also allows optional `links: { entityId: string; rel?: string }[]` and `attachmentIds`.

| entityType | Payload (main fields) |
|---|---|
| `log_entry` | `text`, `category` (event, info, decision, contact, other), `eventTime`, `source?`, `visibility` fixed to incident |
| `fact_item` | `kind` (`fact` \| `assumption` \| `unknown`), `text`, `status` (open, verified, refuted, answered), `source?`, `confidence?` (low/medium/high), `ownerUserId?`, `neededBy?` |
| `situation_snapshot` | `title`, `whatHappened`, `currentSituation`, `consequences`, `protectedValues[]` (the five), `facts` / `meaning` / `conclusions` (FIS), `timeHorizon` |
| `scenario` | `title`, `likelihood` (probable/possible), `horizon` (`hours`, `days2`, `weeks2`, `custom`), `description`, `implications`, `contingencyPlan?` |
| `mission` | `content`, `staffShouldDo`, `staffShouldNotDo`, `deadline?`, `issuedBy`, `acknowledgedByChief?` (set by a later version) |
| `direction` | `desired` (text), `actual` (text), `divergenceNote?`, `validFrom` |
| `decision_request` | `question`, `background`, `options[] {title, pros, cons}`, `recommendation?`, `neededBy?`, `status` (open, decided, withdrawn) |
| `decision` | `requestId?`, `text`, `rationale?`, `decidedByUserId`, `decidedAt`, `mandate` (`decision_maker` \| `delegated_chief`) |
| `task` | `title`, `description`, `assigneeFunctionId`, `assigneeUserId?`, `due?`, `priority` (low/normal/high/critical), `status` (proposed, todo, doing, blocked, done, cancelled), `reportForm` (oral/written/none), `parentTaskId?` |
| `timeline_event` | `title`, `time`, `endTime?`, `type` (meeting, deadline, decision, milestone, external, other), `scope` (internal/external) |
| `briefing` | `title`, `scheduledAt`, `kind` (first_gathering, first_briefing, recurring, other), `agenda[]`, `minutes?`, `status` (planned, held, cancelled), `recurrence?` |
| `briefing_report` | `briefingId`, `done`, `planned`, `challenges`, `collaborationNeeds` (per function; the four prepare-questions of the handbook) |
| `shift` | `functionId`, `userId`, `start`, `end`, `role` |
| `handover_note` | `shiftId?`, `fromUserId`, `toUserId?`, `text` (most important to hand over) |
| `actor` | `name`, `type`, `role`, `contact?`, `status` (involved, should_be_involved, informed), `relations[] {actorId, relation}` |
| `resource` | `name`, `type` (personnel, vehicle, equipment, facility, other), `quantity`, `unit?`, `location?`, `status` (available, deployed, requested, unavailable), `notes?` |
| `map_feature` | `layer`, `geometry` (GeoJSON), `label`, `status`, `severity` (1–4), `description?`, `validFrom?`, `validTo?`, `circle?` |
| `attachment` | `filename`, `mime`, `size`, `hash` |
| `sitrep` | `title`, `sections[]`, `generatedAt`, `snapshot` (frozen HTML or JSON of what was exported) |
| `closure_plan` | `items[] {what, action: 'archive'|'discard'|'handover', owner, location?, retention?}`, `status`, `announcedAt?` |
| `evaluation` | AAR answers: `why`, `what`, `whoAffected`, `how`, `useOfResult`, `learnings[]` |

---

## 7. Roles and permissions

Incident roles: `chief_of_staff`, `deputy_chief`, `function_lead`, `staff_member`, `decision_maker`, `observer`.

**Read:** every incident member can read every record of that incident. (No need-to-know partitioning in v1.)

**Write rule (default):** a user may create a record (or a new version) whose `functionId` is one of the user's functions in this incident. `chief_of_staff` and `deputy_chief` may write any `functionId`, including `null`.

**Type gates (override the default):**

| Entity | Who may create/version |
|---|---|
| `mission` | `decision_maker`, `chief_of_staff`, `deputy_chief` (chief may only set `acknowledgedByChief`) |
| `decision` | `decision_maker`; `chief_of_staff` only with `mandate = delegated_chief` |
| `decision_request` | any writer for own function |
| `briefing`, `shift`, `direction`, `closure_plan` | `chief_of_staff`, `deputy_chief` |
| `timeline_event` | chief/deputy any; `function_lead` for own function |
| `task` with `assigneeFunctionId` ≠ own function | `chief_of_staff`, `deputy_chief`, `function_lead` (others may create only `proposed` tasks) |
| `briefing_report` | members of the reporting function |
| `observer` | nothing |
| `retract` | the record's author, or chief/deputy |

Implement as one pure function `can(actor, action, recordOrDraft, context)` in `packages/shared/src/permissions.ts`, used by **both** the server (authoritative) and the client (to hide/disable UI). Cover with a table-driven unit test (every role × entity type × own/foreign function).

Incident administration (create incident, set members/roles): system `admin`. Editing the incident's functions and presets after creation: chief/deputy.

### Function presets (seed data; admin/chief can edit names)

- **small (4)**, from handbook example "four functions": Analys & lägesbild · Genomförande · Kriskommunikation · Stöd (personal, ekonomi, juridik).
- **medium (6)**, from handbook example "six functions": Lägesbild & analys · Säkerhet · Genomförande · Samverkan · Kriskommunikation · Personal.
- **continental (9)**: Personal · Lägesbild & analys · Genomförande/operation · Logistik · Planering · Samband & IT · Utbildning · Ekonomi & juridik · Samverkan & kommunikation. *(The handbook shows the nine-function structure only in a figure; these names are the commonly used continental set and must be treated as editable defaults. Record in QUESTIONS.md that the owner should confirm them.)*

### Template texts (seed data, sv + en)

- **First gathering agenda** (stabsmedlemmarna samlas första gången): Vad har hänt? · Vad har gjorts och vad görs just nu? · Stabens uppdrag och arbetets inriktning · Vad innebär det för oss? · Vad måste vi göra direkt? · Nu startar vi upp ett stabsarbete · Uppdrag (omedelbara åtgärder / iordningställa stabsutrymme) · Återsamling kl. xx.xx.
- **First staff briefing agenda**: Uppdrag från beslutsfattare · Vad vet vi nu? · Vilka arbetsuppgifter måste genomföras (nu / längre sikt)? · Hur ska vi arbeta? · Presentera stabsarbetsplanen · Alla dokumenterar (kan bli allmän handling) · Nästa möte kl. xx.xx.
- **Recurring briefing agenda**: Stabschefen ger nulägesbeskrivning · Funktionerna redovisar (gjort / planerat / utmaningar och begränsningar) · Samverkansbehov · Följ upp och justera arbetsfördelning · Förtydliga eller ge nya uppgifter. Long discussions are moved to separate meetings.
- **Report preparation questions**: Vad har jag gjort? · Vad planerar jag att göra? · Vilka utmaningar och begränsningar har jag? · Vem behöver jag samarbeta med?
- **AAR/evaluation questions**: Varför ska vi utvärdera? · Vad ska utvärderas? · Vilka är berörda? · Hur ska utvärderingen gå till? · Hur ska vi använda resultatet?

---

## 8. Docker compose

Services: `caddy` (custom image: builds `apps/web` in a Node stage, copies `dist` into the Caddy image; mounts `./data/maps` read-only at `/srv/maps`), `api` (Node image, runs migrations at start under a Postgres advisory lock), `db` (postgres:16, volume `pgdata`). Volumes: `pgdata`, `attachments`, `caddy_data`. Healthchecks on `api` and `db`. All configuration through `.env` (`SITE_ADDRESS`, `POSTGRES_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `MAX_UPLOAD_MB`, `TZ`).

Caddyfile outline:

```
{$SITE_ADDRESS:localhost} {
  tls internal
  encode zstd gzip
  header { Strict-Transport-Security "max-age=31536000" X-Content-Type-Options nosniff Referrer-Policy no-referrer }
  handle /api/events* { reverse_proxy api:3000 { flush_interval -1 } }
  handle /api/* { reverse_proxy api:3000 }
  handle /tiles/* { root * /srv/maps; uri strip_prefix /tiles; file_server }
  handle /map-assets/* { root * /srv/maps; file_server }
  handle { root * /srv/web; try_files {path} /index.html; file_server }
}
```

Air-gapped install: images are built once with internet, then moved with `docker save` / `docker load` (documented in M38).

---

## 9. Quality gates used by every milestone

A milestone is **done** only when all are true:

1. `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` pass.
2. New behaviour has tests (pure logic: unit tests; API: Fastify `inject` tests against a real test Postgres; UI logic: Vitest + Testing Library where cheap).
3. i18n key parity test passes (every new string in `sv.json` and `en.json`).
4. If the milestone touches Docker/Caddy: `docker compose build` and the smoke script succeed.
5. `PROGRESS.md` updated (what was done, what was learned, anything left over).
6. One git commit per milestone: `M<n>: <title>`.

---

## 10. Milestones

Size rule: each milestone should fit in roughly 5–8 files and a few hundred lines of new code. If one turns out larger, split it into `M<n>a`, `M<n>b` in `PROGRESS.md` and continue. Milestones marked **HARD** are the most error-prone for a small local model: slow down, write the tests first, and if stuck after two honest attempts, record the problem in `QUESTIONS.md` (the owner may switch you to a stronger online model for that milestone).

### Phase 0 — Foundation

## M0 — Repository scaffold
Create the pnpm workspace with `packages/shared`, `apps/api`, `apps/web`, root tsconfig (strict), ESLint, Prettier, Vitest. Create `AGENTS.md` (already provided by the owner — copy it in unchanged), `PROGRESS.md`, `QUESTIONS.md`, `.gitignore` (`data/`, `node_modules`, `.env`), `.env.example`. Root scripts: `typecheck`, `lint`, `test`, `format`.
**Accept:** the three root scripts run and pass on empty-but-valid packages. `git init` and first commit.

## M1 — API skeleton
Fastify app factory `buildApp()` in `apps/api/src/app.ts`; config loader with zod (`config.ts`); `GET /api/health` returns `{ok:true, db:true|false}`; Postgres connection pool; drizzle-kit configured; Dockerfile for api.
**Accept:** `inject` test for health; app starts against local Postgres (`docker compose up db`).

## M2 — Web skeleton
Vite + React + TS + Tailwind; React Router with a layout shell (header, language switch sv/en, empty home); i18next with `sv.json`/`en.json`; locally bundled font (add `@fontsource-variable/inter` or similar via pnpm — no Google Fonts); i18n parity test.
**Accept:** `pnpm --filter web build` works; parity test passes; language switch changes visible text.

## M3 — Compose and Caddy
`docker-compose.yml`, `deploy/caddy/Dockerfile` + `Caddyfile` per section 8, `.env.example`, `scripts/smoke.sh` (curl `https://localhost/api/health -k` and `/`). README "Run it" section (how to trust the Caddy internal CA).
**Accept:** `docker compose up --build` serves the web app and the health endpoint over HTTPS; smoke script passes.

### Phase 1 — Identity and structure

## M4 — Core schema and append-only table
Drizzle schema + migration for `users`, `sessions`, `incidents`, `incident_members`, `staff_functions`, `function_members`, `settings`, `auth_events`, `records`. Migration adds triggers that reject UPDATE/DELETE on `records`.
**Accept:** a test proves INSERT works and UPDATE/DELETE on `records` throw.

## M5 — Authentication
Endpoints from 5.5, argon2, admin bootstrap, login rate limit, `auth_events`. Web: login page, auth context, protected routes, forced change-password screen.
**Accept:** API tests for login/logout/me/change-password/rate-limit; manual login works through Caddy.

## M6 — User administration
Admin API + UI: list/create/disable users, reset password (temporary password + must-change), display name, preferred language. `GET/PUT /api/settings` (timezone, `map.onlineTileUrl`, max upload MB).
**Accept:** non-admin gets 403; tests for each endpoint.

## M7 — Incidents, members, functions
Admin: create incident (name, type, start time, status `active|winding_down|closed`), choose function preset (copied into `staff_functions`), add members with incident role and function(s). Chief/deputy: edit function names/leads. Users see "My incidents" list. Seed presets and templates from `packages/shared/src/presets.ts`.
**Accept:** tests for creation with each preset; a user only lists incidents they are a member of.

## M8 — Permission module
Implement `can()` per section 7 in `packages/shared` with the table-driven test. No UI yet beyond exporting the helper.
**Accept:** the test matrix is exhaustive (roles × entity types × own/foreign function × put/retract) and passes.

### Phase 2 — Sync engine (HARD, write tests first)

## M9 — Shared record model — HARD
In `packages/shared`: `RecordEnvelope` type + zod, entity registry with a trivial `log_entry` schema (others added in later milestones), uuidv7 helpers, HLC (`tick`, `receive`, compare), `materialize(records)` → `{ current, heads, conflict, history, retracted }`.
**Accept:** unit tests: linear history; two concurrent heads → conflict; merge record resolves conflict; retract; HLC monotonic with a wrong clock; out-of-order arrival gives the same result as in-order (property-style test with shuffled input).

## M10 — Server sync endpoints — HARD
`POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/events` (SSE) per 5.3, with permission checks using `can()`. A tiny in-process pub/sub notifies SSE listeners (single api instance is fine in v1).
**Accept:** tests: idempotent re-push; rejection reasons (not member, forbidden type, bad payload); pull pagination; SSE emits after push; two incidents do not leak into each other.

## M11 — Client local store — HARD
Dexie schema from 5.3, `LocalStore` class: `addLocalRecord`, `ingestRemoteRecords`, `getEntity`, `liveQuery` helpers, incremental update of the `entities` cache. Local DB name includes the user id.
**Accept:** tests with `fake-indexeddb`: add/read, ingest out-of-order, conflict visible in `entities`, outbox contents correct.

## M12 — Client sync loop — HARD
`SyncEngine`: push outbox in batches, pull since cursor, SSE subscription, backoff, online/offline events, visibility-change trigger, rejected-record handling. UI: sync status chip in the header (Synced / Syncing / Offline N pending / Problems) and a "Sync problems" panel.
**Accept:** integration test with two `LocalStore` instances and a real in-process API: A and B edit, one goes "offline" (fetch stub fails), both converge after reconnect; duplicate delivery is harmless.

## M13 — PWA and offline shell
`vite-plugin-pwa` precaches the app shell, manifest, icons, offline fallback; the app reloads while the network is down and reads local data. README section on installing the Caddy root CA on Windows/macOS/Android/iOS (service workers need HTTPS).
**Accept:** Playwright smoke test: load app online, go offline (`context.setOffline(true)`), reload, app still renders from cache and shows the Offline chip.

## M14 — Conflict UI primitives
`<ConflictBanner entity>` showing both heads side by side (author, time, diff of payload fields), "Use this version" action that writes a merge record with all heads as parents (if permitted), and an `<EntityHistory>` drawer.
**Accept:** component tests; merge record test asserts `parentIds` contains all heads.

### Phase 3 — Core modules (each: schema in shared, hooks, UI, tests, sv/en strings)

## M15 — Incident workspace shell
Route `/incidents/:id` with navigation: **Läge**, **Inriktning**, **Samordning**, **Logg**, **Karta**, **Stab** (briefings/shifts/actors/resources), **Rapporter**. Role-aware (hide write actions the user cannot perform, using `can()`). Header shows incident name, status, elapsed time, my function, sync chip, language, bell placeholder.
**Accept:** navigation works; observer sees no write buttons.

## M16 — Logbook
`log_entry` schema, create form (text, category, event time vs entry time, function, links), list with filters (function, category, time range, text search), retract with reason, entity history drawer. Public-record reminder shown on the form.
**Accept:** create offline → appears immediately → syncs; retract shown struck through; tests.

## M17 — Facts, assumptions, information needs
`fact_item` schema; board with three columns **Vet / Antar / Vet ej** (handbook: "facts and assumptions"); change status (assumption → verified or refuted creates a new version, keeps history); link to log entries; filter by owner and function.
**Accept:** tests for status transitions and history.

## M18 — Situation picture
`situation_snapshot` schema; editor with sections (what happened, current, consequences), the five protected values (checkboxes), FIS fields (Fakta → Innebörd → Slutsatser shown as three steps); "current picture" = latest version; history list with a simple text diff between two versions.
**Accept:** versioning and diff tests.

## M19 — Scenarios and time scales
`scenario` schema; page grouping scenarios by horizon (hours / 2 days / 2 weeks / custom) and likelihood (probable / possible); optional contingency plan text; link to tasks.
**Accept:** grouping tests; create/edit/retract.

## M20 — Mission and direction
`mission` and `direction` schemas; mission editor (content, should do, should not do, deadline) for `decision_maker`/chief/deputy; "Acknowledge — same understanding" action by the chief of staff; **desired vs actual direction** side by side with a divergence note.
**Accept:** permission tests (only allowed roles can write); acknowledgement creates a new version.

## M21 — Decisions
`decision_request` and `decision` schemas; request form with options (pros/cons) and recommendation; decision form for `decision_maker` (or chief with delegated mandate); list with status filters; links to tasks and log.
**Accept:** only decision maker records outcomes; request status updates to `decided` via a new version; tests.

## M22 — Tasks and staff work plan
`task` schema; list + kanban board (columns by status); per-function view = the **stabsarbetsplan** (who does what, deadline, report form); overdue highlighting; subtasks; priority; colour conventions (meeting blue, task black, deadline red) as legend only. Cross-function assignment rules from section 7 (proposed tasks).
**Accept:** tests for permission edge cases and overdue logic.

## M23 — Timeline
`timeline_event` schema; horizontal timeline component (zoom hours/days/weeks) showing manual events plus **derived** items (briefings, shifts, task deadlines, decisions); internal events below the line, external above; colours as in M22.
**Accept:** derivation unit tests; component renders 200 items without freezing (simple virtualisation or windowing).

## M24 — Staff briefings
`briefing` and `briefing_report` schemas; chief schedules (single or recurring rhythm); agenda templates from section 7; each function pre-fills its report (done / planned / challenges / collaboration needs) before the briefing; briefing view for running the meeting (agenda, reports side by side, minutes box); countdown to next briefing.
**Accept:** recurrence expansion unit tests; report form per function.

## M25 — Shifts and handovers
`shift` and `handover_note` schemas; roster grid per function; **warnings** (non-blocking): shift over 8 h, overlap under 30 min, chief of staff and decision-maker changing at the same time, all members of a function changing at once; "on duty now" derived; handover note form (everyone summarises the most important points).
**Accept:** pure functions for each warning with tests.

## M26 — Actor analysis
`actor` schema; list/filter; relations between actors; simple node-link SVG view (no graph library; force-free layout: circle layout is fine); status involved / should be involved / informed.
**Accept:** relation add/remove (as versions) tests.

## M27 — Resources, staffing, logistics
`resource` schema; table with status; summary per type and per status; request resources (status `requested`) assigned to the logistics/support function; staffing overview of functions vs members on duty.
**Accept:** summary calculation tests.

## M28 — Attachments
Upload flow per 5.6: sha256 in the browser (`crypto.subtle`), Dexie `blobs` queue, background upload, `attachment` record, attach to any entity (`attachmentIds`), image preview, download, server endpoints with membership check, size limit.
**Accept:** API tests (hash verification, access control); client test: add attachment offline, reconnect, bytes uploaded exactly once.

### Phase 4 — Map

## M29 — Map base — HARD
`scripts/fetch-map.sh` per 5.7; MapLibre component with PMTiles basemap and local glyphs/sprites; attribution; friendly message if the file is missing; optional online layer from settings; layer switcher.
**Accept:** with the pmtiles file present the map renders with **no network requests to other hosts** (verify with a Playwright network log assertion); without the file the instruction message shows.

## M30 — Map drawing — HARD
terra-draw integration: point, line, polygon, circle, edit, select. Saving creates/versions `map_feature` records. Feature side panel: label, layer, severity colour, validity, description, link to situation snapshot. Layer visibility toggles. Map view state (centre/zoom) kept per user locally. Features appear for all members after sync.
**Accept:** unit tests for circle → polygon and geometry (de)serialisation; a Playwright check that a drawn polygon persists after reload.

## M31 — Administrative areas and search
`scripts/import-places.ts` imports from an OpenStreetMap Sweden extract (documented download step; use `osmium` or equivalent): län and kommun boundaries (OSM admin levels, verify the levels for Sweden), populated places, street names and addresses. Tables `places` (name, kind, lat, lon, kommun, län, bbox) and `admin_areas` (name, kind, geojson) with `pg_trgm` search. `GET /api/geo/search?q=` and `GET /api/geo/area/:id`. Map search box zooms to a result; "Mark as affected area" creates a `map_feature` from a kommun/län polygon. **No PostGIS.**
**Accept:** search tests with a small fixture; if address data is too large/slow, ship place + kommun/län search first and record the limitation in PROGRESS.md.

### Phase 5 — Dashboard, notifications, outputs

## M32 — Chief of staff dashboard
Route `/incidents/:id/dashboard` (default landing for `chief_of_staff`/`deputy_chief`). Widgets, all from local data so they work offline: current mission and direction (with divergence flag) · elapsed time and incident status · next briefing countdown · shift changes next 4 h · **function status board** (lead on duty, open/overdue tasks, last update, latest challenge from briefing report, red/amber/green set by the function lead) · latest 10 log entries · fact/assumption/unknown counts and oldest unverified assumptions · decisions waiting · overdue tasks · time-scale strip (now / 48 h / 2 weeks scenarios) · mini map of current features · sync health (conflicts, rejected, pending) .
**Accept:** each widget has a pure selector function with a unit test; dashboard renders from fixtures.

## M33 — Function workspace home
Home for non-chief roles: my tasks, my function's board and latest log, upcoming briefing with "prepare my report" shortcut, my next shift and handover note, items needing my attention.
**Accept:** selectors tested; role-specific landing redirect works.

## M34 — Notifications
Client-side derivation per 5.8, bell menu with read/unread stored locally, browser Notification API opt-in, in-app timers (work offline).
**Accept:** unit tests for each rule given fixture data and a fake clock.

## M35 — Reports and exports
Printable **situation report** page: choose sections (mission, direction, situation picture, key facts/assumptions, decisions, open tasks, resources, map snapshot, timeline) → print stylesheet → user prints to PDF in the browser (works offline). Saving a sitrep creates a `sitrep` record with a frozen copy. **Archive export:** ZIP of JSON (all records) + CSV (log, decisions, tasks) + attachments, generated server-side for chief/deputy.
**Accept:** export contains every record exactly once (test); sitrep print view renders.

## M36 — Wind-down and evaluation
Incident status `winding_down` → `closed` with a closure plan (what to archive/discard/hand over, owners, retention), tasks handed over keep clear owners, announcement text template; AAR/evaluation form with the five questions; closed incidents are read-only except evaluation.
**Accept:** permission tests for closed state (server rejects new operational records except `evaluation`).

### Phase 6 — Hardening

## M37 — Wall display mode
Read-only fullscreen route `/incidents/:id/wall` for a projector/screen: large type, auto-refresh, rotates between mission/direction, situation, timeline, task board, map every N seconds (setting). Requires login as an `observer` or any member.
**Accept:** renders without interaction; no write controls.

## M38 — Operations
`scripts/backup.sh` / `restore.sh` (pg_dump + attachments volume), documented restore test; air-gapped install doc (`docker save`/`docker load`, `fetch-map.sh` on a connected machine then copy `data/maps`); security headers/CSP verified; password policy; session management page (log out all devices).
**Accept:** documented restore actually run once in the milestone and noted in `PROGRESS.md`.

## M39 — Offline end-to-end scenario
Playwright, two browser contexts logged in as different users in the same incident: both online → A goes offline, creates log entry, task and map feature, edits a fact; B edits the same fact and creates a decision request; A reconnects → both converge; the double edit shows a conflict badge; resolve it; assert append-only history is complete.
**Accept:** suite passes reliably 3 runs in a row.

## M40 — Documentation and polish
README (install, trust the CA, first login, create incident, offline behaviour, backup), admin guide, short user guide in sv and en, known limitations list, accessibility pass (focus order, labels, contrast), empty states for every list, loading and error states.
**Accept:** a new person can follow the README from clone to first incident without help (the agent describes the steps tested).

---

## 11. Known hard parts and honest limits

- **Sync correctness** (M9–M12) is the riskiest part. Prefer simple, well-tested code over clever code. Never optimise before the tests pass.
- **Service workers need HTTPS.** Without the Caddy CA installed on devices, offline mode will not work. This must be explained in the README and visible in an in-app diagnostic ("Offline support: active / not available — why").
- **Map data size and glyph hosting** are the usual reasons an "offline" map silently depends on the internet. M29 includes a test for this.
- **Address-level search** may be too heavy for v1; city/place/kommun/län search is the fallback.
- **Clock skew:** HLC orders concurrent edits, but wall-clock times typed by users (event time) are the user's responsibility.
- **Devices store data locally.** On shared computers use the "wipe local data on logout" option (warns if unsynced items exist).
- Not in v1: SSO, chat, need-to-know partitioning, multi-organisation, native apps, server clustering, server-side PDF rendering.
