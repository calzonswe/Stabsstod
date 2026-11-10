import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { loadConfig, type Env } from './config.js';

export interface BuildAppOptions {
  config?: Env;
  pool?: Pool;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const config = opts.config ?? loadConfig();
  const pool = opts.pool ?? new Pool({ connectionString: config.DATABASE_URL });

  const app = Fastify({ logger: false });

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

  app.addHook('onClose', async () => {
    if (!opts.pool) {
      await pool.end().catch(() => undefined);
    }
  });

  return app;
}
