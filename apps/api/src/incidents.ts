import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { sessionId } from './auth.js';
import { FUNCTION_PRESETS } from '@stabsstod/shared';

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

async function requireAuth(
  cookies: Record<string, string | undefined>,
  pool: Pool,
): Promise<AuthedUser | { status: number; body: { error: string } }> {
  const user = await getSessionUser(cookies, pool);
  if (!user) {
    return { status: 401, body: { error: 'not authenticated' } };
  }
  return user;
}

// System admin only.
async function requireSystemAdmin(
  cookies: Record<string, string | undefined>,
  pool: Pool,
): Promise<AuthedUser | { status: number; body: { error: string } }> {
  const user = await requireAuth(cookies, pool);
  if ('status' in user) {
    return user;
  }
  if (user.role !== 'admin') {
    return { status: 403, body: { error: 'forbidden: system admin required' } };
  }
  return user;
}

// Incident role of a user within an incident (null if not a member).
async function incidentRole(
  pool: Pool,
  incidentId: string,
  userId: string,
): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT role FROM incident_members WHERE incident_id = $1 AND user_id = $2',
    [incidentId, userId],
  );
  return rows[0]?.role ?? null;
}

// Chief/deputy (or system admin) may edit functions of an incident.
async function requireChiefOrDeputy(
  pool: Pool,
  incidentId: string,
  userId: string,
): Promise<boolean> {
  const role = await incidentRole(pool, incidentId, userId);
  return (
    role === 'chief_of_staff' || role === 'deputy_chief' || (await isSystemAdmin(pool, userId))
  );
}

async function isSystemAdmin(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role === 'admin';
}

const incidentCreateSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  startedAt: z.string().datetime(),
  status: z.enum(['active', 'winding_down', 'closed']).default('active'),
  presetId: z.enum(['small', 'medium', 'continental']),
  members: z
    .array(
      z.object({
        userId: z.string(),
        role: z.enum([
          'chief_of_staff',
          'deputy_chief',
          'function_lead',
          'staff_member',
          'decision_maker',
          'observer',
        ]),
        functionIds: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const incidentMemberSchema = z.object({
  userId: z.string(),
  role: z.enum([
    'chief_of_staff',
    'deputy_chief',
    'function_lead',
    'staff_member',
    'decision_maker',
    'observer',
  ]),
  functionIds: z.array(z.string()).optional(),
});

const functionUpdateSchema = z.object({
  name: z.string().min(1),
});

export function registerIncidents(app: FastifyInstance, pool: Pool) {
  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------

  app.get('/api/presets', async (_req, reply) => {
    const presets = [
      { id: 'small', name: 'Small (4 functions)', functionCount: 4 },
      { id: 'medium', name: 'Medium (6 functions)', functionCount: 6 },
      { id: 'continental', name: 'Continental (9 functions)', functionCount: 9 },
    ];
    return reply.send({ presets });
  });

  // ---------------------------------------------------------------------------
  // Create incident (system admin)
  // ---------------------------------------------------------------------------

  app.post('/api/incidents', async (req, reply) => {
    const auth = await requireSystemAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const parsed = incidentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { name, type, startedAt, status, presetId, members } = parsed.data;

    const incidentId = randomUUID();
    await pool.query(
      `INSERT INTO incidents (id, title, type, started_at, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [incidentId, name, type, startedAt, status, auth.id],
    );

    // Copy the chosen preset into staff_functions of this incident.
    const preset = getPreset(presetId);
    const functionIds: string[] = [];
    if (preset) {
      for (const fnName of preset.functions) {
        const fid = randomUUID();
        await pool.query(
          'INSERT INTO staff_functions (id, incident_id, name) VALUES ($1, $2, $3)',
          [fid, incidentId, fnName],
        );
        functionIds.push(fid);
      }
    }

    // Add the creator as chief_of_staff member.
    await pool.query(
      `INSERT INTO incident_members (id, incident_id, user_id, role)
         VALUES ($1, $2, $3, 'chief_of_staff')
         ON CONFLICT (incident_id, user_id) DO UPDATE SET role = 'chief_of_staff'`,
      [randomUUID(), incidentId, auth.id],
    );

    // Add any additional members with their roles and functions.
    if (members) {
      for (const m of members) {
        await pool.query(
          `INSERT INTO incident_members (id, incident_id, user_id, role)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (incident_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [randomUUID(), incidentId, m.userId, m.role],
        );
        if (m.functionIds) {
          for (const fid of m.functionIds) {
            await pool.query(
              `INSERT INTO function_members (id, function_id, user_id)
                 VALUES ($1, $2, $3)`,
              [randomUUID(), fid, m.userId],
            );
          }
        }
      }
    }

    return reply.status(201).send({
      incident: {
        id: incidentId,
        name,
        type,
        startedAt,
        status,
        presetId,
        functionIds,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // List incidents the user is a member of ("My incidents")
  // ---------------------------------------------------------------------------

  app.get('/api/incidents', async (req, reply) => {
    const auth = await requireAuth(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { rows } = await pool.query(
      `SELECT i.id, i.title, i.type, i.started_at, i.status, i.created_at, im.role
         FROM incidents i
         JOIN incident_members im ON im.incident_id = i.id
         WHERE im.user_id = $1
         ORDER BY i.created_at DESC`,
      [auth.id],
    );
    return reply.send({
      incidents: rows.map((r) => ({
        id: r.id,
        name: r.title,
        type: r.type,
        startedAt: r.started_at,
        status: r.status,
        createdAt: r.created_at,
        role: r.role,
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // Get incident detail (member)
  // ---------------------------------------------------------------------------

  app.get('/api/incidents/:id', async (req, reply) => {
    const auth = await requireAuth(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { id } = req.params as { id: string };

    const memberRole = await incidentRole(pool, id, auth.id);
    if (!memberRole) {
      return reply.status(403).send({ error: 'forbidden: not a member of this incident' });
    }

    const { rows } = await pool.query(
      'SELECT id, title, type, started_at, status, created_by, created_at FROM incidents WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'incident not found' });
    }
    const incident = rows[0];

    const functions = await pool.query(
      'SELECT id, name FROM staff_functions WHERE incident_id = $1 ORDER BY name',
      [id],
    );

    const members = await pool.query(
      `SELECT im.id, im.user_id, u.username, u.display_name, im.role,
                array_agg(DISTINCT fm.function_id) FILTER (WHERE fm.function_id IS NOT NULL) AS function_ids
         FROM incident_members im
         JOIN users u ON u.id = im.user_id
         LEFT JOIN function_members fm ON fm.user_id = im.user_id
         WHERE im.incident_id = $1
         GROUP BY im.id, im.user_id, u.username, u.display_name, im.role
         ORDER BY u.username`,
      [id],
    );

    return reply.send({
      incident: {
        id: incident.id,
        name: incident.title,
        type: incident.type,
        startedAt: incident.started_at,
        status: incident.status,
        createdBy: incident.created_by,
        createdAt: incident.created_at,
        role: memberRole,
      },
      functions: functions.rows.map((f) => ({ id: f.id, name: f.name })),
      members: members.rows.map((m) => ({
        id: m.user_id,
        username: m.username,
        displayName: m.display_name,
        role: m.role,
        functionIds: (m.function_ids ?? []).filter(Boolean),
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // Add member (system admin)
  // ---------------------------------------------------------------------------

  app.post('/api/incidents/:id/members', async (req, reply) => {
    const auth = await requireSystemAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { id } = req.params as { id: string };
    const parsed = incidentMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { userId, role, functionIds } = parsed.data;

    await pool.query(
      `INSERT INTO incident_members (id, incident_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (incident_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [randomUUID(), id, userId, role],
    );
    if (functionIds) {
      for (const fid of functionIds) {
        await pool.query(
          `INSERT INTO function_members (id, function_id, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
          [randomUUID(), fid, userId],
        );
      }
    }
    return reply.status(201).send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Edit function name (chief / deputy / system admin)
  // ---------------------------------------------------------------------------

  app.patch('/api/incidents/:id/functions/:functionId', async (req, reply) => {
    const auth = await requireAuth(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { id, functionId } = req.params as { id: string; functionId: string };
    if (!(await requireChiefOrDeputy(pool, id, auth.id))) {
      return reply.status(403).send({ error: 'forbidden: chief or deputy required' });
    }
    const parsed = functionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    await pool.query('UPDATE staff_functions SET name = $1 WHERE id = $2 AND incident_id = $3', [
      parsed.data.name,
      functionId,
      id,
    ]);
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Update member role / functions (system admin)
  // ---------------------------------------------------------------------------

  app.patch('/api/incidents/:id/members/:userId', async (req, reply) => {
    const auth = await requireSystemAdmin(req.cookies ?? {}, pool);
    if ('status' in auth) {
      return reply.status(auth.status).send(auth.body);
    }
    const { id, userId } = req.params as { id: string; userId: string };
    const parsed = incidentMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error });
    }
    const { role, functionIds } = parsed.data;
    await pool.query(
      'UPDATE incident_members SET role = $1 WHERE incident_id = $2 AND user_id = $3',
      [role, id, userId],
    );
    // Replace function memberships.
    await pool.query(
      'DELETE FROM function_members WHERE user_id = $1 AND function_id IN (SELECT id FROM staff_functions WHERE incident_id = $2)',
      [userId, id],
    );
    if (functionIds) {
      for (const fid of functionIds) {
        await pool.query(
          `INSERT INTO function_members (id, function_id, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
          [randomUUID(), fid, userId],
        );
      }
    }
    return reply.send({ ok: true });
  });
}

function getPreset(presetId: string) {
  return FUNCTION_PRESETS.find((p: { id: string }) => p.id === presetId);
}
