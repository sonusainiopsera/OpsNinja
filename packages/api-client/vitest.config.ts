import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.browser.ts', 'src/index.server.ts'],
      thresholds: { lines: 70, branches: 70, functions: 70, statements: 70 },
    },
  },
});
