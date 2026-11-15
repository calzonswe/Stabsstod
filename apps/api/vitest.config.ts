import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // The api tests share one Postgres database, and several suites
    // (attachments, sync, export, m36) TRUNCATE shared tables in beforeAll.
    // Files must therefore run one at a time — parallel files race the
    // truncate and fail with 403/500 (missing rows created by a sibling
    // suite).
    fileParallelism: false,
  },
});
