// Attachment API tests — plan.md §5.6 / M28
//
// Accept: hash verification (client-computed sha256 verified server-side)
// and access control (session + incident membership required to download).

import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hash } from '@node-rs/argon2';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'drizzle');

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
    headers: { cookie: `session=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userId, role, functionIds: [] }),
  });
  expect(res.statusCode).toBe(201);
}

function makeAttachmentRecord(
  incidentId: string,
  hash: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    entityId: 'entity-attachment-1',
    entityType: 'attachment',
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
      filename: 'test.pdf',
      mime: 'application/pdf',
      size: 4,
      hash,
      linkedEntityIds: ['entity-1'],
    },
    ...overrides,
  };
}

// Build a multipart/form-data body with a file part and a hash field.
function makeMultipartBody(
  fileName: string,
  fileContent: string,
  hash: string,
): { body: string; headers: Record<string, string> } {
  const boundary = '----TestAttachmentBoundary';
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    'Content-Type: application/octet-stream',
    '',
    fileContent,
    `--${boundary}`,
    'Content-Disposition: form-data; name="hash"',
    '',
    hash,
    `--${boundary}--`,
  ].join('\r\n');
  return {
    body: parts,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('attachment endpoints — plan.md §5.6', () => {
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
      ['user-m28-admin-1', 'm28admin', adminHash],
    );
    adminId = adminRows[0].id;

    const userHash = await hash('user123');
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
       RETURNING id`,
      ['user-m28-regular-1', 'm28user', userHash],
    );
    userId = userRows[0].id;

    await pool.query('TRUNCATE records, staff_functions, incident_members, incidents CASCADE');
    await pool.end();

    app = await appWithDb();
    adminToken = await loginAs(app, 'm28admin', 'admin123');
    userToken = await loginAs(app, 'm28user', 'user123');

    incidentId = await createIncident(app, adminToken, 'M28 Test Incident');
    await addMember(app, adminToken, incidentId, adminId, 'chief_of_staff');
    await addMember(app, adminToken, incidentId, userId, 'staff_member');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/attachments', () => {
    it('accepts a file with a correct sha256 hash', async () => {
      const fileContent = 'hello attachment';
      const hash = createHash('sha256').update(fileContent).digest('hex');

      const { body, headers } = makeMultipartBody('test.txt', fileContent, hash);
      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { cookie: `session=${userToken}`, ...headers },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().hash).toBe(hash);
      expect(res.json().size).toBe(fileContent.length);
    });

    it('rejects a file with a wrong sha256 hash', async () => {
      const fileContent = 'hello attachment';
      const wrongHash = '0'.repeat(64);

      const { body, headers } = makeMultipartBody('test.txt', fileContent, wrongHash);
      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { cookie: `session=${userToken}`, ...headers },
        body,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('hash mismatch');
    });

    it('rejects a file without a hash field', async () => {
      const fileContent = 'hello attachment';
      // Body with file but no hash field.
      const boundary = '----TestAttachmentBoundary';
      const parts = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="test.txt"',
        'Content-Type: application/octet-stream',
        '',
        fileContent,
        `--${boundary}--`,
      ].join('\r\n');
      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: {
          cookie: `session=${userToken}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body: parts,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('hash field required');
    });

    it('rejects a file larger than MAX_UPLOAD_MB', async () => {
      const fileContent = 'x'.repeat(26 * 1024 * 1024); // 26 MB > 25 MB limit
      const hash = createHash('sha256').update(fileContent).digest('hex');

      const { body, headers } = makeMultipartBody('big.txt', fileContent, hash);
      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { cookie: `session=${userToken}`, ...headers },
        body,
      });
      expect(res.statusCode).toBe(413);
    });

    it('requires authentication', async () => {
      const fileContent = 'hello';
      const hash = createHash('sha256').update(fileContent).digest('hex');
      const { body, headers } = makeMultipartBody('test.txt', fileContent, hash);
      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers,
        body,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/attachments/:hash', () => {
    it('returns 404 when the file does not exist on disk', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/attachments/' + 'a'.repeat(64),
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('denies access to a user who is not a member of any incident referencing the hash', async () => {
      // Create another incident where the user is not a member.
      const otherIncidentId = await createIncident(app, adminToken, 'Other Incident');

      const fileContent = 'secret document';
      const hash = createHash('sha256').update(fileContent).digest('hex');

      // Create an attachment record in the other incident via sync/push.
      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          incidentId: otherIncidentId,
          records: [makeAttachmentRecord(otherIncidentId, hash)],
        }),
      });
      expect(pushRes.statusCode).toBe(200);

      // Upload the actual file.
      const { body: mBody, headers: mHeaders } = makeMultipartBody('secret.txt', fileContent, hash);
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { cookie: `session=${adminToken}`, ...mHeaders },
        body: mBody,
      });
      expect(uploadRes.statusCode).toBe(200);

      // The user is not a member of the other incident → denied.
      const res = await app.inject({
        method: 'GET',
        url: `/api/attachments/${hash}`,
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows access to a member of an incident referencing the hash', async () => {
      const fileContent = 'shared document';
      const hash = createHash('sha256').update(fileContent).digest('hex');

      // Create an attachment record in the incident the user is a member of.
      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          incidentId,
          records: [makeAttachmentRecord(incidentId, hash)],
        }),
      });
      expect(pushRes.statusCode).toBe(200);

      // Upload the actual file.
      const { body: mBody, headers: mHeaders } = makeMultipartBody('shared.txt', fileContent, hash);
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { cookie: `session=${adminToken}`, ...mHeaders },
        body: mBody,
      });
      expect(uploadRes.statusCode).toBe(200);

      // The user is a member → allowed, content matches.
      const res = await app.inject({
        method: 'GET',
        url: `/api/attachments/${hash}`,
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      const body = res.body as string;
      expect(body).toContain(fileContent);
    });

    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/attachments/' + 'a'.repeat(64),
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
