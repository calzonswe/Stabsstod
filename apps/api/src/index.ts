import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

dotenv.config();

const config = loadConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL });
const app = await buildApp({ config, pool });

async function bootstrapAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM users');
  if (Number(rows[0].c) > 0) {
    return;
  }
  const id = randomUUID();
  const passwordHash = await hash(config.ADMIN_PASSWORD);
  await pool.query(
    'INSERT INTO users (id, username, role, must_change_password, password_hash) VALUES ($1, $2, $3, $4, $5)',
    [id, config.ADMIN_USERNAME, 'admin', true, passwordHash],
  );
  console.log(`admin user bootstrapped: ${config.ADMIN_USERNAME} (must-change-password)`);
}

const start = async () => {
  try {
    await bootstrapAdmin();
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`stabsstod api listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error('failed to start api', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
};

void start();
