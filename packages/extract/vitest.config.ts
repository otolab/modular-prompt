import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      concurrent: false,
    },
    testTimeout: 10_000,
    hookTimeout: 300_000,
  },
});
