/**
 * Deterministic generator for the Phase 1 world: 128x80 tiles = 8x5 chunks, three seamless areas
 * (Desa Lentera → Hutan Bisik → Gua Kelam). Pure logic, no Phaser.
 */
import { CHUNK_TILES, TILE, WORLD_TILES_H, WORLD_TILES_W } from '../config';
import { clamp, fbm, hashf, makeRng, valueNoise } from '../core/rng';
import { areaAtTile, CAVE_X0, FOREST_X0, type AreaId } from './areas';
import { PROPS, type PropPlacement, type PropType } from './props';
import type { ChunkData, NpcDef, SpawnDef, TileRect, WorldMarkers, WorldSource } from './source';
import { isGrassy, isWater, T, TILE_INFO } from './tiles';

const SEED = 20260920;

// ─────────────────────────── layout constants (tiles) ───────────────────────────
export const VILLAGE_PLAY: TileRect = { x0: 3, y0: 16, x1: 47, y1: 64 };
export const FOREST_PLAY: TileRect = { x0: 48, y0: 6, x1: 93, y1: 73 };
const PLAZA = { x: 20, y: 40 };
const RIVER_X = 70;
const BRIDGE_Y = 40;
const HALL = { x: 101, y: 40, r: 6.3 };
const ARENA = { x: 121, y: 40, rx: 6.4, ry: 10.2 };
const PLATE = { tx: 104, ty: 43 };
const ROCK = { tx: 99, ty: 37 };
const GATE = { tx: 109, ty: 39, w: 1, h: 3 };
const BOSS_DOOR = { tx: 114, ty: 39, w: 1, h: 3 };

const px = (t: number): number => t * TILE + TILE / 2;

class Grid {
  readonly w = WORLD_TILES_W;
  readonly h = WORLD_TILES_H;
  readonly ground = new Uint8Array(this.w * this.h);
  /** 1 = statically blocked by a prop / border (in addition to solid ground). */
  readonly blocked = new Uint8Array(this.w * this.h);
  /** 1 = keep free of trees and clutter (paths, plazas, spawn areas). */
  readonly keep = new Uint8Array(this.w * this.h);
  readonly props: PropPlacement[] = [];

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): number {
    return this.inb(x, y) ? this.ground[y * this.w + x] : T.WALL;
  }
  set(x: number, y: number, t: number): void {
    if (this.inb(x, y)) this.ground[y * this.w + x] = t;
  }
  isKept(x: number, y: number): boolean {
    return !this.inb(x, y) || this.keep[y * this.w + x] === 1;
  }
  keepDisc(cx: number, cy: number, r: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (this.inb(x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.keep[y * this.w + x] = 1;
  }
  isBlocked(x: number, y: number): boolean {
    return !this.inb(x, y) || this.blocked[y * this.w + x] === 1 || TILE_INFO[this.get(x, y)].solid;
  }
  block(x: number, y: number): void {
    if (this.inb(x, y)) this.blocked[y * this.w + x] = 1;
  }

  /** Place a prop by foot tile (bottom-centre of tile) and register its footprint as blocked. */
  prop(type: PropType, tx: number, ty: number, opts: { halfX?: boolean; flip?: boolean } = {}): PropPlacement {
    const p: PropPlacement = {
      type,
      x: tx * TILE + (opts.halfX ? TILE : TILE / 2),
      y: ty * TILE + TILE,
      flip: opts.flip,
    };
    this.props.push(p);
    const fp = PROPS[type].fp;
    if (fp) {
      const x0 = Math.floor((p.x + fp[0]) / TILE);
      const x1 = Math.floor((p.x + fp[0] + fp[2] - 1) / TILE);
      const y0 = Math.floor((p.y + fp[1]) / TILE);
      const y1 = Math.floor((p.y + fp[1] + fp[3] - 1) / TILE);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.block(x, y);
    }
    return p;
  }
}

function disc(cx: number, cy: number, r: number, fn: (x: number, y: number, d: number) => void): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) fn(x, y, d);
    }
}

/** Organic ellipse: radius wobbles with noise. */
function blob(g: Grid, cx: number, cy: number, rx: number, ry: number, tile: number, seed: number, wobble = 0.18): void {
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++)
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const n = 1 + (valueNoise(x * 0.35, y * 0.35, seed) - 0.5) * 2 * wobble;
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d <= n * n) g.set(x, y, tile);
    }
}

/** Wobbly tunnel between two points. */
function tunnel(g: Grid, ax: number, ay: number, bx: number, by: number, halfW: number, tile: number): void {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    disc(x, y, halfW, (dx, dy) => g.set(dx, dy, tile));
  }
}

/** Dirt path along waypoints (2-tile wide) that also marks tiles as "keep clear". */
function path(g: Grid, pts: [number, number][], halfW: number, tile: number, seed: number): void {
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s];
    const [bx, by] = pts[s + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wob = (valueNoise((ax + (bx - ax) * t) * 0.25, (ay + (by - ay) * t) * 0.25, seed) - 0.5) * 2.2;
      const x = ax + (bx - ax) * t + (Math.abs(by - ay) > Math.abs(bx - ax) ? wob : 0);
      const y = ay + (by - ay) * t + (Math.abs(by - ay) > Math.abs(bx - ax) ? 0 : wob);
      disc(x, y, halfW, (dx, dy) => {
        const cur = g.get(dx, dy);
        if (cur === T.WATER || cur === T.SHALLOW || cur === T.WALL || cur === T.COBBLE || cur === T.BRIDGE_H) return;
        g.set(dx, dy, tile);
      });
      g.keepDisc(x, y, halfW + 1.6);
    }
  }
}

export function areaOfTile(tx: number): AreaId {
  return areaAtTile(tx);
}

export class GeneratedWorld implements WorldSource {
  readonly widthTiles = WORLD_TILES_W;
  readonly heightTiles = WORLD_TILES_H;
  readonly markers: WorldMarkers;
  private readonly g = new Grid();
  private readonly solid = new Uint8Array(WORLD_TILES_W * WORLD_TILES_H);
  private readonly spawns: SpawnDef[] = [];
  private readonly npcs: NpcDef[] = [];
  private readonly chunks = new Map<number, ChunkData>();

  constructor(seed = SEED) {
    const g = this.g;
    this.baseTerrain(seed);
    this.carveCave(seed);
    this.rivers(seed);
    this.paths(seed);
    this.entities();
    this.village();
    this.caveDecor(seed);
    this.forestDecor(seed);
    this.borders(seed);

    this.markers = {
      playerStart: { x: px(PLAZA.x), y: px(PLAZA.y + 4) },
      lantern: { x: px(PLAZA.x), y: PLAZA.y * TILE + TILE },
      checkpoints: [
        { id: 'cp_village', name: 'Lentera Agung', x: px(PLAZA.x), y: px(PLAZA.y + 3) },
        { id: 'cp_forest', name: 'Altar Hutan', x: px(60), y: px(32) },
        { id: 'cp_cave', name: 'Altar Gua', x: px(97), y: px(36) },
      ],
      puzzle: {
        rock: ROCK,
        plate: PLATE,
        gate: GATE,
        room: { x0: 94, y0: 32, x1: 108, y1: 48 },
      },
      boss: {
        spawn: { x: px(ARENA.x + 1), y: px(ARENA.y) },
        arena: { x0: 114, y0: 29, x1: 127, y1: 51 },
        door: BOSS_DOOR,
      },
    };

    // collapse solidity
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) this.solid[y * g.w + x] = g.isBlocked(x, y) ? 1 : 0;
  }

  // ─────────────────────────── WorldSource ───────────────────────────
  tileAt(tx: number, ty: number): number {
    return this.g.get(tx, ty);
  }
  solidAt(tx: number, ty: number): boolean {
    if (!this.g.inb(tx, ty)) return true;
    return this.solid[ty * this.g.w + tx] === 1;
  }
  areaAt(tx: number, _ty: number): AreaId {
    return areaAtTile(tx);
  }
  chunk(cx: number, cy: number): ChunkData {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    const inChunk = (x: number, y: number): boolean =>
      Math.floor(x / TILE / CHUNK_TILES) === cx && Math.floor((y - 1) / TILE / CHUNK_TILES) === cy;
    const inChunkPt = (x: number, y: number): boolean =>
      Math.floor(x / TILE / CHUNK_TILES) === cx && Math.floor(y / TILE / CHUNK_TILES) === cy;
    c = {
      cx,
      cy,
      props: this.g.props.filter((p) => inChunk(p.x, p.y)),
      spawns: this.spawns.filter((s) => inChunkPt(s.x, s.y)),
      npcs: this.npcs.filter((n) => inChunkPt(n.x, n.y)),
    };
    this.chunks.set(key, c);
    return c;
  }

  // ─────────────────────────── generation passes ───────────────────────────

  private baseTerrain(seed: number): void {
    const g = this.g;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (x >= CAVE_X0) {
          g.set(x, y, T.WALL);
          continue;
        }
        const forestness = clamp((x - 44) / 16, 0, 1) * 0.55 + fbm(x * 0.07, y * 0.07, seed + 3) * 0.55;
        const edge = y < 10 || y > 70 || x < 6 ? 0.25 : 0;
        if (forestness + edge > 0.66) g.set(x, y, T.FOREST);
        else if (hashf(x, y, seed + 9) < 0.06 && fbm(x * 0.2, y * 0.2, seed + 5) > 0.45) g.set(x, y, T.FLOWERS);
        else g.set(x, y, T.GRASS);
      }
    }
  }

  private carveCave(seed: number): void {
    const g = this.g;
    // entrance tunnel from the forest
    tunnel(g, CAVE_X0 - 2, 40, HALL.x - 3, 40, 1.6, T.CAVE);
    // puzzle hall
    blob(g, HALL.x, HALL.y, HALL.r, HALL.r, T.CAVE, seed + 1, 0.1);
    // north & south caverns + connecting tunnels
    tunnel(g, HALL.x, 35, 102, 26, 1.5, T.CAVE);
    blob(g, 102, 21, 7, 4.6, T.CAVE, seed + 2, 0.16);
    tunnel(g, HALL.x + 1, 46, 104, 54, 1.5, T.CAVE);
    blob(g, 105, 59, 8, 5.4, T.CAVE, seed + 3, 0.16);
    // corridor to the boss arena (gate at GATE.tx, boss door at BOSS_DOOR.tx)
    tunnel(g, HALL.x + 4, 40, ARENA.x - 4, 40, 1.5, T.CAVE);
    // boss arena
    blob(g, ARENA.x, ARENA.y, ARENA.rx, ARENA.ry, T.ARENA, seed + 4, 0.06);
    // keep gate columns tunnel-shaped (3 tall) so doors seal them completely
    for (const door of [GATE, BOSS_DOOR])
      for (let y = door.ty - 1; y <= door.ty + door.h; y++) g.set(door.tx, y, y >= door.ty && y < door.ty + door.h ? T.CAVE : T.WALL);
    // corridor tiles east of the boss door, back into arena stay arena stone
    for (let x = BOSS_DOOR.tx + 1; x < ARENA.x - ARENA.rx + 1; x++) for (let y = 39; y <= 41; y++) g.set(x, y, T.ARENA);
    // mark key tiles clear
    g.keepDisc(HALL.x, HALL.y, HALL.r);
    g.keepDisc(ARENA.x, ARENA.y, 8);
  }

  private rivers(seed: number): void {
    const g = this.g;
    const riverCx = (y: number): number => RIVER_X + Math.sin(y * 0.11 + 1.2) * 3 + Math.sin(y * 0.29) * 0.8;
    for (let y = 0; y < g.h; y++) {
      const cx = riverCx(y);
      const ford = y >= 62 && y <= 65;
      for (let x = Math.floor(cx - 5); x <= Math.ceil(cx + 5); x++) {
        const d = Math.abs(x - cx);
        const cur = g.get(x, y);
        if (isGrassy(cur) || cur === T.SAND) {
          if (d <= 1.6 && !ford) g.set(x, y, T.WATER);
          else if (d <= 2.7) g.set(x, y, T.SHALLOW);
          else if (d <= 3.6) g.set(x, y, T.SAND);
        }
      }
    }
    // bridges (2 tiles tall, rails N/S)
    const bridge = (by: number): void => {
      const cx = riverCx(by);
      for (let x = Math.floor(cx - 5); x <= Math.ceil(cx + 5); x++)
        for (let y = by; y <= by + 1; y++) {
          const cur = g.get(x, y);
          if (isWater(cur) || cur === T.SAND) g.set(x, y, T.BRIDGE_H);
        }
      g.keepDisc(cx, by + 0.5, 7);
    };
    bridge(BRIDGE_Y);
    bridge(20);
    // village pond
    blob(g, 12, 56, 3.4, 3, T.SHALLOW, seed + 20, 0.15);
    blob(g, 12, 56, 2, 1.7, T.WATER, seed + 21, 0.15);
    for (let y = 50; y <= 62; y++)
      for (let x = 5; x <= 19; x++) {
        if (isGrassy(g.get(x, y)) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => g.get(x + dx, y + dy) === T.SHALLOW))
          g.set(x, y, T.SAND);
      }
    // forest lake
    blob(g, 58, 63, 5.2, 4.2, T.SHALLOW, seed + 22, 0.14);
    blob(g, 58, 63, 3.2, 2.4, T.WATER, seed + 23, 0.14);
    for (let y = 55; y <= 72; y++)
      for (let x = 49; x <= 68; x++)
        if (isGrassy(g.get(x, y)) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => g.get(x + dx, y + dy) === T.SHALLOW))
          g.set(x, y, T.SAND);
  }

  private paths(seed: number): void {
    const g = this.g;
    // village plaza (cobble disc) + main road east through the forest to the cave mouth
    disc(PLAZA.x, PLAZA.y, 6, (x, y) => g.set(x, y, T.COBBLE));
    g.keepDisc(PLAZA.x, PLAZA.y, 8);
    path(g, [[PLAZA.x, PLAZA.y], [32, 40], [46, 41], [56, 40], [64, 40], [76, 40], [84, 39], [93, 40]], 1.2, T.DIRT, seed + 30);
    // village lanes
    path(g, [[PLAZA.x, PLAZA.y - 6], [PLAZA.x, 30]], 1, T.DIRT, seed + 31);
    path(g, [[14, 40], [9, 36], [9, 35]], 0.8, T.DIRT, seed + 32);
    path(g, [[27, 40], [31, 38], [32, 36]], 0.8, T.DIRT, seed + 33);
    path(g, [[16, 44], [10, 46], [8, 50]], 0.8, T.DIRT, seed + 34);
    path(g, [[26, 44], [30, 47], [33, 51]], 0.8, T.DIRT, seed + 35);
    // forest branches: north shrine, north bridge, south clearing, ford
    path(g, [[56, 40], [58, 34], [60, 31]], 1, T.DIRT, seed + 36);
    path(g, [[60, 31], [62, 24], [66, 20]], 1, T.DIRT, seed + 37);
    path(g, [[78, 40], [80, 50], [80, 58]], 1, T.DIRT, seed + 38);
    path(g, [[66, 20], [76, 20], [84, 26]], 1, T.DIRT, seed + 39);
    // clearings
    g.keepDisc(60, 30, 4);
    g.keepDisc(80, 58, 4);
    g.keepDisc(84, 26, 3);
  }

  private village(): void {
    const g = this.g;
    const P = PLAZA;
    // Great Lantern
    g.prop('great_lantern', P.x, P.y);
    // houses face south; foot at the bottom row
    g.prop('hall', P.x, 29);
    g.prop('house_a', 9, 34, { halfX: true });
    g.prop('house_b', 32, 34, { halfX: true });
    g.prop('house_c', 8, 50);
    g.prop('house_a', 33, 51, { halfX: true, flip: true });
    // facilities
    g.prop('well', 27, 45, { halfX: true });
    for (const [x, y] of [[14, 36], [26, 36], [14, 45], [26, 43]] as const) g.prop('lamp', x, y);
    g.prop('stall', 13, 43, { halfX: true });
    g.prop('stall', 13, 47, { halfX: true });
    g.prop('barrel', 16, 43);
    g.prop('crate', 10, 44);
    g.prop('crate', 11, 44);
    g.prop('barrel', 36, 45);
    g.prop('haystack', 6, 58, { halfX: true });
    g.prop('flowerbed', 17, 54, { halfX: true });
    g.prop('flowerbed', 22, 54, { halfX: true });
    g.prop('flowerbed', 29, 56, { halfX: true });
    // signs
    g.prop('sign', 43, 38).text = 'Gerbang Timur. Di seberang: Hutan Bisik. Hati-hati, monsternya makin buas!';
    g.prop('sign', 22, 35).text = 'Desa Lentera. Tempat cahaya bersemi. Bicaralah dengan Tetua Wulan di plaza.';
    // fences: village north edge & garden
    for (let x = 4; x <= 46; x++) g.prop('fence_h', x, 16);
    for (let x = 4; x <= 46; x++) g.prop('fence_h', x, 64);
    for (let y = 17; y <= 63; y++) g.prop('fence_v', 3, y);
    for (let y = 17; y <= 63; y++) if (y < 37 || y > 43) g.prop('fence_v', 47, y);
    g.keepDisc(PLAZA.x, PLAZA.y + 4, 3);
    // decor: keep house doors clear
    for (const [x, y] of [[9, 35], [32, 35], [8, 51], [33, 52], [20, 30]] as const) g.keepDisc(x, y, 1.5);
  }

  private caveDecor(seed: number): void {
    const g = this.g;
    // puzzle room props
    g.prop('pillar', 102, 40);
    g.prop('pillar', 100, 44);
    g.prop('plate', PLATE.tx, PLATE.ty);
    // gate + boss door art (visual; collision handled dynamically by the puzzle system)
    g.prop('gate', GATE.tx, GATE.ty + GATE.h - 1);
    g.prop('boss_door', BOSS_DOOR.tx, BOSS_DOOR.ty + BOSS_DOOR.h - 1);
    // cave altar (checkpoint)
    g.prop('shrine', 97, 35);
    // arena pillars
    for (const [x, y] of [[118, 33], [124, 33], [118, 47], [124, 47]] as const) g.prop('pillar', x, y);
    // torches on wall faces, crystals on floors
    const lastTorch: [number, number][] = [];
    for (let y = 1; y < g.h - 1; y++)
      for (let x = CAVE_X0 - 1; x < g.w - 1; x++) {
        const t = g.get(x, y);
        const below = g.get(x, y + 1);
        if (t === T.WALL && (below === T.CAVE || below === T.ARENA) && hashf(x, y, seed + 40) < 0.13) {
          if (lastTorch.some(([tx, ty]) => Math.abs(tx - x) < 6 && Math.abs(ty - y) < 6)) continue;
          if (x >= GATE.tx - 1 && x <= GATE.tx + 1) continue;
          lastTorch.push([x, y]);
          g.prop('torch', x, y);
        }
      }
    const cryst: [number, number][] = [];
    for (let y = 2; y < g.h - 2; y++)
      for (let x = CAVE_X0 + 1; x < g.w - 2; x++) {
        const t = g.get(x, y);
        if ((t !== T.CAVE && t !== T.ARENA) || g.isKept(x, y) || g.isBlocked(x, y)) continue;
        const nearWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) === T.WALL);
        const r = hashf(x, y, seed + 41);
        if (nearWall && r < 0.05 && !cryst.some(([cx, cy]) => Math.abs(cx - x) < 4 && Math.abs(cy - y) < 4)) {
          cryst.push([x, y]);
          g.prop(hashf(x, y, seed + 42) < 0.5 ? 'crystal_a' : 'crystal_b', x, y);
        } else if (nearWall && r > 0.965) {
          g.prop('stalagmite', x, y);
        }
      }
  }

  private forestDecor(seed: number): void {
    const g = this.g;
    const rng = makeRng(seed + 77);
    const treeAt: Set<number> = new Set();
    const canTree = (x: number, y: number): boolean => {
      if (g.isKept(x, y) || g.isBlocked(x, y)) return false;
      const t = g.get(x, y);
      if (!isGrassy(t)) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (treeAt.has((y + dy) * g.w + x + dx)) return false;
      return true;
    };
    const putTree = (x: number, y: number, kind: PropType): void => {
      treeAt.add(y * g.w + x);
      g.prop(kind, x, y);
    };
    // forest trees
    for (let y = FOREST_PLAY.y0; y <= FOREST_PLAY.y1; y++)
      for (let x = FOREST_X0 - 6; x <= FOREST_PLAY.x1; x++) {
        const depth = clamp((x - (FOREST_X0 - 6)) / 14, 0, 1);
        const cluster = fbm(x * 0.13, y * 0.13, seed + 50);
        const p = (0.1 + 0.34 * Math.max(0, cluster - 0.38)) * depth;
        if (rng() < p && canTree(x, y)) {
          const r = rng();
          putTree(x, y, r < 0.5 ? 'tree_a' : r < 0.82 ? 'tree_b' : r < 0.95 ? 'tree_c' : 'tree_dead');
        }
      }
    // village-side scatter (few trees)
    for (let y = VILLAGE_PLAY.y0 + 1; y <= VILLAGE_PLAY.y1 - 1; y++)
      for (let x = 4; x < 46; x++)
        if (rng() < 0.018 && canTree(x, y) && !(x > 5 && x < 40 && y > 26 && y < 60)) putTree(x, y, rng() < 0.6 ? 'tree_a' : 'tree_c');
    // small clutter: bushes, rocks, stumps, logs, mushrooms, tall grass, flowers/reeds/lilies
    for (let y = 4; y < g.h - 4; y++)
      for (let x = 4; x < CAVE_X0 - 2; x++) {
        const t = g.get(x, y);
        const r = rng();
        if (g.isBlocked(x, y)) continue;
        if (isGrassy(t) && !g.isKept(x, y)) {
          const inForest = x >= FOREST_X0 - 4;
          if (r < 0.012) g.prop(rng() < 0.5 ? 'bush_a' : 'bush_b', x, y);
          else if (r < 0.018) g.prop(rng() < 0.6 ? 'rock_a' : 'rock_b', x, y);
          else if (inForest && r < 0.021) g.prop(rng() < 0.5 ? 'stump' : 'log', x, y);
          else if (inForest && r < 0.027 && t === T.FOREST) g.prop('mushroom', x, y);
          else if (r < 0.13 && fbm(x * 0.18, y * 0.18, seed + 60) > 0.55) g.prop('tallgrass', x, y);
        } else if (t === T.SHALLOW && r < 0.08) {
          g.prop(rng() < 0.5 ? 'lily' : 'reeds', x, y);
        } else if (t === T.SAND && r < 0.12 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) === T.SHALLOW)) {
          g.prop('reeds', x, y);
        }
      }
    // forest shrine (checkpoint) + a couple of set-pieces
    g.prop('shrine', 60, 31);
    g.prop('sign', 58, 36).text = 'Altar Hutan di utara. Menyentuh apinya menyembuhkan dan menyimpan progresmu.';
    g.prop('sign', 91, 38).text = 'Gua Kelam. Hanya untuk yang berani. Dorong batu ukir ke pelat untuk membuka gerbang!';
    g.prop('log', 74, 29, { halfX: true });
  }

  private borders(seed: number): void {
    const g = this.g;
    const rng = makeRng(seed + 99);
    const playable = (x: number, y: number): boolean => {
      if (x >= CAVE_X0) return false;
      if (x >= FOREST_X0) return y >= FOREST_PLAY.y0 && y <= FOREST_PLAY.y1 && x <= FOREST_PLAY.x1 + 1;
      return x >= VILLAGE_PLAY.x0 && y >= VILLAGE_PLAY.y0 && y <= VILLAGE_PLAY.y1;
    };
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < CAVE_X0; x++) {
        if (playable(x, y)) continue;
        // seam between village and forest regions
        if (x < FOREST_X0 && x >= VILLAGE_PLAY.x0 && (y < VILLAGE_PLAY.y0 || y > VILLAGE_PLAY.y1)) {
          /* village north/south hedge zone */
        }
        g.block(x, y);
        if (g.get(x, y) === T.WATER || g.get(x, y) === T.SHALLOW) continue;
        if (g.get(x, y) !== T.FOREST) g.set(x, y, T.FOREST);
        // dense visual wall of trees within camera reach of the playable area
        let near = false;
        for (let dy = -9; dy <= 9 && !near; dy += 3) for (let dx = -12; dx <= 12; dx += 3) if (playable(x + dx, y + dy)) near = true;
        if (near && rng() < 0.7) {
          const r = rng();
          g.prop(r < 0.45 ? 'tree_a' : r < 0.85 ? 'tree_b' : 'tree_c', x, y);
        }
      }
    // forest east edge before cave: rocks
    for (let y = FOREST_PLAY.y0; y <= FOREST_PLAY.y1; y++)
      if (y < 39 || y > 41) {
        g.set(93, y, T.WALL);
        g.set(94, y, T.WALL);
      }
  }

  private entities(): void {
    const S = (id: string, kind: SpawnDef['kind'], tx: number, ty: number, count?: number): void => {
      this.spawns.push({ id, kind, x: px(tx), y: px(ty), count });
      this.g.keepDisc(tx, ty, 2.2);
    };
    // forest
    S('slime_f1', 'slime', 54, 30);
    S('slime_f2', 'slime', 58, 50);
    S('slime_f3', 'slime', 77, 29);
    S('slime_f4', 'slime', 79, 52);
    S('slime_f5', 'slime', 87, 34);
    S('slime_f6', 'slime', 85, 47);
    S('slime_f7', 'slime', 62, 66);
    S('slime_v1', 'slime', 42, 22);
    S('slime_v2', 'slime', 43, 58);
    S('archer_f1', 'archer', 75, 24);
    S('archer_f2', 'archer', 89, 45);
    S('archer_f3', 'archer', 66, 58);
    S('archer_f4', 'archer', 53, 22);
    S('archer_f5', 'archer', 82, 33);
    // cave
    S('bats_c1', 'bats', 101, 21, 4);
    S('bats_c2', 'bats', 106, 59, 3);
    S('bats_c3', 'bats', 112, 40, 3);
    S('archer_c1', 'archer', 99, 23);
    S('archer_c2', 'archer', 108, 58);
    S('bats_c4', 'bats', 123, 33, 2);
    S('boss', 'boss', ARENA.x + 1, ARENA.y);
    // NPCs
    const npcs: NpcDef[] = [
      { id: 'wulan', name: 'Tetua Wulan', look: 'elder', x: px(PLAZA.x - 2), y: px(PLAZA.y - 3) },
      { id: 'rengga', name: 'Bu Rengga', look: 'smith', x: px(15), y: px(45) },
      { id: 'mita', name: 'Mita', look: 'kid', x: px(64), y: px(43) },
      { id: 'jagat', name: 'Pak Jagat', look: 'guard', x: px(98), y: px(41) },
    ];
    for (const n of npcs) {
      this.npcs.push(n);
      this.g.keepDisc(Math.floor(n.x / TILE), Math.floor(n.y / TILE), 1.8);
    }
  }
}
