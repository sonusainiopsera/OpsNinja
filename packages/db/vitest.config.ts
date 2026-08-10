import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Use the extended tsconfig that includes test/ and scripts/.
  // vitest uses esbuild by default; this tsconfig is for type-checking only.
  test: {
    // Allow tests to spin up Docker containers.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Run each test file in its own process to avoid container conflicts.
    pool: 'forks',
    // Run files sequentially in CI to avoid exhausting Docker resources.
    // Set to undefined locally to allow parallel execution.
    maxConcurrency: process.env['CI'] ? 1 : undefined,
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    reporters: ['verbose'],
  },
});
