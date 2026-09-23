/**
 * Chunk baker: turns the ground layer of one 16x16-tile chunk into a 256x256 Pixmap.
 * Shared by the game (→ canvas texture) and the Node preview tool, so previews match the game exactly.
 */
import { CHUNK_PX, CHUNK_TILES, TILE } from '../config';
import { hash2 } from '../core/rng';
import type { Sheet } from './sheet';
import { VARIANTS, WATER_FRAMES } from './tiles';
import { Pixmap } from './pixmap';
import type { WorldSource } from '../core/world/source';
import { isGrassy, isWater, T, TILE_INFO } from '../core/world/tiles';

const SIDE_DELTAS: [string, number, number][] = [
  ['n', 0, -1],
  ['e', 1, 0],
  ['s', 0, 1],
  ['w', -1, 0],
];

/** Does this chunk contain tiles that animate (→ needs WATER_FRAMES baked frames)? */
export function chunkIsAnimated(world: WorldSource, cx: number, cy: number): boolean {
  for (let y = 0; y < CHUNK_TILES; y++)
    for (let x = 0; x < CHUNK_TILES; x++) if (TILE_INFO[world.tileAt(cx * CHUNK_TILES + x, cy * CHUNK_TILES + y)]?.animated) return true;
  return false;
}

function blitFrame(dst: Pixmap, sheet: Sheet, name: string, dx: number, dy: number): void {
  const f = sheet.frames[name];
  if (!f) throw new Error(`Missing tile frame "${name}"`);
  dst.blit(sheet.pixmap, dx, dy, {}, f.x, f.y, f.w, f.h);
}

export function bakeChunk(world: WorldSource, sheet: Sheet, cx: number, cy: number, frame = 0): Pixmap {
  const out = new Pixmap(CHUNK_PX, CHUNK_PX);
  for (let ly = 0; ly < CHUNK_TILES; ly++) {
    for (let lx = 0; lx < CHUNK_TILES; lx++) {
      const tx = cx * CHUNK_TILES + lx;
      const ty = cy * CHUNK_TILES + ly;
      const t = world.tileAt(tx, ty);
      const h = hash2(tx, ty, 7);
      const dx = lx * TILE;
      const dy = ly * TILE;
      const put = (name: string): void => blitFrame(out, sheet, name, dx, dy);
      const nb = (ox: number, oy: number): number => world.tileAt(tx + ox, ty + oy);

      switch (t) {
        case T.GRASS:
          put(`grass_${h % VARIANTS.grass}`);
          break;
        case T.FLOWERS:
          put(`flowers_${h % VARIANTS.flowerGrass}`);
          break;
        case T.FOREST:
          put(`forest_${h % VARIANTS.forest}`);
          break;
        case T.DIRT:
          put(`dirt_${h % VARIANTS.dirt}`);
          break;
        case T.COBBLE:
          put(`cobble_${h % VARIANTS.cobble}`);
          break;
        case T.SAND:
          put(`sand_${h % VARIANTS.sand}`);
          break;
        case T.WATER:
          put(`water_${h % VARIANTS.water}_${(frame + (h >>> 8)) % WATER_FRAMES}`);
          break;
        case T.SHALLOW:
          put(`shallow_${h % VARIANTS.shallow}_${(frame + (h >>> 8)) % WATER_FRAMES}`);
          break;
        case T.CAVE:
          put(`cave_${h % VARIANTS.cave}`);
          break;
        case T.ARENA:
          put(`arena_${h % VARIANTS.arena}`);
          break;
        case T.WALL:
          if (nb(0, 1) !== T.WALL) put(`wallface_${h % VARIANTS.wallFace}`);
          else put(`walltop_${h % VARIANTS.wallTop}`);
          break;
        case T.BRIDGE_H:
          put(`water_${h % VARIANTS.water}_${(frame + (h >>> 8)) % WATER_FRAMES}`);
          put(`bridgeh_${h % VARIANTS.bridge}`);
          break;
        case T.BRIDGE_V:
          put(`water_${h % VARIANTS.water}_${(frame + (h >>> 8)) % WATER_FRAMES}`);
          put(`bridgev_${h % VARIANTS.bridge}`);
          break;
        default:
          put(`grass_0`);
      }

      // ── overlays ──
      if (isWater(t)) {
        for (const [s, ox, oy] of SIDE_DELTAS) {
          const n = nb(ox, oy);
          if (!isWater(n) && n !== T.BRIDGE_H && n !== T.BRIDGE_V) put(`foam_${s}_${(frame + (h >>> 5)) % WATER_FRAMES}`);
        }
      } else if (t === T.DIRT || t === T.COBBLE || t === T.SAND) {
        for (const [s, ox, oy] of SIDE_DELTAS) if (isGrassy(nb(ox, oy))) put(`fringe_${s}_${(h >>> 3) % 2}`);
      } else if (t === T.CAVE || t === T.ARENA) {
        for (const [s, ox, oy] of SIDE_DELTAS) if (nb(ox, oy) === T.WALL) put(`shadow_${s}`);
      }
    }
  }
  return out;
}


/**
 * A 16x16 mask of where the water is in one chunk: one texel per tile, alpha marks water and the
 * red channel says how deep (0 = shallow, 1 = open water).
 *
 * The 3D renderer lays a rippling surface over the baked ground and uses this to know which tiles
 * it may touch. One byte per tile is all the resolution needed — the ripple pattern itself comes
 * from world coordinates, not from this texture.
 */
export function bakeWaterMask(world: WorldSource, cx: number, cy: number): Pixmap {
  const pm = new Pixmap(CHUNK_TILES, CHUNK_TILES);
  let any = false;
  for (let ty = 0; ty < CHUNK_TILES; ty++)
    for (let tx = 0; tx < CHUNK_TILES; tx++) {
      const t = world.tileAt(cx * CHUNK_TILES + tx, cy * CHUNK_TILES + ty);
      if (!isWater(t)) continue;
      any = true;
      pm.set(tx, ty, t === T.WATER ? 0xff0000 : 0x000000, 255);
    }
  return any ? pm : new Pixmap(0, 0);
}

/** True when a chunk has any water at all, so the renderer can skip the overlay entirely. */
export function chunkHasWater(world: WorldSource, cx: number, cy: number): boolean {
  for (let ty = 0; ty < CHUNK_TILES; ty++)
    for (let tx = 0; tx < CHUNK_TILES; tx++)
      if (isWater(world.tileAt(cx * CHUNK_TILES + tx, cy * CHUNK_TILES + ty))) return true;
  return false;
}
