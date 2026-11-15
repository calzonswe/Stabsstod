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

describe('admin users and settings', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let adminToken: string;
  let userToken: string;
  let regularUserId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);

    // Admin user
    const adminHash = await hash('admin123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'admin', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false`,
      ['user-admin-1', 'adminuser', adminHash],
    );

    // Regular user
    const userHash = await hash('user123');
    const { rows } = await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false
       RETURNING id`,
      ['user-regular-1', 'regularuser', userHash],
    );
    regularUserId = rows[0].id;

    // Reset settings to defaults for deterministic GET tests
    await pool.query(
      `INSERT INTO settings (key, value) VALUES
       ('timezone', '"Europe/Stockholm"'),
       ('map.onlineTileUrl', 'null'),
       ('maxUploadMB', '25'),
       ('wall.rotateEverySeconds', '30')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    await pool.end();

    app = await appWithDb();
    adminToken = await loginAs(app, 'adminuser', 'admin123');
    userToken = await loginAs(app, 'regularuser', 'user123');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/admin/users', () => {
    it('lists users for admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/admin/users', () => {
    const uniqueUser = `newuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    it('creates a user for admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          username: uniqueUser,
          password: 'newpass123',
          displayName: 'New User',
          role: 'user',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user.username).toBe(uniqueUser);
      expect(body.user.role).toBe('user');
      expect(body.user.display_name).toBe('New User');
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { cookie: `session=${userToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'newuser2',
          password: 'newpass123',
        }),
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects duplicate username', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          username: uniqueUser,
          password: 'x',
        }),
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('PATCH /api/admin/users/:id/disable', () => {
    it('disables a user for admin', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${regularUserId}/disable`,
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });

      // Disabled user can no longer log in
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody({ username: 'regularuser', password: 'user123' }),
      });
      expect(login.statusCode).toBe(401);

      // Re-enable so subsequent 403 tests for this user still work
      const reenablePool = new Pool({ connectionString: DATABASE_URL });
      await reenablePool.query('UPDATE users SET disabled = false WHERE id = $1', [regularUserId]);
      await reenablePool.end();
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${regularUserId}/disable`,
        headers: { cookie: `session=${userToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: false }),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/admin/users/:id/reset-password', () => {
    it('resets password and returns temp password for admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${regularUserId}/reset-password`,
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(typeof body.tempPassword).toBe('string');
      expect(body.tempPassword.length).toBeGreaterThan(0);

      // Temp password works
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody({ username: 'regularuser', password: body.tempPassword }),
      });
      expect(login.statusCode).toBe(200);
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${regularUserId}/reset-password`,
        headers: { cookie: `session=${userToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PATCH /api/admin/users/:id', () => {
    it('updates display name and role for admin', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${regularUserId}`,
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated Name', role: 'admin' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });

      const list = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: `session=${adminToken}` },
      });
      const updated = list.json().users.find((u: { id: string }) => u.id === regularUserId);
      expect(updated.display_name).toBe('Updated Name');
      expect(updated.role).toBe('admin');

      // Reset regularuser back to non-admin so later 403 tests still apply
      const resetPool = new Pool({ connectionString: DATABASE_URL });
      await resetPool.query('UPDATE users SET role = $1 WHERE id = $2', ['user', regularUserId]);
      await resetPool.end();
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${regularUserId}`,
        headers: { cookie: `session=${userToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'x' }),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/settings', () => {
    it('returns settings', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { cookie: `session=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.timezone).toBe('Europe/Stockholm');
      expect(body.map.onlineTileUrl).toBeNull();
      expect(body.maxUploadMB).toBe(25);
      expect(body.wallRotateEverySeconds).toBe(30);
    });
  });

  describe('PUT /api/settings', () => {
    it('updates settings for admin', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { cookie: `session=${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          timezone: 'America/New_York',
          map: { onlineTileUrl: 'https://example.com/tiles/{z}/{x}/{y}.pbf' },
          maxUploadMB: 50,
          wallRotateEverySeconds: 45,
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });

      const get = await app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { cookie: `session=${adminToken}` },
      });
      const body = get.json();
      expect(body.timezone).toBe('America/New_York');
      expect(body.map.onlineTileUrl).toBe('https://example.com/tiles/{z}/{x}/{y}.pbf');
      expect(body.maxUploadMB).toBe(50);
      expect(body.wallRotateEverySeconds).toBe(45);
    });

    it('returns 403 for non-admin', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { cookie: `session=${userToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ maxUploadMB: 10 }),
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
