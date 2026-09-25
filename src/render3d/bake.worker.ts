/**
 * Chunk ground baking, off the main thread.
 *
 * Baking a chunk's ground texture is the heaviest single piece of JavaScript in the game: 11–22 ms
 * in Node on the VPS, several times that on a phone — a visible hitch every time a new chunk comes
 * into view while walking. Here it runs in a worker: the worker builds its own copy of the world
 * (it is generated from a fixed seed, so it is the same world — and the same one the area packs
 * were baked from) and its own tile sheet, then bakes whatever the main thread asks for and hands
 * the pixels back without copying them.
 */
import { buildTileSheet } from '../art/tiles';
import { bakeChunk } from '../art/bake';
import { GeneratedWorld } from '../core/world/worldgen';

const world = new GeneratedWorld();
const sheet = buildTileSheet();

interface Req {
  id: number;
  cx: number;
  cy: number;
}

self.addEventListener('message', (ev: MessageEvent<Req>) => {
  const { id, cx, cy } = ev.data;
  try {
    const pm = bakeChunk(world, sheet, cx, cy, 0);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    (self as unknown as Worker).postMessage({ id, cx, cy, w: pm.w, h: pm.h, data: pm.data }, [pm.data.buffer]);
  } catch {
    // (a worker's postMessage has no targetOrigin: it only ever talks to the page that made it)
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    (self as unknown as Worker).postMessage({ id, cx, cy, w: 0, h: 0, data: null });
  }
});
