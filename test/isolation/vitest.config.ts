/**
 * Vitest configuration for the isolation test suite.
 *
 * Path aliases allow tests to import @opsninja/filter-compiler directly
 * from source without requiring a compiled build.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@opsninja/filter-compiler': path.resolve(
        __dirname,
        '../../packages/filter-compiler/src/index.ts',
      ),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.spec.ts'],
    testTimeout: 30_000,
  },
});
