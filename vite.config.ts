import { defineConfig, type Plugin } from 'vite';
import { buildAreaPacks } from './scripts/areaPacks';

/**
 * The area data packs (Batch 6): pre-baked chunk ground, one file set per area, plus a manifest.
 *
 * Generated from the same code the game runs, so they can never drift from what the phone would
 * bake itself. The dev server builds them once, on the first request, and serves them from memory;
 * `vite build` emits them into dist/data/. Nothing is committed to the repository — a binary that
 * can be regenerated at will does not belong in git history.
 */
function areaPacks(): Plugin {
  let files: Map<string, Uint8Array> | null = null;
  const get = (): Map<string, Uint8Array> => (files ??= buildAreaPacks());
  return {
    name: 'lentera-area-packs',
    configureServer(server) {
      // Build them as the server starts, not on the phone's first request: generating takes a few
      // seconds of CPU, and doing it inside a request would stall every other file the dev server
      // is serving at that moment.
      setTimeout(() => get(), 0);
      server.middlewares.use('/data/', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        const bytes = get().get(name);
        if (!bytes) {
          next();
          return;
        }
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        // the manifest is always re-checked; the packs are content-addressed and never change
        res.setHeader('Cache-Control', name.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable');
        res.setHeader('Content-Length', String(bytes.length));
        res.end(Buffer.from(bytes));
      });
    },
    generateBundle() {
      for (const [name, bytes] of get()) this.emitFile({ type: 'asset', fileName: `data/${name}`, source: bytes });
    },
  };
}

// Game is exposed through a Cloudflare Tunnel at https://game.varesa.mom,
// so the dev server only listens on loopback and trusts that host.
const PUBLIC_HOST = 'game.varesa.mom';

export default defineConfig({
  base: './',
  plugins: [areaPacks()],
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
