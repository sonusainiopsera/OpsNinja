import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    typecheck: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@opsninja/db': resolve(__dirname, '../../packages/db/src/index.ts'),
      '@opsninja/observability': resolve(__dirname, './src/index.ts'),
    },
  },
});
