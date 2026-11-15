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

function jsonBody(username: string, password: string) {
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  };
}

describe('authentication', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);
    // Insert a test user with a known password.
    const passwordHash = await hash('password123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = EXCLUDED.must_change_password`,
      ['user-test-1', 'testuser', 'user', false, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = EXCLUDED.must_change_password`,
      ['user-ratelimit-1', 'ratelimit-user', 'user', false, passwordHash],
    );
    // M38: dedicated users for session management and password policy tests.
    // Their passwords satisfy the policy (12+ chars, letter + digit, not the
    // username) so individual violations can be asserted in isolation.
    const m38PasswordHash = await hash('currentpass99');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = EXCLUDED.must_change_password`,
      ['user-sessions-m38', 'sessions-user', 'user', false, m38PasswordHash],
    );
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = EXCLUDED.must_change_password`,
      ['user-policy-m38', 'policy-user', 'user', false, m38PasswordHash],
    );
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = EXCLUDED.must_change_password`,
      ['user-policy2-m38', 'policy2-user', 'user', false, m38PasswordHash],
    );
    await pool.end();

    app = await appWithDb();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/login', () => {
    it('rejects wrong password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'wrong'),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'invalid credentials' });
    });

    it('accepts correct password and sets a session cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'password123'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.username).toBe('testuser');
      expect(body.user.role).toBe('user');
      const token = sessionCookieOf(res);
      expect(token).toBeDefined();
      expect(token!.length).toBeGreaterThan(0);
    });

    it('rejects unknown user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('nosuchuser', 'password123'),
      });
      expect(res.statusCode).toBe(401);
    });

    it('rate-limits repeated failed logins per ip+username', async () => {
      // Use a dedicated user so earlier tests don't consume its rate-limit budget.
      // 5 failed attempts allowed
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          ...jsonBody('ratelimit-user', 'wrong'),
        });
        expect(res.statusCode).toBe(401);
      }
      // 6th is rate limited before credentials are checked
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('ratelimit-user', 'wrong'),
      });
      expect(res.statusCode).toBe(429);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without a session cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns the user for a valid session', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'password123'),
      });
      const token = sessionCookieOf(login);
      expect(token).toBeDefined();

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `session=${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        user: { username: 'testuser', role: 'user' },
      });
    });

    it('returns 401 for an invalid session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: 'session=does-not-exist' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('rejects wrong current password', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'password123'),
      });
      const token = sessionCookieOf(login)!;

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { cookie: `session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'newpassword456' }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('changes the password and clears must-change-password', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'password123'),
      });
      const token = sessionCookieOf(login)!;

      const change = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { cookie: `session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'password123',
          newPassword: 'newpassword456',
        }),
      });
      expect(change.statusCode).toBe(200);
      expect(change.json()).toMatchObject({ ok: true });

      // Can now log in with the new password
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'newpassword456'),
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 401 without a session cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'x', newPassword: 'y' }),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('testuser', 'newpassword456'),
      });
      const token = sessionCookieOf(login)!;

      const out = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: `session=${token}` },
      });
      expect(out.statusCode).toBe(200);
      expect(out.json()).toMatchObject({ ok: true });

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: `session=${token}` },
      });
      expect(me.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // M38: session management + password policy
  // ---------------------------------------------------------------------------

  describe('POST /api/auth/change-password policy (M38)', () => {
    async function loginAsPolicyUser() {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('policy-user', 'currentpass99'),
      });
      expect(login.statusCode).toBe(200);
      return sessionCookieOf(login)!;
    }

    async function tryChange(token: string, newPassword: string) {
      return app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { cookie: `session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'currentpass99', newPassword }),
      });
    }

    it('rejects a too-short new password', async () => {
      const res = await tryChange(await loginAsPolicyUser(), 'short1');
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('password_policy');
      expect(res.json().details).toContain('too_short');
    });

    it('rejects a new password without a digit', async () => {
      const res = await tryChange(await loginAsPolicyUser(), 'abcdefghijkl');
      expect(res.statusCode).toBe(400);
      expect(res.json().details).toContain('missing_digit');
    });

    it('rejects a new password without a letter', async () => {
      const res = await tryChange(await loginAsPolicyUser(), '123456789012');
      expect(res.statusCode).toBe(400);
      expect(res.json().details).toContain('missing_letter');
    });

    it('rejects a new password identical to the username', async () => {
      const res = await tryChange(await loginAsPolicyUser(), 'policy-user');
      expect(res.statusCode).toBe(400);
      expect(res.json().details).toContain('same_as_username');
    });

    it('rejects a new password identical to the current password', async () => {
      const res = await tryChange(await loginAsPolicyUser(), 'currentpass99');
      expect(res.statusCode).toBe(400);
      expect(res.json().details).toContain('same_as_current');
    });

    it('accepts a policy-clean new password', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('policy2-user', 'currentpass99'),
      });
      expect(login.statusCode).toBe(200);
      const token = sessionCookieOf(login)!;

      const change = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { cookie: `session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'currentpass99',
          newPassword: 'newpassword789',
        }),
      });
      expect(change.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('policy2-user', 'newpassword789'),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('session management (M38)', () => {
    const USER_AGENT = 'M38-TestAgent/1.0';

    it('GET /api/auth/sessions returns 401 without a session cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/sessions' });
      expect(res.statusCode).toBe(401);
    });

    it('lists the user\'s sessions and marks the current one', async () => {
      const login1 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('sessions-user', 'currentpass99'),
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      });
      const token1 = sessionCookieOf(login1)!;
      const login2 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('sessions-user', 'currentpass99'),
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      });
      const token2 = sessionCookieOf(login2)!;
      expect(token2).toBeDefined();
      expect(token2).not.toBe(token1);

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/sessions',
        headers: { cookie: `session=${token1}` },
      });
      expect(res.statusCode).toBe(200);
      const { sessions } = res.json();
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      const current = sessions.filter((s: { current: boolean }) => s.current);
      expect(current).toHaveLength(1);
      for (const s of sessions) {
        expect(s.createdAt).toBeDefined();
        expect(s.expiresAt).toBeDefined();
        expect(s.lastSeenAt).toBeDefined();
        expect(s.userAgent).toBe(USER_AGENT);
      }
    });

    it('DELETE /api/auth/sessions logs out every device', async () => {
      const login1 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('sessions-user', 'currentpass99'),
      });
      const token1 = sessionCookieOf(login1)!;
      const login2 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        ...jsonBody('sessions-user', 'currentpass99'),
      });
      const token2 = sessionCookieOf(login2)!;

      const out = await app.inject({
        method: 'DELETE',
        url: '/api/auth/sessions',
        headers: { cookie: `session=${token1}` },
      });
      expect(out.statusCode).toBe(200);
      expect(out.json()).toMatchObject({ ok: true });

      // Every session of the user is gone, including the one that acted.
      for (const token of [token1, token2]) {
        const me = await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: `session=${token}` },
        });
        expect(me.statusCode).toBe(401);
      }

      const pool = new Pool({ connectionString: DATABASE_URL });
      try {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n
           FROM sessions
           WHERE user_id = (SELECT id FROM users WHERE username = 'sessions-user')`,
        );
        expect(rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });

    it('DELETE /api/auth/sessions returns 401 without a session cookie', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/auth/sessions' });
      expect(res.statusCode).toBe(401);
    });
  });
});
