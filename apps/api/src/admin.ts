import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { hash } from '@node-rs/argon2';
import { sessionId } from './auth.js';

type AuthedUser = {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
};

async function getSessionUser(
  cookies: Record<string, string | undefined>,
  pool: Pool,
): Promise<AuthedUser | null> {
  const token = cookies?.session;
  if (!token) {
    return null;
  }
  const sid = sessionId(token);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.role, u.disabled
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now() AND u.disabled = false`,
    [sid],
  );
  return rows[0] ?? null;
}

async function requireAdmin(
  cookies: Record<string, string | undefined>,
  pool: Pool,
): Promise<AuthedUser | { status: number; body: { error: string } }> {
  const user = await getSessionUser(cookies, pool);
  if (!user) {
    return { status: 401, body: { error: 'not authenticated' } };
  }
  if (user.role !== 'admin') {
    return { status: 403, body: { error: 'forbidden: admin required' } };
  }
  return user;
}

const userCreateSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  displayName: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
});
const userDisableSchema = z.object({ disabled: z.boolean() });
const userUpdateSchema = z.object({
  displayName: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  preferredLanguage: z.enum(['sv', 'en']).optional(),
});
const settingsSchema = z.object({
  timezone: z.string().optional(),
  map: z.object({ onlineTileUrl: z.string().nullable().optional() }).optional(),
  maxUploadMB: z.number().int().positive().optional(),
  wallRotateEverySeconds: z.number().int().positive().optional(),
});

export function registerAdmin(app: FastifyInstance, pool: Pool) {
  // ---------------------------------------------------------------------------
  // Admin users
  // ---------------------------------------------------------------------------

  app.get('/api/admin/users', async (req, reply) => {
    const auth = await requireAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { rows } = await pool.query(
      'SELECT id, username, display_name, role, disabled, preferred_language, must_change_password, created_at FROM users ORDER BY username',
    );
    return reply.send({ users: rows });
  });

  app.post('/api/admin/users', async (req, reply) => {
    const auth = await requireAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { username, password, displayName, role } = parsed.data;

    const existing = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if ((existing.rowCount ?? 0) > 0) {
      return reply.status(409).send({ error: 'username already exists' });
    }

    const id = randomUUID();
    const passwordHash = await hash(password);
    await pool.query(
      `INSERT INTO users
         (id, username, role, must_change_password, disabled, preferred_language, password_hash, display_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, username, role ?? 'user', false, false, 'sv', passwordHash, displayName ?? null],
    );

    const { rows } = await pool.query(
      'SELECT id, username, display_name, role, disabled, preferred_language, must_change_password FROM users WHERE id = $1',
      [id],
    );
    return reply.status(201).send({ user: rows[0] });
  });

  app.patch('/api/admin/users/:id/disable', async (req, reply) => {
    const auth = await requireAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const parsed = userDisableSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { id } = req.params as { id: string };
    await pool.query('UPDATE users SET disabled = $1 WHERE id = $2', [parsed.data.disabled, id]);
    return reply.send({ ok: true });
  });

  app.post('/api/admin/users/:id/reset-password', async (req, reply) => {
    const auth = await requireAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { id } = req.params as { id: string };
    const tempPassword = randomUUID().slice(0, 12);
    const passwordHash = await hash(tempPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2',
      [passwordHash, id],
    );
    return reply.send({ ok: true, tempPassword });
  });

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const auth = await requireAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { id } = req.params as { id: string };
    const { displayName, role, preferredLanguage } = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (displayName !== undefined) {
      sets.push(`display_name = $${sets.length + 1}`);
      vals.push(displayName);
    }
    if (role !== undefined) {
      sets.push(`role = $${sets.length + 1}`);
      vals.push(role);
    }
    if (preferredLanguage !== undefined) {
      sets.push(`preferred_language = $${sets.length + 1}`);
      vals.push(preferredLanguage);
    }
    if (sets.length === 0) {
      return reply.status(400).send({ error: 'nothing to update' });
    }
    vals.push(id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${sets.length + 1}`, vals);
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  app.get('/api/settings', async (_req, reply) => {
    const { rows } = await pool.query(
      'SELECT key, value FROM settings WHERE key IN ($1, $2, $3, $4)',
      ['timezone', 'map.onlineTileUrl', 'maxUploadMB', 'wall.rotateEverySeconds'],
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return reply.send({
      timezone: byKey.timezone ?? 'Europe/Stockholm',
      map: { onlineTileUrl: byKey['map.onlineTileUrl'] ?? null },
      maxUploadMB: byKey.maxUploadMB ?? 25,
      wallRotateEverySeconds: byKey['wall.rotateEverySeconds'] ?? 30,
    });
  });

  app.put('/api/settings', async (req, reply) => {
    const auth = await requireAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { timezone, map, maxUploadMB, wallRotateEverySeconds } = parsed.data;
    const updates: { key: string; value: unknown }[] = [];
    if (timezone !== undefined) {
      updates.push({ key: 'timezone', value: timezone });
    }
    if (map?.onlineTileUrl !== undefined) {
      updates.push({ key: 'map.onlineTileUrl', value: map.onlineTileUrl });
    }
    if (maxUploadMB !== undefined) {
      updates.push({ key: 'maxUploadMB', value: maxUploadMB });
    }
    if (wallRotateEverySeconds !== undefined) {
      updates.push({ key: 'wall.rotateEverySeconds', value: wallRotateEverySeconds });
    }
    for (const u of updates) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [u.key, JSON.stringify(u.value)],
      );
    }
    return reply.send({ ok: true });
  });
}
