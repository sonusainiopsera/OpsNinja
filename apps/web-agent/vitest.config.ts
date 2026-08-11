import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
      exclude: ['app/**', 'e2e/**', '**/*.d.ts', 'next.config.ts', 'vitest*'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '@opsninja/api-client': resolve(__dirname, '../../packages/api-client/src/index.browser.ts'),
      '@opsninja/filter-compiler': resolve(__dirname, '../../packages/filter-compiler/src/index.ts'),
      '@opsninja/ui-kit': resolve(__dirname, '../../packages/ui-kit/src/index.ts'),
    },
  },
});
