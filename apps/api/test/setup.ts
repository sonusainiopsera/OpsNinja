/**
 * Vitest global test setup — runs before every test file.
 * Seeds process.env with the in-memory test config fixture so the
 * NestJS ConfigModule Zod validator passes without real services.
 */
import { testEnvConfig } from './fixtures/config.fixture';

// Override process.env before any module is imported
Object.assign(process.env, testEnvConfig);
