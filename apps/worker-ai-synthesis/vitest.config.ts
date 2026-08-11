import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    include: ['src/**/__tests__/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
