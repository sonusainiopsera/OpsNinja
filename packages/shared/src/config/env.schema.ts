import { z } from 'zod';

/**
 * Non-empty string helper — treats empty string the same as missing.
 * This prevents `KEY=` (present-but-empty) from silently passing validation.
 */
const nonEmpty = (key: string) =>
  z.string({ required_error: `${key} is required` }).min(1, `${key} must not be empty`);

/**
 * Zod schema for all required environment variables.
 * Startup aborts with a descriptive error listing offending keys
 * when any variable is missing, empty, or malformed.
 */
export const envSchema = z.object({
  DATABASE_URL: nonEmpty('DATABASE_URL'),
  REDIS_URL: nonEmpty('REDIS_URL'),
  OIDC_ISSUER: nonEmpty('OIDC_ISSUER'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Secret key used for HMAC-tagging cursor payloads.
   * Must be at least 32 characters to provide adequate entropy.
   */
  HMAC_SECRET: z
    .string({ required_error: 'HMAC_SECRET is required' })
    .min(32, 'HMAC_SECRET must be at least 32 characters'),
  /**
   * Git SHA or semantic version injected at build time.
   * Used in /healthz response for observability.
   */
  BUILD_SHA: z.string().min(1).default('local'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables against the schema.
 * Throws with a descriptive message listing all invalid/missing keys
 * so startup fails fast with actionable output.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  [${e.path.join('.')}] ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed — fix the following before starting:\n${errors}`);
  }
  return result.data;
}
