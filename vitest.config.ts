import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest runs the pure logic in `src/core` plus the integration smoke test.
 * Phaser is aliased to a lightweight fake so the real scenes can run in Node without a browser
 * (there is no GPU on the VPS, so nothing is ever really rendered here).
 */
export default defineConfig({
  resolve: {
    alias: { phaser: fileURLToPath(new URL('./tests/mocks/phaser-mock.ts', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each file gets a fresh module registry: the smoke test installs browser globals of its own.
    isolate: true,
    testTimeout: 60_000,
    reporters: ['default'],
  },
});
