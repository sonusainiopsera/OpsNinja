import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@opsninja/events': resolve(__dirname, '../packages/events/src/index.ts'),
    },
  },
});
