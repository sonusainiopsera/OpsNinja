import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@opsninja/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'src/common/filters/**/*.ts',
        'src/common/pipes/**/*.ts',
        'src/observability/**/*.ts',
        'src/health/**/*.ts',
        'src/config/**/*.ts',
      ],
      exclude: ['**/*.spec.ts', '**/test/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
  },
});
