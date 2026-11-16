// Sync endpoints — plan.md §5.3
//
// POST /api/sync/push   — client pushes records (idempotent on id)
// GET  /api/sync/pull   — client pulls records since a serverSeq cursor
// GET  /api/events      — SSE stream of new records per incident
//
// Permission checks use can() from @stabs/shared. A tiny in-process pub/sub
// notifies SSE listeners when new records land for an incident (single api
// instance in v1).

import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  can,
  type EntityType,
  type Actor,
  type Action,
  type RecordLike,
  type RecordEnvelope,
  RecordEnvelopeSchema,
  validateEntityPayload,
} from '@stabsstod/shared';
import { sessionId as sessionIdFromAuth } from './auth.js';

// ---------------------------------------------------------------------------
// In-process pub/sub for SSE
// ---------------------------------------------------------------------------

type SSEClient = {
  res: ServerResponse;
  incidentId: string;
};

const clientsByIncident = new Map<string, Set<SSEClient>>();

function sseSubscribe(incidentId: string, res: ServerResponse): SSEClient {
  let clients = clientsByIncident.get(incidentId);
  if (!clients) {
    clients = new Set();
    clientsByIncident.set(incidentId, clients);
  }
  const client: SSEClient = { res, incidentId };
  clients.add(client);
  return client;
}

function sseUnsubscribe(client: SSEClient) {
  const clients = clientsByIncident.get(client.incidentId);
  if (clients) {
    clients.delete(client);
    if (clients.size === 0) {
      clientsByIncident.delete(client.incidentId);
    }
  }
}

function ssePublish(incidentId: string, data: unknown) {
  const clients = clientsByIncident.get(incidentId);
  if (!clients) return;
  // plan.md §5.3: named "records" event — clients subscribe to 'records',
  // not the default "message" event.
  const payload = `event: records\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      // Client gone; will be cleaned up on close/error.
    }
  }
}

function sseHeartbeat(res: ServerResponse) {
  const interval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(interval);
    }
  }, 20_000);
  return interval;
}

// ---------------------------------------------------------------------------
// Session / actor helpers
// ---------------------------------------------------------------------------

async function getSessionUser(
  cookies: Record<string, string | undefined>,
  pool: Pool,
): Promise<{ user_id: string; role: string } | null> {
  const token = cookies?.session;
  if (!token) return null;

  const sid = sessionIdFromAuth(token);
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now() AND u.disabled = false`,
    [sid],
  );
  return rows[0] ?? null;
}

async function getIncidentActor(
  pool: Pool,
  userId: string,
  incidentId: string,
): Promise<Actor | null> {
  const { rows } = await pool.query(
    `SELECT im.role,
            COALESCE(
              array_agg(DISTINCT fm.function_id) FILTER (WHERE fm.function_id IS NOT NULL),
              '{}'
            ) AS function_ids
     FROM incident_members im
     LEFT JOIN function_members fm
       ON fm.user_id = im.user_id
      AND fm.function_id = ANY(
        SELECT id FROM staff_functions WHERE incident_id = im.incident_id
      )
     WHERE im.incident_id = $1 AND im.user_id = $2
     GROUP BY im.role`,
    [incidentId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId,
    incidentId,
    role: row.role as Actor['role'],
    functionIds: (row.function_ids as string[] | null) ?? [],
  };
}

function recordLikeFromEnvelope(r: RecordEnvelope): RecordLike {
  return {
    entityType: r.entityType as unknown as EntityType,
    incidentId: r.incidentId,
    functionId: r.functionId,
    authorId: r.authorId,
    status: (r.payload as { status?: string } | undefined)?.status,
    mandate: (r.payload as { mandate?: 'decision_maker' | 'delegated_chief' } | undefined)?.mandate,
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const pushBodySchema = z.object({
  incidentId: z.string().min(1),
  records: z.array(RecordEnvelopeSchema).max(100),
});

type PushResult =
  | { status: 'accepted'; serverSeq: number }
  | { status: 'duplicate' }
  | { status: 'rejected'; reason: string };

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSync(app: FastifyInstance, pool: Pool) {
  // ---------------------------------------------------------------------------
  // POST /api/sync/push
  // ---------------------------------------------------------------------------

  app.post('/api/sync/push', async (req, reply) => {
    const cookies = req.cookies ?? {};
    const sessionUser = await getSessionUser(cookies, pool);
    if (!sessionUser) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const parsed = pushBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid input',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { incidentId, records } = parsed.data;

    // Verify membership and resolve incident-scoped actor.
    const actor = await getIncidentActor(pool, sessionUser.user_id, incidentId);
    if (!actor) {
      return reply.status(403).send({
        error: 'forbidden: not a member of this incident',
      });
    }

    // Incident status (M36): a closed incident is read-only except for
    // evaluation records.
    const statusResult = await pool.query(
      'SELECT status FROM incidents WHERE id = $1',
      [incidentId],
    );
    const incidentStatus: string | undefined = statusResult.rows[0]?.status;

    const results: PushResult[] = [];
    let maxSeq: number | null = null;

    for (const record of records) {
      // Idempotent on id.
      const existing = await pool.query('SELECT server_seq FROM records WHERE id = $1', [
        record.id,
      ]);
      if ((existing.rowCount ?? 0) > 0) {
        results.push({ status: 'duplicate' });
        continue;
      }

      // IncidentId must match.
      if (record.incidentId !== incidentId) {
        results.push({
          status: 'rejected',
          reason: `record ${record.id}: incidentId mismatch`,
        });
        continue;
      }

      // Permission check via can(). A closed incident is read-only except
      // for evaluation records (M36).
      const rl = recordLikeFromEnvelope(record);
      if (!(await canWrite(actor, rl, incidentStatus))) {
        results.push({
          status: 'rejected',
          reason: `forbidden: cannot write ${record.entityType}`,
        });
        continue;
      }

      // Payload validation via entity registry.
      const validation = validateEntityPayload(record.entityType as EntityType, record.payload);
      if (!validation.success) {
        results.push({
          status: 'rejected',
          reason: `invalid payload for ${record.entityType}`,
        });
        continue;
      }

      // Insert.
      const { rows } = await pool.query(
        `INSERT INTO records (
            id, entity_id, entity_type, incident_id, parent_ids, function_id,
            author_id, device_id, hlc, created_at_client, kind, schema_version, payload
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING server_seq`,
        [
          record.id,
          record.entityId,
          record.entityType,
          record.incidentId,
          record.parentIds,
          record.functionId,
          record.authorId,
          record.deviceId,
          record.hlc,
          record.createdAtClient,
          record.kind,
          record.schemaVersion,
          JSON.stringify(record.payload),
        ],
      );
      const serverSeq = Number(rows[0].server_seq);
      if (!maxSeq || serverSeq > maxSeq) maxSeq = serverSeq;

      results.push({ status: 'accepted', serverSeq });
    }

    // Notify SSE listeners of new records for this incident.
    if (maxSeq !== null) {
      ssePublish(incidentId, { type: 'records', incidentId, maxSeq });
    }

    return reply.status(200).send({ results });
  });

  // ---------------------------------------------------------------------------
  // GET /api/sync/pull
  // ---------------------------------------------------------------------------

  app.get('/api/sync/pull', async (req, reply) => {
    const cookies = req.cookies ?? {};
    const sessionUser = await getSessionUser(cookies, pool);
    if (!sessionUser) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const q = req.query as { incidentId?: string; since?: string; limit?: string };
    const incidentId = q.incidentId;
    const since = Number(q.since ?? 0);
    const limit = Math.min(Number(q.limit ?? 500), 500);

    if (!incidentId) {
      return reply.status(400).send({ error: 'incidentId required' });
    }

    const actor = await getIncidentActor(pool, sessionUser.user_id, incidentId);
    if (!actor) {
      return reply.status(403).send({
        error: 'forbidden: not a member of this incident',
      });
    }

    const { rows } = await pool.query(
      `SELECT id, entity_id, entity_type, incident_id, parent_ids, function_id,
                author_id, device_id, hlc, created_at_client, kind, schema_version,
                payload, server_seq, received_at
         FROM records
         WHERE incident_id = $1 AND server_seq > $2
         ORDER BY server_seq
         LIMIT $3`,
      [incidentId, since, limit],
    );

    const records = rows.map((r) => ({
      id: r.id,
      entityId: r.entity_id,
      entityType: r.entity_type,
      incidentId: r.incident_id,
      parentIds: r.parent_ids,
      functionId: r.function_id,
      authorId: r.author_id,
      deviceId: r.device_id,
      hlc: r.hlc,
      createdAtClient: r.created_at_client,
      kind: r.kind,
      schemaVersion: r.schema_version,
      payload: r.payload,
      serverSeq: Number(r.server_seq),
      receivedAt: r.received_at,
    }));

    const hasMore = records.length === limit;
    const nextSince = records.length > 0 ? records[records.length - 1].serverSeq : since;

    return reply.send({ records, nextSince, hasMore });
  });

  // ---------------------------------------------------------------------------
  // GET /api/events  (SSE)
  // ---------------------------------------------------------------------------

  app.get('/api/events', async (req, reply) => {
    const cookies = req.cookies ?? {};
    const sessionUser = await getSessionUser(cookies, pool);
    if (!sessionUser) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const q = req.query as { incidentId?: string };
    const incidentId = q.incidentId;
    if (!incidentId) {
      return reply.status(400).send({ error: 'incidentId required' });
    }

    const actor = await getIncidentActor(pool, sessionUser.user_id, incidentId);
    if (!actor) {
      return reply.status(403).send({
        error: 'forbidden: not a member of this incident',
      });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(': connected\n\n');

    const client = sseSubscribe(incidentId, reply.raw);
    const interval = sseHeartbeat(reply.raw);

    reply.raw.on('close', () => {
      clearInterval(interval);
      sseUnsubscribe(client);
    });
    reply.raw.on('error', () => {
      clearInterval(interval);
      sseUnsubscribe(client);
    });

    reply.raw.flushHeaders();
  });
}

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

async function canWrite(
  actor: Actor,
  rl: RecordLike,
  incidentStatus?: string,
): Promise<boolean> {
  if (actor.incidentId !== rl.incidentId) return false;
  return can(actor, 'write' as Action, rl, { incidentStatus });
}

export type { PushResult };
