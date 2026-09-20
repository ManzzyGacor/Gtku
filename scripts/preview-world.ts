/** Render the whole generated world (ground + props as coloured boxes/sprites) to .preview/world.png. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHUNK_TILES, TILE, WORLD_CHUNKS_H, WORLD_CHUNKS_W, WORLD_PX_H, WORLD_PX_W } from '../src/config';
import { buildAllSheets } from '../src/art/index';
import { Pixmap } from '../src/art/pixmap';
import { bakeChunk } from '../src/world/bake';
import { GeneratedWorld } from '../src/world/worldgen';
import { PROPS } from '../src/world/props';
import { encodePng, upscale } from './png';

const out = new URL('../.preview/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const sheets = buildAllSheets();
const tiles = sheets.find((s) => s.key === 'tiles')!;
const props = sheets.find((s) => s.key === 'props');
const world = new GeneratedWorld();
const full = new Pixmap(WORLD_PX_W, WORLD_PX_H);
for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
  for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) full.blit(bakeChunk(world, tiles, cx, cy, 0), cx * CHUNK_TILES * TILE, cy * CHUNK_TILES * TILE);

// props, y-sorted
const all: { type: keyof typeof PROPS; x: number; y: number; flip?: boolean }[] = [];
for (let cy = 0; cy < WORLD_CHUNKS_H; cy++) for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) all.push(...world.chunk(cx, cy).props);
all.sort((a, b) => a.y - b.y);
for (const p of all) {
  const def = PROPS[p.type];
  const name = def.frames ? `${p.type}_0` : p.type;
  const f = props?.frames[name];
  if (props && f) {
    full.blit(props.pixmap, Math.round(p.x - (f.ax ?? f.w / 2)), Math.round(p.y - (f.ay ?? f.h)), { flipX: p.flip }, f.x, f.y, f.w, f.h);
  } else {
    full.rect(p.x - 6, p.y - 12, 12, 12, 0xff00ff, 200);
  }
}
// spawns / npcs / markers
for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
  for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) {
    const c = world.chunk(cx, cy);
    for (const s of c.spawns) full.rect(s.x - 3, s.y - 3, 6, 6, s.kind === 'boss' ? 0xff2222 : s.kind === 'bats' ? 0xaa44ff : s.kind === 'archer' ? 0xffaa22 : 0x44ff44);
    for (const n of c.npcs) full.rect(n.x - 3, n.y - 3, 6, 6, 0x33ddff);
  }
const m = world.markers;
full.rect(m.playerStart.x - 3, m.playerStart.y - 3, 6, 6, 0xffffff);
for (const c of m.checkpoints) full.rect(c.x - 3, c.y - 3, 6, 6, 0xffff00);
writeFileSync(`${out}world.png`, encodePng(full));
// halves for viewing at readable size
const half = (x0: number, w: number, name: string): void => {
  const sub = full.sub(x0, 0, w, WORLD_PX_H);
  writeFileSync(`${out}${name}.png`, encodePng(upscale(sub, 1)));
};
half(0, 704, 'world-village');
half(704, 704, 'world-forest');
half(1408, 640, 'world-cave');
console.log(`world: ${WORLD_PX_W}x${WORLD_PX_H}, props=${all.length}`);
