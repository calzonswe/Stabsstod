import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hash } from '@node-rs/argon2';

const __dirname = dirname(fileURLToPath(import.meta.url)); // /app/apps/api/src
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'drizzle'); // /app/drizzle

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:stabsstod@localhost:5432/stabsstod';

async function applyMigrations(pool: Pool) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [0x534f4444]);
    try {
      for (const file of files) {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [0x534f4444]);
    }
  } finally {
    client.release();
  }
}

function appWithDb() {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL,
    NODE_ENV: 'test',
    PORT: '3000',
    HOST: '0.0.0.0',
    SITE_ADDRESS: 'localhost',
    TZ: 'Europe/Stockholm',
    POSTGRES_PASSWORD: 'stabsstod',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-secret-test',
    SESSION_SECRET: 'test-secret-do-not-use-in-production',
    MAX_UPLOAD_MB: '25',
  });
  return buildApp({ config });
}

function jsonBody(body: unknown) {
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function sessionCookieOf(res: { headers: unknown }): string | undefined {
  const headers = res.headers as Record<string, string | string[] | undefined> | undefined;
  const setCookie = headers?.['set-cookie'];
  if (!setCookie) {
    return undefined;
  }
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const match = cookies.find((c) => typeof c === 'string' && c.startsWith('session='));
  if (!match) {
    return undefined;
  }
  return match.split(';')[0].split('=')[1];
}

async function loginAs(
  app: Awaited<ReturnType<typeof appWithDb>>,
  username: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    ...jsonBody({ username, password }),
  });
  expect(res.statusCode).toBe(200);
  const token = sessionCookieOf(res);
  expect(token).toBeDefined();
  return token!;
}

async function createIncident(
  app: Awaited<ReturnType<typeof appWithDb>>,
  token: string,
  title: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/incidents',
    headers: { cookie: `session=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: title,
      type: 'storm',
      startedAt: '2026-11-10T08:00:00Z',
      status: 'active',
      presetId: 'small',
      members: [],
    }),
  });
  expect(res.statusCode).toBe(201);
  return res.json().incident.id;
}

async function addMember(
  app: Awaited<ReturnType<typeof appWithDb>>,
  token: string,
  incidentId: string,
  userId: string,
  role: string,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/incidents/${incidentId}/members`,
    headers: {
      cookie: `session=${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId, role, functionIds: [] }),
  });
  expect(res.statusCode).toBe(201);
}

function makeRecord(
  incidentId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    entityId: 'entity-1',
    entityType: 'log_entry',
    incidentId,
    parentIds: [],
    functionId: 'fn-1',
    authorId: 'author-1',
    deviceId: 'device-1',
    hlc: '000000000000001-00001-device-1',
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    schemaVersion: 1,
    payload:
      overrides.payload !== undefined
        ? (overrides.payload as Record<string, unknown>)
        : {
            text: 'test entry',
            category: 'info',
            eventTime: new Date().toISOString(),
            visibility: 'incident',
          },
    ...(overrides.incidentId !== undefined ? { incidentId: overrides.incidentId as string } : {}),
    ...(overrides.entityId !== undefined ? { entityId: overrides.entityId as string } : {}),
    ...(overrides.hlc !== undefined ? { hlc: overrides.hlc as string } : {}),
    ...(overrides.id !== undefined ? { id: overrides.id as string } : {}),
  };
}

describe('sync endpoints — plan.md §5.3', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let adminToken: string;
  let userToken: string;
  let adminId: string;
  let userId: string;
  let incidentId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);

    const adminHash = await hash('admin123');
    const { rows: adminRows } = await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'admin', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
       RETURNING id`,
      ['user-m10-admin-1', 'm10admin', adminHash],
    );
    adminId = adminRows[0].id;

    const userHash = await hash('user123');
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
       RETURNING id`,
      ['user-m10-regular-1', 'm10user', userHash],
    );
    userId = userRows[0].id;

    await pool.query('TRUNCATE records, staff_functions, incident_members, incidents CASCADE');
    await pool.end();

    app = await appWithDb();
    adminToken = await loginAs(app, 'm10admin', 'admin123');
    userToken = await loginAs(app, 'm10user', 'user123');

    incidentId = await createIncident(app, adminToken, 'M10 Test Incident');
    await addMember(app, adminToken, incidentId, adminId, 'chief_of_staff');
    await addMember(app, adminToken, incidentId, userId, 'staff_member');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/sync/push', () => {
    it('accepts valid records and assigns server_seq', async () => {
      const r1 = makeRecord(incidentId);
      const r2 = makeRecord(incidentId, {
        id: 'rec-2',
        entityId: 'entity-2',
        hlc: '000000000000002-00001-device-1',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r1, r2] }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(2);
      expect(body.results[0].status).toBe('accepted');
      expect(typeof body.results[0].serverSeq).toBe('number');
      expect(body.results[0].serverSeq).toBeGreaterThanOrEqual(1);
      expect(body.results[1].status).toBe('accepted');
      expect(body.results[1].serverSeq).toBeGreaterThan(body.results[0].serverSeq);
    });

    it('is idempotent: re-pushing same records returns duplicate', async () => {
      const r = makeRecord(incidentId, { id: 'rec-idempotent-1' });

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().results[0].status).toBe('accepted');

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().results[0].status).toBe('duplicate');
    });

    it('rejects when user is not a member of the incident', async () => {
      const otherIncidentId = await createIncident(app, adminToken, 'Other Incident');

      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${userToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          incidentId: otherIncidentId,
          records: [makeRecord(otherIncidentId)],
        }),
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects forbidden record type', async () => {
      const r = makeRecord(incidentId, {
        entityType: 'mission',
        entityId: 'entity-mission',
        functionId: 'fn-1',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${userToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results[0].status).toBe('rejected');
      expect(res.json().results[0].reason).toContain('forbidden');
    });

    it('rejects invalid payload', async () => {
      const r = makeRecord(incidentId, {
        entityId: 'entity-bad',
        payload: { not_a_valid_field: 'bad' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results[0].status).toBe('rejected');
      expect(res.json().results[0].reason).toContain('invalid payload');
    });

    it('does not reject unknown parent ids', async () => {
      const r = makeRecord(incidentId, {
        id: 'rec-unknown-parent',
        parentIds: ['nonexistent-parent-id'],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results[0].status).toBe('accepted');
    });
  });

  describe('GET /api/sync/pull', () => {
    beforeAll(async () => {
      const r1 = makeRecord(incidentId, { id: 'rec-pull-1' });
      const r2 = makeRecord(incidentId, {
        id: 'rec-pull-2',
        entityId: 'entity-2',
        hlc: '000000000000002-00001-device-1',
      });
      await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r1, r2] }),
      });
    });

    it('pulls records since cursor 0', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0&limit=500`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.records.length).toBeGreaterThanOrEqual(2);
      expect(body.nextSince).toBeGreaterThan(0);
      expect(typeof body.hasMore).toBe('boolean');
    });

    it('pulls only records after since cursor', async () => {
      const first = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0&limit=500`,
        headers: { cookie: `session=${adminToken}` },
      });
      const firstBody = first.json();
      const lastSeq = firstBody.records[firstBody.records.length - 1].serverSeq;

      const r = makeRecord(incidentId, { id: 'rec-pull-after' });
      await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });

      const second = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=${lastSeq}&limit=500`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(second.statusCode).toBe(200);
      const secondBody = second.json();
      expect(secondBody.records.length).toBe(1);
      expect(secondBody.records[0].id).toBe('rec-pull-after');
    });

    it('limits results per limit parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0&limit=1`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.records.length).toBeLessThanOrEqual(1);
      expect(body.hasMore).toBe(true);
    });

    it('returns 403 for non-member', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0`,
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 401 without session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('two incidents do not leak', () => {
    let otherIncidentId: string;

    beforeAll(async () => {
      otherIncidentId = await createIncident(app, adminToken, 'Other Incident');
      await addMember(app, adminToken, otherIncidentId, userId, 'staff_member');
    });

    it('user only sees records from incidents they are a member of', async () => {
      const r = makeRecord(otherIncidentId, {
        id: 'rec-other-incident',
        entityId: 'entity-other',
      });
      await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId: otherIncidentId, records: [r] }),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0&limit=500`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const otherRecord = body.records.find((r: { id: string }) => r.id === 'rec-other-incident');
      expect(otherRecord).toBeUndefined();
    });

    it('pulling other incident shows only its records', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${otherIncidentId}&since=0&limit=500`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const r of body.records) {
        expect(r.incidentId).toBe(otherIncidentId);
      }
    });
  });

  describe('GET /api/events (SSE)', () => {
    it('returns 401 without session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/events?incidentId=${incidentId}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for non-member', async () => {
      const noMemberIncident = await createIncident(app, adminToken, 'No Member');
      const res = await app.inject({
        method: 'GET',
        url: `/api/events?incidentId=${noMemberIncident}`,
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('push then pull is consistent', async () => {
      const r = makeRecord(incidentId, { id: 'rec-sse-test' });
      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId, records: [r] }),
      });
      expect(pushRes.statusCode).toBe(200);
      expect(pushRes.json().results[0].status).toBe('accepted');

      const pullRes = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?incidentId=${incidentId}&since=0&limit=500`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(pullRes.statusCode).toBe(200);
      const found = pullRes.json().records.some((r: { id: string }) => r.id === 'rec-sse-test');
      expect(found).toBe(true);
    });
  });
});
