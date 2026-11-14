// Geo search API tests — plan.md §5 / M31.
//
// Search tests with a small fixture (pg_trgm on places + admin_areas).

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

describe('GET /api/geo/search', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let token: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);

    const hashStr = await hash('geo123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false`,
      ['user-m31-geo-1', 'm31geo', hashStr],
    );

    // Fixture places (idempotent: data may persist across test runs).
    await pool.query(
      `INSERT INTO places (id, name, kind, lat, lon, kommun, lan, bbox) VALUES
       ('p-stockholm', 'Stockholm', 'place', 59.3293, 18.0686, 'Stockholm', 'Stockholms lan', '17.9,59.2,18.2,59.4'),
       ('p-goteborg', 'Göteborg', 'place', 57.7089, 11.9746, 'Göteborg', 'Vastra Gotalands lan', '11.8,57.6,12.1,57.8'),
       ('p-uppsala', 'Uppsala', 'place', 59.8586, 17.6389, 'Uppsala', 'Uppsala lan', '17.5,59.7,17.8,60.0'),
       ('p-malmo', 'Malmö', 'place', 55.6050, 13.0038, 'Malmö', 'Skane lan', '12.9,55.5,13.1,55.7'),
       ('street-drottninggatan', 'Drottninggatan', 'street', 59.3345, 18.0600, 'Stockholm', 'Stockholms lan', NULL)
       ON CONFLICT (id) DO NOTHING`,
    );

    // Fixture admin areas (idempotent).
    await pool.query(
      `INSERT INTO admin_areas (id, name, kind, geojson) VALUES
       ('a-stockholms-lan', 'Stockholms län', 'county',
        '{"type":"Polygon","coordinates":[[[17.5,59.2],[18.5,59.2],[18.5,60.0],[17.5,60.0],[17.5,59.2]]]}'),
       ('a-stockholms-kommun', 'Stockholms kommun', 'municipality',
        '{"type":"Polygon","coordinates":[[[17.9,59.2],[18.2,59.2],[18.2,59.4],[17.9,59.4],[17.9,59.2]]]}'),
       ('a-vastra-gotalands-lan', 'Västra Götalands län', 'county',
        '{"type":"Polygon","coordinates":[[[11.5,57.0],[12.5,57.0],[12.5,58.0],[11.5,58.0],[11.5,57.0]]]}')
       ON CONFLICT (id) DO NOTHING`,
    );

    await pool.end();

    app = await appWithDb();
    token = await loginAs(app, 'm31geo', 'geo123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const appNoAuth = await appWithDb();
    try {
      const res = await appNoAuth.inject({ method: 'GET', url: '/api/geo/search?q=Stockholm' });
      expect(res.statusCode).toBe(401);
    } finally {
      await appNoAuth.close();
    }
  });

  it('searches places by name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/search?q=Stockholm',
      headers: { cookie: `session=${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ id: string; type: string; name: string; lat?: number | null; lon?: number | null; kommun?: string | null; lan?: string | null }> };
    const stockholm = body.results.find((r) => r.id === 'p-stockholm');
    expect(stockholm).toBeDefined();
    expect(stockholm!.type).toBe('place');
    expect(stockholm!.name).toBe('Stockholm');
    expect(stockholm!.lat).toBeCloseTo(59.3293, 3);
    expect(stockholm!.lon).toBeCloseTo(18.0686, 3);
    expect(stockholm!.kommun).toBe('Stockholm');
    expect(stockholm!.lan).toBe('Stockholms län');
  });

  it('searches admin areas by name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/search?q=Stockholms län',
      headers: { cookie: `session=${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ id: string; type: string; name: string; geojson?: unknown }> };
    const lan = body.results.find((r) => r.id === 'a-stockholms-lan');
    expect(lan).toBeDefined();
    expect(lan!.type).toBe('area');
    expect(lan!.name).toBe('Stockholms län');
    expect(lan!.geojson).toBeDefined();
  });

  it('returns empty results for no match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/search?q=Zzxqnonexistent',
      headers: { cookie: `session=${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it('rejects empty query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/search?q=',
      headers: { cookie: `session=${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/geo/area/:id', () => {
  let app: Awaited<ReturnType<typeof appWithDb>>;
  let token: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);

    const hashStr = await hash('geo123');
    await pool.query(
      `INSERT INTO users (id, username, role, must_change_password, disabled, preferred_language, password_hash)
       VALUES ($1, $2, 'user', false, false, 'sv', $3)
       ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false`,
      ['user-m31-geo-2', 'm31geo2', hashStr],
    );
    await pool.end();

    app = await appWithDb();
    token = await loginAs(app, 'm31geo2', 'geo123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an admin area with geojson', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/area/a-stockholms-kommun',
      headers: { cookie: `session=${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string; kind: string; geojson: unknown };
    expect(body.id).toBe('a-stockholms-kommun');
    expect(body.name).toBe('Stockholms kommun');
    expect(body.kind).toBe('municipality');
    expect(body.geojson).toBeDefined();
    expect((body.geojson as { type: string }).type).toBe('Polygon');
  });

  it('returns 404 for unknown area id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/area/does-not-exist',
      headers: { cookie: `session=${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const appNoAuth = await appWithDb();
    try {
      const res = await appNoAuth.inject({ method: 'GET', url: '/api/geo/area/a-stockholms-kommun' });
      expect(res.statusCode).toBe(401);
    } finally {
      await appNoAuth.close();
    }
  });
});
