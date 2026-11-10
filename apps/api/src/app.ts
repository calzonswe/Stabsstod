import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { Pool } from 'pg';
import { loadConfig, type Env } from './config.js';
import { registerAuth } from './auth.js';
import { registerAdmin } from './admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url)); // /app/apps/api/src
const WEB_DIST = __dirname + '/../../web/dist'; // /app/apps/web/dist

export interface BuildAppOptions {
  config?: Env;
  pool?: Pool;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const pool = opts.pool ?? new Pool({ connectionString: config.DATABASE_URL });

  const app = Fastify({ logger: false });

  await app.register(fastifyCookie);

  const webAvailable = existsSync(WEB_DIST);
  if (webAvailable) {
    // Serve built web assets under /assets.
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: '/assets',
    });
  }

  app.get('/api/health', async (_request, reply) => {
    let db = false;
    try {
      await pool.query('SELECT 1');
      db = true;
    } catch {
      // Database unreachable: report db: false while keeping ok: true.
    }
    return reply.send({ ok: true, db });
  });

  registerAuth(app, config, pool);
  registerAdmin(app, pool);

  // SPA: serve index.html for the root and any client-side route that isn't
  // an API route or a static asset. API routes (/api/*) registered above take
  // precedence over this wildcard.
  if (webAvailable) {
    app.get('/', (_req, reply) => reply.sendFile('index.html', WEB_DIST));
    app.get('/*', (_req, reply) => reply.sendFile('index.html', WEB_DIST));
  }

  app.addHook('onClose', async () => {
    if (!opts.pool) {
      await pool.end().catch(() => undefined);
    }
  });

  return app;
}
