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
  },
});
