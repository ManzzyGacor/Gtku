/**
 * Build the area data packs and their manifest (Node only).
 *
 * Bakes every chunk's ground texture with the same `bakeChunk` the game runs on the phone, deflates
 * it, groups the chunks by area, splits each area into files of at most 20 MB, and names every file
 * after its own SHA-256 — so a file never changes under a URL, and a new build of the art is a new
 * set of URLs that caches can tell apart from the old one.
 *
 * Used by the Vite plugin in vite.config.ts: served from memory by the dev server, emitted into
 * `dist/data/` by `vite build`. Can also be run by hand to see the sizes:
 *
 *   npx tsx scripts/areaPacks.ts
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { CHUNK_TILES, WORLD_CHUNKS_H, WORLD_CHUNKS_W } from '../src/config';
import { bakeChunk } from '../src/art/bake';
import { buildTileSheet } from '../src/art/tiles';
import { areaAtTile, type AreaId } from '../src/core/world/areas';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { encodePack, splitEntries, type PackEntry } from '../src/core/download/pack';
import type { DataManifest } from '../src/core/download/manifest';

export const AREA_ORDER: AreaId[] = ['village', 'forest', 'cave'];

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Which area a chunk belongs to: the area under its centre column. */
export function chunkArea(cx: number): AreaId {
  return areaAtTile(cx * CHUNK_TILES + CHUNK_TILES / 2);
}

/** Every file to serve under `/data/`, by file name, including `manifest.json`. */
export function buildAreaPacks(): Map<string, Uint8Array> {
  const world = new GeneratedWorld();
  const sheet = buildTileSheet();
  const byArea = new Map<AreaId, PackEntry[]>();
  for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
    for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) {
      const pm = bakeChunk(world, sheet, cx, cy, 0);
      const raw = Buffer.from(pm.data.buffer, pm.data.byteOffset, pm.data.byteLength);
      // zlib-wrapped deflate: what DecompressionStream('deflate') expects on the phone
      const payload = new Uint8Array(deflateSync(raw, { level: 9 }));
      const area = chunkArea(cx);
      const list = byArea.get(area) ?? [];
      list.push({ cx, cy, payload });
      byArea.set(area, list);
    }

  const out = new Map<string, Uint8Array>();
  const manifest: DataManifest = { format: 1, core: 'village', areas: {} };
  for (const area of AREA_ORDER) {
    const entries = byArea.get(area) ?? [];
    const files = splitEntries(entries).map((group) => encodePack(group));
    const hashes = files.map(sha);
    const version = sha(new TextEncoder().encode(hashes.join(''))).slice(0, 16);
    manifest.areas[area] = {
      version,
      bytes: files.reduce((n, f) => n + f.length, 0),
      chunks: entries.length,
      files: files.map((bytes, i) => {
        const url = `${area}-${hashes[i].slice(0, 16)}-${i}.bin`;
        out.set(url, bytes);
        return { url, bytes: bytes.length, sha256: hashes[i] };
      }),
    };
  }
  out.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 1)));
  return out;
}

// run directly: print the sizes
if (process.argv[1]?.endsWith('areaPacks.ts')) {
  const t0 = Date.now();
  const files = buildAreaPacks();
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as DataManifest;
  for (const [id, a] of Object.entries(manifest.areas))
    console.log(`${id.padEnd(8)} ${String(a.chunks).padStart(3)} chunk  ${(a.bytes / 1024).toFixed(0).padStart(5)} KB  ${a.files.length} berkas  versi ${a.version}`);
  console.log(`dibangun dalam ${Date.now() - t0} ms`);
}
