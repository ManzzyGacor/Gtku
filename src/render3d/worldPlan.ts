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
import { CHUNK_TILES, TILE } from '../config';
import { P, shade } from '../art/palette';
import type { GreyboxTexture } from '../art/greybox';
import { mix, type Color } from '../art/pixmap';
import type { PropPlacement, PropType } from '../core/world/props';
import { PROPS } from '../core/world/props';
import type { TileRect, WorldSource } from '../core/world/source';
import { T } from '../core/world/tiles';

export const UNITS_PER_PX = 1 / TILE;
/** px → world units. */
export const u = (px: number): number => px * UNITS_PER_PX;

export type ShapeKind = 'box' | 'prism';

/** Textures whose shapes bend in the wind and part when the hero walks through them. */
export const VEGETATION: ReadonlySet<GreyboxTexture> = new Set<GreyboxTexture>(['leaf']);

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
  /** Only shown after dark — lit windows, which is what makes a village look inhabited at night. */
  nightOnly?: boolean;
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
  /** 0 = steady, higher = a livelier flame. Straight from the 2D light definition. */
  flicker: number;
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
  nightOnly?: boolean;
}

const box = (sx: number, sy: number, sz: number, color: number, texture: GreyboxTexture, extra: Partial<Part> = {}): Part => ({
  kind: 'box', sx, sy, sz, color, texture, ...extra,
});
const prism = (sx: number, sy: number, sz: number, color: number, texture: GreyboxTexture, extra: Partial<Part> = {}): Part => ({
  kind: 'prism', sx, sy, sz, color, texture, ...extra,
});

/**
 * Buildings, assembled the way the reference art draws them.
 *
 * The first pass was a box plus a pyramid, and it read as a box plus a pyramid. What makes the
 * reference's cabins look built is a short list of specific parts: a **stone base course**, **log
 * walls**, **corner posts**, a **top plate**, a roof with a real **overhang** and a **fascia board**
 * under the eaves, a **ridge cap**, and windows with a **frame** around the glass. Each one is one
 * more instance in a pool that is already drawing thousands, so the cost is nil.
 */
function house(w: number, h: number, d: number, opts: { roof?: Color; roofTex?: GreyboxTexture; wall?: Color; wallTex?: GreyboxTexture } = {}): Part[] {
  const base = 0.3;
  const top = base + h;
  const overhang = 0.55;
  const roofH = h * 0.62;
  const roofColor = opts.roof ?? mix(P.s1, P.b0, 0.45);
  const roofTex = opts.roofTex ?? 'roof';
  const wall = opts.wall ?? P.o3;
  const wallTex = opts.wallTex ?? 'logwall';
  const winY = base + h * 0.58;
  const winX = w * 0.27;

  const parts: Part[] = [
    // stone footing, slightly wider than the walls
    box(w + 0.18, base, d + 0.18, mix(P.s2, P.d1, 0.3), 'stone', { dy: base / 2 }),
    box(w, h, d, wall, wallTex, { dy: base + h / 2 }),
    // top plate the roof sits on
    box(w + 0.12, 0.2, d + 0.12, P.o1, 'beam', { dy: top }),
    // roof: overhanging pyramid + the fascia board that makes the eaves read
    prism(w + overhang * 2, roofH, d + overhang * 2, roofColor, roofTex, { dy: top + 0.1 + roofH / 2 }),
    box(w + overhang * 2, 0.16, d + overhang * 2, shade(P.o0, 0.1), 'beam', { dy: top + 0.14 }),
    // ridge cap
    box(0.34, 0.18, d + overhang * 2 + 0.1, P.o1, 'beam', { dy: top + 0.1 + roofH }),
    // door: frame, then the door itself recessed inside it
    box(1.06, h * 0.72 + 0.1, 0.1, shade(P.o0, 0.15), 'beam', { dy: base + (h * 0.72) / 2, dz: d / 2 + 0.03 }),
    box(0.84, h * 0.68, 0.1, P.o2, 'wood', { dy: base + (h * 0.68) / 2, dz: d / 2 + 0.07 }),
  ];

  // corner posts
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(box(0.24, h, 0.24, P.o1, 'beam', { dy: base + h / 2, dx: (sx * w) / 2, dz: (sz * d) / 2 }));

  /** A window is a dark frame, dark glass by day, and a lit pane that appears after dark. */
  const window = (dx: number, dz: number, side: boolean): void => {
    const fw = side ? 0.1 : 0.62;
    const fd = side ? 0.62 : 0.1;
    parts.push(box(fw + (side ? 0 : 0.18), 0.66, fd + (side ? 0.18 : 0), shade(P.o0, 0.1), 'beam', { dy: winY, dx, dz }));
    parts.push(box(fw, 0.48, fd, mix(P.ink1, P.b0, 0.5), 'metal', { dy: winY, dx: dx + (side ? Math.sign(dx) * 0.03 : 0), dz: dz + (side ? 0 : Math.sign(dz) * 0.03) }));
    parts.push(
      box(fw, 0.48, fd, P.y4, 'glow', {
        dy: winY,
        dx: dx + (side ? Math.sign(dx) * 0.05 : 0),
        dz: dz + (side ? 0 : Math.sign(dz) * 0.05),
        emissive: true,
        nightOnly: true,
      }),
    );
    // a sill under it
    parts.push(box(fw + (side ? 0.06 : 0.3), 0.1, fd + (side ? 0.3 : 0.06), P.o1, 'beam', { dy: winY - 0.4, dx, dz }));
  };
  window(-winX, d / 2 + 0.04, false);
  window(winX, d / 2 + 0.04, false);
  window(w / 2 + 0.04, 0, true);
  window(-w / 2 - 0.04, 0, true);
  return parts;
}

/** Trunk plus a chunky crown; `crown` scales the foliage. Three stacked masses, not one blob. */
function tree(trunkH: number, crown: number, leaf: Color): Part[] {
  return [
    box(0.46, trunkH, 0.46, P.o1, 'beam', { dy: trunkH / 2 }),
    // a root flare so the trunk does not look like a stick pushed into the ground
    box(0.66, 0.2, 0.66, shade(P.o1, -0.2), 'beam', { dy: 0.1 }),
    box(crown, crown * 0.7, crown, leaf, 'leaf', { dy: trunkH + crown * 0.35 }),
    box(crown * 0.72, crown * 0.5, crown * 0.72, shade(leaf, 0.12), 'leaf', { dy: trunkH + crown * 0.8 }),
    prism(crown * 0.8, crown * 0.75, crown * 0.8, shade(leaf, 0.2), 'leaf', { dy: trunkH + crown * 1.05 + crown * 0.15 }),
  ];
}

/** A lantern on a post: base, post, iron cage, glowing pane, and a little peaked cap. */
function lanternPost(postH: number): Part[] {
  return [
    box(0.42, 0.16, 0.42, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.08 }),
    box(0.16, postH, 0.16, P.s1, 'metal', { dy: 0.08 + postH / 2 }),
    box(0.38, 0.42, 0.38, P.s1, 'metal', { dy: 0.08 + postH + 0.21 }),
    box(0.3, 0.34, 0.3, P.y4, 'glow', { dy: 0.08 + postH + 0.21, emissive: true }),
    prism(0.5, 0.2, 0.5, P.o1, 'beam', { dy: 0.08 + postH + 0.52 }),
  ];
}

const RECIPES: Partial<Record<PropType, Part[]>> = {
  tree_a: tree(1.6, 2.5, P.f1),
  tree_b: tree(2.1, 2.1, P.f0),
  tree_c: tree(1.3, 3.0, P.f2),
  tree_dead: [
    box(0.44, 2.3, 0.44, P.o0, 'beam', { dy: 1.15 }),
    box(0.62, 0.2, 0.62, shade(P.o0, -0.2), 'beam', { dy: 0.1 }),
    box(1.4, 0.18, 0.18, P.o0, 'beam', { dy: 1.9 }),
    box(0.18, 0.18, 1.1, P.o0, 'beam', { dy: 1.55 }),
  ],
  bush_a: [box(0.95, 0.6, 0.95, P.f1, 'leaf', { dy: 0.3 }), box(0.6, 0.3, 0.6, P.g2, 'leaf', { dy: 0.66 })],
  bush_b: [box(1.25, 0.8, 1.25, P.f2, 'leaf', { dy: 0.4 }), box(0.8, 0.36, 0.8, P.g3, 'leaf', { dy: 0.9 })],
  rock_a: [box(0.95, 0.55, 0.9, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.27 }), box(0.6, 0.3, 0.55, P.s3, 'stone', { dy: 0.64, dx: 0.1 })],
  rock_b: [
    box(1.3, 0.8, 1.15, mix(P.s1, P.d1, 0.25), 'stone', { dy: 0.4 }),
    box(0.8, 0.45, 0.7, P.s2, 'stone', { dy: 0.98, dx: -0.12, dz: 0.1 }),
  ],
  stump: [box(0.74, 0.44, 0.74, P.o1, 'beam', { dy: 0.22 }), box(0.6, 0.08, 0.6, shade(P.o4, 0.2), 'wood', { dy: 0.47 })],
  log: [box(2, 0.5, 0.5, P.o1, 'beam', { dy: 0.25 }), box(0.14, 0.52, 0.52, shade(P.o4, 0.15), 'wood', { dy: 0.26, dx: 1 })],
  haystack: [
    box(1.85, 1.05, 1.85, P.y2, 'thatch', { dy: 0.52 }),
    prism(2, 0.8, 2, shade(P.y2, 0.15), 'thatch', { dy: 1.45 }),
    box(0.12, 1.4, 0.12, P.o1, 'beam', { dy: 0.7, dx: 0.7, dz: 0.7 }),
  ],
  house_a: house(4.0, 2.3, 3.6),
  house_b: house(4.0, 2.7, 3.4, { roof: mix(P.t0, P.b0, 0.4) }),
  house_c: house(3.0, 2.1, 2.8, { roof: P.y1, roofTex: 'thatch' }),
  hall: [
    ...house(5.2, 3.2, 4.4, { roof: mix(P.r0, P.s0, 0.4) }),
    // a covered porch across the front
    box(5.6, 0.2, 0.3, P.o1, 'beam', { dy: 0.1, dz: 2.6 }),
    box(0.24, 2.2, 0.24, P.o1, 'beam', { dy: 1.1, dx: -2.4, dz: 2.5 }),
    box(0.24, 2.2, 0.24, P.o1, 'beam', { dy: 1.1, dx: 2.4, dz: 2.5 }),
    prism(5.8, 0.7, 1.6, mix(P.r0, P.s0, 0.4), 'roof', { dy: 2.55, dz: 2.4 }),
  ],
  well: [
    box(1.7, 0.75, 1.7, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.37 }),
    box(1.3, 0.1, 1.3, P.ink1, 'metal', { dy: 0.78 }),
    box(0.18, 1.6, 0.18, P.o1, 'beam', { dy: 1.5, dx: -0.62 }),
    box(0.18, 1.6, 0.18, P.o1, 'beam', { dy: 1.5, dx: 0.62 }),
    box(1.5, 0.16, 0.16, P.o2, 'wood', { dy: 2.2 }),
    prism(2.1, 0.65, 2.1, P.o3, 'roof', { dy: 2.6 }),
    box(0.3, 0.34, 0.3, P.o2, 'wood', { dy: 1.5 }),
  ],
  lamp: lanternPost(1.9),
  fence_h: [
    box(0.9, 0.14, 0.16, P.o2, 'wood', { dy: 0.66 }),
    box(0.9, 0.14, 0.16, P.o2, 'wood', { dy: 0.38 }),
    box(0.22, 0.9, 0.22, P.o1, 'beam', { dy: 0.45, dx: 0.45 }),
    box(0.3, 0.16, 0.3, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.08, dx: 0.45 }),
  ],
  fence_v: [
    box(0.16, 0.14, 0.9, P.o2, 'wood', { dy: 0.66 }),
    box(0.16, 0.14, 0.9, P.o2, 'wood', { dy: 0.38 }),
    box(0.22, 0.9, 0.22, P.o1, 'beam', { dy: 0.45, dz: 0.45 }),
    box(0.3, 0.16, 0.3, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.08, dz: 0.45 }),
  ],
  sign: [
    box(0.16, 0.9, 0.16, P.o1, 'beam', { dy: 0.45 }),
    box(1.05, 0.62, 0.1, P.o3, 'wood', { dy: 1.0 }),
    box(1.05, 0.08, 0.14, P.o1, 'beam', { dy: 1.33 }),
  ],
  barrel: [
    box(0.68, 0.86, 0.68, P.o2, 'wood', { dy: 0.43 }),
    box(0.74, 0.1, 0.74, P.s2, 'metal', { dy: 0.24 }),
    box(0.74, 0.1, 0.74, P.s2, 'metal', { dy: 0.66 }),
    box(0.6, 0.06, 0.6, shade(P.o4, 0.2), 'wood', { dy: 0.89 }),
  ],
  crate: [
    box(0.8, 0.8, 0.8, P.o3, 'wood', { dy: 0.4 }),
    box(0.84, 0.1, 0.1, P.o1, 'beam', { dy: 0.4, dz: 0.4 }),
    box(0.1, 0.1, 0.84, P.o1, 'beam', { dy: 0.4, dx: 0.4 }),
  ],
  chest: [
    box(1.1, 0.5, 0.78, P.o2, 'wood', { dy: 0.25 }),
    prism(1.14, 0.34, 0.82, P.o3, 'wood', { dy: 0.66 }),
    box(0.24, 0.62, 0.84, P.s2, 'metal', { dy: 0.4 }),
    box(0.2, 0.18, 0.1, P.y3, 'metal', { dy: 0.3, dz: 0.42 }),
  ],
  stall: [
    box(2.8, 0.9, 1.3, P.o2, 'wood', { dy: 0.45 }),
    box(2.9, 0.12, 1.4, shade(P.o4, 0.15), 'wood', { dy: 0.95 }),
    box(0.16, 1.9, 0.16, P.o1, 'beam', { dy: 0.95, dx: -1.35, dz: -0.55 }),
    box(0.16, 1.9, 0.16, P.o1, 'beam', { dy: 0.95, dx: 1.35, dz: -0.55 }),
    box(0.16, 1.9, 0.16, P.o1, 'beam', { dy: 0.95, dx: -1.35, dz: 0.55 }),
    box(0.16, 1.9, 0.16, P.o1, 'beam', { dy: 0.95, dx: 1.35, dz: 0.55 }),
    // striped awning, tilted forward by being wider at the front
    prism(3.2, 0.7, 1.9, P.r2, 'cloth', { dy: 2.15 }),
    box(3.2, 0.18, 0.12, P.cream, 'cloth', { dy: 1.86, dz: 0.9 }),
    box(0.5, 0.5, 0.5, P.o3, 'wood', { dy: 1.26, dx: -0.8 }),
    box(0.4, 0.4, 0.4, P.o4, 'wood', { dy: 1.21, dx: 0.7 }),
  ],
  great_lantern: [
    box(2.2, 0.35, 2.2, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.17 }),
    box(1.7, 0.3, 1.7, mix(P.s3, P.d1, 0.2), 'stone', { dy: 0.48 }),
    box(0.55, 2.8, 0.55, P.s1, 'metal', { dy: 2.0 }),
    box(1.25, 1.4, 1.25, P.s1, 'metal', { dy: 4.0 }),
    box(1.05, 1.2, 1.05, P.y4, 'glow', { dy: 4.0, emissive: true }),
    prism(1.7, 0.8, 1.7, P.o1, 'roof', { dy: 4.9 }),
    box(0.18, 0.4, 0.18, P.y3, 'metal', { dy: 5.4 }),
  ],
  shrine: [
    box(1.2, 0.3, 1.2, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.15 }),
    box(0.9, 0.8, 0.9, mix(P.s1, P.d1, 0.25), 'stone', { dy: 0.7 }),
    box(0.55, 0.55, 0.55, P.y4, 'glow', { dy: 1.35, emissive: true }),
    prism(1.1, 0.4, 1.1, P.o1, 'roof', { dy: 1.8 }),
  ],
  torch: [
    box(0.16, 1.15, 0.16, P.o1, 'beam', { dy: 0.57 }),
    box(0.26, 0.24, 0.26, P.s1, 'metal', { dy: 1.2 }),
    box(0.3, 0.34, 0.3, P.y4, 'glow', { dy: 1.32, emissive: true }),
  ],
  crystal_a: [prism(0.8, 1.7, 0.8, P.k2, 'glow', { dy: 0.85, emissive: true }), prism(0.4, 0.8, 0.4, P.k3, 'glow', { dy: 0.4, dx: 0.35, emissive: true })],
  crystal_b: [prism(1.0, 2.1, 1.0, P.c3, 'glow', { dy: 1.05, emissive: true }), prism(0.5, 1.0, 0.5, P.c2, 'glow', { dy: 0.5, dx: -0.4, emissive: true })],
  stalagmite: [prism(0.95, 1.9, 0.95, mix(P.s1, P.d1, 0.2), 'stone', { dy: 0.95 })],
  pillar: [
    box(1.15, 0.25, 1.15, mix(P.s2, P.d1, 0.3), 'stone', { dy: 0.12 }),
    box(0.9, 2.4, 0.9, mix(P.s2, P.d1, 0.2), 'stone', { dy: 1.45 }),
    box(1.15, 0.25, 1.15, mix(P.s3, P.d1, 0.2), 'stone', { dy: 2.77 }),
  ],
  mushroom: [box(0.14, 0.24, 0.14, P.cream, 'wood', { dy: 0.12 }), prism(0.4, 0.26, 0.4, P.k3, 'glow', { dy: 0.32, emissive: true })],
  flowerbed: [
    box(1.0, 0.12, 1.0, P.d2, 'dirt', { dy: 0.06 }),
    box(0.8, 0.22, 0.8, P.g3, 'leaf', { dy: 0.2 }),
    box(0.25, 0.1, 0.25, P.p2, 'leaf', { dy: 0.33, dx: -0.2 }),
    box(0.25, 0.1, 0.25, P.y4, 'leaf', { dy: 0.33, dx: 0.22, dz: 0.18 }),
  ],
  reeds: [box(0.5, 1.0, 0.5, P.f2, 'leaf', { dy: 0.5 }), box(0.28, 0.4, 0.28, P.g3, 'leaf', { dy: 1.15 })],
  tallgrass: [box(0.75, 0.5, 0.75, P.g2, 'leaf', { dy: 0.25 }), box(0.45, 0.26, 0.45, P.g4, 'leaf', { dy: 0.58 })],
  lily: [box(0.72, 0.06, 0.72, P.g3, 'leaf', { dy: 0.03 }), box(0.18, 0.1, 0.18, P.p2, 'leaf', { dy: 0.1, dx: 0.15 })],
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
      nightOnly: part.nightOnly,
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
    flicker: def.flicker ?? 0,
  });
}

/** Geometry and lights belonging to one chunk. Planned lazily by the streamer and cached. */
export interface ChunkPlan {
  cx: number;
  cy: number;
  shapes: ShapeInstance[];
  lights: PointLightPlan[];
}

/**
 * Just the static lights of one chunk. Cheaper than a full `planChunk` and what the light-map
 * baker needs from the surrounding chunks (a lamp lights the ground across a chunk border).
 */
export function chunkLights(world: WorldSource, cx: number, cy: number): PointLightPlan[] {
  const out: PointLightPlan[] = [];
  for (const p of world.chunk(cx, cy).props) {
    if (PROPS[p.type].special) continue;
    propLight(p, out);
  }
  return out;
}

/**
 * Plan one chunk: every prop whose foot stands in it, plus its wall tiles.
 *
 * Chunk membership follows the foot position, exactly like the 2D renderer, so a house whose roof
 * overhangs the border still belongs to one chunk and can never be counted twice.
 */
export function planChunk(world: WorldSource, cx: number, cy: number, opts: { walls?: boolean } = {}): ChunkPlan {
  const shapes: ShapeInstance[] = [];
  const lights: PointLightPlan[] = [];
  for (const p of world.chunk(cx, cy).props) {
    if (PROPS[p.type].special) continue;
    partsToShapes(p, shapes);
    propLight(p, lights);
  }
  if (opts.walls !== false) {
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    for (let ty = ty0; ty < ty0 + CHUNK_TILES; ty++)
      for (let tx = tx0; tx < tx0 + CHUNK_TILES; tx++) {
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
  return { cx, cy, shapes, lights };
}

/**
 * Build the 3D plan for a whole tile rectangle by planning each chunk it covers.
 * Used by `scripts/plan-stats.ts` and by the tests; the renderer streams `planChunk` instead.
 */
export function planArea(world: WorldSource, rect: TileRect, opts: { walls?: boolean } = {}): WorldPlan {
  const shapes: ShapeInstance[] = [];
  const lights: PointLightPlan[] = [];
  const chunks: { cx: number; cy: number }[] = [];

  const cx0 = Math.floor(rect.x0 / CHUNK_TILES);
  const cy0 = Math.floor(rect.y0 / CHUNK_TILES);
  const cx1 = Math.floor((rect.x1 - 1) / CHUNK_TILES);
  const cy1 = Math.floor((rect.y1 - 1) / CHUNK_TILES);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      chunks.push({ cx, cy });
      const plan = planChunk(world, cx, cy, opts);
      shapes.push(...plan.shapes);
      lights.push(...plan.lights);
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
  nightOnly: boolean;
  shapes: ShapeInstance[];
}

/** The group key a shape belongs to. The streamer uses it to find the right instance pool. */
export const groupKeyOf = (s: ShapeInstance): string => `${s.kind}|${s.texture}|${s.emissive ? 1 : 0}|${s.nightOnly ? 'n' : 'd'}`;

export function groupShapes(shapes: readonly ShapeInstance[]): ShapeGroup[] {
  const groups = new Map<string, ShapeGroup>();
  for (const s of shapes) {
    const key = groupKeyOf(s);
    let g = groups.get(key);
    if (!g) {
      g = { key, kind: s.kind, texture: s.texture, emissive: !!s.emissive, nightOnly: !!s.nightOnly, shapes: [] };
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
