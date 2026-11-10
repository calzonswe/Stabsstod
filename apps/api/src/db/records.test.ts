import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url)); // /app/apps/api/src/db
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'drizzle'); // /app/drizzle

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:stabsstod@localhost:5432/stabsstod';

async function applyMigrations(pool: Pool) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

describe('records table (append-only)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('INSERT works and UPDATE / DELETE throw', async () => {
    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // INSERT succeeds
    await pool.query(
      `INSERT INTO records (
        id, entity_id, entity_type, incident_id, parent_ids, function_id,
        author_id, device_id, hlc, created_at_client, kind, schema_version,
        payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        'entity-1',
        'logEntry',
        'incident-1',
        '{}',
        null,
        'author-1',
        'device-1',
        '000000000000001-00001-device-1',
        new Date().toISOString(),
        'put',
        1,
        { message: 'hello' },
      ],
    );

    // Verify the row was inserted and server_seq assigned
    const inserted = await pool.query('SELECT id, server_seq FROM records WHERE id = $1', [id]);
    expect(inserted.rowCount).toBe(1);
    expect(Number(inserted.rows[0].server_seq)).toBeGreaterThanOrEqual(1);

    // UPDATE is rejected by the trigger
    await expect(
      pool.query('UPDATE records SET payload = $1 WHERE id = $2', [{ message: 'changed' }, id]),
    ).rejects.toThrow(/append-only.*UPDATE/i);

    // DELETE is rejected by the trigger
    await expect(pool.query('DELETE FROM records WHERE id = $1', [id])).rejects.toThrow(
      /append-only.*DELETE/i,
    );

    // Row still present (update/delete did not mutate it)
    const stillThere = await pool.query('SELECT id, payload FROM records WHERE id = $1', [id]);
    expect(stillThere.rows[0].payload).toEqual({ message: 'hello' });
  });
});
