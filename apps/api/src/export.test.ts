// Archive export tests — plan.md §10 / M35.
//
// Accept: export contains every record exactly once; access restricted to
// chief_of_staff / deputy_chief. The ZIP-building logic (`buildArchive`)
// is tested directly with real Buffers; the HTTP route is tested for status
// codes and headers. Runs against a real test Postgres via Fastify inject
// (no mocks).

import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hash } from '@node-rs/argon2';
import { buildArchive, type ExportRecord, type AttachmentFile } from './export.js';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url)); // /app/apps/api/src
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'drizzle'); // /app/drizzle
const ATTACHMENTS_DIR = join(__dirname, '..', '..', 'test-attachments');

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
    ATTACHMENTS_DIR,
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

describe('buildArchive (M35)', () => {
  beforeAll(() => {
    rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
  });

  it('builds a ZIP whose records.json contains every record exactly once', async () => {
    const now = new Date('2026-11-14T12:00:00Z').toISOString();
    const records: ExportRecord[] = [
      {
        id: 'rec-log-1',
        entityId: 'entity-log-1',
        entityType: 'log_entry',
        incidentId: 'incident-1',
        parentIds: [],
        functionId: null,
        authorId: 'author-1',
        deviceId: 'device-1',
        hlc: '000000000000001-00001-device-1',
        createdAtClient: now,
        kind: 'put',
        schemaVersion: 1,
        payload: { text: 'Första loggpost', category: 'event', eventTime: now, visibility: 'incident' },
        serverSeq: 1,
        receivedAt: now,
      },
      {
        id: 'rec-decision-1',
        entityId: 'entity-decision-1',
        entityType: 'decision',
        incidentId: 'incident-1',
        parentIds: [],
        functionId: null,
        authorId: 'author-1',
        deviceId: 'device-1',
        hlc: '000000000000002-00001-device-1',
        createdAtClient: now,
        kind: 'put',
        schemaVersion: 1,
        payload: {
          text: 'Beslut om förstärkning',
          rationale: 'Lägesbilden kräver det',
          decidedByUserId: 'author-1',
          decidedAt: now,
          mandate: 'delegated_chief',
        },
        serverSeq: 2,
        receivedAt: now,
      },
      {
        id: 'rec-task-1',
        entityId: 'entity-task-1',
        entityType: 'task',
        incidentId: 'incident-1',
        parentIds: [],
        functionId: 'fn-1',
        authorId: 'author-1',
        deviceId: 'device-1',
        hlc: '000000000000003-00001-device-1',
        createdAtClient: now,
        kind: 'put',
        schemaVersion: 1,
        payload: {
          title: 'Avspärrning',
          description: 'Avspärrning av byggnad',
          assigneeFunctionId: 'fn-1',
          priority: 'high',
          status: 'todo',
          reportForm: 'none',
        },
        serverSeq: 3,
        receivedAt: now,
      },
    ];

    const zip = await buildArchive(records, []);
    const adm = new AdmZip(zip);
    const entryNames = adm.getEntries().map((e) => e.entryName);

    expect(entryNames).toContain('records.json');
    expect(entryNames).toContain('log.csv');
    expect(entryNames).toContain('decisions.csv');
    expect(entryNames).toContain('tasks.csv');

    const recordsJson = JSON.parse(adm.readAsText('records.json'));
    expect(recordsJson.length).toBe(3);
    const recordIds = recordsJson.map((r: { id: string }) => r.id);
    expect(recordIds).toEqual(['rec-log-1', 'rec-decision-1', 'rec-task-1']);

    // Every record exactly once — no duplicates.
    const allIds = recordsJson.map((r: { id: string }) => r.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('includes attachments referenced by the incident', async () => {
    const hash = 'a1b2c3d4e5f6071829304a5b6c7d8e9f0a1b2c3d4e5f6071829304a5b6c7d8e9';
    writeFileSync(join(ATTACHMENTS_DIR, hash), Buffer.from('attachment contents'));

    const records: ExportRecord[] = [
      {
        id: 'rec-attachment-1',
        entityId: 'entity-attachment-1',
        entityType: 'attachment',
        incidentId: 'incident-1',
        parentIds: [],
        functionId: null,
        authorId: 'author-1',
        deviceId: 'device-1',
        hlc: '000000000000004-00001-device-1',
        createdAtClient: new Date('2026-11-14T12:00:00Z').toISOString(),
        kind: 'put',
        schemaVersion: 1,
        payload: {
          filename: 'foto.jpg',
          mime: 'image/jpeg',
          size: 18,
          hash,
          linkedEntityIds: [],
        },
        serverSeq: 4,
        receivedAt: new Date('2026-11-14T12:00:00Z').toISOString(),
      },
    ];

    const attachments: AttachmentFile[] = [{ hash, path: join(ATTACHMENTS_DIR, hash) }];
    const zip = await buildArchive(records, attachments);
    const adm = new AdmZip(zip);
    const entryNames = adm.getEntries().map((e) => e.entryName);

    expect(entryNames).toContain(`attachments/${hash}`);
    const entry = adm.getEntry(`attachments/${hash}`);
    expect(entry).not.toBeNull();
    expect(entry?.getData().toString()).toBe('attachment contents');
  });
});

describe('POST /api/export/archive — M35', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let adminToken: string;
  let userToken: string;
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
      ['user-m35-admin-1', 'm35admin', adminHash],
    );

    const userHash = await hash('user123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
       RETURNING id`,
      ['user-m35-regular-1', 'm35user', userHash],
    );

    await pool.query('TRUNCATE records, staff_functions, incident_members, incidents CASCADE');
    await pool.end();

    rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    app = await appWithDb();
    adminToken = await loginAs(app, 'm35admin', 'admin123');
    userToken = await loginAs(app, 'm35user', 'user123');

    incidentId = await createIncident(app, adminToken, 'M35 Export Test Incident');
    // The creator is automatically chief_of_staff.
  });

  afterAll(async () => {
    await app.close();
    rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
  });

  async function pushRecords(records: Record<string, unknown>[], token: string) {
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
    const body = res.json();
    expect(body.results.every((r: { status: string }) => r.status === 'accepted')).toBe(true);
    return body;
  }

  it('returns a ZIP with correct headers for chief_of_staff', async () => {
    await pushRecords(
      [makeRecord(incidentId, { id: 'rec-log-1', entityId: 'entity-log-1' })],
      adminToken,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/export/archive',
      headers: {
        cookie: `session=${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ incidentId }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(`sitrep-${incidentId}.zip`);
    // Body should start with the ZIP signature (PK).
    const bodyBuf = Buffer.from(res.body as string);
    expect(bodyBuf[0]).toBe(0x50);
    expect(bodyBuf[1]).toBe(0x4b);
  });

  it('rejects requests from users who are not incident members', async () => {
    const otherIncidentId = await createIncident(app, adminToken, 'Other Incident');
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/archive',
      headers: {
        cookie: `session=${userToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ incidentId: otherIncidentId }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects requests from members who are not chief or deputy', async () => {
    await pushRecords(
      [makeRecord(incidentId, { id: 'rec-user-1', entityId: 'entity-user-1' })],
      adminToken,
    );
    // Add user as a plain member (not chief/deputy).
    await app.inject({
      method: 'POST',
      url: `/api/incidents/${incidentId}/members`,
      headers: {
        cookie: `session=${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-m35-regular-1', role: 'function_lead', functionIds: [] }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/archive',
      headers: {
        cookie: `session=${userToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ incidentId }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('chief of staff or deputy');
  });
});
