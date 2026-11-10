import { pgTable, text } from 'drizzle-orm/pg-core';

// Core schema arrives in M4. This stub keeps drizzle-kit configured in M1.
export const __m1_stub = pgTable('__m1_stub', {
  id: text('id').primaryKey(),
});
