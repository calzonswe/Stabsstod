// Attachment endpoints — plan.md §5.6 / M28
//
// POST /api/attachments   — multipart upload; fields: `file` (the file bytes),
//                           `hash` (client-computed sha256 hex). Server verifies
//                           the hash matches the file content and stores at
//                           ATTACHMENTS_DIR/<hash>. Default max 25 MB.
// GET  /api/attachments/:hash — download; requires session + membership of an
//                               incident that references the hash.

import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { promises as fsPromises, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type Actor } from '@stabsstod/shared';
import { sessionId as sessionIdFromAuth } from './auth.js';

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR ?? join(tmpdir(), 'stabsstod-attachments');

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// EntityType is only exported as a type from @stabsstod/shared; use string
// literals for entity_type comparisons in SQL.
const ENTITY_TYPE_ATTACHMENT = 'attachment';

async function ensureAttachmentsDir(): Promise<void> {
  await fsPromises.mkdir(ATTACHMENTS_DIR, { recursive: true });
}

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

// Check whether the user is a member of any incident that has an attachment
// record with the given hash.
async function userCanAccessAttachment(
  pool: Pool,
  userId: string,
  hash: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT DISTINCT incident_id
     FROM records
     WHERE entity_type = $1 AND (payload->>'hash') = $2`,
    [ENTITY_TYPE_ATTACHMENT, hash],
  );
  for (const row of rows) {
    const actor = await getIncidentActor(pool, userId, row.incident_id);
    if (actor) return true;
  }
  return false;
}

// Parse a multipart/form-data body into fields and files. Returns { file, hash }.
// This is a minimal parser sufficient for the attachment upload (one file +
// one hash field). Avoids @fastify/multipart to keep the inject test path simple.
interface MultipartParts {
  file: { data: Buffer; filename: string; mimetype: string } | null;
  hash: string;
}

function parseMultipart(
  body: string,
  contentType: string | undefined,
): MultipartParts {
  const boundaryMatch = contentType?.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    return { file: null, hash: '' };
  }
  const boundary = boundaryMatch[1];
  // Strip surrounding quotes if present.
  const cleanBoundary = boundary.replace(/^"|"$/g, '');
  const delimiter = `\r\n--${cleanBoundary}`;
  const parts = body.split(delimiter);

  let file: { data: Buffer; filename: string; mimetype: string } | null = null;
  let hash = '';

  for (const part of parts) {
    if (!part.trim() || part === '--\r\n' || part === '--') continue;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd);
    const payload = part.slice(headerEnd + 4).replace(/\r\n$/, '');

    const dispositionMatch = headers.match(
      /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i,
    );
    if (!dispositionMatch) continue;

    const fieldName = dispositionMatch[1];
    const fileName = dispositionMatch[2];

    const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    const mimetype = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';

    if (fieldName === 'file' && fileName) {
      file = {
        data: Buffer.from(payload, 'utf8'),
        filename: fileName,
        mimetype,
      };
    } else if (fieldName === 'hash') {
      hash = payload.trim();
    }
  }

  return { file, hash };
}

export function registerAttachments(app: FastifyInstance, pool: Pool) {
  // Fastify only parses application/json by default. Add a content-type
  // parser for multipart/form-data that returns the raw body buffer so we
  // can parse it manually in the handler.
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // ---------------------------------------------------------------------------
  // POST /api/attachments
  // ---------------------------------------------------------------------------

  app.post('/api/attachments', async (req, reply) => {
    const cookies = req.cookies ?? {};
    const sessionUser = await getSessionUser(cookies, pool);
    if (!sessionUser) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    await ensureAttachmentsDir();

    try {
      const contentType = req.headers['content-type'];
      const rawBody = req.body as Buffer | string | undefined;
      const bodyStr =
        typeof rawBody === 'string' ? rawBody : rawBody ? rawBody.toString() : '';

      const { file, hash } = parseMultipart(bodyStr, contentType);

      if (!file) {
        return reply.status(400).send({ error: 'no file part' });
      }
      if (!hash) {
        return reply.status(400).send({ error: 'hash field required' });
      }

      const fileData = file.data;
      const size = fileData.byteLength;

      // Enforce max upload size.
      if (size > MAX_UPLOAD_BYTES) {
        return reply.status(413).send({
          error: `file too large: max ${MAX_UPLOAD_MB} MB`,
        });
      }

      // Verify client-computed sha256 against actual file content.
      const actualHash = createHash('sha256').update(fileData).digest('hex');
      if (actualHash !== hash) {
        return reply.status(400).send({ error: 'hash mismatch' });
      }

      // Store the file at ATTACHMENTS_DIR/<hash>.
      const filePath = join(ATTACHMENTS_DIR, actualHash);
      await fsPromises.writeFile(filePath, fileData);

      return reply.send({
        hash: actualHash,
        size,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: 'internal error',
        details: String(err),
        bodyType: typeof req.body,
        bodyIsBuffer: Buffer.isBuffer(req.body),
        bodyLength: Buffer.isBuffer(req.body) ? req.body.length : 'n/a',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/attachments/:hash
  // ---------------------------------------------------------------------------

  app.get('/api/attachments/:hash', async (req, reply) => {
    const cookies = req.cookies ?? {};
    const sessionUser = await getSessionUser(cookies, pool);
    if (!sessionUser) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const { hash } = req.params as { hash: string };

    const filePath = join(ATTACHMENTS_DIR, hash);
    try {
      await fsPromises.stat(filePath);
    } catch {
      return reply.status(404).send({ error: 'attachment not found' });
    }

    // Membership check: user must be a member of an incident that references
    // this hash in an attachment record. (Checked after file existence so
    // that unknown hashes return 404 rather than leaking 403.)
    const hasAccess = await userCanAccessAttachment(pool, sessionUser.user_id, hash);
    if (!hasAccess) {
      return reply.status(403).send({ error: 'forbidden: no access to this attachment' });
    }

    // Read attachment record for mime/filename.
    const { rows } = await pool.query(
      `SELECT payload FROM records
       WHERE entity_type = $1 AND (payload->>'hash') = $2
       LIMIT 1`,
      [ENTITY_TYPE_ATTACHMENT, hash],
    );

    let mime = 'application/octet-stream';
    let filename = hash;
    if (rows.length > 0) {
      const payload = rows[0].payload as { mime?: string; filename?: string };
      mime = payload.mime ?? mime;
      filename = payload.filename ?? filename;
    }

    return reply
      .type(mime)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(createReadStream(filePath));
  });
}
