import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { randomUUID, createHash, randomInt } from 'crypto';
import { hash, verify } from '@node-rs/argon2';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ---------------------------------------------------------------------------
// Password policy (plan.md §10 / M38)
//
// A password must be:
//   - at least 12 characters long
//   - contain at least one letter and at least one digit
//   - not identical to the username (case-insensitive)
// When a password is changed, it must also differ from the current password
// (checked at the change-password endpoint, which has both values).
// ---------------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 12;

export function passwordPolicyViolations(
  password: string,
  username: string,
): string[] {
  const violations: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push('too_short');
  }
  if (!/[a-zA-Z]/.test(password)) {
    violations.push('missing_letter');
  }
  if (!/[0-9]/.test(password)) {
    violations.push('missing_digit');
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    violations.push('same_as_username');
  }
  return violations;
}

const TEMP_PASSWORD_ALPHABET =
  'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Random password guaranteed to satisfy the policy (used for admin resets). */
export function generateTempPassword(username: string): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
    }
    if (passwordPolicyViolations(password, username).length === 0) {
      return password;
    }
  }
  throw new Error('password policy: unable to generate temp password');
}

// In-memory login rate limiter: max 5 failed attempts per IP+username per minute.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const loginAttempts = new Map<string, number[]>();

// Deterministic one-way hash of the session token. The raw token is never
// stored; only its hash is kept in the sessions table (lookup key).
function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export { sessionId };

function sessionCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
  } as const;
}

export function registerAuth(app: FastifyInstance, config: { NODE_ENV: string }, pool: Pool) {
  const secure = config.NODE_ENV === 'production';

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string } | undefined;
    const username = body?.username ?? '';
    const password = body?.password ?? '';
    const ip = req.ip ?? '';
    const rateLimitKey = `${ip}:${username}`;

    const now = Date.now();
    const windowStart = now - LOGIN_WINDOW_MS;
    const prior = loginAttempts.get(rateLimitKey) ?? [];
    const recentFailures = prior.filter((t) => t > windowStart);
    if (recentFailures.length >= LOGIN_MAX_ATTEMPTS) {
      return reply.status(429).send({ error: 'too many login attempts' });
    }

    const { rows } = await pool.query(
      'SELECT id, username, password_hash, role, must_change_password, disabled FROM users WHERE username = $1',
      [username],
    );
    const user = rows[0];

    let ok = false;
    if (user && user.password_hash && !user.disabled) {
      ok = await verify(user.password_hash, password);
    }

    // Always record the attempt so failures are visible in auth_events.
    await pool.query('INSERT INTO auth_events (id, type, username, ip) VALUES ($1, $2, $3, $4)', [
      randomUUID(),
      ok ? 'login' : 'failed_login',
      username,
      ip,
    ]);

    if (!ok) {
      // Only failed attempts consume the rate-limit budget (brute-force protection).
      recentFailures.push(now);
      loginAttempts.set(rateLimitKey, recentFailures);
      return reply.status(401).send({ error: 'invalid credentials' });
    }

    const token = randomUUID();
    const sid = sessionId(token);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 500) || null;
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at, user_agent, last_seen_at)
       VALUES ($1, $2, $3, $4, now())`,
      [sid, user.id, expiresAt, userAgent],
    );

    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(secure));
    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.must_change_password,
      },
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId(token)]);
      await pool.query('INSERT INTO auth_events (id, type, username, ip) VALUES ($1, $2, $3, $4)', [
        randomUUID(),
        'logout',
        '',
        req.ip,
      ]);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const sid = sessionId(token);
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.username, u.role, u.must_change_password
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [sid],
    );
    const row = rows[0];
    if (!row) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(401).send({ error: 'session expired or invalid' });
    }

    // Sliding expiry + last-seen tracking.
    await pool.query(
      'UPDATE sessions SET expires_at = $1, last_seen_at = now() WHERE id = $2',
      [new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000), sid],
    );
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(secure));

    return reply.send({
      user: {
        id: row.user_id,
        username: row.username,
        role: row.role,
        mustChangePassword: row.must_change_password,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Session management (plan.md §10 / M38): list the user's active sessions
  // and log out all devices.
  // ---------------------------------------------------------------------------

  app.get('/api/auth/sessions', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      return reply.status(401).send({ error: 'not authenticated' });
    }
    const sid = sessionId(token);
    const { rows } = await pool.query(
      `SELECT s.user_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now() AND u.disabled = false`,
      [sid],
    );
    const userRow = rows[0] as { user_id: string } | undefined;
    if (!userRow) {
      return reply.status(401).send({ error: 'session expired or invalid' });
    }
    const all = await pool.query(
      `SELECT id, created_at, last_seen_at, user_agent, expires_at
       FROM sessions
       WHERE user_id = $1 AND expires_at > now()
       ORDER BY COALESCE(last_seen_at, created_at) DESC`,
      [userRow.user_id],
    );
    return reply.send({
      sessions: all.rows.map((r) => ({
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        userAgent: r.user_agent,
        expiresAt: r.expires_at,
        current: r.id === sid,
      })),
    });
  });

  app.delete('/api/auth/sessions', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      return reply.status(401).send({ error: 'not authenticated' });
    }
    const sid = sessionId(token);
    const { rows } = await pool.query(
      `SELECT u.id AS user_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [sid],
    );
    const row = rows[0] as { user_id: string } | undefined;
    if (!row) {
      return reply.status(401).send({ error: 'session expired or invalid' });
    }
    // "Log out all devices": every session of this user, including this one.
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    await pool.query('INSERT INTO auth_events (id, type, username, ip) VALUES ($1, $2, $3, $4)', [
      randomUUID(),
      'logout_all',
      '',
      req.ip,
    ]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const sid = sessionId(token);
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.password_hash
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [sid],
    );
    const row = rows[0];
    if (!row || !row.password_hash) {
      return reply.status(401).send({ error: 'session invalid' });
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    const usernameRow = (await pool.query('SELECT username FROM users WHERE id = $1', [
      row.user_id,
    ])).rows[0] as { username: string };
    const violations = passwordPolicyViolations(newPassword ?? '', usernameRow.username);
    if (currentPassword && newPassword && currentPassword === newPassword) {
      violations.push('same_as_current');
    }
    if (violations.length > 0) {
      return reply.status(400).send({ error: 'password_policy', details: violations });
    }
    if (!(await verify(row.password_hash, currentPassword))) {
      await pool.query('INSERT INTO auth_events (id, type, username, ip) VALUES ($1, $2, $3, $4)', [
        randomUUID(),
        'failed_password_change',
        '',
        req.ip,
      ]);
      return reply.status(401).send({ error: 'current password incorrect' });
    }

    const newHash = await hash(newPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
      [newHash, row.user_id],
    );
    await pool.query('INSERT INTO auth_events (id, type, username, ip) VALUES ($1, $2, $3, $4)', [
      randomUUID(),
      'password_change',
      '',
      req.ip,
    ]);

    return reply.send({ ok: true });
  });
}
