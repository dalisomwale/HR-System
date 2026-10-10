import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    globalSetup: ['./test/global-setup.js'],
    // Tests share one MySQL test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
