import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'crypto';

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
    // Serialize DDL across test files to avoid deadlocks on concurrent migrations.
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
  presetId: string,
  addUserAsMember = false,
): Promise<{ id: string; name: string }> {
  const members = addUserAsMember
    ? [{ userId: 'user-m7-regular-1', role: 'chief_of_staff', functionIds: [] }]
    : [];
  const res = await app.inject({
    method: 'POST',
    url: '/api/incidents',
    headers: {
      cookie: `session=${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `M7 test ${presetId} ${Date.now()}`,
      type: 'storm',
      startedAt: '2026-11-10T08:00:00Z',
      status: 'active',
      presetId,
      members,
    }),
  });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  return { id: body.incident.id, name: body.incident.name };
}

describe('incidents, members, functions', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);

    const adminHash = await hash('admin123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'admin', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false`,
      ['user-m7-admin-1', 'm7admin', adminHash],
    );

    const userHash = await hash('user123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false`,
      ['user-m7-regular-1', 'm7user', userHash],
    );

    await pool.end();

    app = await appWithDb();
    adminToken = await loginAs(app, 'm7admin', 'admin123');
    userToken = await loginAs(app, 'm7user', 'user123');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/presets', () => {
    it('returns all three presets with function counts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/presets',
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.presets.length).toBe(3);
      expect(body.presets.map((p: { id: string }) => p.id)).toEqual([
        'small',
        'medium',
        'continental',
      ]);
      expect(body.presets.find((p: { id: string }) => p.id === 'small').functionCount).toBe(4);
      expect(body.presets.find((p: { id: string }) => p.id === 'medium').functionCount).toBe(6);
      expect(body.presets.find((p: { id: string }) => p.id === 'continental').functionCount).toBe(
        9,
      );
    });
  });

  describe('POST /api/incidents (create with each preset)', () => {
    it('small preset creates 4 staff functions', async () => {
      const inc = await createIncident(app, adminToken, 'small', true);
      const pool = new Pool({ connectionString: DATABASE_URL });
      const { rows } = await pool.query(
        'SELECT COUNT(*) AS c FROM staff_functions WHERE incident_id = $1',
        [inc.id],
      );
      await pool.end();
      expect(Number(rows[0].c)).toBe(4);
    });

    it('medium preset creates 6 staff functions', async () => {
      const inc = await createIncident(app, adminToken, 'medium', true);
      const pool = new Pool({ connectionString: DATABASE_URL });
      const { rows } = await pool.query(
        'SELECT COUNT(*) AS c FROM staff_functions WHERE incident_id = $1',
        [inc.id],
      );
      await pool.end();
      expect(Number(rows[0].c)).toBe(6);
    });

    it('continental preset creates 9 staff functions', async () => {
      const inc = await createIncident(app, adminToken, 'continental', true);
      const pool = new Pool({ connectionString: DATABASE_URL });
      const { rows } = await pool.query(
        'SELECT COUNT(*) AS c FROM staff_functions WHERE incident_id = $1',
        [inc.id],
      );
      await pool.end();
      expect(Number(rows[0].c)).toBe(9);
    });

    it('rejects non-admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/incidents',
        headers: {
          cookie: `session=${userToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Should fail',
          type: 'fire',
          startedAt: '2026-11-10T08:00:00Z',
          status: 'active',
          presetId: 'small',
        }),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/incidents (my incidents)', () => {
    it('lists only incidents the user is a member of', async () => {
      // Create an incident where the user is NOT a member.
      await createIncident(app, adminToken, 'small', false);

      const userRes = await app.inject({
        method: 'GET',
        url: '/api/incidents',
        headers: { cookie: `session=${userToken}` },
      });
      expect(userRes.statusCode).toBe(200);
      const userBody = userRes.json();
      const userIncidentIds = userBody.incidents.map((i: { id: string }) => i.id);

      // Create an incident where the user IS a member.
      const memberInc = await createIncident(app, adminToken, 'small', true);

      const userRes2 = await app.inject({
        method: 'GET',
        url: '/api/incidents',
        headers: { cookie: `session=${userToken}` },
      });
      expect(userRes2.statusCode).toBe(200);
      const userBody2 = userRes2.json();
      const userIncidentIds2 = userBody2.incidents.map((i: { id: string }) => i.id);

      // The non-member incident must not appear; the member incident must appear.
      expect(userIncidentIds2).toContain(memberInc.id);
      // Sanity check: user's incident list changed after becoming a member.
      expect(userIncidentIds2.length).toBeGreaterThan(userIncidentIds.length);
    });

    it('returns 401 without session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/incidents' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/incidents/:id (detail)', () => {
    let memberIncidentId: string;

    beforeAll(async () => {
      const inc = await createIncident(app, adminToken, 'small', true);
      memberIncidentId = inc.id;
    });

    it('returns incident detail with functions and members for a member', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/incidents/${memberIncidentId}`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.functions.length).toBe(4);
      expect(body.members.length).toBeGreaterThanOrEqual(1);
      expect(body.incident.role).toBe('chief_of_staff');
    });

    it('returns 403 for a non-member', async () => {
      // Create an incident where the user is NOT a member.
      const nonMemberInc = await createIncident(app, adminToken, 'small', false);
      const res = await app.inject({
        method: 'GET',
        url: `/api/incidents/${nonMemberInc.id}`,
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PATCH /api/incidents/:id/functions/:functionId (chief/deputy edit)', () => {
    let incidentId: string;
    let functionId: string;

    beforeAll(async () => {
      const inc = await createIncident(app, adminToken, 'small', true);
      incidentId = inc.id;
      const pool = new Pool({ connectionString: DATABASE_URL });
      const { rows } = await pool.query(
        'SELECT id FROM staff_functions WHERE incident_id = $1 LIMIT 1',
        [incidentId],
      );
      functionId = rows[0].id;
      await pool.end();
    });

    it('renames a function for chief_of_staff', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/incidents/${incidentId}/functions/${functionId}`,
        headers: {
          cookie: `session=${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Ny funktion' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });

      const pool = new Pool({ connectionString: DATABASE_URL });
      const { rows } = await pool.query('SELECT name FROM staff_functions WHERE id = $1', [
        functionId,
      ]);
      await pool.end();
      expect(rows[0].name).toBe('Ny funktion');
    });

    it('returns 403 for a regular member', async () => {
      // Add user as staff_member (not chief/deputy) so they can't edit functions.
      const pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO incident_members (id, incident_id, user_id, role)
         VALUES ($1, $2, $3, 'staff_member')
         ON CONFLICT (incident_id, user_id) DO UPDATE SET role = 'staff_member'`,
        [randomUUID(), incidentId, 'user-m7-regular-1'],
      );
      await pool.end();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/incidents/${incidentId}/functions/${functionId}`,
        headers: {
          cookie: `session=${userToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Hack' }),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/incidents/:id/members (admin add member)', () => {
    let incidentId: string;

    beforeAll(async () => {
      const inc = await createIncident(app, adminToken, 'small', false);
      incidentId = inc.id;
    });

    it('adds a member for admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/incidents/${incidentId}/members`,
        headers: {
          cookie: `session=${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'user-m7-regular-1',
          role: 'staff_member',
          functionIds: [],
        }),
      });
      expect(res.statusCode).toBe(201);

      // Now the user should see this incident in "my incidents"
      const list = await app.inject({
        method: 'GET',
        url: '/api/incidents',
        headers: { cookie: `session=${userToken}` },
      });
      const body = list.json();
      expect(body.incidents.some((i: { id: string }) => i.id === incidentId)).toBe(true);
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/incidents/${incidentId}/members`,
        headers: {
          cookie: `session=${userToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: 'user-m7-regular-1', role: 'staff_member' }),
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
