// Map file serving tests — plan.md §5.7 / M29
//
// Accept: /tiles/sweden.pmtiles and /map-assets/* are served from the maps
// directory (MAPS_DIR, default data/maps) with HTTP range request support,
// and missing files yield 404 (the web app shows an instruction message
// based on that).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:stabsstod@localhost:5432/stabsstod';

function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    HOST: '0.0.0.0',
    DATABASE_URL,
    SITE_ADDRESS: 'localhost',
    TZ: 'Europe/Stockholm',
    POSTGRES_PASSWORD: 'stabsstod',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'stabsstod',
    SESSION_SECRET: 'test-secret-do-not-use-in-production',
    MAX_UPLOAD_MB: '25',
    ...overrides,
  };
}

const PMTILES_BYTES = Buffer.from('pmtiles-fake-archive-bytes-0123456789');
const GLYPH_BYTES = Buffer.from('fake-glyph-pbf');
const SPRITE_BYTES = Buffer.from('{"train_station":{"x":0,"y":0,"w":16,"h":16}}');

let mapsDir: string;
let app: FastifyInstance;

beforeAll(async () => {
  mapsDir = mkdtempSync(join(tmpdir(), 'stabsstod-maps-'));
  const fontDir = join(mapsDir, 'map-assets', 'fonts', 'Noto Sans Regular');
  mkdirSync(fontDir, { recursive: true });
  mkdirSync(join(mapsDir, 'map-assets', 'sprites'), { recursive: true });
  writeFileSync(join(mapsDir, 'sweden.pmtiles'), PMTILES_BYTES);
  writeFileSync(join(fontDir, '0-255.pbf'), GLYPH_BYTES);
  writeFileSync(join(mapsDir, 'map-assets', 'sprites', 'light.json'), SPRITE_BYTES);
  process.env.MAPS_DIR = mapsDir;
  app = await buildApp({ config: loadConfig(testEnv()) });
});

afterAll(async () => {
  await app.close();
  rmSync(mapsDir, { recursive: true, force: true });
});

describe('map file serving (MAPS_DIR)', () => {
  it('serves /tiles/sweden.pmtiles with the full payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/sweden.pmtiles' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.body).toBe(PMTILES_BYTES.toString('utf8'));
  });

  it('supports HTTP range requests on the pmtiles file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tiles/sweden.pmtiles',
      headers: { range: 'bytes=0-9' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${PMTILES_BYTES.length}`);
    expect(res.body).toBe(PMTILES_BYTES.subarray(0, 10).toString('utf8'));
  });

  it('serves glyph files under /map-assets/fonts/', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/map-assets/fonts/Noto%20Sans%20Regular/0-255.pbf',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(GLYPH_BYTES.toString('utf8'));
  });

  it('serves sprite files under /map-assets/sprites/', async () => {
    const res = await app.inject({ method: 'GET', url: '/map-assets/sprites/light.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ train_station: { x: 0, y: 0, w: 16, h: 16 } });
  });

  it('returns 404 for a missing pmtiles file', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/nofile.pmtiles' });
    expect(res.statusCode).toBe(404);
  });

  it('supports range requests on the full payload (bytes=0-16383 like the pmtiles client)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tiles/sweden.pmtiles',
      headers: { range: 'bytes=0-16383' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe(PMTILES_BYTES.toString('utf8'));
  });
});
