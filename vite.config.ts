import { defineConfig } from 'vite';

// Game is exposed through a Cloudflare Tunnel at https://game.varesa.mom,
// so the dev server only listens on loopback and trusts that host.
const PUBLIC_HOST = 'game.varesa.mom';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: [PUBLIC_HOST],
    hmr: {
      protocol: 'wss',
      clientPort: 443,
      host: PUBLIC_HOST,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: [PUBLIC_HOST],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        /*
         * Three.js gets its own chunk, separate from the game code.
         *
         * It is by far the biggest thing we ship and the thing that changes least: splitting it
         * out means a game update re-downloads ~90 kB of game code instead of ~730 kB, because the
         * player's browser already has the renderer cached under an unchanged file name. It costs
         * one extra request on a cold load, which HTTP/2 makes free.
         */
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
