// M38: security headers.
//
// The API sets HSTS, X-Content-Type-Options, Referrer-Policy and a strict
// Content-Security-Policy on every response (plan.md §7). The organisation
// runs its own reverse proxy in front of the API, so the headers are asserted
// here at the API level: whatever the proxy forwards, the headers are already
// present.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

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
    // Serialize DDL across test files to avoid deadlocks on concurrent migrations.
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

describe('security headers (M38)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let distDir: string;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);
    await pool.end();

    // A minimal "built web app" so the static + SPA-fallback routes exist.
    distDir = mkdtempSync(join(tmpdir(), 'stabsstod-webdist-'));
    writeFileSync(
      join(distDir, 'index.html'),
      '<!doctype html><html><head><title>stabsstod</title></head><body>app</body></html>',
    );
    writeFileSync(join(distDir, 'sw.js'), '/* service worker */');
    process.env.WEB_DIST = distDir;

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
    app = await buildApp({ config });
  });

  afterAll(async () => {
    delete process.env.WEB_DIST;
    rmSync(distDir, { recursive: true, force: true });
    await app.close();
  });

  function expectSecurityHeaders(res: { headers: unknown }) {
    const headers = res.headers as Record<string, string>;
    expect(headers['strict-transport-security']).toBe('max-age=31536000');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    const csp = headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("img-src 'self' blob: data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    // No remote origin may appear anywhere in the policy.
    expect(csp).not.toMatch(/https?:\/\//);
  }

  it('sets the security headers on API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res);
  });

  it('sets the security headers on the SPA index (HTML navigation)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/incidents',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('stabsstod');
    expectSecurityHeaders(res);
  });

  it('sets the security headers on static assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res);
  });
});
