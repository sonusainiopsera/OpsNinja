/**
 * Vitest configuration for the OpenAPI contract test suite.
 *
 * Path aliases allow tests to import @opsninja/api-types directly
 * from source without requiring a compiled build.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@opsninja/api-types': path.resolve(
        __dirname,
        '../../packages/api-types/src/index.ts',
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
