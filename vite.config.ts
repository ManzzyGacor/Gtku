import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Game is exposed through a Cloudflare Tunnel at https://game.varesa.mom,
// so the dev server only listens on loopback and trusts that host.
const PUBLIC_HOST = 'game.varesa.mom';

export default defineConfig({
  base: './',
  resolve: {
    // Use Phaser's pre-minified ESM build: the dev pre-bundle shrinks from ~22 MB to ~1.5 MB, which matters over the tunnel on a phone.
    // (Types still come from the `phaser` package.)
    alias: { phaser: fileURLToPath(new URL('./node_modules/phaser/dist/phaser.esm.min.js', import.meta.url)) },
  },
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
  },
});
