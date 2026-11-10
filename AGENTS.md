# AGENTS.md

This repo is built spec-driven from `plan.md` — a self-hosted, offline-first support system for an incident management staff ("Stabsstöd"). The plan is the source of truth for requirements; do not invent your own.

## Working with plan.md
- It is long (~500 lines). **Do not load the whole file.**
- Once at project start: read sections 1–3. Each work session: section 4 (stack), the part of section 5 relevant to the milestone, and **the current milestone** in section 10.
- Locate milestones: `grep -n '^## M' plan.md`, then read just that line range.
- Never edit `plan.md` unless a milestone says so.

## Progress, questions, commits
- Progress is tracked in `PROGRESS.md` (created in M0). If it doesn't exist yet, the project hasn't started; do M0.
- Open questions / decisions the owner must make go in `QUESTIONS.md`.
- Milestones run in order; one commit each, message `M<n>: <title>`.
- **HARD milestones (M9–M12, M29, M30):** slow down, write tests first, prefer simple over clever. After two honest attempts at a problem, record it in `QUESTIONS.md` instead of churning.

## Phase map (details in plan.md §10)
0 Foundation (scaffold, API/web skeletons, Caddy) → 1 Identity & structure (auth, users, incidents, permissions) → 2 **Sync engine** (record model, push/pull/SSE, Dexie store, PWA, conflicts) → 3 Core modules (logbook, facts, situation, mission, decisions, tasks, timeline, briefings, shifts, actors, resources, attachments) → 4 Map (PMTiles, drawing, places) → 5 Dashboards, notifications, exports → 6 Hardening (wall display, ops, offline E2E, docs).

## Non-negotiables (full list in plan.md §2)
- Works with **no internet at runtime**: no CDN scripts, no Google Fonts, no external tiles/glyphs. All assets self-hosted (Caddy + `data/`).
- **Offline-first:** writes go to local Dexie (records + outbox) first, then sync; nothing is silently lost or dropped.
- **Append-only** operational data: every change is a new versioned `RecordEnvelope`; "delete" = a `retract` record with reason. Postgres triggers reject UPDATE/DELETE on `records` — never alter or remove rows.
- **sv/en i18n from day one:** every user-facing string via `t('key')`, resources in `apps/web/src/locales/{sv,en}.json`, Swedish default. A unit test fails on key-set mismatch — add both.
- **TypeScript strict, stack is fixed** (plan.md §4): pnpm workspaces, Fastify 5 + zod, PostgreSQL 16 + Drizzle (**no PostGIS in v1**), React + Vite + Tailwind, Dexie, MapLibre + PMTiles, Caddy 2, Vitest, Playwright (one offline E2E suite only). Do not substitute libraries.

## Commands
- Packages: `packages/shared` (pure logic, no framework deps), `apps/api`, `apps/web`, `e2e/`.
- Quality gate for **every** milestone (plan.md §9): `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` — all must pass, plus new tests for new behaviour.
- If the milestone touches Docker/Caddy: `docker compose build` and `scripts/smoke.sh` must pass too.
- API tests: Fastify `inject` against a **real** test Postgres (`docker compose up db`), not mocks.
- Dexie tests use `fake-indexeddb`.
- Install deps with `pnpm add <pkg>` so the lockfile gets real versions — never write versions from memory into `package.json`. Unsure about a library API? Read its `.d.ts` in `node_modules` before writing code.

## Architecture anchors (not obvious from filenames)
- The hard core lives in `packages/shared/src/`: `RecordEnvelope`, HLC (`tick`/`receive`), `materialize(records)` → heads/conflict/current, entity zod schemas, and `can()` — one pure permission function used by **both** server (authoritative) and client (hide/disable UI). Keep these pure and heavily unit-tested.
- Sync flow: client → Dexie outbox → `POST /api/sync/push` (server assigns `serverSeq`, idempotent on `id`) → pull via `GET /api/sync/pull?since=` → live updates via SSE `GET /api/events`. Unknown parent ids are not errors.
- Local Dexie DB name includes the user id: `stabsstod-<userId>`.
- Times are stored UTC, displayed `Europe/Stockholm`, 24h clock.
- Service workers require HTTPS: Caddy `tls internal` — the root CA must be installed on client devices or offline mode won't work. Document it, and show an in-app diagnostic.

## Repo state
- Pre-M0: this repo currently contains only `plan.md` (and this file). M0 scaffolds the workspace, tooling, `PROGRESS.md`, `QUESTIONS.md`, and does `git init` + first commit.
- `data/` (maps, backups, attachments) is git-ignored; `.env` from `.env.example`.
