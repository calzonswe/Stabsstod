# Known limitations — Stabsstöd v1

Honest limits from plan.md §11, plus defects carried across milestones.

## Sync correctness (riskiest part)

M9–M12 (shared record model, HLC, materialize, push/pull/SSE) is the
riskiest part of the system. The code is kept simple and well-tested; no
optimisation is done before tests pass.

## Service workers need HTTPS

Without the Caddy CA installed on client devices, offline mode will not work.
This is explained in the README and visible via an in-app diagnostic
("Offline support: active / not available — why").

## Map data size and glyph hosting

The usual reasons an "offline" map silently depends on the internet. M29
includes a test for local tile/glyph serving.

## Address-level search

May be too heavy for v1. City/place/kommun/län search is the fallback.

## Clock skew

HLC orders concurrent edits, but wall-clock times typed by users (event time)
are the user's responsibility.

## Local device data

Devices store data locally. On shared computers use the "wipe local data on
logout" option (warns if unsynced items exist).

## Not in v1

SSO, chat, need-to-know partitioning, multi-organisation, native apps, server
clustering, server-side PDF rendering.

## Carried defects (left over from earlier milestones)

These are known issues accepted into v1:

- **M30**: feature persistence after reload e2e test not yet written.
- **M31**: geo search sort order; `markAsAffected` bypasses the outbox;
  `Stockholms län` / `lan` fixture inconsistency.
- **API tests pollute runtime DB**: API tests run against a real test
  Postgres and can leave fixture data behind.
- **M18**: diff labels not shown in all conflict views.
- **M19**: conflict badge is plain (no per-field detail).
- **M20**: acknowledge action lacks a dedicated UI flow in some paths.

None of these block the v1 release criteria; they are tracked here so the
organisation is aware of them.
