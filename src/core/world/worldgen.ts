/**
 * Deterministic generator for the Phase 1 world: 128x80 tiles = 8x5 chunks, three seamless areas
 * (Desa Lentera → Hutan Bisik → Gua Kelam). Pure logic, no Phaser.
 */
import { CHUNK_TILES, TILE, WORLD_TILES_H, WORLD_TILES_W } from '../../config';
import { clamp, fbm, hashf, makeRng, valueNoise } from '../rng';
import { areaAtTile, CAVE_X0, FOREST_X0, type AreaId } from './areas';
import { PROPS, type PropPlacement, type PropType } from './props';
import type { ChunkData, NpcDef, SpawnDef, TileRect, WorldMarkers, WorldSource } from './source';
import { isGrassy, isWater, T, TILE_INFO } from './tiles';

const SEED = 20260920;

/*
 * ─────────────────────────── layout (tiles) ───────────────────────────
 *
 * 256 x 128 tiles, three seamless areas on a west→east journey:
 *   Desa Lentera  x 0..95    village core, outskirt farms, pond, brook
 *   Hutan Bisik   x 96..191  river with two bridges and a ford, lake, clearings, ruins, viewpoint
 *   Gua Kelam     x 192..255 branching tunnels, puzzle hall, boss arena
 *
 * Batch 2 roughly tripled every area. The numbers are hand-placed rather than derived, because a
 * village has to *read* as a village; the generator's job is the terrain and the clutter around them.
 */
export const VILLAGE_PLAY: TileRect = { x0: 6, y0: 20, x1: 95, y1: 108 };
/** Reaches all the way to the cave wall: `borders()` blocks everything it does not cover. */
export const FOREST_PLAY: TileRect = { x0: 96, y0: 10, x1: CAVE_X0 - 1, y1: 118 };

/** Village centre: the plaza with the Great Lantern. */
const PLAZA = { x: 34, y: 64 };
/** Farm on the northern outskirts, and the mill on the southern ones. */
const FARM = { x: 26, y: 31 };
const MILL = { x: 40, y: 98 };
const POND = { x: 18, y: 92 };
/** The brook marks the eastern edge of the village; the road crosses it on a bridge. */
const BROOK_X = 86;
const BROOK_BRIDGE_Y = 63;

/** Forest river, its two bridges and the ford further south. */
const RIVER_X = 144;
const BRIDGE_Y = 63;
const NORTH_BRIDGE_Y = 33;
const FORD_Y0 = 100;
const FORD_Y1 = 104;
const LAKE = { x: 116, y: 100 };
/** Forest landmarks: shrine clearing, ruins, the south clearing and the north-east viewpoint. */
const FOREST_SHRINE = { x: 120, y: 41 };
const RUINS = { x: 176, y: 38 };
const SOUTH_CLEARING = { x: 168, y: 92 };
const VIEWPOINT = { x: 177, y: 26 };

/** Cave: the puzzle hall, its two side caverns, a dead-end grotto, and the arena. */
const HALL = { x: 206, y: 64, r: 9.5 };
const NORTH_CAVERN = { x: 206, y: 33, rx: 9, ry: 5.5 };
const SOUTH_CAVERN = { x: 213, y: 99, rx: 9, ry: 6 };
const GROTTO = { x: 197, y: 44, rx: 4.5, ry: 4 };
const ARENA = { x: 245, y: 64, rx: 9.5, ry: 14 };
const CAVE_MOUTH_Y = 64;
const ROCK = { tx: 201, ty: 59 };
const PLATE = { tx: 211, ty: 69 };
const GATE = { tx: 220, ty: 63, w: 1, h: 3 };
const BOSS_DOOR = { tx: 232, ty: 63, w: 1, h: 3 };

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

/**
 * Wobbly tunnel between two points. It also marks itself "keep clear", because a corridor barely
 * three tiles wide is exactly where a single randomly placed crystal can wall the cave off —
 * which is how the north cavern and the grotto first became unreachable.
 */
function tunnel(g: Grid, ax: number, ay: number, bx: number, by: number, halfW: number, tile: number): void {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    disc(x, y, halfW, (dx, dy) => g.set(dx, dy, tile));
    g.keepDisc(x, y, halfW);
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

/** Centre line of the forest river at row `y` — two sine terms so it never reads as a canal. */
const riverCx = (y: number): number => RIVER_X + Math.sin(y * 0.07 + 1.2) * 4 + Math.sin(y * 0.19) * 1.2;
/** Centre line of the village brook. */
const brookCx = (y: number): number => BROOK_X + Math.sin(y * 0.09) * 1.6;
/** Inside the part of the map the player is meant to walk (used to keep borders out of it). */
const playable = (x: number, y: number): boolean => {
  if (x >= CAVE_X0) return false;
  if (x >= FOREST_X0) return y >= FOREST_PLAY.y0 && y <= FOREST_PLAY.y1 && x <= FOREST_PLAY.x1 + 1;
  return x >= VILLAGE_PLAY.x0 && y >= VILLAGE_PLAY.y0 && y <= VILLAGE_PLAY.y1;
};

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
      playerStart: { x: px(PLAZA.x), y: px(PLAZA.y + 5) },
      lantern: { x: px(PLAZA.x), y: PLAZA.y * TILE + TILE },
      checkpoints: [
        { id: 'cp_village', name: 'Lentera Agung', x: px(PLAZA.x), y: px(PLAZA.y + 4) },
        { id: 'cp_forest', name: 'Altar Hutan', x: px(FOREST_SHRINE.x), y: px(FOREST_SHRINE.y + 1) },
        { id: 'cp_cave', name: 'Altar Gua', x: px(198), y: px(53) },
      ],
      puzzle: {
        rock: ROCK,
        plate: PLATE,
        gate: GATE,
        room: { x0: 194, y0: 50, x1: 218, y1: 78 },
      },
      boss: {
        spawn: { x: px(ARENA.x + 1), y: px(ARENA.y) },
        arena: { x0: 234, y0: 48, x1: 255, y1: 80 },
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
        // trees thicken toward the forest and toward the map edges
        const forestness = clamp((x - 88) / 32, 0, 1) * 0.55 + fbm(x * 0.05, y * 0.05, seed + 3) * 0.55;
        const edge = y < 16 || y > 112 || x < 10 ? 0.25 : 0;
        if (forestness + edge > 0.66) g.set(x, y, T.FOREST);
        else if (hashf(x, y, seed + 9) < 0.06 && fbm(x * 0.15, y * 0.15, seed + 5) > 0.45) g.set(x, y, T.FLOWERS);
        else g.set(x, y, T.GRASS);
      }
    }
  }

  /**
   * The cave is a small network, not a corridor: the hall in the middle, a cavern north and south,
   * a dead-end grotto, and two loops back to the hall. Every one of those branches stays *west* of
   * the puzzle gate, so the gate is still the only way to the boss — which the world test proves by
   * sealing the gate column and checking the arena becomes unreachable.
   */
  private carveCave(seed: number): void {
    const g = this.g;
    // mouth: from the forest road into the hall
    tunnel(g, CAVE_X0 - 3, CAVE_MOUTH_Y, HALL.x - 6, CAVE_MOUTH_Y, 2, T.CAVE);
    blob(g, HALL.x, HALL.y, HALL.r, HALL.r, T.CAVE, seed + 1, 0.08);

    // north cavern + its loop back to the hall
    tunnel(g, HALL.x - 2, HALL.y - 7, NORTH_CAVERN.x, NORTH_CAVERN.y + 4, 1.5, T.CAVE);
    blob(g, NORTH_CAVERN.x, NORTH_CAVERN.y, NORTH_CAVERN.rx, NORTH_CAVERN.ry, T.CAVE, seed + 2, 0.16);
    tunnel(g, NORTH_CAVERN.x + 7, NORTH_CAVERN.y + 2, 217, 48, 1.3, T.CAVE);
    tunnel(g, 217, 48, HALL.x + 8, HALL.y - 6, 1.3, T.CAVE);

    // south cavern + its loop back
    tunnel(g, HALL.x + 2, HALL.y + 7, SOUTH_CAVERN.x - 1, SOUTH_CAVERN.y - 5, 1.5, T.CAVE);
    blob(g, SOUTH_CAVERN.x, SOUTH_CAVERN.y, SOUTH_CAVERN.rx, SOUTH_CAVERN.ry, T.CAVE, seed + 3, 0.16);
    tunnel(g, SOUTH_CAVERN.x - 8, SOUTH_CAVERN.y - 6, 199, 80, 1.3, T.CAVE);
    tunnel(g, 199, 80, HALL.x - 7, HALL.y + 5, 1.3, T.CAVE);

    // dead-end crystal grotto west of the hall: the reward for poking around
    tunnel(g, HALL.x - 6, HALL.y - 4, GROTTO.x + 1, GROTTO.y + 3, 1.3, T.CAVE);
    blob(g, GROTTO.x, GROTTO.y, GROTTO.rx, GROTTO.ry, T.CAVE, seed + 5, 0.18);

    // corridor east: hall → gate → boss door → arena
    tunnel(g, HALL.x + 8, HALL.y, GATE.tx - 1, GATE.ty + 1, 1.5, T.CAVE);
    tunnel(g, GATE.tx + 1, GATE.ty + 1, BOSS_DOOR.tx - 1, BOSS_DOOR.ty + 1, 1.5, T.CAVE);
    blob(g, ARENA.x, ARENA.y, ARENA.rx, ARENA.ry, T.ARENA, seed + 4, 0.06);

    // keep both door columns exactly as tall as the door, so a closed door seals them completely
    for (const door of [GATE, BOSS_DOOR])
      for (let y = door.ty - 1; y <= door.ty + door.h; y++) g.set(door.tx, y, y >= door.ty && y < door.ty + door.h ? T.CAVE : T.WALL);
    // the stretch between the boss door and the arena is arena stone
    for (let x = BOSS_DOOR.tx + 1; x < ARENA.x - ARENA.rx + 1; x++)
      for (let y = BOSS_DOOR.ty; y < BOSS_DOOR.ty + BOSS_DOOR.h; y++) g.set(x, y, T.ARENA);

    g.keepDisc(HALL.x, HALL.y, HALL.r);
    g.keepDisc(ARENA.x, ARENA.y, 10);
    g.keepDisc(GROTTO.x, GROTTO.y, GROTTO.rx);
    // keep the rock's push lane (east along its row, then south to the plate) clear of clutter
    for (let x = ROCK.tx; x <= PLATE.tx; x++) g.keepDisc(x, ROCK.ty, 1.4);
    for (let y = ROCK.ty; y <= PLATE.ty; y++) g.keepDisc(PLATE.tx, y, 1.4);
  }

  /** Forest river with two bridges and a ford, the village brook, the pond and the forest lake. */
  private rivers(seed: number): void {
    const g = this.g;
    for (let y = 0; y < g.h; y++) {
      const cx = riverCx(y);
      const ford = y >= FORD_Y0 && y <= FORD_Y1;
      for (let x = Math.floor(cx - 6); x <= Math.ceil(cx + 6); x++) {
        const d = Math.abs(x - cx);
        const cur = g.get(x, y);
        if (isGrassy(cur) || cur === T.SAND) {
          if (d <= 1.8 && !ford) g.set(x, y, T.WATER);
          else if (d <= 3) g.set(x, y, T.SHALLOW);
          else if (d <= 4) g.set(x, y, T.SAND);
        }
      }
    }

    // village brook: narrow, marks the eastern edge of the village
    for (let y = VILLAGE_PLAY.y0 - 4; y <= VILLAGE_PLAY.y1 + 4; y++) {
      const cx = brookCx(y);
      for (let x = Math.floor(cx - 3); x <= Math.ceil(cx + 3); x++) {
        const d = Math.abs(x - cx);
        const cur = g.get(x, y);
        if (!isGrassy(cur) && cur !== T.SAND) continue;
        if (d <= 1) g.set(x, y, T.WATER);
        else if (d <= 1.9) g.set(x, y, T.SHALLOW);
        else if (d <= 2.6) g.set(x, y, T.SAND);
      }
    }

    /** A 2-tile-tall plank bridge across whatever water sits at `by`. */
    const bridge = (centreX: (y: number) => number, by: number, span: number): void => {
      const cx = centreX(by);
      for (let x = Math.floor(cx - span); x <= Math.ceil(cx + span); x++)
        for (let y = by; y <= by + 1; y++) {
          const cur = g.get(x, y);
          if (isWater(cur) || cur === T.SAND) g.set(x, y, T.BRIDGE_H);
        }
      g.keepDisc(cx, by + 0.5, span + 2);
    };
    bridge(riverCx, BRIDGE_Y, 6);
    bridge(riverCx, NORTH_BRIDGE_Y, 6);
    bridge(brookCx, BROOK_BRIDGE_Y, 4);

    /** Sandy shore wherever grass meets shallow water. */
    const shore = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if (
            isGrassy(g.get(x, y)) &&
            [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => g.get(x + dx, y + dy) === T.SHALLOW)
          )
            g.set(x, y, T.SAND);
    };

    // village pond
    blob(g, POND.x, POND.y, 5.4, 4.4, T.SHALLOW, seed + 20, 0.15);
    blob(g, POND.x, POND.y, 3.4, 2.6, T.WATER, seed + 21, 0.15);
    shore(POND.x - 9, POND.y - 8, POND.x + 9, POND.y + 8);

    // forest lake
    blob(g, LAKE.x, LAKE.y, 8.5, 6.5, T.SHALLOW, seed + 22, 0.14);
    blob(g, LAKE.x, LAKE.y, 5.5, 4, T.WATER, seed + 23, 0.14);
    shore(LAKE.x - 12, LAKE.y - 10, LAKE.x + 12, LAKE.y + 10);
  }

  private paths(seed: number): void {
    const g = this.g;
    // plaza
    disc(PLAZA.x, PLAZA.y, 8, (x, y) => g.set(x, y, T.COBBLE));
    g.keepDisc(PLAZA.x, PLAZA.y, 10);

    // the main road: plaza → brook bridge → forest → cave mouth
    path(g, [[PLAZA.x, PLAZA.y], [52, 64], [70, 65], [BROOK_X, BROOK_BRIDGE_Y + 1], [98, 65], [116, 64], [132, 64],
      [RIVER_X, BRIDGE_Y + 1], [158, 64], [174, 64], [CAVE_X0 - 4, CAVE_MOUTH_Y]], 1.3, T.DIRT, seed + 30);

    // village lanes: hall, farm, west houses, pond, mill, east gardens
    path(g, [[PLAZA.x, PLAZA.y - 8], [PLAZA.x, 50]], 1, T.DIRT, seed + 31);
    path(g, [[PLAZA.x, 50], [30, 40], [FARM.x, FARM.y + 2]], 1, T.DIRT, seed + 32);
    path(g, [[26, 64], [18, 66], [14, 74]], 0.9, T.DIRT, seed + 33);
    path(g, [[15, 78], [POND.x, POND.y - 7]], 0.9, T.DIRT, seed + 34);
    path(g, [[PLAZA.x, PLAZA.y + 8], [38, 84], [MILL.x, MILL.y + 2]], 1, T.DIRT, seed + 35);
    path(g, [[44, 64], [52, 74], [58, 80]], 0.9, T.DIRT, seed + 36);
    path(g, [[52, 54], [58, 44], [56, 34]], 0.9, T.DIRT, seed + 37);

    // forest branches: shrine, viewpoint ridge, ruins, south clearing, lake shore
    path(g, [[112, 64], [116, 52], [FOREST_SHRINE.x, FOREST_SHRINE.y]], 1, T.DIRT, seed + 40);
    path(g, [[FOREST_SHRINE.x, FOREST_SHRINE.y], [134, 32], [150, 26], [VIEWPOINT.x, VIEWPOINT.y]], 1, T.DIRT, seed + 41);
    path(g, [[150, 26], [RIVER_X, NORTH_BRIDGE_Y + 1], [136, 34], [130, 44]], 1, T.DIRT, seed + 42);
    path(g, [[174, 64], [180, 50], [RUINS.x, RUINS.y]], 1, T.DIRT, seed + 43);
    path(g, [[158, 64], [164, 78], [SOUTH_CLEARING.x, SOUTH_CLEARING.y]], 1, T.DIRT, seed + 44);
    path(g, [[132, 64], [126, 82], [LAKE.x + 2, LAKE.y - 8]], 1, T.DIRT, seed + 45);
    path(g, [[SOUTH_CLEARING.x, SOUTH_CLEARING.y], [156, 102], [RIVER_X + 2, FORD_Y0 + 2]], 1, T.DIRT, seed + 46);

    /**
     * Clearings: real open ground, not just "no clutter here". Without clearing the tiles too, a
     * glade in the middle of the forest still reads as forest floor.
     */
    for (const [x, y, r] of [
      [FOREST_SHRINE.x, FOREST_SHRINE.y, 5],
      [SOUTH_CLEARING.x, SOUTH_CLEARING.y, 5],
      [RUINS.x, RUINS.y, 5],
      [VIEWPOINT.x, VIEWPOINT.y, 4],
      [LAKE.x + 2, LAKE.y - 8, 4],
    ] as const) {
      disc(x, y, r, (tx, ty, d) => {
        const cur = g.get(tx, ty);
        if (isWater(cur) || cur === T.SAND || cur === T.WALL) return;
        g.set(tx, ty, d < r * 0.45 ? T.DIRT : hashf(tx, ty, seed + 47) < 0.25 ? T.FLOWERS : T.GRASS);
      });
      g.keepDisc(x, y, r);
    }
  }

  private village(): void {
    const g = this.g;
    const P = PLAZA;
    g.prop('great_lantern', P.x, P.y);
    g.prop('hall', P.x, P.y - 14);

    // core houses around the plaza
    g.prop('house_a', 16, 56, { halfX: true });
    g.prop('house_b', 52, 56, { halfX: true });
    g.prop('house_c', 14, 80);
    g.prop('house_a', 54, 82, { halfX: true, flip: true });
    g.prop('house_c', 24, 78, { halfX: true });

    // northern outskirts: a farm with haystacks behind a fence
    g.prop('house_c', FARM.x, FARM.y);
    g.prop('haystack', FARM.x - 6, FARM.y + 3, { halfX: true });
    g.prop('haystack', FARM.x + 6, FARM.y + 4, { halfX: true });
    g.prop('crate', FARM.x + 3, FARM.y + 1);
    for (let x = FARM.x - 9; x <= FARM.x + 9; x++) if (x < FARM.x - 1 || x > FARM.x + 1) g.prop('fence_h', x, FARM.y + 7);

    // southern outskirts: the mill yard
    g.prop('house_b', MILL.x, MILL.y, { halfX: true });
    g.prop('haystack', MILL.x + 7, MILL.y + 1, { halfX: true });
    g.prop('barrel', MILL.x - 4, MILL.y - 1);
    g.prop('barrel', MILL.x - 3, MILL.y);
    g.prop('crate', MILL.x + 3, MILL.y - 2);

    // facilities
    g.prop('well', 46, 72, { halfX: true });
    g.prop('stall', 22, 68, { halfX: true });
    g.prop('stall', 22, 74, { halfX: true });
    g.prop('barrel', 26, 68);
    g.prop('crate', 18, 70);
    g.prop('crate', 19, 70);
    g.prop('barrel', 56, 70);
    for (const [x, y] of [[24, 58], [44, 58], [24, 70], [44, 70], [P.x, 52], [12, 66], [62, 64], [76, 64], [BROOK_X - 4, BROOK_BRIDGE_Y], [FARM.x, FARM.y + 5], [MILL.x - 6, MILL.y]] as const)
      g.prop('lamp', x, y);
    for (const [x, y] of [[28, 88], [40, 88], [50, 66], [20, 62]] as const) g.prop('flowerbed', x, y, { halfX: true });

    // signs
    g.prop('sign', 92, 62).text = 'Jembatan Anak Sungai. Di seberang: Hutan Bisik. Hati-hati, monsternya makin buas!';
    g.prop('sign', 38, 56).text = 'Desa Lentera. Tempat cahaya bersemi. Bicaralah dengan Tetua Wulan di plaza.';
    g.prop('sign', FARM.x + 4, FARM.y + 6).text = 'Ladang Utara. Jangan ganggu jerami Pak Sura, katanya.';
    g.prop('sign', MILL.x - 8, MILL.y).text = 'Kincir Selatan. Kolam desa ada di barat.';

    // a chest tucked behind the pond: the first reward for wandering off the road
    g.prop('chest', POND.x - 7, POND.y + 6);

    // fence ring around the village, open where the roads leave
    for (let x = VILLAGE_PLAY.x0; x <= 84; x++) {
      if (Math.abs(x - PLAZA.x) > 2) g.prop('fence_h', x, VILLAGE_PLAY.y0);
      if (Math.abs(x - MILL.x) > 3) g.prop('fence_h', x, VILLAGE_PLAY.y1);
    }
    for (let y = VILLAGE_PLAY.y0 + 1; y <= VILLAGE_PLAY.y1 - 1; y++) g.prop('fence_v', VILLAGE_PLAY.x0 - 1, y);

    g.keepDisc(PLAZA.x, PLAZA.y + 6, 4);
    for (const [x, y] of [[16, 57], [52, 57], [14, 81], [54, 83], [24, 79], [P.x, P.y - 13], [FARM.x, FARM.y + 1], [MILL.x, MILL.y + 1]] as const)
      g.keepDisc(x, y, 1.8);
  }

  private caveDecor(seed: number): void {
    const g = this.g;
    // puzzle hall: pillars placed off the rock's push lane
    g.prop('pillar', HALL.x - 3, HALL.y + 4);
    g.prop('pillar', HALL.x + 2, HALL.y - 8);
    g.prop('plate', PLATE.tx, PLATE.ty);
    // gate + boss door art (visual; collision is handled dynamically by the puzzle system)
    g.prop('gate', GATE.tx, GATE.ty + GATE.h - 1);
    g.prop('boss_door', BOSS_DOOR.tx, BOSS_DOOR.ty + BOSS_DOOR.h - 1);
    // cave altar (checkpoint), just inside the mouth
    g.prop('shrine', 198, 52);
    // the grotto's reward, and a second chest deep in the south cavern
    g.prop('chest', GROTTO.x - 1, GROTTO.y + 1);
    g.prop('chest', SOUTH_CAVERN.x + 5, SOUTH_CAVERN.y + 2);
    // arena pillars
    for (const [dx, dy] of [[-6, -9], [6, -9], [-6, 9], [6, 9]] as const) g.prop('pillar', ARENA.x + dx, ARENA.y + dy);

    // torches on wall faces, crystals and stalagmites on the floor
    const lastTorch: [number, number][] = [];
    for (let y = 1; y < g.h - 1; y++)
      for (let x = CAVE_X0 - 1; x < g.w - 1; x++) {
        const t = g.get(x, y);
        const below = g.get(x, y + 1);
        if (t === T.WALL && (below === T.CAVE || below === T.ARENA) && hashf(x, y, seed + 40) < 0.14) {
          if (lastTorch.some(([tx, ty]) => Math.abs(tx - x) < 7 && Math.abs(ty - y) < 7)) continue;
          if (x >= GATE.tx - 1 && x <= GATE.tx + 1) continue;
          if (x >= BOSS_DOOR.tx - 1 && x <= BOSS_DOOR.tx + 1) continue;
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
        // the grotto is the crystal room: much denser there
        const inGrotto = Math.hypot(x - GROTTO.x, y - GROTTO.y) < GROTTO.rx + 1;
        if (nearWall && r < (inGrotto ? 0.3 : 0.05) && !cryst.some(([cx, cy]) => Math.abs(cx - x) < 4 && Math.abs(cy - y) < 4)) {
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
      if (!isGrassy(g.get(x, y))) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (treeAt.has((y + dy) * g.w + x + dx)) return false;
      return true;
    };
    const putTree = (x: number, y: number, kind: PropType): void => {
      treeAt.add(y * g.w + x);
      g.prop(kind, x, y);
    };

    // forest proper
    for (let y = FOREST_PLAY.y0; y <= FOREST_PLAY.y1; y++)
      for (let x = FOREST_X0 - 10; x <= CAVE_X0 - 4; x++) {
        const depth = clamp((x - (FOREST_X0 - 10)) / 22, 0, 1);
        const cluster = fbm(x * 0.1, y * 0.1, seed + 50);
        const p = (0.1 + 0.34 * Math.max(0, cluster - 0.38)) * depth;
        if (rng() < p && canTree(x, y)) {
          const r = rng();
          putTree(x, y, r < 0.5 ? 'tree_a' : r < 0.82 ? 'tree_b' : r < 0.95 ? 'tree_c' : 'tree_dead');
        }
      }
    // a few trees on the village side, but not in the built-up middle
    for (let y = VILLAGE_PLAY.y0 + 1; y <= VILLAGE_PLAY.y1 - 1; y++)
      for (let x = VILLAGE_PLAY.x0 + 1; x < 92; x++)
        if (rng() < 0.016 && canTree(x, y) && !(x > 10 && x < 62 && y > 44 && y < 90)) putTree(x, y, rng() < 0.6 ? 'tree_a' : 'tree_c');

    // ruins: a broken pillar ring with rubble, at two spots
    const ruin = (cx: number, cy: number, r: number, count: number, s: number): void => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + s;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        if (g.isBlocked(x, y)) continue;
        g.prop(hashf(x, y, s) < 0.6 ? 'pillar' : 'rock_b', x, y);
      }
      g.prop('rock_a', cx + 1, cy + 1);
      g.prop('stump', cx - 2, cy);
    };
    ruin(RUINS.x, RUINS.y, 4, 7, 0.3);
    ruin(SOUTH_CLEARING.x, SOUTH_CLEARING.y, 3, 5, 1.1);

    // landmarks
    g.prop('shrine', FOREST_SHRINE.x, FOREST_SHRINE.y);
    g.prop('sign', FOREST_SHRINE.x - 3, FOREST_SHRINE.y + 4).text = 'Altar Hutan. Menyentuh apinya menyembuhkan dan menyimpan progresmu.';
    g.prop('sign', CAVE_X0 - 6, CAVE_MOUTH_Y - 3).text = 'Gua Kelam. Hanya untuk yang berani. Dorong batu ukir ke pelat untuk membuka gerbang!';
    g.prop('sign', RUINS.x - 3, RUINS.y + 4).text = 'Reruntuhan tanpa nama. Batunya lebih tua dari desa.';

    // viewpoint: a bench of logs looking out over the forest
    g.prop('log', VIEWPOINT.x - 1, VIEWPOINT.y + 2, { halfX: true });
    g.prop('log', VIEWPOINT.x + 2, VIEWPOINT.y + 2, { halfX: true });
    g.prop('sign', VIEWPOINT.x, VIEWPOINT.y + 4).text = 'Titik Pandang Bisik. Dari sini seluruh hutan kelihatan bernapas.';
    g.prop('lamp', VIEWPOINT.x + 4, VIEWPOINT.y + 3);

    // chests hidden away from the roads
    g.prop('chest', RUINS.x + 1, RUINS.y - 4);
    g.prop('chest', 136, 114);
    g.prop('chest', VIEWPOINT.x - 5, VIEWPOINT.y - 3);

    // small clutter everywhere outdoors
    for (let y = 4; y < g.h - 4; y++)
      for (let x = 4; x < CAVE_X0 - 2; x++) {
        const t = g.get(x, y);
        const r = rng();
        if (g.isBlocked(x, y)) continue;
        if (isGrassy(t) && !g.isKept(x, y)) {
          const inForest = x >= FOREST_X0 - 8;
          if (r < 0.012) g.prop(rng() < 0.5 ? 'bush_a' : 'bush_b', x, y);
          else if (r < 0.018) g.prop(rng() < 0.6 ? 'rock_a' : 'rock_b', x, y);
          else if (inForest && r < 0.021) g.prop(rng() < 0.5 ? 'stump' : 'log', x, y);
          else if (inForest && r < 0.027 && t === T.FOREST) g.prop('mushroom', x, y);
          else if (r < 0.13 && fbm(x * 0.15, y * 0.15, seed + 60) > 0.55) g.prop('tallgrass', x, y);
        } else if (t === T.SHALLOW && r < 0.08) {
          g.prop(rng() < 0.5 ? 'lily' : 'reeds', x, y);
        } else if (t === T.SAND && r < 0.12 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) === T.SHALLOW)) {
          g.prop('reeds', x, y);
        }
      }
  }

  private borders(seed: number): void {
    const g = this.g;
    const rng = makeRng(seed + 99);
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < CAVE_X0; x++) {
        if (playable(x, y)) continue;
        g.block(x, y);
        if (g.get(x, y) === T.WATER || g.get(x, y) === T.SHALLOW) continue;
        if (g.get(x, y) !== T.FOREST) g.set(x, y, T.FOREST);
        // a dense visual wall of trees, but only within camera reach of somewhere you can stand
        let near = false;
        for (let dy = -10; dy <= 10 && !near; dy += 3) for (let dx = -14; dx <= 14; dx += 3) if (playable(x + dx, y + dy)) near = true;
        if (near && rng() < 0.7) {
          const r = rng();
          g.prop(r < 0.45 ? 'tree_a' : r < 0.85 ? 'tree_b' : 'tree_c', x, y);
        }
      }
    // rock face between the forest and the cave, pierced only by the mouth
    for (let y = FOREST_PLAY.y0; y <= FOREST_PLAY.y1; y++)
      if (y < CAVE_MOUTH_Y - 2 || y > CAVE_MOUTH_Y + 2) {
        g.set(CAVE_X0 - 2, y, T.WALL);
        g.set(CAVE_X0 - 1, y, T.WALL);
      }
  }

  private entities(): void {
    const S = (id: string, kind: SpawnDef['kind'], tx: number, ty: number, count?: number): void => {
      this.spawns.push({ id, kind, x: px(tx), y: px(ty), count });
      this.g.keepDisc(tx, ty, 2.2);
    };
    // village outskirts: a couple of strays so the first fight comes to you
    S('slime_v1', 'slime', 78, 30);
    S('slime_v2', 'slime', 80, 96);
    S('slime_v3', 'slime', 64, 26);
    // forest, west of the river
    S('slime_f1', 'slime', 104, 44);
    S('slime_f2', 'slime', 108, 82);
    S('slime_f3', 'slime', 122, 30);
    S('slime_f4', 'slime', 126, 70);
    S('slime_f5', 'slime', 118, 110);
    S('archer_f1', 'archer', 112, 24);
    S('archer_f2', 'archer', 130, 96);
    S('archer_f3', 'archer', 106, 58);
    // forest, east of the river
    S('slime_f6', 'slime', 152, 44);
    S('slime_f7', 'slime', 166, 58);
    S('slime_f8', 'slime', 158, 88);
    S('slime_f9', 'slime', 180, 72);
    S('slime_f10', 'slime', 172, 106);
    S('archer_f4', 'archer', 160, 30);
    S('archer_f5', 'archer', 178, 52);
    S('archer_f6', 'archer', 170, 92);
    S('archer_f7', 'archer', 186, 66);
    // cave
    S('bats_c1', 'bats', NORTH_CAVERN.x, NORTH_CAVERN.y, 4);
    S('bats_c2', 'bats', SOUTH_CAVERN.x, SOUTH_CAVERN.y, 3);
    S('bats_c3', 'bats', 226, 64, 3);
    S('bats_c4', 'bats', GROTTO.x, GROTTO.y, 2);
    S('archer_c1', 'archer', NORTH_CAVERN.x + 5, NORTH_CAVERN.y + 1);
    S('archer_c2', 'archer', SOUTH_CAVERN.x - 4, SOUTH_CAVERN.y);
    S('archer_c3', 'archer', HALL.x - 5, HALL.y + 6); // clear of the plate and the rock's push lane
    S('bats_c5', 'bats', ARENA.x - 6, ARENA.y - 8, 2);
    S('boss', 'boss', ARENA.x + 1, ARENA.y);

    const npcs: NpcDef[] = [
      { id: 'wulan', name: 'Tetua Wulan', look: 'elder', x: px(PLAZA.x - 3), y: px(PLAZA.y - 4) },
      { id: 'rengga', name: 'Bu Rengga', look: 'smith', x: px(25), y: px(71) },
      { id: 'mita', name: 'Mita', look: 'kid', x: px(114), y: px(66) },
      { id: 'jagat', name: 'Pak Jagat', look: 'guard', x: px(CAVE_X0 + 5), y: px(CAVE_MOUTH_Y + 2) },
    ];
    for (const n of npcs) {
      this.npcs.push(n);
      this.g.keepDisc(Math.floor(n.x / TILE), Math.floor(n.y / TILE), 1.8);
    }
  }
}
