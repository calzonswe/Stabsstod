import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url)); // /app/apps/api/src
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'drizzle'); // /app/drizzle
const ADVISORY_LOCK_ID = 0x534f4444;

async function main() {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Advisory lock serializes migrations across api instances.
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);

    // Migration tracking table (idempotent).
    await client.query(`
      CREATE TABLE IF NOT EXISTS __meta (
        migration_id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const already = await client.query('SELECT 1 FROM __meta WHERE migration_id = $1', [file]);
      if ((already.rowCount ?? 0) > 0) {
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO __meta (migration_id) VALUES ($1)', [file]);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    client.release();
    await pool.end();
  }
}

void main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
