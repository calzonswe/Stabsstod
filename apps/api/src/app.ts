import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { Pool } from 'pg';
import { loadConfig, type Env } from './config.js';
import { registerAuth } from './auth.js';
import { registerAdmin } from './admin.js';
import { registerIncidents } from './incidents.js';
import { registerSync } from './sync.js';
import { registerAttachments } from './attachments.js';

const __dirname = dirname(fileURLToPath(import.meta.url)); // /app/apps/api/src
const WEB_DIST = __dirname + '/../../web/dist'; // /app/apps/web/dist
const DEFAULT_MAPS_DIR = __dirname + '/../../../data/maps'; // /app/data/maps

export interface BuildAppOptions {
  config?: Env;
  pool?: Pool;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const pool = opts.pool ?? new Pool({ connectionString: config.DATABASE_URL });

  const app = Fastify({ logger: false });

  await app.register(fastifyCookie);

  // Serve the built web app. The static plugin maps URLs straight onto the
  // dist directory: /assets/index-*.js → dist/assets/index-*.js, /sw.js →
  // dist/sw.js, /manifest.webmanifest, /pwa-*.svg, and so on.
  //
  // A URL that matches no file (and no API or map route) reaches the
  // not-found handler below: browsers asking for HTML — SPA navigations such
  // as /login or /incidents/<id> — get index.html, anything else gets a 404.
  const webDist = process.env.WEB_DIST ?? WEB_DIST;
  const webAvailable = existsSync(webDist);
  if (webAvailable) {
    await app.register(async (scope) => {
      scope.register(fastifyStatic, { root: webDist });
      scope.setNotFoundHandler(async (req, reply) => {
        const wantsHtml =
          req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');
        if (wantsHtml) {
          const html = await readFile(join(webDist, 'index.html'), 'utf8');
          return reply.type('text/html; charset=utf-8').send(html);
        }
        return reply.code(404).send({
          message: 'Not Found',
          error: 'Not Found',
          statusCode: 404,
        });
      });
    });
  }

  // Serve map tiles (PMTiles) and map assets (glyphs/sprites) from the maps
  // directory (MAPS_DIR, default data/maps). @fastify/static (via
  // @fastify/send) supports the HTTP range requests the pmtiles:// protocol
  // relies on.
  // Each registration is encapsulated in its own scope: the plugin decorates
  // reply.sendFile, which Fastify only allows once per encapsulation context.
  // /tiles/sweden.pmtiles → <maps>/sweden.pmtiles
  // /map-assets/fonts/... → <maps>/map-assets/fonts/...
  const mapsDir = process.env.MAPS_DIR ?? DEFAULT_MAPS_DIR;
  if (existsSync(mapsDir)) {
    await app.register(async (scope) =>
      scope.register(fastifyStatic, { root: mapsDir, prefix: '/tiles' }),
    );
    await app.register(async (scope) =>
      scope.register(fastifyStatic, { root: join(mapsDir, 'map-assets'), prefix: '/map-assets' }),
    );
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
  registerIncidents(app, pool);
  registerSync(app, pool);
  registerAttachments(app, pool);

  app.addHook('onClose', async () => {
    if (!opts.pool) {
      await pool.end().catch(() => undefined);
    }
  });

  return app;
}
