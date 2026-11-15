// Archive export — plan.md §10 / M35.
//
// POST /api/export/archive — generates a ZIP archive of an incident's data
// for chief_of_staff / deputy_chief. The ZIP contains:
//   records.json   — every record for the incident (JSON array)
//   log.csv        — log entries (CSV)
//   decisions.csv  — decisions (CSV)
//   tasks.csv      — tasks (CSV)
//   attachments/   — the actual attachment files referenced by the incident
//
// Generated server-side so the client (possibly offline) does not need to
// assemble the archive. Every record appears exactly once in records.json.

import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import type { Actor } from '@stabsstod/shared';
import { sessionId as sessionIdFromAuth } from './auth.js';

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR ?? join(process.cwd(), 'attachments');

const ENTITY_TYPE_ATTACHMENT = 'attachment';
const ENTITY_TYPE_LOG_ENTRY = 'log_entry';
const ENTITY_TYPE_DECISION = 'decision';
const ENTITY_TYPE_TASK = 'task';

const CHIEF_OR_DEPUTY: Set<string> = new Set(['chief_of_staff', 'deputy_chief']);

const exportBodySchema = z.object({
  incidentId: z.string().min(1),
});

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

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function payloadField(payload: unknown, field: string): string {
  return csvEscape((payload as Record<string, unknown> | undefined)?.[field]);
}

// ---------------------------------------------------------------------------
// Archive building (pure over records + attachment file paths, testable with
// real Buffers — no HTTP round-trip needed).
// ---------------------------------------------------------------------------

export interface ExportRecord {
  id: string;
  entityId: string;
  entityType: string;
  incidentId: string;
  parentIds: string[];
  functionId: string | null;
  authorId: string;
  deviceId: string;
  hlc: string;
  createdAtClient: string;
  kind: string;
  schemaVersion: number;
  payload: unknown;
  serverSeq: number;
  receivedAt: string;
}

export interface AttachmentFile {
  hash: string;
  path: string;
}

/** Build the export ZIP buffer from records and attachment files. */
export function buildArchive(
  records: ExportRecord[],
  attachments: AttachmentFile[],
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    // records.json — every record exactly once.
    archive.append(JSON.stringify(records, null, 2), { name: 'records.json' });

    const csv = (
      header: string,
      entityType: string,
      fields: Array<(r: ExportRecord) => string>,
    ): string => {
      const rows = records.filter((r) => r.entityType === entityType);
      return (
        header +
        '\n' +
        rows
          .map((r) => fields.map((f) => csvEscape(f(r))).join(','))
          .join('\n') +
        '\n'
      );
    };

    archive.append(
      csv(
        'id,entityId,createdAtClient,authorId,category,eventTime,text',
        ENTITY_TYPE_LOG_ENTRY,
        [
          (r) => csvEscape(r.id),
          (r) => csvEscape(r.entityId),
          (r) => csvEscape(r.createdAtClient),
          (r) => csvEscape(r.authorId),
          (r) => payloadField(r.payload, 'category'),
          (r) => payloadField(r.payload, 'eventTime'),
          (r) => payloadField(r.payload, 'text'),
        ],
      ),
      { name: 'log.csv' },
    );

    archive.append(
      csv(
        'id,entityId,createdAtClient,authorId,text,decidedByUserId,decidedAt,mandate',
        ENTITY_TYPE_DECISION,
        [
          (r) => csvEscape(r.id),
          (r) => csvEscape(r.entityId),
          (r) => csvEscape(r.createdAtClient),
          (r) => csvEscape(r.authorId),
          (r) => payloadField(r.payload, 'text'),
          (r) => payloadField(r.payload, 'decidedByUserId'),
          (r) => payloadField(r.payload, 'decidedAt'),
          (r) => payloadField(r.payload, 'mandate'),
        ],
      ),
      { name: 'decisions.csv' },
    );

    archive.append(
      csv(
        'id,entityId,createdAtClient,authorId,title,description,assigneeUserId,due,priority,status,reportForm',
        ENTITY_TYPE_TASK,
        [
          (r) => csvEscape(r.id),
          (r) => csvEscape(r.entityId),
          (r) => csvEscape(r.createdAtClient),
          (r) => csvEscape(r.authorId),
          (r) => payloadField(r.payload, 'title'),
          (r) => payloadField(r.payload, 'description'),
          (r) => payloadField(r.payload, 'assigneeUserId'),
          (r) => payloadField(r.payload, 'due'),
          (r) => payloadField(r.payload, 'priority'),
          (r) => payloadField(r.payload, 'status'),
          (r) => payloadField(r.payload, 'reportForm'),
        ],
      ),
      { name: 'tasks.csv' },
    );

    for (const { hash, path } of attachments) {
      archive.file(path, { name: `attachments/${hash}` });
    }

    archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// HTTP route
// ---------------------------------------------------------------------------

export function registerExport(app: FastifyInstance, pool: Pool) {
  app.post('/api/export/archive', async (req, reply) => {
    const cookies = req.cookies ?? {};
    const sessionUser = await getSessionUser(cookies, pool);
    if (!sessionUser) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const parsed = exportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid input',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { incidentId } = parsed.data;

    const actor = await getIncidentActor(pool, sessionUser.user_id, incidentId);
    if (!actor) {
      return reply.status(403).send({
        error: 'forbidden: not a member of this incident',
      });
    }
    if (!CHIEF_OR_DEPUTY.has(actor.role)) {
      return reply.status(403).send({
        error: 'forbidden: chief of staff or deputy required',
      });
    }

    // All records for the incident, each exactly once (ordered by serverSeq).
    const { rows: recordRows } = await pool.query(
      `SELECT id, entity_id, entity_type, incident_id, parent_ids, function_id,
              author_id, device_id, hlc, created_at_client, kind, schema_version,
              payload, server_seq, received_at
       FROM records
       WHERE incident_id = $1
       ORDER BY server_seq`,
      [incidentId],
    );

    const records: ExportRecord[] = recordRows.map((r) => ({
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
      serverSeq: r.server_seq,
      receivedAt: r.received_at,
    }));

    // Attachment files referenced by this incident.
    const { rows: attachmentRows } = await pool.query(
      `SELECT DISTINCT (payload->>'hash') AS hash
       FROM records
       WHERE incident_id = $1 AND entity_type = $2 AND (payload->>'hash') IS NOT NULL`,
      [incidentId, ENTITY_TYPE_ATTACHMENT],
    );

    const attachments: AttachmentFile[] = [];
    for (const row of attachmentRows) {
      const hash: string = row.hash;
      const filePath = join(ATTACHMENTS_DIR, hash);
      let exists = false;
      try {
        await fsPromises.stat(filePath);
        exists = true;
      } catch {
        // File missing on disk — skip it (record still referenced).
      }
      if (exists) {
        attachments.push({ hash, path: filePath });
      }
    }

    const zip = await buildArchive(records, attachments);
    reply.header('Content-Type', 'application/zip');
    reply.header(
      'Content-Disposition',
      `attachment; filename="sitrep-${incidentId}.zip"`,
    );
    return reply.send(zip);
  });
}
