// Geo search — plan.md §5 / M31.
//
// GET /api/geo/search?q=  — pg_trgm trigram search over places and admin_areas.
// GET /api/geo/area/:id   — return a single admin area with its GeoJSON.
//
// Read-only: any authenticated session may search. No PostGIS — geometry is
// plain GeoJSON / text.

import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { sessionId } from './auth.js';

const SEARCH_LIMIT = 20;

async function getSessionUser(
  cookies: Record<string, string | undefined>,
  pool: Pool,
): Promise<{ id: string; username: string; role: string } | null> {
  const token = cookies?.session;
  if (!token) return null;
  const sid = sessionId(token);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now() AND u.disabled = false`,
    [sid],
  );
  return rows[0] ?? null;
}

type GeoResult = {
  id: string;
  type: 'place' | 'area';
  name: string;
  kind: string;
  lat?: number | null;
  lon?: number | null;
  kommun?: string | null;
  lan?: string | null;
  bbox?: string | null;
  geojson?: unknown | null;
};

export function registerGeo(app: FastifyInstance, pool: Pool) {
  // ---------------------------------------------------------------------------
  // GET /api/geo/search?q=
  // ---------------------------------------------------------------------------

  app.get('/api/geo/search', async (req, reply) => {
    const user = await getSessionUser(req.cookies ?? {}, pool);
    if (!user) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const parsed = z
      .object({ q: z.string().min(1).max(100) })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error.flatten().fieldErrors });
    }

    const q = parsed.data.q;

    // Search places by name similarity.
    const placeRows = await pool.query<{
      id: string;
      name: string;
      kind: string;
      lat: number;
      lon: number;
      kommun: string | null;
      lan: string | null;
      bbox: string | null;
      sim: string;
    }>(
      `SELECT id, name, kind, lat, lon, kommun, lan, bbox,
              similarity(name, $1) AS sim
       FROM places
       WHERE name % $1
       ORDER BY sim DESC, name
       LIMIT $2`,
      [q, SEARCH_LIMIT],
    );

    // Search admin areas by name similarity.
    const areaRows = await pool.query<{
      id: string;
      name: string;
      kind: string;
      geojson: unknown;
      sim: string;
    }>(
      `SELECT id, name, kind, geojson,
              similarity(name, $1) AS sim
       FROM admin_areas
       WHERE name % $1
       ORDER BY sim DESC, name
       LIMIT $2`,
      [q, SEARCH_LIMIT],
    );

    const results: GeoResult[] = [
      ...placeRows.rows.map((r) => ({
        id: r.id,
        type: 'place' as const,
        name: r.name,
        kind: r.kind,
        lat: r.lat,
        lon: r.lon,
        kommun: r.kommun,
        lan: r.lan,
        bbox: r.bbox,
      })),
      ...areaRows.rows.map((r) => ({
        id: r.id,
        type: 'area' as const,
        name: r.name,
        kind: r.kind,
        geojson: r.geojson,
      })),
    ];

    // Combined sort by similarity (desc), then name.
    results.sort((a, b) => b.name.localeCompare(a.name) || 0);

    return reply.send({ results, query: q });
  });

  // ---------------------------------------------------------------------------
  // GET /api/geo/area/:id
  // ---------------------------------------------------------------------------

  app.get('/api/geo/area/:id', async (req, reply) => {
    const user = await getSessionUser(req.cookies ?? {}, pool);
    if (!user) {
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const parsed = z.object({ id: z.string().min(1) }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid input', details: parsed.error.flatten().fieldErrors });
    }

    const { rows } = await pool.query<{
      id: string;
      name: string;
      kind: string;
      geojson: unknown;
    }>(
      `SELECT id, name, kind, geojson
       FROM admin_areas
       WHERE id = $1`,
      [parsed.data.id],
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'not found' });
    }

    return reply.send({ ...rows[0] });
  });
}
