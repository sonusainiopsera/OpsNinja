import { describe, it, expect } from 'vitest';
import { validateEnv, envSchema } from './env.schema';

const VALID_CONFIG = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  OIDC_ISSUER: 'https://auth.example.com',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  PORT: '3000',
  HMAC_SECRET: 'a-valid-hmac-secret-at-least-32-chars-long!!!',
  BUILD_SHA: 'abc123def456',
};

describe('envSchema / validateEnv', () => {
  it('accepts a fully valid configuration', () => {
    const result = validateEnv({ ...VALID_CONFIG });
    expect(result.DATABASE_URL).toBe(VALID_CONFIG.DATABASE_URL);
    expect(result.PORT).toBe(3000);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from string to number', () => {
    const result = validateEnv({ ...VALID_CONFIG, PORT: '8080' });
    expect(result.PORT).toBe(8080);
    expect(typeof result.PORT).toBe('number');
  });

  it('defaults LOG_LEVEL to "info" when omitted', () => {
    const { LOG_LEVEL: _, ...rest } = VALID_CONFIG;
    const result = validateEnv(rest);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('defaults NODE_ENV to "development" when omitted', () => {
    const { NODE_ENV: _, ...rest } = VALID_CONFIG;
    const result = validateEnv(rest);
    expect(result.NODE_ENV).toBe('development');
  });

  it('defaults PORT to 3000 when omitted', () => {
    const { PORT: _, ...rest } = VALID_CONFIG;
    const result = validateEnv(rest);
    expect(result.PORT).toBe(3000);
  });

  it('defaults BUILD_SHA to "local" when omitted', () => {
    const { BUILD_SHA: _, ...rest } = VALID_CONFIG;
    const result = validateEnv(rest);
    expect(result.BUILD_SHA).toBe('local');
  });

  // ── Missing required variables ─────────────────────────────────────────────

  it('throws a descriptive error when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...rest } = VALID_CONFIG;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL: _, ...rest } = VALID_CONFIG;
    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });

  it('throws when OIDC_ISSUER is missing', () => {
    const { OIDC_ISSUER: _, ...rest } = VALID_CONFIG;
    expect(() => validateEnv(rest)).toThrow(/OIDC_ISSUER/);
  });

  it('throws when HMAC_SECRET is missing', () => {
    const { HMAC_SECRET: _, ...rest } = VALID_CONFIG;
    expect(() => validateEnv(rest)).toThrow(/HMAC_SECRET/);
  });

  // ── Empty-string is treated as missing ────────────────────────────────────

  it('treats DATABASE_URL="" as missing and fails startup', () => {
    expect(() => validateEnv({ ...VALID_CONFIG, DATABASE_URL: '' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('treats REDIS_URL="" as missing and fails startup', () => {
    expect(() => validateEnv({ ...VALID_CONFIG, REDIS_URL: '' })).toThrow(/REDIS_URL/);
  });

  it('treats HMAC_SECRET="" as missing and fails startup', () => {
    expect(() => validateEnv({ ...VALID_CONFIG, HMAC_SECRET: '' })).toThrow(/HMAC_SECRET/);
  });

  // ── Malformed values ───────────────────────────────────────────────────────

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() =>
      validateEnv({ ...VALID_CONFIG, LOG_LEVEL: 'verbose' }),
    ).toThrow();
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...VALID_CONFIG, PORT: 'abc' })).toThrow();
  });

  it('rejects an HMAC_SECRET shorter than 32 characters', () => {
    expect(() =>
      validateEnv({ ...VALID_CONFIG, HMAC_SECRET: 'too-short' }),
    ).toThrow(/HMAC_SECRET/);
  });

  // ── Error message quality ──────────────────────────────────────────────────

  it('lists all offending keys in a single error message', () => {
    const empty = {};
    let errorMessage = '';
    try {
      validateEnv(empty);
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toContain('DATABASE_URL');
    expect(errorMessage).toContain('REDIS_URL');
    expect(errorMessage).toContain('OIDC_ISSUER');
    expect(errorMessage).toContain('HMAC_SECRET');
  });

  it('error message starts with descriptive prefix', () => {
    expect(() => validateEnv({})).toThrow(/Configuration validation failed/);
  });

  // ── Zod schema direct access ───────────────────────────────────────────────

  it('envSchema.parse() is also callable directly', () => {
    const result = envSchema.parse({ ...VALID_CONFIG });
    expect(result.DATABASE_URL).toBe(VALID_CONFIG.DATABASE_URL);
  });
});
