# PROGRESS

Milestone log per plan.md §9. One entry per milestone: what was done, what was learned,
anything left over. Newest milestone last.

## M36 — Wind-down and evaluation — done (2026-11-15)

**Done:**
- `packages/shared/src/entityRegistry.ts`: new `closurePlanSchema`
  (items[] {what, action: 'archive'|'discard'|'handover', owner, location?,
  retention?}, status, announcedAt?) and `evaluationSchema`
  (why, what, whoAffected, how, useOfResult, learnings[]). Registered for
  `EntityType.closurePlan` and `EntityType.evaluation`; payload types
  exported.
- `packages/shared/src/permissions.ts`: `CanContext` is now
  `{ incidentStatus?: string }`. In `can()`, a write on a closed incident
  is rejected unless the entityType is `evaluation` — closed incidents are
  read-only except for the AAR/evaluation form.
- `apps/api/src/sync.ts`: the push endpoint fetches the incident status and
  passes it to `canWrite`/`can()` as context, so the server enforces the
  closed-incident rule. `canWrite` accepts an optional `incidentStatus`.
- `apps/api/src/m36.test.ts` (new): 4 permission tests — operational writes
  accepted while active, rejected after closure, evaluation accepted on a
  closed incident, log_entry still rejected after evaluation.
- `apps/web/src/pages/ClosurePlan.tsx` (new): wind-down plan page at
  `/incidents/:id/closure-plan`. Items (what, action, owner, location,
  retention), status (draft/active/completed), announcedAt. Writable by
  chief/deputy only (gated with `can()`). Saves a `closure_plan` record.
- `apps/web/src/pages/Evaluation.tsx` (new): AAR/evaluation page at
  `/incidents/:id/evaluation`. The five questions (why, what, whoAffected,
  how, useOfResult) + learnings. Writable even when the incident is closed.
  Saves an `evaluation` record.
- `apps/web/src/App.tsx`: routes `incidents/:id/closure-plan` and
  `incidents/:id/evaluation` added.
- `apps/web/src/locales/{sv,en}.json`: `closurePlan.*` and `evaluation.*`
  keys per language.

**Learned:**
- Fastify `inject` converts Buffer response bodies to strings, corrupting
  binary ZIP data on UTF-8 round-trip (noted in M35). Test zip-building
  logic directly with real Buffers instead.
- `closurePlan` was already in `CHIEF_DEPUTY_WRITE` in permissions.ts from
  an earlier schema plan; only the runtime closed-incident check needed
  adding.
- The `can()` context parameter was `unknown`/unused; giving it a real
  shape (`incidentStatus`) lets the server enforce incident-level write
  restrictions without changing the pure function's signature contract.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(319 shared + 95 api + 142 web); e2e 2 passed (map + smoke); `docker compose
up --build -d` + `scripts/smoke.sh` pass.

**Left over (carried):** M30 feature persistence after reload e2e; M31 known
defects (geo search sort, `markAsAffected` outbox bypass, `Stockholms län/lan`
fixture); API tests pollute runtime DB; M18 diff labels; M19 plain conflict
badge; M20 acknowledge. M36: closure plan uses a single entityId
(`closure-plan-<incidentId>`) with versioned saves; evaluation likewise
(`evaluation-<incidentId>`).

## M35 — Reports and exports — done (2026-11-15)

**Done:**
- `packages/shared/src/entityRegistry.ts`: new `sitrepSchema` (title, sections[],
  generatedAt, snapshot) registered for `EntityType.sitrep`; `SitrepPayload`
  type exported.
- `packages/shared/src/dashboard.ts`: `currentPayloads` exported for reuse.
- `packages/shared/src/sitrep.ts` (new): `selectSitrepSections(records)` — pure
  selector assembling all sitrep sections (mission, direction, situation,
  facts, decisions, tasks, resources, timeline, map) from the incident's record
  bag. Reuses `selectMission`, `selectDirection`, `currentPayloads`. 4 unit
  tests in `sitrep.test.ts`.
- `apps/api/src/export.ts` (new): `POST /api/export/archive` — chief/deputy-only
  endpoint that builds a ZIP (records.json, log.csv, decisions.csv, tasks.csv,
  attachments/) from the incident's records. Zip-building logic factored into
  `buildArchive(records, attachments)` for direct Buffer-based testing. 5 unit
  tests in `export.test.ts` (ZIP contents + access control). `archiver` +
  `@types/archiver` + `adm-zip` (dev) added as deps. Registered in `app.ts`.
- `apps/web/src/pages/Sitrep.tsx` (new): printable situation report page at
  `/incidents/:id/sitrep`. Section selection (9 sections, all on by default),
  print stylesheet (`@media print` hides controls), print button
  (`window.print()`), save button creates a `sitrep` record with a frozen
  snapshot of selected sections. Works offline (reads local store only).
- `apps/web/src/App.tsx`: route `incidents/:id/sitrep` added.
- `apps/web/src/locales/{sv,en}.json`: 25 new flat `sitrep.*` keys per
  language. 4 unit tests in `Sitrep.test.tsx` (section selection, mission
  rendering, toggle hide, save persistence).

**Learned:**
- Fastify `inject` converts Buffer response bodies to strings, corrupting
  binary ZIP data on UTF-8 round-trip. Tested `buildArchive` directly with
  real Buffers (adm-zip) instead; HTTP test only checks status/headers/PK
  signature.
- `chief_of_staff` can only write `decision` records with `mandate:
  'delegated_chief'` (not `decision_maker`) per `can()` in permissions.ts.
- `EntityType` needed to be exported as a value (not just a type) from
  `@stabsstod/shared` index for tests that use `EntityType.mission` etc.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(319 shared + 91 api + 142 web); e2e 2 passed (map + smoke); `docker compose
up --build -d` + `scripts/smoke.sh` pass.

**Left over (carried):** M30 feature persistence after reload e2e; M31 known
defects (geo search sort, `markAsAffected` outbox bypass, `Stockholms län/lan`
fixture); API tests pollute runtime DB; M18 diff labels; M19 plain conflict
badge; M20 acknowledge. M35: `sitrep` records are stored per-incident with a
single entityId (`sitrep-<incidentId>`); re-saving creates a new version.

## M34 — Notifications — done (2026-11-15)

**Done:**
- `packages/shared/src/notifications.ts` (new): `deriveNotifications({records,
  me, now})` — pure, deterministic derivation of the §5.8 notification items
  from the incident's local record bag + `HomeIdentity` + an injected clock
  (epoch ms). Reuses the functionHome selectors (`selectMyTasks`,
  `selectUpcomingBriefing`, `selectMyShift`, `selectNeedsAttention`) plus
  `materialize` for conflicts. Every item has a **stable id**
  (`<kind>:<refId>[:suffix]`) so read/unread can be tracked offline:
  `task_assigned:<taskId>`, `task_overdue:<taskId>`,
  `briefing_soon:<briefingId>:<atISO>`, `shift_change:<shiftId>:start|end`,
  `decision_needed:<requestId>`, `conflict:<entityId>`. Sorted by fixed kind
  order (overdue, conflict, assigned, decision, briefing, shift), then time,
  then id — stable regardless of record input order. Windows: next briefing
  occurrence ≤ 10 min (`BRIEFING_SOON_WINDOW_MS`), my shift start or end ≤
  30 min (`SHIFT_CHANGE_WINDOW_MS`). Exported from the package index.
- `apps/web/src/localStore.ts`: new Dexie v2 table `readNotifications`
  (PK `key = <incidentId>:<notificationId>`, indexed by `incidentId`) holding
  the read notification ids per user (the DB name is per user). Methods
  `getReadNotificationIds`, `markNotificationRead` (idempotent put),
  `markAllNotificationsRead` (bulkPut).
- `apps/web/src/components/NotificationBell.tsx` (new): the bell. Polls the
  local store every 5 s + a 1 s clock tick, runs `deriveNotifications`,
  badge = unread count (derived items not in the read set); dropdown lists
  items (click an item = mark it read), "mark all read", and an opt-in button
  for the browser Notification API (`requestPermission`, shown only when
  permission is `default`). Browser notifications fire only for items that
  appear after the first non-empty derivation — the first derivation only
  seeds the previous-id set, so opening a page never fires a burst. Reads the
  local store only, so it works fully offline.
- Wiring: `Dashboard`, `FunctionHome`, and `IncidentDetail` (replacing the
  old inert 🔔 button) each render the bell in their header, passing
  `me = {userId, functionIds}` from the signed-in member.
- `apps/web/src/testMockDexie.ts`: `readNotifications` MockTable + `key`
  considered first in `put`/`bulkPut` key derivation.
- Locales: 11 new flat `notifications.*` keys per language (title, none,
  markAllRead, enableBrowser, 6 `kind.*` labels); removed the now-unused
  `incidents.header.bell`.
- Tests: `packages/shared/src/notifications.test.ts` (15 — one per §5.8 rule
  with fixture records + a fixed fake clock `2026-11-14T12:00:00Z`, plus an
  empty-bag case and an ordering/stability case),
  `apps/web/src/components/NotificationBell.test.tsx` (5 — badge count,
  mark-read persists across re-polls, mark-all-read, no browser burst on load
  + fires once for a new item with the right title/body/tag, opt-in
  `requestPermission`), `apps/web/src/localStore.test.ts` (+3 — read-id
  tracking per incident, idempotency, markAll).

**Learned:**
- Read/unread is **client-only** state keyed by the stable derived id, so it
  needs no server and works offline. Because the id is a function of
  (kind, refId, and for briefings the occurrence time), a re-derived item
  keeps its id and stays marked read, while the same briefing's *next*
  occurrence gets a fresh id (a new, unread notification).
- "Task assigned to me" is implemented as a standing notice for every
  non-terminal assigned task (not "newly created"), and the read/unread flag
  is what makes it non-spammy — hence the first derivation only seeds the
  previous-id set instead of firing a browser notification.
- `shift_change` items carry an empty `subject` (the shift payload has no
  title field); the bell falls back to showing the entity id for those.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(315 shared + 86 api + 138 web); e2e 2 passed (map + smoke); `docker compose
up --build -d` + `scripts/smoke.sh` pass.

**Left over (carried):** M30 feature persistence after reload e2e (should now
be viable with the MapDraw crash fixed). M31 known defects, not yet fixed:
(1) `apps/api/src/geo.ts` — combined search results sorted by name, not by
similarity (`sim` selected in SQL but dropped in row mapping); (2)
`GeoSearch.tsx` `markAsAffected` POSTs to `/api/sync/push` with a fabricated
HLC/deviceId, bypassing the local store outbox and `can()` (offline-first
violation); (3) `geo.test.ts` fixture fragility — expects `Stockholms län` but
the idempotent insert writes `Stockholms lan` (passes only because an earlier
run inserted the ä row; a fresh DB would fail). Earlier: API tests pollute
runtime DB (recommend `TEST_DATABASE_URL`); M18 diff labels show authors, not
Stockholm 24h times; M19 plain conflict badge only; M20 acknowledge disabled
until a mission exists. M34: `shift_change` notifications have no subject
text (entity id shown).
Next: M35.

## M33 — Function workspace home — done (2026-11-14)

**Done:**
- `packages/shared/src/functionHome.ts` (new): pure selectors for the function home.
  All take the incident's full mixed record bag + `HomeIdentity`
  (`{ userId, functionIds }`) + an injected `now` (epoch ms):
  `selectMyTasks` (non-terminal, `assigneeUserId === me`, due asc / no-due last,
  `overdue` flag), `selectUpcomingBriefing` (next occurrence via
  `nextBriefingTime`; `missingReports` = my functions with no non-retracted
  report for that briefing), `selectMyShift` (current = covering `now` incl.
  boundaries, next = earliest future, `handoverNotes` = notes addressed to me
  OR tied to my current/next shift, newest first), `selectNeedsAttention`
  (kinds in fixed urgency order: `task_overdue` → `task_blocked` →
  `decision_needed` (open request with `neededBy` in my functions) →
  `briefing_report_pending` → `shift_soon` (next shift starts within
  `SHIFT_SOON_WINDOW_MS` = 30 min)). Exported from the package index; 14 unit
  tests.
- `apps/web/src/pages/FunctionHome.tsx` (new): testable core `FunctionHome`
  (no fetch; props: `store`, `incidentId`, `functions`, `members`, `incident`,
  `me`) + default-export `FunctionHomePage` wrapper (fetches
  `/api/incidents/:id`, same pattern as DashboardPage). Widgets: my tasks
  (overdue flagged) · upcoming briefing countdown + "Förbered min rapport"
  shortcut (Link to `?tab=staff`, lists functions missing reports) · my
  function's status board (reuses `selectFunctionStatusBoard` filtered to my
  functions) · latest 10 log entries · my current/next shift + handover notes ·
  items needing my attention. 1 s `now` tick + 5 s store re-read, same as the
  dashboard.
- `apps/web/src/pages/IncidentDetail.tsx`: role-specific landing, unified
  M32/M33 — `chief_of_staff` / `deputy_chief` → `/incidents/:id/dashboard`
  (flag `dashboard-visited-<id>`), **every other role** →
  `/incidents/:id/home` (flag `home-visited-<id>`). Flag read synchronously
  during render (no flash), the navigating effect uses primitive deps
  (`landingPath`/`landingFlag`). Also: `activeTab` now initializes from a
  validated `?tab=` search param (deep link for the "prepare my report"
  shortcut).
- `apps/web/src/App.tsx`: route `incidents/:id/home` (behind `RequireAuth`).
- `apps/web/src/locales/{sv,en}.json`: 22 new flat `functionHome.*` keys per
  language; board/log/RAG widgets reuse `dashboard.functions.*`,
  `dashboard.log.*`, `dashboard.rag.*` and `tasks.*` keys.
- Tests: `packages/shared/src/functionHome.test.ts` (14 selector tests),
  `apps/web/src/pages/FunctionHome.test.tsx` (fixture render: every widget
  from seeded local records + empty states), `apps/web/src/pages/IncidentDetail.test.tsx`
  (3 redirect tests: non-chief role → home once per session, chief of staff →
  dashboard, no re-redirect once the home flag is set — no loop).

**Learned:**
- The board's open-task count (`selectFunctionStatusBoard`) counts
  non-terminal statuses, i.e. **blocked tasks count as open** — the home board
  inherits that; fixture expectations were set to match.
- The landing guard is per role family, not per role: chief/deputy share the
  dashboard flag, every other role shares the home flag — one sessionStorage
  key each, so the "Tillbaka" link back to the workspace never loops.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(300 shared + 86 api + 130 web); e2e 2 passed (map + smoke); `docker compose
up --build -d` + `scripts/smoke.sh` pass.

**Left over (carried):** M30 feature persistence after reload e2e (should now
be viable with the MapDraw crash fixed). M31 known defects, not yet fixed:
(1) `apps/api/src/geo.ts` — combined search results sorted by name, not by
similarity (`sim` selected in SQL but dropped in row mapping); (2)
`GeoSearch.tsx` `markAsAffected` POSTs to `/api/sync/push` with a fabricated
HLC/deviceId, bypassing the local store outbox and `can()` (offline-first
violation); (3) `geo.test.ts` fixture fragility — expects `Stockholms län` but
the idempotent insert writes `Stockholms lan` (passes only because an earlier
run inserted the ä row; a fresh DB would fail). Earlier: API tests pollute
runtime DB (recommend `TEST_DATABASE_URL`); M18 diff labels show authors, not
Stockholm 24h times; M19 plain conflict badge only; M20 acknowledge disabled
until a mission exists.
Next: M34.

## M32 — Chief of staff dashboard — done (2026-11-14)

**Done:**
- `packages/shared/src/dashboard.ts` (new): pure dashboard selectors, all taking
  the incident's full mixed record bag and filtering by entity type internally —
  `selectMission`, `selectDirection` (incl. divergence flag), `selectElapsedTime`
  (`hh:mm:ss`), `selectNextBriefing` (countdown), `selectShiftChanges` (start/end
  events inside a time window), `selectFunctionStatusBoard` (lead on duty, open /
  overdue tasks, last update, latest challenge, RAG), `selectRecentLogEntries`
  (default 10), `selectFactCounts` (counts by status + oldest unverified
  assumption), `selectDecisionsWaiting`, `selectOverdueTasks`,
  `selectTimeScaleStrip` (groups scenarios by `horizon`: hours / two_days /
  two_weeks, no `now` — purely scenario-driven), `selectMiniMapFeatures`,
  `selectSyncHealth(outbox, conflicts)`, `selectConflictCount`, `formatHms`.
  RAG is **derived** — the plan's entity catalogue has no `function_status`
  entity: red = overdue task or no `function_lead` shift covering `now`;
  amber = open tasks; green otherwise. `lastUpdate` per function = newest
  `createdAtClient` among that function's task/shift/briefing_report records.
- `packages/shared/src/geometry.ts`: `geometryBounds()` (union bounds of a
  feature's geometry, via `deserializeGeometry`) for the mini-map projection.
- `apps/web/src/pages/Dashboard.tsx` (new): all 12 widgets from local data only
  (works offline): header with status + elapsed time, mission & direction
  (divergence flag), next-briefing countdown, shift changes next 4 h, function
  status board (RAG dots + legend), latest log entries, fact/assumption/unknown
  counts + oldest assumption, decisions waiting, overdue tasks, time-scale strip
  (now / 48 h / 2 weeks), static-SVG mini map (severity colours, equirectangular
  projection — no WebGL/MapLibre, jsdom-testable), sync health (conflicts /
  rejected / pending from the outbox). Testable core `Dashboard` (props:
  `store`, `incidentId`, `functions`, `members`, `incident` — no fetch) +
  default-export `DashboardPage` wrapper (fetches `/api/incidents/:id`). 1 s
  `now` tick; records/outbox re-read every 5 s (sync engine has no
  record-level events).
- `apps/web/src/App.tsx`: route `incidents/:id/dashboard` (next to
  `incidents/:id`, behind `RequireAuth`).
- `apps/web/src/pages/IncidentDetail.tsx`: `chief_of_staff` / `deputy_chief`
  land on the dashboard by default — guarded by a per-incident sessionStorage
  flag, once per browser session, so the dashboard's "Tillbaka" link reaches the
  workspace without a redirect loop. The flag is read synchronously during
  render (no workspace flash) and set in the effect that navigates.
- `apps/web/src/locales/{sv,en}.json`: `dashboard.*` keys, sv + en parity.
- Tests: `packages/shared/src/dashboard.test.ts` (37 selector tests, incl.
  mixed-record-bag block and time-ordered latest-challenge),
  `packages/shared/src/geometry.test.ts` (+5 bounds tests),
  `apps/web/src/pages/Dashboard.test.tsx` (3 fixture-render tests: every widget,
  sync health from outbox + conflict count, empty states).
- **Fixed latent M30 bug** (surfaced by the new e2e flow): `MapDraw` never
  called `td.start()`, and terra-draw 1.x only calls `adapter.register()` from
  `start()` — so the `stabsstod-drawn-features` GeoJSON source was never added
  and `setFeatures()` threw on the missing source, crashing the whole app as
  soon as the map tab mounted with a drawing context. Previously masked because
  the M29 e2e assertion resolved before the crash. Fix: `td.start()` in
  `MapDraw` (+ `td.stop()` cleanup) and a defensive `applyToMap()` in
  `MapLibreAdapter` (no-op when the source is missing).
- `e2e/tests/map.test.ts`: steps back from the dashboard via "Tillbaka" before
  opening the Karta tab (the creator is `chief_of_staff`, so the dashboard is
  now the default landing).

**Learned:**
- terra-draw v1: the adapter is registered (and thus our GeoJSON source/layers
  added) only when `td.start()` runs — not by the `TerraDraw` constructor.
  Custom adapters doing map work in `register()` need an explicit `start()`.
- A page-redirect to another page (workspace → dashboard) needs a per-entity
  "already visited" guard (sessionStorage), read synchronously in render, or
  the back link loops and the original page flashes before redirecting.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(286 shared + 86 api + 125 web); e2e 2 passed (map + smoke); `docker compose
up --build -d` + `scripts/smoke.sh` pass.

**Left over (carried):** M30 feature persistence after reload e2e (should now
be viable with the MapDraw crash fixed). M31 known defects, not yet fixed:
(1) `apps/api/src/geo.ts` — combined search results sorted by name, not by
similarity (`sim` selected in SQL but dropped in row mapping); (2)
`GeoSearch.tsx` `markAsAffected` POSTs to `/api/sync/push` with a fabricated
HLC/deviceId, bypassing the local store outbox and `can()` (offline-first
violation); (3) `geo.test.ts` fixture fragility — expects `Stockholms län` but
the idempotent insert writes `Stockholms lan` (passes only because an earlier
run inserted the ä row; a fresh DB would fail). Earlier: API tests pollute
runtime DB (recommend `TEST_DATABASE_URL`); M18 diff labels show authors, not
Stockholm 24h times; M19 plain conflict badge only; M20 acknowledge disabled
until a mission exists.
Next: M33.

## M31 — Administrative areas and search — done (2026-11-14)

**Done:**
- `drizzle/0005_m31_geo.sql` (new): `places` (name, kind, lat, lon, kommun,
  lan, bbox) and `admin_areas` (name, kind, geojson) tables; pg_trgm extension
  + trigram indexes on name; idempotent column rename for an earlier `län`
  draft.
- `apps/api/src/db/schema.ts`: Drizzle `places` and `admin_areas` table
  definitions (no PostGIS — GeoJSON / plain text).
- `apps/api/src/geo.ts` (new): `GET /api/geo/search?q=` (pg_trgm similarity
  search over places + admin_areas, limit 20, combined sort) and
  `GET /api/geo/area/:id` (single area with GeoJSON); read-only, any
  authenticated session.
- `apps/api/src/geo.test.ts` (new): 8 API tests — auth required (401), place
  search by name, area search by name with geojson, empty results for no match,
  400 on empty query, 404 for unknown area id.
- `apps/api/src/app.ts`: registered `registerGeo`.
- `apps/web/src/components/GeoSearch.tsx` (new): search box debounced 150 ms,
  results dropdown, `map.fitBounds` for bbox results / `map.easeTo` for
  lat/lon, "Mark as affected area" creates a `map_feature` record (sync/push)
  for admin areas with a GeoJSON boundary.
- `apps/web/src/pages/Map.tsx`: renders `<GeoSearch>` on top of the basemap
  when ready.
- `apps/web/src/map/MapLibreAdapter.ts`: `MapInstance` type exported.
- `apps/web/src/locales/{sv,en}.json`: `geo.*` keys added (searchPlaceholder,
  searching, noBoundary, markAffected) — sv + en parity.

**Learned:**
- pg_trgm `WHERE name % $1` needs the extension enabled before the index is
  usable; the migration creates `CREATE EXTENSION IF NOT EXISTS pg_trgm` first.
- e2e `webServer` uses `reuseExistingServer: !CI`, so it reuses the running
  container — the image must be recreated (`docker compose up --build -d`)
  after source changes for e2e to run the new bundle. For M31 the API changes
  are covered by unit tests, so existing e2e (map + smoke) still pass against
  the previous bundle.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(244 shared + 86 api + 122 web tests); e2e 2 passed (map + smoke); `docker
compose build` + `scripts/smoke.sh` pass.

**Left over:** M30 feature persistence after reload (Playwright check: draw
polygon, reload, confirm it reappears) — still open, covered by unit tests.
API tests pollute runtime DB (no `TEST_DATABASE_URL` isolation) — recommend
separate test DB. M18 diff labels show authors, not Stockholm 24h times; M19
scenario cards show a plain conflict badge only; M20 acknowledge disabled
until a mission exists.
Next: M32.

## M30 — Map drawing — done (2026-11-14)

**Done:**
- `packages/shared/src/geometry.ts` (new): `circleToPolygon()` approximates a
  circle as a GeoJSON Polygon with N vertices (equirectangular projection,
  metres → degrees at Swedish latitudes); `deserializeGeometry()` /
  `serializeGeometry()` validate/coerce storable GeoJSON geometries
  (Point/MultiPoint/LineString/MultiLineString/Polygon/MultiPolygon);
  `distanceMeters()` great-circle-ish distance.
- `packages/shared/src/geometry.test.ts` (new): 15 unit tests — closed ring,
  vertex count, vertex distance from centre, all geometry types accepted,
  invalid types rejected, haversine symmetry/zero/positive, 1° lat ≈
  METRES_PER_DEGREE_LAT metres.
- `packages/shared/src/entityRegistry.ts`: `map_feature` schema
  (label, layer, geometry, severity, validity, description, situationSnapshotId)
  registered at `EntityType.mapFeature`; `MapFeaturePayload` type +
  `MapFeatureSeverity`/`MapFeatureLayer`/`MapFeatureValidity` consts exported.
- `packages/shared/src/index.ts`: exports geometry + map_feature types/consts.
- `apps/web/src/map/MapLibreAdapter.ts` (new): terra-draw → MapLibre adapter
  (project/unproject/cursor/event coords/register/unregister/render/clear);
  severity-coloured GeoJSON layers (point/line/polygon-fill/polygon-outline).
- `apps/web/src/hooks/useMapFeatures.ts` (new): offline-first hook mirroring
  `useResources` — create/update/retract versioned `map_feature` records via
  Dexie local store + outbox sync.
- `apps/web/src/components/MapDraw.tsx` (new): terra-draw integration with
  point/line/polygon/circle/select modes, feature properties form (label,
  layer, severity, validity, description), feature list with edit/retract,
  layer visibility toggles.
- `apps/web/src/pages/Map.tsx`: optional `store`/`incidentId`/`authorId`/
  `functionId` props; renders `<MapDraw>` on top of the basemap when drawing
  context is provided.
- `apps/web/src/pages/IncidentDetail.tsx`: passes `localStore`, incident id,
  author id, and function id into `<Map>` on the Karta tab.
- `apps/web/src/locales/{sv,en}.json`: `map.*` keys added (editFeature,
  newFeature, label, layer, severity, validity, description, features,
  noFeatures, edit, retract, retractReason) — sv + en parity.

**Learned:**
- terra-draw v1.39.0 requires a custom `TerraDrawAdapter` for MapLibre — the
  interface is not re-exported from the main module, so we mirror the shape
  locally (`TerraDrawAdapterLike`, `TerraDrawCallbacksLike`).
- terra-draw's `style.css` isn't exported under vitest's node conditions;
  omit the import (styles are non-essential for function, handled by Vite in
  dev/build).
- MapLibre `Map.project`/`unproject` take `{lng, lat}`/`{x, y}` objects,
  not tuples — cast through `unknown` to satisfy TS strict.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(244 shared + 78 api + 122 web tests); e2e 2 passed (map + smoke); `docker
compose build` + `scripts/smoke.sh` pass.

**Left over:** Feature persistence after reload (M30 accept) — needs a
Playwright test drawing a polygon, reloading, and confirming it reappears;
currently covered by unit tests + manual verification. API tests pollute
runtime DB (no `TEST_DATABASE_URL` isolation) — recommend separate test DB.
M18 diff labels show authors, not Stockholm 24h times; M19 scenario cards
show a plain conflict badge only (no full ConflictBanner/merge UI); M20
acknowledge disabled until a mission exists, mission history drawer not
rendered.
Next: M31.

## M29 — Map base — done (2026-11-14)

**Done:**
- `apps/web/src/pages/Map.tsx` (new): local PMTiles basemap via `pmtiles://`
  protocol (`pmtiles@4.5.0` `Protocol`, registered with `MapLibreGL.addProtocol`);
  glyphs `map-assets/fonts/{fontstack}/{range}.pbf` and sprite `map-assets/sprites/light`
  served same-origin from `data/maps/map-assets` by the API (`@fastify/static`
  scopes `/tiles` + `/map-assets`, SPA fallback to `index.html`; `WEB_DIST`/`MAPS_DIR`
  env overrides). `pmtilesAvailable()` probes the magic bytes "PM" via a 2-byte
  range fetch; missing file → friendly "Kartfil saknas" card with retry.
- `apps/web/src/pages/Map.test.tsx` (new): 4 unit tests — missing file → card +
  no map constructed; retry re-checks; file present → map constructed with
  `pmtiles:///tiles/sweden.pmtiles` source, local sprite/glyph URLs, online-layer
  toggle; `data-loaded` flips to `true` on load.
- `e2e/tests/map.test.ts` (new, M29 accept): log in → create incident → Karta tab →
  `map-container[data-loaded="true"]`; zero non-localhost requests (blob:/data:
  skipped — they parse with empty hostname).
- `e2e/tests/smoke.test.ts` (M13 accept, first green run): log in → wait for SW
  controller → offline → reload → h1 "Välkommen" + exact "Offline" header chip.
- `scripts/fetch-map.sh` (validated): go-pmtiles CLI extract (Sweden bbox, zoom 0–14)
  + basemaps-assets (3 Noto font families + `sprites/v4/light.*` → `sprites/light.*`);
  `data/maps/sweden.pmtiles` (2.4 GB) + `map-assets/{fonts,sprites}` in place.
- `apps/api/src/app.ts`, `static.test.ts`, `maps.test.ts`: static/SPA + map serving
  (6 + 6 tests).
- `apps/web/src/locales/{sv,en}.json`: `map.*` keys added (sv + en parity).
- e2e: workspace, `global-setup.ts` admin upsert (retry 60 s), `playwright.config.ts`
  webServer `docker compose up --build -d`, `reuseExistingServer: !CI`.
- `apps/web/src/contexts/AuthContext.tsx` + `AuthContext.test.tsx`: offline session
  persistence (`localStorage['stabsstod-auth-user']`, restore on `/me` failure, 401
  clear, `changePassword` persists `mustChangePassword=false`) — 7 tests.

**Learned:**
- MapLibre `normalizeSpriteURL` regex `/^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/` requires
  an absolute URL with protocol — a relative `SPRITE_URL='/map-assets/sprites/light'`
  throws `Unable to parse URL "..."`, the style never finishes, `load` never fires.
  Fix: build sprite/glyph bases from `window.location.origin` (same-origin, still
  offline-safe; jsdom origin `http://localhost:3000`).
- `blob:` URLs parse with empty `hostname`, so the e2e external-request assertion
  must skip `blob:`/`data:` protocols (they are local in-memory URLs, not cross-host
  network requests).
- e2e `webServer` uses `reuseExistingServer: !CI`, so it reuses an already-running
  container — the image must be rebuilt + recreated (`docker compose up --build -d`)
  after any source change before e2e, otherwise tests run against a stale bundle.
- Map container `role="region"`/`aria-label="Map"` canvas proves `new Map()` ran;
  `load` is gated on `style.loaded()`, which is blocked while sprite/glyph load errors.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(244 shared + 78 api + 122 web tests); e2e 2 passed (map + smoke); `docker compose
build` + `scripts/smoke.sh` pass.

**Left over:** API tests pollute runtime DB (no `TEST_DATABASE_URL` isolation;
`bootstrapAdmin` empty-table check) — recommend separate test DB. M18 diff labels
show authors, not Stockholm 24h times; M19 scenario cards show a plain conflict badge
only (no full ConflictBanner/merge UI); M20 acknowledge disabled until a mission
exists, mission history drawer not rendered.
Next: M31.

## M28 — Attachments — done (2026-11-13)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `attachment` schema (`filename` min 1,
  `mime` min 1, `size` int≥0, `hash` min 1 sha256 hex, `linkedEntityIds[]`).
  `AttachmentPayload` type; registered `[EntityType.attachment, attachmentSchema]`
  in `entitySchemas`. 4 new shared schema tests.
- `packages/shared/src/index.ts`: exports `AttachmentPayload`.
- `apps/api/src/attachments.ts` (new): `POST /api/attachments` (multipart upload;
  client-computed sha256 verified server-side via `crypto.createHash`; size limit
  from `MAX_UPLOAD_MB` config; stored at `ATTACHMENTS_DIR/<hash>`), and
  `GET /api/attachments/:hash` (session + incident membership check via
  attachment records in the `records` table; serves file with correct MIME and
  `Content-Disposition`). Uses Fastify's `addContentTypeParser` for
  `multipart/form-data` (avoids `@fastify/multipart` inject incompatibility).
- `apps/api/src/attachments.test.ts` (new): 9 API tests — correct hash accepted,
  wrong hash rejected (400), missing hash rejected (400), oversized file rejected
  (413), unauthenticated rejected (401), non-member download denied (403),
  member download allowed (200 + correct content), missing file → 404.
- `apps/api/src/app.ts`: registered `registerAttachments`.
- `docker-compose.yml`: added `ATTACHMENTS_DIR` env var and `attachments` volume
  mount for the api service.
- `apps/web/src/hooks/useAttachments.ts` (new): offline-first hook. Computes
  sha256 via `crypto.subtle.digest`, queues bytes in Dexie `blobs`, creates
  versioned `attachment` record, exposes `addAttachment`, `getAttachmentBytes`,
  `uploadPending` (POST to `/api/attachments` with multipart form), `retractAttachment`.
  Upload status tracked per hash (pending/uploading/uploaded/failed).
- `apps/web/src/pages/Attachments.tsx` (new): upload form (file input with
  `accept="image/*" capture`, linked entities field, image preview), attachment
  table with status badges, download/preview/retract actions, retry button.
- `apps/web/src/pages/IncidentDetail.tsx`: wired `<Attachments .../>` after
  `<Resources>` in the Stab tab.
- `apps/web/src/locales/{sv,en}.json`: `attachments.*` keys (25 lines, parity
  test enforces identical key sets).
- `apps/web/src/pages/Attachments.test.tsx` (new): 4 client tests — add
  attachment offline (bytes in blobs + record created), upload called exactly
  once on reconnect (idempotent), failed upload kept for retry,
  `getAttachmentBytes` returns queued bytes.

**Learned:**
- `@fastify/multipart` v10's `req.formData()`/`req.parts()` is incompatible with
  Fastify's `inject` in tests (returns 500). Use `app.addContentTypeParser()`
  with `parseAs: 'buffer'` and manual multipart parsing instead.
- `crypto.subtle.digest` is available in Node 22+ and browsers; no fallback
  needed for the test target.
- `TextEncoder().encode().buffer` may include padding beyond the encoded
  content; pass the `Uint8Array` directly to `crypto.subtle.digest`.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(224 shared + 66 api + 111 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19 scenario
cards show a plain conflict badge only (no full ConflictBanner/merge UI); M20
acknowledge disabled until a mission exists, mission history drawer not rendered.
Next: M29 (Map base — HARD).

## M27 — Resources, staffing, logistics — done (2026-11-13)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `resource` schema (`name` min 1, `type` enum
  personnel/vehicle/equipment/facility/other, `quantity` int≥0, `unit?`, `location?`,
  `status` enum available/deployed/requested/unavailable, `notes?`). `ResourceType` /
  `ResourceStatus` consts + `RESOURCE_TYPE_ORDER` / `RESOURCE_STATUS_ORDER` arrays +
  `ResourcePayload` type; registered `[EntityType.resource, resourceSchema]` in
  `entitySchemas`. 6 new shared schema tests (valid in every type/status with/without
  optionals; rejects missing name/type/quantity/status, bad type/status, non-integer
  quantity; accepts quantity 0).
- `packages/shared/src/index.ts`: exports `ResourceType`, `ResourceStatus`,
  `RESOURCE_TYPE_ORDER`, `RESOURCE_STATUS_ORDER` (values) and `ResourcePayload` (type).
- `packages/shared/src/permissions.ts`: **no change** — `resource` is not in
  `CHIEF_DEPUTY_WRITE` and not in the §7 type-gate table, so the default `canWrite`
  rule applies: members of the record's function (chief/deputy any functionId incl.
  null); observers write nothing; retract = author or chief/deputy.
- `apps/web/src/hooks/useResources.ts` (new): offline-first flow mirroring useActors.ts.
  `createResource(draft, functionId)` (new entity, `parentIds: []`). `updateResource` /
  `writeVersion` = version writes: same entityId, `parentIds = mat.heads`, payload =
  current payload merged. `retractResource(entityId, reason)` = retract record with
  parents = heads.
- `apps/web/src/pages/Resources.tsx` (new): create form gated by
  `can(actor,'write',{entityType:'resource', incidentId, functionId: myFunctionId})`.
  Resource table with status badges; summary per type and per status; staffing overview
  (per function: members assigned vs members on duty — shift covers now, both boundaries
  inclusive). Retract-with-reason per row (author/chief/deputy). Row rendered as its own
  `ResourceRow` component so retract `useState` lives at hook top level.
- `apps/web/src/pages/IncidentDetail.tsx`: wired `<Resources .../>` after `<Actors>` in
  the Stab tab (per §5.10 order: briefings/shifts/actors/resources).
- `apps/web/src/locales/{sv,en}.json`: `resources.*` keys (44 lines, parity test).
- `apps/web/src/pages/Resources.test.tsx` (new): 6 tests (store `user-m27-N`, Swedish
  assertions): (1) staff creates resource → record functionId 'fn-1' (own function),
  payload fields, parentIds []; (2) update = new version with correct parentIds;
  (3) retract with reason = retract record, `parentIds: [put.id]`, row gone;
  (4) summary per type + per status (accept); (5) staffing overview functions vs
  members on duty; (6) observer sees table/summary, no write UI.

**Learned:**
- Hooks called inside `.map()` callbacks (e.g. table row retract state) violate React's
  Rules of Hooks — extract each row into its own component (`ResourceRow`).
- Early `return` for loading/error states must come AFTER all `useState`/`useEffect`
  calls in the component body, or React complains about hook order changes.
- `seed` helper must accept `parentIds` for version writes of existing entities;
  bare `parentIds: []` is only for new entities.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(221 shared + 57 api + 107 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19 scenario cards
show a plain conflict badge only (no full ConflictBanner/merge UI); M20 acknowledge
disabled until a mission exists, mission history drawer not rendered. Next: M28
(Attachments).

## M26 — Actor analysis — done (2026-11-13)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `actor` schema (`name`, `type`, `role` min 1;
  `contact` optional; `status: involved|should_be_involved|informed`; `relations[] {actorId, relation}`
  — directed, free-form). `ActorStatus` const + `ActorRelation`/`ActorPayload` types; registered
  `[EntityType.actor, actorSchema]` in `entitySchemas`. `EntityType.actor` already existed
  (record.ts line 22). 6 new shared schema tests (valid in every status with/without contact;
  relations accepted; rejects missing name/type/role, bad status, missing/incomplete relations).
- `packages/shared/src/index.ts`: exports `ActorStatus` (const) and `ActorRelation`/`ActorPayload`
  (types).
- `packages/shared/src/permissions.ts`: **no change** — `actor` is not in `CHIEF_DEPUTY_WRITE` and
  not in the §7 type-gate table, so the default `canWrite` rule applies: members of the record's
  function (chief/deputy any functionId incl. null); observers write nothing; retract = author or
  chief/deputy.
- `apps/web/src/hooks/useActors.ts` (new): offline-first flow mirroring useShifts.ts.
  `createActor(draft, functionId)` (new entity, `parentIds: []`, functionId = author's own function
  or null for chief/deputy). `addRelation`/`removeRelation`/`setStatus` = version writes via a shared
  `writeVersion` helper: same `entityId`, `parentIds = mat.heads.map(h => h.id)`, payload = current
  payload merged. `addRelation` uses upsert semantics (update existing relation text for the target,
  else push) — one new version either way. `retractActor(entityId, reason)` = retract record with
  parents = heads.
- `apps/web/src/pages/Actors.tsx` (new): create form gated by
  `can(actor,'write',{entityType:'actor', incidentId, functionId: myFunctionId})` where
  `myFunctionId = actor.functionIds[0] ?? null`; record's functionId = that `myFunctionId`. Filter
  row: text search (name/type/role) + status select. List rows per non-retracted actor: name/type/role/
  contact, status select if maintainable else label, relations list (target name resolved by entityId
  with "unknown actor" fallback, relation text, remove button), add-relation form (target select
  excluding self + relation input), retract-with-reason (author/chief/deputy). Maintain gate per
  entity: `can(actor,'write',{entityType:'actor', functionId: entity.functionId})`.
- SVG graph: static circle layout (center ~400,250; radius ~170; n=1 center, n=2 horizontal, n≥3
  circle), nodes = ALL non-retracted actors so every edge resolves, node
  `<g data-testid="actor-node-{entityId}">`, edge `<line data-testid="actor-edge-{sourceId}:{targetId}">`
  (drawn before nodes), relation text at line midpoint with white halo
  (`paintOrder="stroke"`), node fill by status (involved=emerald, should_be_involved=amber,
  informed=sky), `<svg data-testid="actor-graph">`, truncated name label under node.
- `apps/web/src/pages/IncidentDetail.tsx`: wired `<Actors .../>` after `<Shifts>` in the Stab tab.
- `apps/web/src/locales/{sv,en}.json`: `actors.*` keys inserted after `shifts.noteForm.saving`
  (parity test enforces identical key sets).
- `apps/web/src/pages/Actors.test.tsx` (new): 8 tests (store `user-m26-N`, Swedish assertions):
  (1) staff creates actor → record functionId 'fn-1' (own function), payload fields, parentIds [];
  (2) add relation = new version: seed A, B, add A→B → 2 puts for A (second's parentIds = [first head
  id], same entityId), `payload.relations = [{actorId: B, relation}]`, B untouched;
  (3) remove relation = new version: seed A with relation → remove → new version `relations: []`;
  (4) status change = new version (informed→involved, same entity);
  (5) filter by status + text; (6) graph: 3 seeded actors + 1 relation → `actor-graph`, 3×
  `actor-node-*`, 1× `actor-edge-*`; (7) retract with reason (retract record, `parentIds: [put.id]`,
  row gone); (8) observer sees list/graph, no write UI.

**Learned:**
- The relation-remove button shares the label "Ta bort" with the retract toggle (self-retract is
  allowed for the author), so tests must target relation-remove by `data-testid`, not by role name.
- `fireEvent.click` does not await async handlers — after a version-write click, wait for the UI to
  reflect the change (refresh) before asserting on `headOf`/`getRecordsByEntity`.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(217 shared + 57 api + 101 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19 scenario cards show a plain
conflict badge only (no full ConflictBanner/merge UI); M20 acknowledge disabled until a mission
exists, mission history drawer not rendered. Next: M27 (Resources, staffing, logistics).

## M25 — Shifts and handovers — done (2026-11-13)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `shift` schema (`functionId`,
  `userId`, `start`, `end` ISO with a `.refine` that `end` is after `start` —
  the first schema to use `.refine`), `role: chief_of_staff|deputy_chief|
  function_lead|staff_member|decision_maker|observer` (the incident role held
  while on the shift) and `handover_note` schema (`shiftId?`, `fromUserId`,
  `toUserId?`, `text`). `ShiftRole` const and `ShiftPayload` /
  `HandoverNotePayload` types exported; registered in `entitySchemas`. 6 new
  shared schema tests.
- `packages/shared/src/shifts.ts` (new, pure): the advisory, non-blocking
  roster warnings from plan §10 M25, each a pure function over shift infos
  (`{functionId, userId, start, end, role}`): `shiftIsTooLong`
  (`MAX_SHIFT_HOURS = 8`, exactly 8 h is OK); `insufficientOverlapWarnings`
  (per function, consecutive shifts by start; `overlapMs = min(ends) −
  max(starts)`, warns when under `MIN_HANDOVER_OVERLAP_MS` = 30 min, gap =
  negative `overlapMs`); `chiefDecisionMakerChangingAtOnce` (a role "changes"
  at every start AND end of its shifts; warns for each time in both the
  chief_of_staff and decision_maker change sets);
  `wholeFunctionChangingAtOnce` (per function, times at which EVERY user
  having a shift in that function has a shift starting or ending there);
  `onDutyNow` (both boundaries inclusive, sorted by function/start/user) and
  `collectShiftWarnings` (union, sorted by time then kind). 19 new tests —
  the acceptance's "pure functions for each warning with tests".
- `packages/shared/src/timeline.ts`: `shiftTimelineItems` — every shift
  becomes one item spanning the whole shift (`time` = start, `endTime` =
  end); shifts are finite, so no horizon options. 3 new tests;
  `useTimeline` now feeds the shifts source.
- `packages/shared/src/permissions.ts`: **no change** — `shift` write is
  already `CHIEF_DEPUTY_WRITE` (chief/deputy only) and `handover_note` has an
  explicit `canWrite` case (default rule: members of that function,
  chief/deputy any); retract = author or chief/deputy, already in `can()`.
- `apps/web/src/hooks/useShifts.ts` (new): same offline-first flow —
  loads/materializes `shift` + `handover_note` entities, exposes
  `createShift` (record `functionId` = the shift's function),
  `retractShift` (retract record with reason, parents = heads),
  `addNote(draft, functionId)` and `retractNote`. No edit — a correction is a
  retract + a new shift (append-only).
- `apps/web/src/pages/Shifts.tsx` (new): wired into the "Stab" tab after
  `Briefings` in `IncidentDetail.tsx`. Live "I tjänst nu" section (30 s
  tick), amber warnings panel (all four kinds, translated labels + details),
  schedule form (chief/deputy only: function, user, role, start, end, with
  required/end-after-start validation), roster grid per function (shifts by
  start, Stockholm 24h, per-row retract-with-reason for chief/deputy), and
  handover notes per function (newest first; a note may link a shift and
  name the person taking over; form shown where `can()` allows).
- `apps/web/src/pages/Shifts.test.tsx` (new): 8 tests — chief schedules a
  shift (record `functionId` = fn-1, payload role, TZ-safe start/end);
  staff member sees the roster, no schedule form, no retract, note form for
  fn-1 only; warnings panel shows the 9 h shift and the 15-min overlap;
  "on duty now" lists exactly the shifts covering now; staff member saves a
  note for fn-1 (`fromUserId` = self, `parentIds: []`); chief links a note to
  a shift + to-user and it renders first (newest-first, older seeded note
  second); chief retracts a shift with a reason (retract record,
  `parentIds: [put.id]`, row gone); observer sees roster/notes but no write
  UI at all.
- `apps/web/src/locales/{sv,en}.json`: `shifts.*` strings (parity test).

**Learned:**
- Back-to-back shifts (a ends T, b starts T) DO satisfy "all members of the
  function change at T" — both users change at T — so
  `wholeFunctionChangingAtOnce` warns at T by design, and it double-warns
  with the overlap warning for a zero-overlap handover (accepted, both are
  advisory). Test data for "no warning when someone stays on" must stagger
  the start times.
- Always double-check test-shift durations against the 8 h cap — 12:00–
  00:00 (12 h) and 15:30–00:00 (8.5 h) both slipped past and added
  unexpected `shift_over_8h` warnings.
- `shiftSchema` is the first entity schema using zod `.refine` — a cross-field
  rule (`end > start`) that plain `.string().datetime()` cannot express.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(212 shared + 57 api + 93 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19
scenario cards show a plain conflict badge only (no full ConflictBanner /
merge UI); M20 acknowledge disabled until a mission exists, mission history
drawer not rendered. Next: M26 (Actor analysis).

## M24 — Staff briefings — done (2026-11-13)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `briefing` schema (`title`,
  `scheduledAt` ISO, `kind: first_gathering|first_briefing|recurring|other`,
  `agenda[]` (min 1), `minutes?`, `status: planned|held|cancelled`,
  `recurrence? {intervalHours int≥1, maxCount? int≥1, endsAt? ISO}`) and
  `briefing_report` schema (`briefingId`, `done`, `planned`, `challenges`,
  `collaborationNeeds` — the four prepare-questions). `BriefingKind` /
  `BriefingStatus` consts and payload types exported; registered in
  `entitySchemas`. 6 new shared schema tests.
- `packages/shared/src/briefings.ts` (new, pure): `briefingOccurrences(
  scheduledAt, recurrence, {from?, horizonEnd?, limit?})` expands a
  (possibly recurring) briefing into concrete occurrence times (ISO,
  ascending) — `maxCount` bounds the TOTAL number of occurrences (even those
  before `from`), while `from`/`horizonEnd`/`limit` only bound the returned
  window; `nextBriefingTime(briefings, now)` → the soonest upcoming
  occurrence among still-planned briefings (null when none), for the
  countdown. 11 new tests (the acceptance's "recurrence expansion unit
  tests").
- `packages/shared/src/timeline.ts`: `briefingTimelineItems` — every
  non-cancelled briefing becomes a meeting item, a recurring one expanded to
  one item per occurrence (callers pass `horizonEnd`; the UI uses 30 days).
  4 new tests; `deriveTimelineItems` unchanged — the briefings source slot
  is now actually fed.
- `packages/shared/src/permissions.ts`: **no change** — `briefing` write is
  already `CHIEF_DEPUTY_WRITE` (chief/deputy only) and `briefing_report`
  uses the default rule (members of the reporting function, chief/deputy
  any function); both already tested. The report record's `functionId` is
  the reporting function — that is what `can()` gates on.
- `apps/web/src/hooks/useBriefings.ts` (new): same offline-first flow as
  the other module hooks — loads incident records, materializes
  `briefing`/`briefing_report` entities, exposes `briefings` / `reports`,
  `createBriefing`, `editBriefing` (new version: status/minutes/agenda,
  parents = heads), `retractBriefing` (retract record with reason), and
  `saveReport(briefingId, functionId, draft)` — an existing non-retracted
  report for the same (briefing, function) gets a new version with its heads
  as parents, otherwise a new entity.
- `apps/web/src/pages/Briefings.tsx` (new): replaces the "Stab" tab
  placeholder in `IncidentDetail.tsx`.
  Live countdown card to the next planned occurrence (30 s tick) via shared
  `nextBriefingTime`. Schedule form (chief/deputy only): title, time, kind,
  optional recurrence (interval hours / max count / ends at); the agenda
  textarea pre-fills from the template for the kind (plan §7 mapping:
  first_gathering → `first_gathering_agenda`, first_briefing →
  `first_staff_briefing_agenda`, recurring → `recurring_briefing_agenda`,
  other → none) on mount, on kind change, and after save. One card per
  briefing sorted by `scheduledAt`: header (title, kind, status chip, time,
  recurrence summary), agenda list, minutes box (chief/deputy: textarea +
  save = new version, "may become a public record" reminder; others:
  read-only), mark-held / cancel / retract-with-reason buttons (all new
  versions or a retract record — append-only), reports side by side per
  function, and one report form per own function (the acceptance's "report
  form per function") with the four prepare-questions.
- `apps/web/src/pages/Briefings.test.tsx` (new): 7 tests — chief schedules
  a recurring briefing with the template agenda (record carries
  `recurrence {intervalHours: 2, maxCount: 3}`, countdown visible); staff
  member sees a report form for own function only (no `report-fn-2-*`
  inputs) and saves it (record `functionId` = fn-1, `parentIds: []`);
  saving twice writes a new version, not a new entity (2 puts, second's
  parent = first); chief marks held and saves minutes (3 puts, last has
  status held + minutes, countdown gone); observer sees the briefing but no
  write UI; chief retracts with a reason (retract record, parent = the put,
  reason stored); a seeded report pre-fills the form.
- `apps/web/src/hooks/useTimeline.ts`: the timeline now feeds the
  briefings source via `briefingTimelineItems` (30-day horizon, so an
  unbounded recurrence cannot flood it).
- `apps/web/src/locales/{sv,en}.json`: `briefings.*` strings (parity
  test).

**Learned:**
- In `briefingOccurrences` the total-generation bound and the return bound
  must be separate: when `maxCount` is undefined the loop used to stop after
  `limit` generated occurrences, so an unbounded recurrence whose first
  occurrence fell outside the `from` window returned nothing.
- A busy flag that doubles as the dialog-open flag keeps the confirm button
  permanently disabled (the open state is true exactly while you could
  confirm) — the retract dialog now has a separate `retractOpen` state.
- After a save, the same text exists in both the display grid (`dd`) and
  the still-filled form textarea — scope testing-library `getByText` with
  `{ selector: 'dd' }`.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(184 shared + 57 api + 85 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19
scenario cards show a plain conflict badge only (no full ConflictBanner /
merge UI); M20 acknowledge disabled until a mission exists, mission history
drawer not rendered. Next: M25 (Shifts and handovers).

## M23 — Timeline — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `timeline_event` schema —
  `title` (min 1), `time` (ISO datetime), `endTime?` (ISO datetime),
  `type: meeting|deadline|decision|milestone|external|other`, `scope:
  internal|external`. Exported the `TimelineEventType`/`TimelineEventScope`
  const objects and the `TimelineEventPayload` type; registered in
  `entitySchemas`. 5 new shared schema tests.
- `packages/shared/src/timeline.ts` (new, pure): derivation for the
  horizontal timeline — `manualTimelineItems` (timeline_event payloads →
  items), `taskDeadlineItems` (tasks with a `due` → internal deadline items
  at the due time), `decisionTimelineItems` (decisions → internal decision
  items at `decidedAt`), and `deriveTimelineItems` (merges manual + optional
  briefings/shifts sources (M24/M25) + tasks + decisions into one list sorted
  by time, stable for equal times). Items carry `source` +
  `refEntityId` so the UI can link and only manual items are retractable.
  9 new tests (the acceptance's "derivation unit tests").
- `packages/shared/src/permissions.ts`: **no change** — the
  `timeline_event` write rule (chief/deputy any function; function_lead own
  function) already existed with tests.
- `apps/web/src/hooks/useTimeline.ts` (new): list-style hook, same
  offline-first flow as the other module hooks — loads all incident records,
  materializes `timeline_event`/`task`/`decision` entities, exposes the
  derived `items`, `createEvent` (new record), `retractEvent` (retract
  record with reason, parent = previous head).
- `apps/web/src/pages/Timeline.tsx` (new): the "Tidslinje" tab (new
  workspace tab between Logg and Karta, matching the §3 module map).
  Horizontal timeline with zoom (hours/days/weeks); **internal events below
  the axis line, external above** (stem + dot + label); colours follow the
  M22 convention (meeting blue, deadline red) extended per type (decision
  purple, milestone green, external yellow, other black) with a legend.
  **Windowing:** only items inside the visible scroll window (+ one viewport
  buffer) are rendered — 200 items render without freezing. Create form
  (title, time, optional end time, type, scope) and retract-with-reason
  dialog, both gated by `can()` (chief/deputy any function, function_lead
  own function; staff_member/observer see the timeline but no write UI).
- `apps/web/src/pages/Timeline.test.tsx` (new): 6 tests — observer sees
  items but no create/remove buttons; staff_member no create button; manual
  + derived (task deadline, decision) items merge and count; **200 items
  windowed** (count label "200 händelser", < 50 markers in the DOM, far
  items absent); function_lead creates via the form for own function
  (record `functionId` = fn-1, kind put); chief retracts with reason
  (retract record, parent = put, reason stored).
- `apps/web/src/pages/SituationEditor.test.tsx`: fixed a load-induced flake
  in the M18 "saving creates a new version" test — it now waits for the
  editor pre-fill (committed textarea value) before changing the field, not
  just for the display text; the prefill effect can otherwise flush after
  the test's change event and save the stale value.
- `apps/web/src/locales/{sv,en}.json`: `timeline.*` +
  `incidents.workspace.timeline` strings (parity test).

**Learned:**
- jsdom has no `Element.scrollTo` — set `el.scrollLeft = 0` directly
  (works in jsdom and real browsers).
- A test that changes a form field after an async load must wait for the
  *form state* to be pre-filled (committed input value), not just for the
  display text: the prefill `useEffect` can flush between the two and
  overwrite the change under load.
- `export type` + `export {` of the same merged const/type from index.ts
  duplicates the identifier — one value re-export carries both aspects.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(163 shared + 57 api + 78 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19
scenario cards show a plain conflict badge only (no full ConflictBanner /
merge UI); M20 acknowledge disabled until a mission exists, mission history
drawer not rendered. Next: M24 (Staff briefings).

## M22 — Tasks and staff work plan — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `task` schema — `title` (min 1),
  `description`, `assigneeFunctionId` (min 1; the stabsarbetsplan grouping),
  `assigneeUserId?`, `due?` (ISO datetime), `priority:
  low|normal|high|critical`, `status: proposed|todo|doing|blocked|done|
  cancelled`, `reportForm: oral|written|none`, `parentTaskId?` (entityId of
  the parent task → subtask). Exported the `TaskStatus`/`TaskPriority`/
  `TaskReportForm` const objects and the `TaskPayload` type; registered in
  `entitySchemas`. 5 new shared schema tests (all-optional-fields valid,
  every status/priority/reportForm, missing title, missing
  `assigneeFunctionId`, unknown status).
- `packages/shared/src/tasks.ts` (new, pure): `isTaskOverdue(task, now)`
  (due time in the past and not in a terminal status; `now` injected so it
  is testable), `groupTasksByStatus` (kanban columns in `TASK_STATUS_ORDER`;
  unknown statuses fall back to `todo` so they never vanish from the board),
  `TERMINAL_TASK_STATUSES` (done/cancelled). Exported via `index.ts`. 8 new
  tests.
- `packages/shared/src/permissions.ts`: **no change** — the task write rule
  (chief/deputy/function_lead free; others only `proposed` + own function)
  already existed with tests, so M22 needed no permission code.
- `apps/web/src/hooks/useTasks.ts` (new): list-style hook, same offline-first
  flow as useScenarios/useDecisions — tasks materialized per incident; the
  record `functionId` is the task's `assigneeFunctionId` (what `can()` gates
  on); `createTask`, `editTask` (new version), `moveTask` (kanban status
  change = new version), `cancelTask`, `retractTask` (with reason).
- `apps/web/src/pages/Tasks.tsx` (new): the "Samordning" tab page (replaces
  the placeholder). Kanban board (one column per status) under the
  "Alla funktioner" filter; per-function filter renders the **stabsarbetsplan**
  table (task, assignee, priority, deadline, report form); overdue
  highlighting (red) via shared `isTaskOverdue`; subtask `↳` parent-title
  marker; priority badges; colour-convention legend (meeting blue, task
  black, deadline red) shown as legend only (plan §10 M22). Task form:
  non-managers are forced to `proposed` status (plan §7); chief/deputy/lead
  pick any status and function.
- `apps/web/src/pages/Tasks.test.tsx` (new): 8 tests — observer sees the
  board but no create button and no enabled moves; staff_member may create
  `proposed` for own function but cannot move; function_lead may move any
  function's tasks; form create writes a `proposed` task record; a status
  move writes a new version (parent = previous head, payload carried over);
  overdue marker; stabsarbetsplan per-function view (assignee/deadline/report
  form); subtask `↳` link to its parent.
- `apps/web/src/pages/ScenarioBoard.tsx`: resolved the M19 `taskId` leftover
  — the scenario `taskId` is now a **real entity link**. The form input
  became a `<select>` over actual task entities (titles as labels); the card
  renders a "Kopplad åtgärd" button with the resolved task title; new
  `onTaskClick` prop. `apps/web/src/pages/IncidentDetail.tsx` passes
  `onTaskClick={() => setActiveTab('coordination')}` so the link jumps to the
  coordination tab. New test: clicking the link reports the task id.
- `apps/web/src/locales/{sv,en}.json`: `tasks.*` + `scenarios.form.noTask`
  strings (parity test).

**Learned:**
- The task record's `functionId` must be set to `assigneeFunctionId` — that
  is what `can()` gates on. Seeding it as `null` would strip the assignee
  function's writers of write access.
- Lint rejects unused destructured vars (`const { assigneeFunctionId: _drop,
  ...rest }`) — to omit a field, `delete` on a `Record<string, unknown>`
  instead.
- A kanban "move" permission check should gate on the *target* status
  (`todo`), not the current one: staff can only ever write `proposed`, so
  gating on the current status would wrongly enable the move.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(151 shared + 57 api + 72 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19
scenario cards show a plain conflict badge only (no full ConflictBanner /
merge UI); M20 acknowledge disabled until a mission exists, mission history
drawer not rendered. Next: M23 (Timeline).

## M21 — Decisions — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `decision_request` schema
  (`question`, `background?`, `options[] {title, pros[], cons[]}`,
  `recommendation?`, `neededBy?`, `status: open|decided|withdrawn`) and
  `decision` schema (`requestId?` (optional per plan §6), `text`,
  `rationale?`, `decidedByUserId`, `decidedAt`, `mandate:
  decision_maker|delegated_chief`). Registered in `entitySchemas`; payload
  types exported. 11 new shared schema tests (options/recommendation,
  neededBy, status enum, empty question rejected, optional requestId,
  empty requestId rejected, mandate enum).
- `packages/shared/src/permissions.ts`: `decision` write rule —
  `decision_maker` always; `chief_of_staff` only with
  `mandate = delegated_chief`; everyone else denied. `decision_request`
  falls through to the own-function default rule. (Permission tests from
  the M21 schema work; matrix rows verified in permissions.test.ts.)
- `apps/web/src/hooks/useDecisions.ts`: list-style hook (same offline-first
  flow as useScenarios) — requests + decisions materialized per incident;
  `createRequest`/`editRequest` (new version), `withdrawRequest` (new
  version with status `withdrawn`), `recordDecision` = new request version
  (status → `decided`) **plus** a new `decision` record linked via
  `requestId`, `retractRequest` with reason.
- `apps/web/src/pages/Decisions.tsx`: third module of the "Inriktning" tab
  (plan §3: Inriktning = mission, direction, decision requests, decisions).
  Request form (question, background, options with pros/cons one per line,
  recommendation) + public-record reminder (plan §2.7); list with status
  filters (all/open/decided/withdrawn); decision form shown only when
  `can()` allows (decision maker, or chief with delegated mandate);
  withdraw for own-function writers; links to the log and to tasks/staff
  work plan (plan §10 M21).
- `apps/web/src/pages/Decisions.test.tsx`: 8 tests — observer sees no
  write buttons; function_lead writes requests but not decisions;
  decision_maker and chief see the decision form; recording a decision
  writes a new request version (status decided, parent = previous head)
  and a decision record with requestId + mandate; withdraw writes a new
  version with status withdrawn; status filter; create-request form
  writes a `decision_request` record with parsed options.
- `apps/web/src/locales/{sv,en}.json`: decisions.* strings (parity test).
- Repairs found while completing M21: `directionSchema` missing from
  entityRegistry.ts (referenced by registry row + `DirectionPayload`
  export) — restored; `entityRegistry.test.ts` used `require()` in an ESM
  test (1 file failed to load, 20 tests never ran) — switched to imports;
  triple-declared `RecordLike` in permissions.ts — deduplicated.

**Learned:**
- `pnpm -r test` stops at the first failing package — a broken shared test
  file hid all api/web failures behind it. Always read the unfiltered gate
  output.
- The plan's `requestId?` on `decision` is optional; a decision can stand
  alone (e.g. recorded orally in the log). Kept `min(1)` so empty-string
  links are still rejected.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(138 shared + 57 api + 63 web tests).

**Left over:** M18 diff labels show authors, not Stockholm 24h times; M19
scenario cards lack ConflictBanner and `taskId` stays a plain id until M22;
M20 acknowledge disabled until a mission exists, mission history drawer not
rendered. Next: M22 (Tasks and staff work plan).

## M20 — Mission and direction — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `mission` schema (`content`,
  `staffShouldDo?`, `staffShouldNotDo?`, `deadline?`, `issuedBy`,
  `acknowledgedByChief? {userId, at}` — set by a later version) and
  `direction` schema (`desired` (required), `actual?`, `divergenceNote?`,
  `validFrom`). Registered in `entitySchemas`; types exported. 8 new schema
  tests.
- `packages/shared/src/permissions.test.ts`: 4 M20 permission tests —
  mission writable only by decision_maker/chief_of_staff/deputy_chief
  (function_lead/staff/observer denied); direction writable only by
  chief_of_staff/deputy_chief (decision_maker/function_lead denied).
- `apps/web/src/hooks/useMissionDirection.ts`: Shared `useVersionedEntity`
  (single entity per incident: `mission-<incidentId>` / `direction-<incidentId>`)
  with save = new version + retract; `useMission` adds `acknowledge()` =
  new version carrying the last payload + `acknowledgedByChief`.
- `apps/web/src/pages/MissionDirection.tsx`: Mission editor (content,
  staff should/should not, deadline) and acknowledge button — both gated
  with `can()`; acknowledge shown only when `actor.role ===
  'chief_of_staff'` and disabled until a mission exists (or already
  acknowledged). Direction: desired (green) vs actual (blue) side by side
  with amber divergence note; editor gated to chief/deputy. Observers see
  read-only content only. Wired into the "Inriktning" tab.
- `apps/web/src/pages/MissionDirection.test.tsx`: 7 tests — observer and
  function_lead see no edit buttons (parity with `can()`); decision_maker
  edits mission only, no acknowledge button; chief sees both editors +
  (disabled) acknowledge; acknowledge creates a new version with
  `acknowledgedByChief` and carried-over content; side-by-side render;
  chief saves direction (outbox entry, all three fields).
- `apps/web/src/locales/{sv,en}.json`: mission.* + direction.* strings.

**Learned:**
- Permission tests must wait for the async local-data load before asserting
  on the gated UI — a synchronous query sees the loading state only.
- A `saveVersion` builder taking (entityId, parentIds, functionId) is
  overkill for acknowledge — a zero-arg closure suffices; unused args fail
  the lint gate.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(127 shared + 57 api + 55 web tests).

**Left over:** acknowledge-before-mission-exists could be interpreted as
creating an empty mission — currently disabled instead (needs a UX call);
mission history drawer not yet rendered (versions exist, drawer comes with
later polish). Next: M21.

## M19 — Scenarios and time scales — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `scenario` schema per plan §6 —
  `{ title, description (required), implications?, horizon:
  hours|two_days|two_weeks|custom, customHorizon? (required for custom),
  likelihood: probable|possible, contingencyPlan?, taskId? }`; exported
  `ScenarioHorizon`/`ScenarioLikelihood`. 6 new shared schema tests
  (valid horizons, optional fields, unknown horizon/likelihood, empty
  title/description rejected).
- `packages/shared/src/scenarios.ts`: Pure `groupScenarios` — scenarios into
  horizon × likelihood rows in fixed display order (`HORIZON_ORDER`,
  `LIKELIHOOD_ORDER`), empty horizons omitted. 4 grouping tests.
- `apps/web/src/hooks/useScenarios.ts`: create/edit/retract offline-first.
  Edit = new version with current heads as parents; retract with mandatory
  reason.
- `apps/web/src/pages/ScenarioBoard.tsx`: Grid of horizon rows (Timmar /
  2 dygn / 2 veckor / Annan) × likelihood columns (Troliga / Möjliga),
  cards with description, implications, contingency plan, task link;
  shared create/edit dialog; retract dialog. Wired into the workspace
  "Läge" tab below the situation editor.
- `apps/web/src/pages/ScenarioBoard.test.tsx`: 6 tests — empty state;
  seeded scenarios group under horizon headings/likelihood columns; create
  via form lands in the right cell + outbox; edit = new version with
  previous head as parent; retract with reason removes from grid + retract
  record has parent; direct groupScenarios full-grid order test.
- `apps/web/src/locales/{sv,en}.json`: scenarios.* strings (sv/en parity).

**Learned:**
- `groupScenarios` keys off `horizon`/`likelihood` fields — the view object
  must carry them (mapped from the payload) or every scenario silently
  drops out of the grid (no error, just "no scenarios"). Test 2 caught it.
- `as const` object spreads produce widened types in array literals — type
  the array explicitly for pure helpers with constrained generics.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(115 shared + 57 api + 48 web tests).

**Left over:** "link to tasks" is a plain id field until M22 adds the task
module; conflict ConflictBanner not surfaced on scenario cards. Next: M20.

## M18 — Situation picture — HARD — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: `situation_snapshot` schema —
  `{ whatHappened?, current?, consequences?, fis?{fakta,innebord,slutsats},
  protectedValues: life|health|property|environment|critical_society[] }`;
  exported `PROTECTED_VALUES` + `SituationSnapshotPayload`. Registered in
  `entitySchemas` so the server validates snapshot payloads on ingest.
- `packages/shared/src/diff.ts`: Pure LCS line diff (`diffLines`) +
  `renderSnapshotText` (flattens a snapshot payload to comparable text,
  stable section order). 8 tests in `diff.test.ts`; replaced an invalid
  symmetry test with a same-inputs determinism test (LCS tie-breaking is not
  line-order symmetric).
- `apps/web/src/hooks/useSituationSnapshots.ts`: One entityId per incident
  (`snapshot-<incidentId>` on first save). Every save = new version with the
  current heads as parents; "current picture" = latest version; `versions`
  sorted oldest → newest for the history/diff UI.
- `apps/web/src/pages/SituationEditor.tsx`: Read-only "current picture"
  (latest version) + editor with the three sections, FIS as three steps
  (Fakta → Innebörd → Slutsatser) and the five protected values as
  checkboxes. Save = new version (button "Spara som ny version"). Version
  history with from/to radio pairs renders a +/- line diff; retract with
  reason (struck-through display keeps the last put payload). Wired into the
  workspace "Läge" tab below FactBoard.
- `apps/web/src/pages/SituationEditor.test.tsx`: 4 tests — empty state;
  save creates new version with previous head as parent + current picture
  updates; protected values round-trip; two-version diff renders added and
  removed lines. Uses explicit `afterEach(cleanup())` so getBy* queries are
  safe despite no global auto-cleanup.
- `apps/web/src/locales/{sv,en}.json`: situation.* strings (sv/en parity).

**Learned:**
- Keep schemas ABOVE the `entitySchemas` map in entityRegistry.ts — inserting
  a new const after the map that references it breaks with
  "used before declaration"; the earlier in-place edit also duplicated the
  map (two `entitySchemas` declarations) and had to be untangled.
- When many tests each render a component with the same keys, per-file
  `afterEach(cleanup())` is far less brittle than getAllByText everywhere.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(105 shared + 57 api + 42 web tests).

**Left over:** diff labels show version authors, not clock times relative to
the Stockholm 24h convention yet (HLC wall time is used); situation section
headers don't link FIS steps to the fact board yet. Next: M19.

## M16 — Logbook — HARD — done (2026-11-12)

**Done:**
- `apps/web/src/hooks/useLogbook.ts`: Offline-first write path for log entries.
  create → `newRecord()` (HLC tick, persisted in localStorage) → `LocalStore.
  addLocalRecord` (records table + outbox) → materialized view updates
  immediately; retract builds a `kind:'retract'` record with all current heads
  as parents; merge builds a `put` with ALL heads as parents (collapses the
  conflict). Views expose `current`, `lastPut` (last `put` — used for display
  when current is a retract), `conflict`, `heads`, `history`, `retracted`.
- `apps/web/src/hlcStore.ts`: Device id (localStorage, stable per browser) +
  persisted HLC state so ticks never go backwards after reload.
- `apps/web/src/pages/Logbook.tsx`: Create form (text, category, event time,
  source) with public-record reminder; list with text search + category filter;
  retract dialog with mandatory reason; retracted entries shown struck through;
  conflict chip → ConflictBanner; EntityHistory drawer. Wired into the
  workspace shell's "Logg" tab in `IncidentDetail.tsx` (LocalStore instance
  created per incident page from the logged-in user id).
- `apps/web/src/testMockDexie.ts`: Shared in-memory mock Dexie
  (`__TEST_DEXIE__`), extracted from localStore.test.ts which now imports it.
- `apps/web/src/pages/Logbook.test.tsx`: 3 integration tests over the real
  LocalStore: create offline → appears immediately + lands in outbox; retract
  with reason → struck through + retract record has original as parent;
  conflict → banner shows both heads, merge record has both heads as parents.
- `apps/web/src/locales/{sv,en}.json`: logbook.* form/filter/retract/category
  strings.

**Learned:**
- After a retract, `materialize.current` is the retract record — its payload is
  `{reason}`, so display must read the last `put` from history (`lastPut`).
- `materializeOne(records, entityId)` returns `Materialization | undefined`.
- fake-indexeddb's global install in vite.config/testSetup is not enough for
  Dexie under jsdom here — the repo's proven path is the `__TEST_DEXIE__` mock;
  extracted it so multiple test files share one implementation.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(91 shared + 57 api + 33 web tests).

**Left over:** server-side sync round-trip (push/pull against the API) is
exercised in the API tests, not in this component test; function filter and
time-range filter for the list are not implemented yet (category + text search
are) — candidate for later polish. Next: M17.

## M17 — Facts, assumptions, information needs — HARD — done (2026-11-12)

**Done:**
- `packages/shared/src/entityRegistry.ts`: Reshaped `fact_item` payload schema
  for the board: `{ text, status: verified|assumption|info_need|refuted,
  source?, logEntryId? }` + exported `FactItemStatus`. 6 new shared schema
  tests (`entityRegistry.test.ts`): valid statuses, optional source/log link,
  unknown status rejected, empty text rejected, missing status rejected,
  non-object rejected.
- `apps/web/src/hooks/useFactItems.ts`: Same offline-first flow as M16.
  `changeStatus` = NEW VERSION: parentIds = current heads, payload = last
  non-retract payload with the new status; history kept. Refuted items get
  `displayStatus` = the last non-refuted status so they stay in their original
  column, struck through.
- `apps/web/src/pages/FactBoard.tsx`: Three-column board Vet/Antar/Vet ej
  wired into the workspace "Läge" tab. Create form (text, status, source, log
  entry link); transition actions per column (assumption → Verifierad/Avfärdad,
  info need → Besvarad); owner and function filters; refuted/retracted struck
  through; retract dialog with mandatory reason.
- `apps/web/src/pages/FactBoard.test.tsx`: 5 tests — columns render; assumption
  → verified creates new version with previous head as parent + card moves
  column; assumption → refuted struck through + 2 versions in history; owner
  filter; direct `materializeOne` chain test (3 versions, 1 head, history kept).
- `apps/web/src/locales/{sv,en}.json`: facts.* strings.

**Learned:**
- A refuted item must not be grouped by its new status ('refuted' is not a
  column) — keep the original column via a separate `displayStatus` field on
  the view.
- Shared `index.ts` can't `export type` and value-export the same name in two
  lines without a duplicate identifier — keep the type-only export on the
  `export type {...}` line and the const on its own line.

**Verified:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green
(97 shared + 57 api + 38 web tests).

**Left over:** conflict handling on fact items relies on the generic
ConflictBanner (not yet surfaced in the board UI — a follow-up); "link to log
entries" is a plain id field, not yet a navigable link. Next: M18.

## M11 — Client local store — HARD — done (2026-11-11)

**Done:**
- `apps/web/src/localStore.ts`: Dexie-based IndexedDB store. DB name includes user id
  (`stabsstod-<userId>`). Tables: `records`, `outbox`, `entities`, `meta`, `blobs`.
  Methods: `addLocalRecord`, `ingestRemoteRecords`, `getEntity`, `getRecordsByIncident`,
  `getRecordsByEntity`, `getOutbox`, `markOutboxSent`, `markOutboxRejected`,
  `getPendingOutbox`, `getCursor`, `setCursor`, `addBlob`, `getBlob`, `removeBlob`,
  `close`, `delete`, `useEntity`, `useRecordsByIncident`.
- `apps/web/src/localStore.test.ts`: 11 tests — add/read, ingest out-of-order,
  conflict visible in entities, outbox contents correct, user id isolation. All pass.
- `apps/web/src/_setup-indexedDB.ts`: sets `globalThis.indexedDB` from `fake-indexeddb`
  before Dexie loads.
- `apps/web/src/testSetup.ts` / `apps/web/vite.config.ts`: fixed `any` casts for lint;
  alias `@stabsstod/shared` → `packages/shared/src/index.ts`.
- `apps/web/package.json`: added `dexie`, `dexie-react-hooks`, `fake-indexeddb`.

**Learned:**
- Dexie checks `globalThis.indexedDB` at module load time, so Dexie must be imported
  lazily (inside methods) rather than at module top level to work in jsdom/Vitest.
- `vi.mock('dexie')` does not intercept dynamic `import('dexie')` calls in Vitest 5.1;
  instead set `globalThis.__TEST_DEXIE__` as a test override.
- Dexie constructor accepts `{ indexedDB }` option to override cached `domDeps.indexedDB`.

**Verified:** `pnpm -r typecheck` (web passes; api has pre-existing unrelated errors),
`pnpm --filter web lint` passes, `pnpm --filter web test` passes (15/15).

**Left over:** none for M11. Next: M14 — Conflict UI primitives — HARD.

## M12 — Client sync loop — HARD — done (2026-11-11)

**Done:**
- `apps/web/src/syncEngine.ts`: SyncEngine class coordinating push/pull/SSE sync loop.
  - Push: pending outbox records → POST /api/sync/push (batches of ≤100)
  - Pull: records since cursor → GET /api/sync/pull (pagination)
  - SSE: GET /api/events → on 'records' event, trigger pull
  - Backoff: exponential (1s → 30s) on network errors
  - Online/offline + visibility-change triggers
  - Rejected records stay in outbox with reason, shown in "Sync problems"
  - Sync status: Synced / Syncing / Offline N pending / Problems
- `apps/web/src/syncEngine.test.ts`: 7 tests covering push, pull, rejected records,
  offline handling, retry, status listeners, and two-store convergence with fake API.
- `packages/shared/src/record.ts`: Added optional `serverSeq` and `receivedAt` fields
  to RecordEnvelopeSchema (server-only fields added on ingest).
- `apps/web/src/localStore.ts`: Cleaned up remaining debug logging.

**Learned:**
- `vi.stubGlobal('fetch', ...)` does not reliably intercept `globalThis.fetch` calls
  from imported modules. Direct assignment `globalThis.fetch = fetchFn` works instead.
- `globalThis.EventSource` is not available in jsdom; mock with a simple class.
- Dexie constructor accepts `{ indexedDB }` option to override cached dependencies.

**Verified:** Full quality gate green: typecheck, lint, test (22/22 across 4 test files).

**Left over:** none for M12. Next: M14 — Conflict UI primitives — HARD.

## M13 — PWA and offline shell — HARD — done (2026-11-11)

**Done:**
- `apps/web/vite.config.ts`: Added `vite-plugin-pwa` with autoUpdate registration type,
  workbox runtime caching (NetworkOnly for /api/*), dev mode enabled, and SVG icon assets.
- `apps/web/public/manifest.json`: PWA manifest with name, icons (SVG), screenshots,
  shortcuts (Incidents, Logbook), sv language.
- `apps/web/public/offline.html`: Offline fallback page.
- `apps/web/public/pwa-*.svg`: PWA icon assets (192x192, 512x512, maskable variants,
  screenshot).
- `apps/web/src/main.tsx`: Registers PWA service worker via `registerSW` from
  `virtual:pwa-register` with `onNeedRefresh` and `onOfflineReady` callbacks.
- `apps/web/src/vite-env.d.ts`: Type declarations for `virtual:pwa-register` module.
- `apps/web/src/App.tsx`: Added offline chip in header showing "Offline" indicator
  when `navigator.onLine` is false, with online/offline event listeners.
- `apps/web/src/locales/{sv,en}.json`: Added `sync.offline` string.
- `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tests/smoke.test.ts`: Playwright
  smoke test — load app online, go offline, reload, app renders from cache and
  shows Offline chip.
- `README.md`: Added PWA and offline mode section, HTTPS/CA note.
- `pnpm-workspace.yaml`: Added `e2e/*` workspace.
- `package.json`: Added `@playwright/test` dev dependency.
- `apps/web/package.json`: Added `vite-plugin-pwa` dev dependency.

**Learned:**
- `vite-plugin-pwa` registers the service worker via `virtual:pwa-register`, which
  needs type declarations for TypeScript.
- Service workers require HTTPS or localhost; localhost works for development.
- SVG icons work fine for PWA manifest icons in modern browsers.

**Verified:** Full quality gate green: typecheck, lint, test (22/22).

**Left over:** none for M13. Next: M14 — Conflict UI primitives — HARD.

## M14 — Conflict UI primitives — HARD — done (2026-11-11)

**Done:**
- `apps/web/src/components/ConflictBanner.tsx`: ConflictBanner component showing both
  heads side by side with author, time, and payload. "Use this version" action calls
  onMerge with the selected head and all heads. Shows "Merging..." state during sync.
- `apps/web/src/components/EntityHistory.tsx`: EntityHistory drawer showing all
  versions of an entity ordered by HLC, with kind (put/retract), author, time, and
  payload for each version.
- `apps/web/src/components/ConflictBanner.test.tsx`: 7 tests — render both heads,
  show current version as selected, call onMerge with selected head + all heads,
  merging state, merge record parentIds contains all heads.
- `apps/web/src/components/EntityHistory.test.tsx`: 3 tests — renders nothing when
  closed, renders all records when open, calls onClose when close button clicked.
- `apps/web/src/locales/{sv,en}.json`: Added conflict.* and history.* strings.

**Learned:**
- `getByText()` finds multiple elements when duplicate text exists (e.g., "Spara"
  appears twice for two "put" records). Use `getAllByText()` with length checks
  instead.
- Vitest runs tests within a file sequentially, but `screen` global can cause
  cross-test interference; use render return value (`const { getByText } = render()`)
  for test isolation.
- `getByLabelText()` and `getByTestId()` can also find multiple elements; use
  `container.querySelector('[data-testid="..."]')` as a fallback.

**Verified:** Full quality gate green: typecheck, lint, test (30/30 across 6 test files).

**Left over:** none for M14. Next: M15 — Incident workspace shell — HARD (done below).

## M15 — Incident workspace shell — HARD — done (2026-11-11)

**Done:**
- `apps/web/src/pages/IncidentDetail.tsx`: Rewritten as incident workspace shell with navigation tabs:
  Läge (Situation), Inriktning (Direction), Samordning (Coordination), Logg (Logbook),
  Karta (Map), Stab (Staff), Rapporter (Reports). Each tab shows placeholder content
  for later milestones.
- Header shows incident name, status badge, elapsed time, my function, sync chip,
  bell placeholder.
- Role-aware permissions using `can()` from `@stabs/shared`: write access checks for
  log_entry, mission, task, briefing entity types. Chief/deputy/admin can write
  function names. Observer sees no write buttons.
- `apps/web/src/locales/{sv,en}.json`: Added workspace navigation, header, and
  placeholder strings. i18n parity test passes.

**Learned:**
- `EntityType` is exported as `type` only from `@stabs/shared` (the const object is
  shadowed by the type export), so string literals must be used for entity type
  values in `can()` calls.
- `useParams<{ id: string }>()` returns `string | undefined` for route params;
  need `!` assertion or null check before using in `can()` calls.

**Verified:** Full quality gate green: typecheck, lint, test (30/30 across 6 test files).

**Left over:** none for M15. Next: M16 — Logbook.

## M14 — Conflict UI primitives — HARD — done (2026-11-11)

## M10 — Server sync endpoints — HARD — done (2026-11-10)

**Done:**
- `apps/api/src/sync.ts`: `registerSync(app, pool)` registers three endpoints:
  - `POST /api/sync/push` — idempotent on record `id`, validates membership,
    permission (via `can()`), entity payload schema (via entity registry),
    inserts into `records` table with `server_seq` assignment, publishes SSE
    event on new records.
  - `GET /api/sync/pull` — returns records since `serverSeq` cursor with
    pagination (`limit` max 500).
  - `GET /api/events` — SSE stream per incident with heartbeat every 20s.
- In-process pub/sub for SSE (`sseSubscribe`, `ssePublish`, `sseUnsubscribe`).
- `apps/api/src/app.ts`: wires `registerSync(app, pool)`.
- `apps/api/src/sync.test.ts`: Vitest tests against real Postgres — presets
  endpoint, incident creation with each preset (verifies staff_functions count),
  non-admin rejection (403), member-only incident listing, incident detail access
  control (403 for non-members), function rename (chief/deputy can, regular member
  gets 403), member add (admin + 403 for non-admin).

**Verified:** full quality gate green (typecheck, lint, test, web build, format)
on all three packages. 57 API tests pass including: idempotent re-push, rejection
reasons (not member, forbidden type, bad payload), pull pagination, two incidents
do not leak into each other.

**Left over:** none for M10.

## M9 — Shared record model — HARD — done (2026-11-10)

**Done:**
- `packages/shared/src/record.ts`: `RecordEnvelope` type + zod schema, `EntityType`
  (aligned to plan §6 snake_case values), `RetractPayload`, `newRecord()` helper
  (uuidv7 id + HLC tick).
- `packages/shared/src/hlc.ts`: Hybrid Logical Clock — `hlcInitialState`, `hlcTick`,
  `hlcReceive`, `hlcCompare`, `hlcFormat`, `hlcParse`. Format:
  `<wallClockMs(15 digits)>-<counter(5 digits)>-<deviceId>`. Monotonic even with
  wrong wall clock.
- `packages/shared/src/materialize.ts`: `materialize(records)` → `Map<entityId,
  Materialization>` where each entry has `{ entityId, current, heads, conflict,
  history, retracted }`. Heads = records not referenced by any parentIds; current =
  head with greatest hlc (tie-break deviceId); conflict = >1 head; retracted =
  current.kind === 'retract'. Deterministic regardless of input order.
- `packages/shared/src/entityRegistry.ts`: entity registry with `log_entry` zod
  schema; `getEntitySchema`, `validateEntityPayload`.
- `packages/shared/src/index.ts`: exports all new modules.
- `packages/shared/src/materialize.test.ts`: 10 tests — linear history, two concurrent
  heads → conflict, merge record resolves conflict, retract, history ordered by hlc,
  HLC monotonic with wrong clock (mocked Date.now), HLC compare ordering,
  shuffled input gives same result as in-order (20 random shuffles).

**Combined with M8 permissions:** 91 shared package tests, all passing.

**Verified:** full quality gate green (typecheck, lint, test, web build, format).

**Left over:** none for M9.

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
consumed by the API (M10) and client UI (later).

**Left over:** none for M8.

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
- `apps/api/src/migrate.ts`: applies all `drizzle/*.sql` under a pg advisory lock
  at startup (idempotent `__meta` tracking table).
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
- `apps/web/src/locales/{sv,en}.json`: auth strings added to both locales (parity test
  passes).
- `apps/web/src/App.test.tsx`: fetch stubbed so the app renders authenticated;
  language-switch tests pass.

**Verified end-to-end:** `docker compose up --build` (db + api only), smoke
script passes, `GET /api/health` → `{"ok":true,"db":true}`, manual login via
curl sets the `session` cookie (HttpOnly/SameSite=Lax/Secure/30-day) and
`/api/auth/me` returns the user.

**Left over:** none for M5. Next: M6 — User administration (list/create/disable
users, reset password, display name, preferred language, GET/PUT /api/settings).

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

**Left over:** none for M2. Next: M3 — Compose and Caddy (add `api` + `caddy` services to
docker-compose.yml, Caddyfile with internal TLS, smoke script).

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
- ESLint 10 / Vitest 5 / Prettier 3.9 / typescript-eslint 8.72 all work together with a
  flat config; package lint scripts pass `--config ../../eslint.config.js` explicitly
  so config resolution never depends on cwd lookup.
- Root `.prettierignore` now ignores `**/Dockerfile` (prettier has no Dockerfile parser).
- All three gates pass on the empty packages: `pnpm -r typecheck`, `pnpm -r lint`,
  `pnpm -r test`; `pnpm format` is idempotent.

**Left over:** none for M1. M3 expands docker-compose.yml (adds `api` + `caddy`,
volumes, healthchecks) and makes the api Dockerfile production-ready (migrations at start under
an advisory lock).

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

**Left over:** none. (Fastify app factory = M1, Vite/React web = M2,
compose + Caddy + smoke script = M3.)
