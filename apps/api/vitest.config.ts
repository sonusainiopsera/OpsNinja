import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    maxConcurrency: process.env['CI'] ? 1 : undefined,
    include: ['src/**/__tests__/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
