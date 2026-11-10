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
