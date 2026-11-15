// M36 — Wind-down and evaluation: closed-incident permission tests.
//
// Accept: server rejects new operational records on a closed incident
// except evaluation records. Runs against a real test Postgres via Fastify
// inject (no mocks).

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

function sessionCookieOf(res: { headers: unknown }): string | undefined {
  const headers = res.headers as Record<string, string | string[] | undefined> | undefined;
  const setCookie = headers?.['set-cookie'];
  if (!setCookie) return undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const match = cookies.find((c) => typeof c === 'string' && c.startsWith('session='));
  if (!match) return undefined;
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
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
    functionId: null,
    authorId: 'author-1',
    deviceId: 'device-1',
    hlc: '000000000000001-00001-device-1',
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    schemaVersion: 1,
    payload: {
      text: 'test entry',
      category: 'info',
      eventTime: new Date().toISOString(),
      visibility: 'incident',
    },
    ...(overrides.incidentId !== undefined ? { incidentId: overrides.incidentId as string } : {}),
    ...(overrides.entityId !== undefined ? { entityId: overrides.entityId as string } : {}),
    ...(overrides.entityType !== undefined ? { entityType: overrides.entityType as string } : {}),
    ...(overrides.hlc !== undefined ? { hlc: overrides.hlc as string } : {}),
    ...(overrides.id !== undefined ? { id: overrides.id as string } : {}),
    ...(overrides.payload !== undefined ? { payload: overrides.payload } : {}),
    ...(overrides.functionId !== undefined ? { functionId: overrides.functionId } : {}),
    ...(overrides.authorId !== undefined ? { authorId: overrides.authorId } : {}),
    ...(overrides.kind !== undefined ? { kind: overrides.kind } : {}),
  };
}

describe('M36 — closed incident permissions', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let adminToken: string;
  let incidentId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);

    const adminHash = await hash('admin123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'admin', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
       RETURNING id`,
      ['user-m36-admin-1', 'm36admin', adminHash],
    );

    await pool.query('TRUNCATE records, staff_functions, incident_members, incidents CASCADE');
    await pool.end();

    app = await appWithDb();
    adminToken = await loginAs(app, 'm36admin', 'admin123');
    incidentId = await createIncident(app, adminToken, 'M36 Wind-down Test Incident');
    // The creator is automatically chief_of_staff.
  });

  afterAll(async () => {
    await app.close();
  });

  async function pushRecords(
    records: Record<string, unknown>[],
    token: string,
  ): Promise<{ status: string; reason?: string }[]> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: {
        cookie: `session=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ incidentId, records }),
    });
    expect(res.statusCode).toBe(200);
    return res.json().results;
  }

  it('accepts operational records while incident is active', async () => {
    const results = await pushRecords(
      [makeRecord(incidentId, { entityType: 'log_entry', id: 'rec-active-1' })],
      adminToken,
    );
    expect(results[0].status).toBe('accepted');
  });

  it('rejects operational records after incident is closed', async () => {
    // Close the incident directly in the DB.
    const pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(`UPDATE incidents SET status = 'closed' WHERE id = $1`, [incidentId]);
    await pool.end();

    const results = await pushRecords(
      [makeRecord(incidentId, { entityType: 'log_entry', id: 'rec-closed-1' })],
      adminToken,
    );
    expect(results[0].status).toBe('rejected');
    expect(results[0].reason).toContain('cannot write');
  });

  it('allows evaluation records on a closed incident', async () => {
    const results = await pushRecords(
      [
        makeRecord(incidentId, {
          entityType: 'evaluation',
          id: 'rec-eval-1',
          payload: {
            why: 'Varför ska vi utvärdera?',
            what: 'Vad ska utvärderas?',
            whoAffected: 'Vilka är berörda?',
            how: 'Hur ska utvärderingen gå till?',
            useOfResult: 'Hur ska vi använda resultatet?',
            learnings: ['Lärdom 1'],
          },
        }),
      ],
      adminToken,
    );
    expect(results[0].status).toBe('accepted');
  });

  it('still rejects log_entry after evaluation on closed incident', async () => {
    const results = await pushRecords(
      [makeRecord(incidentId, { entityType: 'log_entry', id: 'rec-closed-2' })],
      adminToken,
    );
    expect(results[0].status).toBe('rejected');
  });
});
