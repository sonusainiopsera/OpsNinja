import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
      include: ['src/**'],
      exclude: ['src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@opsninja/filter-compiler': path.resolve(__dirname, 'src/index.ts'),
    },
  },
});
