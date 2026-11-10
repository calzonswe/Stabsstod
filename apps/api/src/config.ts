import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  SITE_ADDRESS: z.string().default('localhost'),
  TZ: z.string().default('Europe/Stockholm'),
  POSTGRES_PASSWORD: z.string().min(1),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}`,
    );
  }
  return parsed.data;
}
