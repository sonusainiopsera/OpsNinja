import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    maxConcurrency: 1,
    include: ['test/**/*.e2e-spec.ts'],
    reporters: ['verbose'],
  },
});
