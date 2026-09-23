/**
 * Turns the existing 2D world data into a description of 3D shapes — **without importing Three.js**,
 * so the whole layout is unit-testable in Node (there is no GPU on the VPS).
 *
 * Units: the 2D game works in logical pixels with 1 tile = 16 px. In 3D **1 tile = 1 world unit**
 * (`UNITS_PER_PX = 1/16`), which keeps every number in `src/core` — speeds, attack radii, AI
 * distances — valid without conversion (docs/OVERHAUL.md §6.3).
 *
 * The 2D world's `y` (down the screen) becomes 3D `z` (south), and `y` in 3D is up.
 */
import { TILE } from '../config';
import { P } from '../art/palette';
import type { GreyboxTexture } from '../art/greybox';
import type { PropPlacement, PropType } from '../core/world/props';
import { PROPS } from '../core/world/props';
import type { TileRect, WorldSource } from '../core/world/source';
import { T } from '../core/world/tiles';

export const UNITS_PER_PX = 1 / TILE;
/** px → world units. */
export const u = (px: number): number => px * UNITS_PER_PX;

export type ShapeKind = 'box' | 'prism';

export interface ShapeInstance {
  kind: ShapeKind;
  /** Centre of the shape, in world units. */
  x: number;
  y: number;
  z: number;
  /** Full size in world units (not half-extents). */
  sx: number;
  sy: number;
  sz: number;
  color: number;
  texture: GreyboxTexture;
  /** Rotate around Y in radians (fences, bridges). */
  rotY?: number;
  /** Drawn unlit and at full brightness (lantern glass, crystals). */
  emissive?: boolean;
}

export interface PointLightPlan {
  x: number;
  y: number;
  z: number;
  color: number;
  /** Radius in world units. */
  radius: number;
  intensity: number;
  nightOnly: boolean;
}

export interface WorldPlan {
  /** Chunks whose baked ground texture should be shown. */
  chunks: { cx: number; cy: number }[];
  shapes: ShapeInstance[];
  lights: PointLightPlan[];
  /** Tile bounds this plan covers. */
  rect: TileRect;
}

// ───────────────────────── prop recipes ─────────────────────────

/** A recipe describes one prop as a few boxes/prisms stacked on its foot point. */
interface Part {
  kind?: ShapeKind;
  /** Offset from the foot point, in world units (dy is upward). */
  dx?: number;
  dy?: number;
  dz?: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  texture: GreyboxTexture;
  emissive?: boolean;
}

const box = (sx: number, sy: number, sz: number, color: number, texture: GreyboxTexture, extra: Partial<Part> = {}): Part => ({
  kind: 'box', sx, sy, sz, color, texture, ...extra,
});
const prism = (sx: number, sy: number, sz: number, color: number, texture: GreyboxTexture, extra: Partial<Part> = {}): Part => ({
  kind: 'prism', sx, sy, sz, color, texture, ...extra,
});

/** A simple house: plaster body, shingled pyramid roof, wooden door. */
function house(w: number, h: number, d: number): Part[] {
  return [
    box(w, h, d, P.n2, 'plaster', { dy: h / 2 }),
    prism(w + 0.5, h * 0.55, d + 0.5, P.r1, 'roof', { dy: h + h * 0.275 }),
    box(0.8, h * 0.62, 0.12, P.o1, 'wood', { dy: h * 0.31, dz: d / 2 + 0.06 }),
  ];
}

/** Trunk plus a chunky crown; `crown` scales the foliage. */
function tree(trunkH: number, crown: number, leaf: number): Part[] {
  return [
    box(0.42, trunkH, 0.42, P.o1, 'wood', { dy: trunkH / 2 }),
    box(crown, crown * 0.8, crown, leaf, 'leaf', { dy: trunkH + crown * 0.4 }),
    prism(crown * 0.8, crown * 0.7, crown * 0.8, leaf, 'leaf', { dy: trunkH + crown * 0.8 + crown * 0.35 }),
  ];
}

const RECIPES: Partial<Record<PropType, Part[]>> = {
  tree_a: tree(1.5, 2.4, P.g2),
  tree_b: tree(1.9, 2.0, P.g1),
  tree_c: tree(1.2, 2.8, P.f3),
  tree_dead: [box(0.4, 2.2, 0.4, P.o0, 'wood', { dy: 1.1 }), box(1.3, 0.16, 0.16, P.o0, 'wood', { dy: 1.8 })],
  bush_a: [box(0.9, 0.6, 0.9, P.g2, 'leaf', { dy: 0.3 })],
  bush_b: [box(1.2, 0.8, 1.2, P.g1, 'leaf', { dy: 0.4 })],
  rock_a: [box(0.9, 0.6, 0.9, P.s2, 'stone', { dy: 0.3 })],
  rock_b: [box(1.2, 0.85, 1.1, P.s1, 'stone', { dy: 0.42 })],
  stump: [box(0.7, 0.45, 0.7, P.o1, 'wood', { dy: 0.22 })],
  log: [box(2, 0.5, 0.5, P.o1, 'wood', { dy: 0.25 })],
  haystack: [box(1.8, 1.1, 1.8, P.y3, 'leaf', { dy: 0.55 }), prism(1.9, 0.7, 1.9, P.y2, 'leaf', { dy: 1.45 })],
  house_a: house(3.8, 2.2, 3.4),
  house_b: house(3.8, 2.5, 3.2),
  house_c: house(2.8, 2.0, 2.6),
  hall: [
    box(4.8, 3.0, 4.0, P.n2, 'plaster', { dy: 1.5 }),
    prism(5.4, 1.9, 4.6, P.r0, 'roof', { dy: 3.95 }),
    box(1.1, 2.0, 0.14, P.o1, 'wood', { dy: 1.0, dz: 2.07 }),
  ],
  well: [box(1.6, 0.7, 1.6, P.s2, 'stone', { dy: 0.35 }), box(0.16, 1.5, 0.16, P.o1, 'wood', { dy: 1.1, dx: -0.6 }), box(0.16, 1.5, 0.16, P.o1, 'wood', { dy: 1.1, dx: 0.6 }), prism(1.9, 0.6, 1.9, P.o3, 'roof', { dy: 2.1 })],
  lamp: [box(0.18, 1.9, 0.18, P.s1, 'metal', { dy: 0.95 }), box(0.42, 0.5, 0.42, P.y4, 'glow', { dy: 2.1, emissive: true })],
  fence_h: [box(1.0, 0.8, 0.14, P.o2, 'wood', { dy: 0.45 })],
  fence_v: [box(0.14, 0.8, 1.0, P.o2, 'wood', { dy: 0.45 })],
  sign: [box(0.14, 0.8, 0.14, P.o1, 'wood', { dy: 0.4 }), box(0.9, 0.55, 0.1, P.o3, 'wood', { dy: 0.9 })],
  barrel: [box(0.7, 0.9, 0.7, P.o2, 'wood', { dy: 0.45 })],
  crate: [box(0.8, 0.8, 0.8, P.o3, 'wood', { dy: 0.4 })],
  stall: [box(2.8, 1.0, 1.4, P.o2, 'wood', { dy: 0.5 }), prism(3.2, 0.8, 1.8, P.r2, 'roof', { dy: 1.4 })],
  great_lantern: [
    box(1.6, 0.5, 1.6, P.s2, 'stone', { dy: 0.25 }),
    box(0.5, 2.6, 0.5, P.s1, 'metal', { dy: 1.55 }),
    box(1.1, 1.3, 1.1, P.y4, 'glow', { dy: 3.45, emissive: true }),
    prism(1.4, 0.7, 1.4, P.o3, 'roof', { dy: 4.45 }),
  ],
  shrine: [box(1.0, 0.9, 1.0, P.s2, 'stone', { dy: 0.45 }), box(0.5, 0.5, 0.5, P.y4, 'glow', { dy: 1.15, emissive: true })],
  torch: [box(0.14, 1.1, 0.14, P.o1, 'wood', { dy: 0.55 }), box(0.3, 0.34, 0.3, P.y4, 'glow', { dy: 1.25, emissive: true })],
  crystal_a: [prism(0.8, 1.6, 0.8, P.k2, 'glow', { dy: 0.8, emissive: true })],
  crystal_b: [prism(1.0, 2.0, 1.0, P.c3, 'glow', { dy: 1.0, emissive: true })],
  stalagmite: [prism(0.9, 1.8, 0.9, P.s1, 'stone', { dy: 0.9 })],
  pillar: [box(1.0, 2.6, 1.0, P.s2, 'stone', { dy: 1.3 })],
  mushroom: [box(0.3, 0.3, 0.3, P.k3, 'glow', { dy: 0.15, emissive: true })],
  flowerbed: [box(1.0, 0.1, 1.0, P.p1, 'leaf', { dy: 0.05 })],
  reeds: [box(0.5, 0.9, 0.5, P.g1, 'leaf', { dy: 0.45 })],
  tallgrass: [box(0.7, 0.45, 0.7, P.g3, 'leaf', { dy: 0.22 })],
  lily: [box(0.7, 0.06, 0.7, P.g3, 'leaf', { dy: 0.03 })],
};

/** Wall tiles become blocks this tall. */
export const WALL_HEIGHT = 1.9;

function partsToShapes(p: PropPlacement, out: ShapeInstance[]): void {
  const recipe = RECIPES[p.type];
  if (!recipe) return;
  const fx = u(p.x);
  const fz = u(p.y);
  for (const part of recipe) {
    out.push({
      kind: part.kind ?? 'box',
      x: fx + (part.dx ?? 0) * (p.flip ? -1 : 1),
      y: part.dy ?? 0,
      z: fz + (part.dz ?? 0),
      sx: part.sx,
      sy: part.sy,
      sz: part.sz,
      color: part.color,
      texture: part.texture,
      emissive: part.emissive,
    });
  }
}

/** Props whose light should also exist in 3D, using the same radius/colour as the 2D lightmap. */
function propLight(p: PropPlacement, out: PointLightPlan[]): void {
  const def = PROPS[p.type].light;
  if (!def) return;
  out.push({
    x: u(p.x),
    y: u(def.lift ?? 10),
    z: u(p.y),
    color: def.color,
    radius: u(def.radius),
    intensity: def.strength,
    nightOnly: !!def.nightOnly,
  });
}

/**
 * Build the 3D plan for a tile rectangle. Only chunks fully inside the rect are listed, which is
 * what the Fase 1 "one area at a time" build wants; chunk streaming arrives in Batch 6.
 */
export function planArea(world: WorldSource, rect: TileRect, opts: { walls?: boolean } = {}): WorldPlan {
  const shapes: ShapeInstance[] = [];
  const lights: PointLightPlan[] = [];
  const chunks: { cx: number; cy: number }[] = [];

  const cx0 = Math.floor(rect.x0 / 16);
  const cy0 = Math.floor(rect.y0 / 16);
  const cx1 = Math.floor((rect.x1 - 1) / 16);
  const cy1 = Math.floor((rect.y1 - 1) / 16);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      chunks.push({ cx, cy });
      for (const p of world.chunk(cx, cy).props) {
        if (PROPS[p.type].special) continue;
        partsToShapes(p, shapes);
        propLight(p, lights);
      }
    }

  if (opts.walls !== false) {
    for (let ty = rect.y0; ty < rect.y1; ty++)
      for (let tx = rect.x0; tx < rect.x1; tx++) {
        if (world.tileAt(tx, ty) !== T.WALL) continue;
        shapes.push({
          kind: 'box',
          x: tx + 0.5,
          y: WALL_HEIGHT / 2,
          z: ty + 0.5,
          sx: 1,
          sy: WALL_HEIGHT,
          sz: 1,
          color: P.s1,
          texture: 'stone',
        });
      }
  }

  return { chunks, shapes, lights, rect };
}

/**
 * One InstancedMesh per (shape, texture, lit/emissive) combination. Grouping is pure so the
 * instance counts can be checked in a test; the renderer just walks the groups.
 */
export interface ShapeGroup {
  key: string;
  kind: ShapeKind;
  texture: GreyboxTexture;
  emissive: boolean;
  shapes: ShapeInstance[];
}

export function groupShapes(shapes: readonly ShapeInstance[]): ShapeGroup[] {
  const groups = new Map<string, ShapeGroup>();
  for (const s of shapes) {
    const emissive = !!s.emissive;
    const key = `${s.kind}|${s.texture}|${emissive ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, kind: s.kind, texture: s.texture, emissive, shapes: [] };
      groups.set(key, g);
    }
    g.shapes.push(s);
  }
  return [...groups.values()];
}

/** How many instances of each shape kind the plan needs (the renderer sizes its InstancedMeshes from this). */
export function countKinds(plan: WorldPlan): Record<ShapeKind, number> {
  const out: Record<ShapeKind, number> = { box: 0, prism: 0 };
  for (const s of plan.shapes) out[s.kind]++;
  return out;
}
