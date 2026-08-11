import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['unit/**/*.spec.ts'],
    testTimeout: 10_000,
  },
});
