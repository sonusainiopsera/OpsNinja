import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@opsninja/events': resolve(__dirname, '../../packages/events/src/index.ts'),
      '@opsninja/webhooks': resolve(__dirname, '../../packages/webhooks/src/index.ts'),
    },
  },
});
