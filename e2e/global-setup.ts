// Playwright global setup — M29 (first real run of the e2e suite).
//
// Runs after the webServer has started the Docker stack (see
// playwright.config.ts) and before any test. Idempotently ensures the known
// e2e admin user exists in the runtime database:
//
//   username: admin, password: stabsstod, role: admin,
//   must_change_password: false
//
// We cannot rely on the API's bootstrapAdmin() for this: it only creates the
// admin user when the `users` table is empty, and the API unit tests share
// this same database (leaving test users behind, so the table is never
// empty).

import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:stabsstod@localhost:5432/stabsstod';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'stabsstod';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(connectionString: string): Promise<Client> {
  let lastError: unknown;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      if (Date.now() > deadline) break;
      await sleep(2_000);
    }
  }
  throw lastError;
}

export default async function globalSetup(): Promise<void> {
  const client = await connectWithRetry(DATABASE_URL);
  try {
    const passwordHash = await hash(ADMIN_PASSWORD);
    await client.query(
      `INSERT INTO users (id, username, role, must_change_password, password_hash)
       VALUES ($1, $2, 'admin', false, $3)
       ON CONFLICT (username) DO UPDATE SET
         role = 'admin',
         must_change_password = false,
         disabled = false,
         password_hash = EXCLUDED.password_hash`,
      [randomUUID(), ADMIN_USERNAME, passwordHash],
    );
  } finally {
    await client.end();
  }
}
