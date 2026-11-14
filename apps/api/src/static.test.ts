// Static + SPA serving tests — plan.md §5 (offline-first PWA) / M29
//
// Accept: the built web app (WEB_DIST, default apps/web/dist) is served so that
//   - hashed assets resolve from dist/assets/ (e.g. /assets/index-*.js),
//   - root-level files resolve (e.g. /manifest.webmanifest, /sw.js),
//   - SPA client routes (/login, /incidents/<id>) return index.html when the
//     client asks for HTML (deep-link / refresh works),
//   - anything else that matches no file and no API route is a 404,
//   - API routes are unaffected.

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

const INDEX_HTML =
  '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Stabsstöd</title></head><body><div id="root"></div></body></html>';
const ASSET_JS = "console.log('asset-abc');";
const MANIFEST_JSON = '{"name":"Stabsstöd"}';

let distDir: string;
let app: FastifyInstance;

beforeAll(async () => {
  distDir = mkdtempSync(join(tmpdir(), 'stabsstod-dist-'));
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), INDEX_HTML, 'utf8');
  writeFileSync(join(distDir, 'assets', 'index-ABC.js'), ASSET_JS, 'utf8');
  writeFileSync(join(distDir, 'manifest.webmanifest'), MANIFEST_JSON, 'utf8');
  process.env.WEB_DIST = distDir;
  app = await buildApp({ config: loadConfig(testEnv()) });
});

afterAll(async () => {
  await app.close();
  rmSync(distDir, { recursive: true, force: true });
  delete process.env.WEB_DIST;
});

describe('static + SPA serving (WEB_DIST)', () => {
  it('serves hashed assets from dist/assets/', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-ABC.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toBe(ASSET_JS);
  });

  it('serves root-level files such as the PWA manifest', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Stabsstöd' });
  });

  it('serves index.html for top-level SPA routes when the client asks for HTML', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/login',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves index.html for nested SPA routes (deep link / refresh)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/incidents/abc123',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('returns a JSON 404 for a missing non-HTML asset', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope.js' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ statusCode: 404 });
  });

  it('leaves API routes unaffected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });
});
