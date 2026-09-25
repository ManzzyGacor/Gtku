import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the pure logic in `src/core`, the renderer-free parts of `src/render3d`, and the
 * headless playthrough in `tests/playthrough.test.ts`.
 *
 * Three.js scene-graph objects work fine in Node — only `WebGLRenderer` needs a real context —
 * so the tests build real meshes, real enemies and a real quest, and never render a pixel. There
 * is no GPU on the VPS; that is what the phone is for.
 */
export default defineConfig({
  test: {
    // the game's tests, and the server's (server/tests: the API on in-memory storage)
    include: ['tests/**/*.test.ts', 'server/tests/**/*.test.ts'],
    environment: 'node',
    // Each file gets a fresh module registry: several tests install browser globals of their own.
    isolate: true,
    testTimeout: 60_000,
    reporters: ['default'],
  },
});
