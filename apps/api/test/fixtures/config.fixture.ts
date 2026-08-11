/**
 * In-memory configuration fixture for integration and unit tests.
 *
 * Provides syntactically valid environment variables that satisfy the Zod
 * schema without requiring any external services.  The entire test suite
 * can run offline as long as health indicators are stubbed.
 *
 * Usage:
 * ```typescript
 * beforeAll(() => {
 *   Object.assign(process.env, testEnvConfig);
 * });
 * ```
 */
export const testEnvConfig: Record<string, string> = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/opsninja_test',
  REDIS_URL: 'redis://localhost:6379/1',
  OIDC_ISSUER: 'https://auth.test.opsninja.io',
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  PORT: '0', // Let the OS assign a random port for integration tests
  HMAC_SECRET: 'integration-test-hmac-secret-at-least-32-chars!!',
  BUILD_SHA: 'test-build-sha-0000000',
};
