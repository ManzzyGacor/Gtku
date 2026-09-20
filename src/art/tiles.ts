/** Procedural 16x16 ground tiles + edge overlays. All art is derived from the palette in ./palette.ts. */
import { makeRng, type Rand } from '../core/rng';
import { P, shade } from './palette';
import { mix, Pixmap, type Color } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

export const TS = 16;
export const WATER_FRAMES = 3;

export const VARIANTS = {
  grass: 6,
  flowerGrass: 4,
  forest: 5,
  dirt: 4,
  cobble: 4,
  sand: 4,
  water: 3,
  shallow: 3,
  cave: 5,
  wallTop: 3,
  wallFace: 4,
  arena: 4,
  bridge: 2,
} as const;

function speckle(pm: Pixmap, rng: Rand, c: Color, count: number, w = 1, h = 1, a = 255): void {
  for (let i = 0; i < count; i++) pm.rect(Math.floor(rng() * (TS - w + 1)), Math.floor(rng() * (TS - h + 1)), w, h, c, a);
}

function base(c: Color): Pixmap {
  return new Pixmap(TS, TS).rect(0, 0, TS, TS, c);
}

// ───────────────────────────── grass ─────────────────────────────

function grassBlade(pm: Pixmap, x: number, y: number, dark: Color, mid: Color, tip: Color): void {
  pm.set(x, y + 1, dark);
  pm.set(x, y, mid);
  pm.set(x + 1, y - 1, tip);
}

export function grassTile(seed: number, flowers = false): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.g3);
  // large soft mottling
  for (let i = 0; i < 5; i++) pm.rect(Math.floor(rng() * 13), Math.floor(rng() * 14), 2 + Math.floor(rng() * 3), 1 + Math.floor(rng() * 2), P.g2);
  speckle(pm, rng, P.g4, 7, 2, 1);
  speckle(pm, rng, P.g2, 5, 1, 1);
  for (let i = 0; i < 3; i++) grassBlade(pm, 1 + Math.floor(rng() * 13), 2 + Math.floor(rng() * 12), P.g1, P.g4, P.g5);
  if (flowers) {
    const cols: [Color, Color][] = [
      [P.white, P.y4],
      [P.p2, P.y4],
      [P.y4, P.y2],
    ];
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const [petal, core] = cols[Math.floor(rng() * cols.length)];
      const fx = 2 + Math.floor(rng() * 11);
      const fy = 2 + Math.floor(rng() * 11);
      pm.set(fx, fy + 1, P.g1);
      pm.set(fx - 1, fy, petal);
      pm.set(fx + 1, fy, petal);
      pm.set(fx, fy - 1, petal);
      pm.set(fx, fy, core);
    }
  }
  return pm;
}

export function forestTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.f2);
  for (let i = 0; i < 6; i++) pm.rect(Math.floor(rng() * 12), Math.floor(rng() * 13), 2 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 3), P.f1);
  speckle(pm, rng, P.f3, 8, 2, 1);
  speckle(pm, rng, P.g1, 3, 1, 1);
  // leaf litter
  const leaf = [P.d3, P.y2, P.d4, P.r3];
  const n = Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const lx = 1 + Math.floor(rng() * 13);
    const ly = 1 + Math.floor(rng() * 13);
    const c = leaf[Math.floor(rng() * leaf.length)];
    pm.set(lx, ly, c);
    pm.set(lx + 1, ly, shade(c, -0.25));
  }
  // twig
  if (rng() < 0.3) {
    const tx = 2 + Math.floor(rng() * 8);
    const ty = 2 + Math.floor(rng() * 12);
    pm.hline(tx, ty, 4, P.o2);
    pm.set(tx + 4, ty - 1, P.o2);
  }
  return pm;
}

// ───────────────────────────── ground ─────────────────────────────

export function dirtTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.d3);
  for (let i = 0; i < 6; i++) pm.rect(Math.floor(rng() * 13), Math.floor(rng() * 14), 2 + Math.floor(rng() * 3), 1 + Math.floor(rng() * 2), P.d2);
  speckle(pm, rng, P.d4, 9, 1, 1);
  speckle(pm, rng, P.d5, 3, 1, 1);
  const stones = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < stones; i++) {
    const sx = 1 + Math.floor(rng() * 12);
    const sy = 1 + Math.floor(rng() * 12);
    pm.rect(sx, sy, 2, 1, P.s3);
    pm.set(sx, sy, P.s5);
    pm.set(sx + 1, sy + 1, P.d1);
  }
  return pm;
}

const COBBLE_MORTAR = mix(P.s2, P.d1, 0.45);
const COBBLE_A = mix(P.s4, P.n2, 0.5);
const COBBLE_B = mix(P.s3, P.n1, 0.45);

export function cobbleTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(COBBLE_MORTAR);
  const rows = [
    { y: 0, h: 7, offset: Math.floor(rng() * 3) },
    { y: 8, h: 7, offset: 5 + Math.floor(rng() * 3) },
  ];
  for (const row of rows) {
    let x = -row.offset;
    while (x < TS) {
      const w = 6 + Math.floor(rng() * 4);
      const fill = rng() < 0.5 ? COBBLE_A : COBBLE_B;
      const x0 = Math.max(0, x);
      const x1 = Math.min(TS, x + w - 1);
      for (let yy = row.y; yy < row.y + row.h - 1; yy++) for (let xx = x0; xx < x1; xx++) pm.set(xx, yy, fill);
      // top-left highlight, bottom-right shade
      for (let xx = x0; xx < x1; xx++) pm.set(xx, row.y, shade(fill, 0.35));
      for (let xx = x0; xx < x1; xx++) pm.set(xx, row.y + row.h - 2, shade(fill, -0.3));
      if (x >= 0) for (let yy = row.y; yy < row.y + row.h - 1; yy++) pm.set(x, yy, shade(fill, 0.22));
      x += w;
    }
  }
  speckle(pm, rng, shade(COBBLE_A, 0.5), 2, 1, 1);
  return pm;
}

export function sandTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.n2);
  for (let i = 0; i < 5; i++) pm.rect(Math.floor(rng() * 12), Math.floor(rng() * 14), 3 + Math.floor(rng() * 3), 1, P.n1);
  speckle(pm, rng, P.n3, 8, 1, 1);
  speckle(pm, rng, P.n0, 3, 1, 1);
  if (rng() < 0.25) {
    const sx = 2 + Math.floor(rng() * 11);
    const sy = 2 + Math.floor(rng() * 11);
    pm.set(sx, sy, P.white);
    pm.set(sx + 1, sy, P.p2);
  }
  return pm;
}

// ───────────────────────────── water ─────────────────────────────

/** Water with animated wave highlights. Frame f shifts the highlights so 3 frames loop seamlessly. */
export function waterTile(seed: number, frame: number, shallow: boolean): Pixmap {
  const rng = makeRng(seed);
  const deep = shallow ? P.w3 : P.w2;
  const dark = shallow ? P.w2 : P.w1;
  const light = shallow ? P.w4 : P.w3;
  const spark = shallow ? P.w6 : P.w5;
  const pm = base(deep);
  for (let i = 0; i < 5; i++) pm.rect(Math.floor(rng() * 11), Math.floor(rng() * 14), 3 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 2), dark);
  // wave crests move 1px per frame horizontally, looping every 3 frames (wave period is 3 px multiples)
  const crests = 3;
  for (let i = 0; i < crests; i++) {
    const y = 2 + Math.floor(rng() * 12);
    const x0 = Math.floor(rng() * 12);
    const len = 3 + Math.floor(rng() * 3);
    const shift = frame % WATER_FRAMES;
    pm.hline((x0 + shift) % (TS - len), y, len, light);
    if (rng() < 0.6) pm.hline((x0 + shift + 1) % (TS - len), y, Math.max(1, len - 2), spark);
  }
  if (shallow) {
    // sparkles blink between frames
    const sx = 2 + Math.floor(rng() * 12);
    const sy = 2 + Math.floor(rng() * 12);
    if (frame === 0) pm.set(sx, sy, P.w6);
    if (frame === 1) pm.set(sx + 1, sy + 1, P.w6);
    // sandy bottom hints
    speckle(pm, rng, mix(P.w3, P.n2, 0.35), 4, 1, 1);
  }
  return pm;
}

/** Foam line drawn on a water tile along its NORTH edge. Rotate for other sides. */
export function foamNorth(frame: number): Pixmap {
  const pm = new Pixmap(TS, TS);
  const seedRng = makeRng(77);
  for (let x = 0; x < TS; x++) {
    const wob = Math.round(Math.sin((x + frame * 5.33) * 0.7) * 0.9 + Math.sin(x * 1.9 + frame) * 0.5);
    const y = 1 + wob;
    pm.set(x, Math.max(0, y), P.w5);
    pm.set(x, Math.max(0, y - 1), P.w6);
    if (seedRng() < 0.5) pm.set(x, y + 1, P.w4, 200);
  }
  for (let x = 0; x < TS; x++) pm.set(x, 0, P.w6);
  return pm;
}

// ───────────────────────────── cave ─────────────────────────────

export function caveTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.s1);
  for (let i = 0; i < 6; i++) pm.rect(Math.floor(rng() * 12), Math.floor(rng() * 13), 2 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 2), P.s0);
  speckle(pm, rng, P.s2, 9, 2, 1);
  speckle(pm, rng, P.s3, 3, 1, 1);
  if (rng() < 0.45) {
    // crack
    let cx = 2 + Math.floor(rng() * 10);
    let cy = 1 + Math.floor(rng() * 6);
    for (let i = 0; i < 6; i++) {
      pm.set(cx, cy, P.ink2);
      cx += rng() < 0.5 ? 1 : 0;
      cy += 1;
      if (rng() < 0.3) cx -= 1;
    }
  }
  return pm;
}

export function wallTopTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.ink2);
  speckle(pm, rng, P.ink3, 8, 2, 1);
  speckle(pm, rng, P.ink1, 6, 2, 2);
  speckle(pm, rng, P.s1, 3, 1, 1);
  return pm;
}

/** Front face of a cave wall (drawn when the tile south of the wall is open floor). */
export function wallFaceTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(P.s2);
  // top lip
  pm.hline(0, 0, TS, P.s4);
  pm.hline(0, 1, TS, P.s3);
  // strata columns
  for (let x = 0; x < TS; x += 2 + Math.floor(rng() * 3)) {
    const len = 6 + Math.floor(rng() * 8);
    pm.vline(x, 2, len, P.s1);
    if (rng() < 0.5) pm.vline(x + 1, 2, Math.max(2, len - 4), P.s3);
  }
  speckle(pm, rng, P.s3, 6, 1, 1);
  speckle(pm, rng, P.s1, 4, 2, 1);
  // bottom shadow gradient toward the floor
  pm.hline(0, TS - 1, TS, P.s0);
  pm.hline(0, TS - 2, TS, P.s1);
  return pm;
}

export function arenaTile(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = base(mix(P.s1, P.c0, 0.35));
  // 8x8 slab grid
  pm.hline(0, 0, TS, P.ink2);
  pm.hline(0, 8, TS, P.ink2);
  pm.vline(0, 0, TS, P.ink2);
  pm.vline(8, 0, TS, P.ink2);
  for (const [x, y] of [
    [1, 1],
    [9, 1],
    [1, 9],
    [9, 9],
  ]) {
    pm.hline(x, y, 6, mix(P.s2, P.c1, 0.3));
    pm.vline(x, y, 6, mix(P.s2, P.c1, 0.3));
  }
  speckle(pm, rng, P.s0, 5, 2, 1);
  speckle(pm, rng, mix(P.s3, P.c2, 0.4), 4, 1, 1);
  return pm;
}

/** Wooden bridge tile. `horizontal` = walks west↔east, rails on north/south. */
export function bridgeTile(seed: number, horizontal: boolean): Pixmap {
  const rng = makeRng(seed);
  const pm = new Pixmap(TS, TS);
  // planks run perpendicular to travel
  for (let i = 0; i < TS; i += 4) {
    const c = rng() < 0.5 ? P.o4 : P.o3;
    if (horizontal) {
      pm.rect(i, 0, 3, TS, c);
      pm.vline(i, 0, TS, shade(c, 0.25));
      pm.vline(i + 3, 0, TS, P.o1);
    } else {
      pm.rect(0, i, TS, 3, c);
      pm.hline(0, i, TS, shade(c, 0.25));
      pm.hline(0, i + 3, TS, P.o1);
    }
  }
  speckle(pm, rng, P.o5, 3, 1, 1);
  // rails
  if (horizontal) {
    pm.rect(0, 0, TS, 3, P.o2);
    pm.hline(0, 0, TS, P.o4);
    pm.hline(0, 3, TS, P.o0);
    pm.rect(0, TS - 4, TS, 4, P.o1);
    pm.hline(0, TS - 4, TS, P.o3);
    pm.hline(0, TS - 1, TS, P.o0);
    for (const x of [1, 8, 14]) pm.rect(x, 0, 2, 5, P.o3);
  } else {
    pm.rect(0, 0, 3, TS, P.o2);
    pm.vline(0, 0, TS, P.o4);
    pm.vline(3, 0, TS, P.o0);
    pm.rect(TS - 3, 0, 3, TS, P.o1);
    pm.vline(TS - 3, 0, TS, P.o3);
    pm.vline(TS - 1, 0, TS, P.o0);
  }
  return pm;
}

// ───────────────────────────── overlays ─────────────────────────────

/** Ragged grass fringe hanging into a non-grass tile from its NORTH edge. */
export function fringeNorth(seed: number): Pixmap {
  const rng = makeRng(seed);
  const pm = new Pixmap(TS, TS);
  for (let x = 0; x < TS; x++) {
    const d = 1 + Math.floor(rng() * 3);
    for (let y = 0; y < d; y++) pm.set(x, y, y === d - 1 ? P.g2 : P.g3);
    if (rng() < 0.4) pm.set(x, 0, P.g4);
    if (rng() < 0.12) pm.set(x, d, P.g1);
  }
  return pm;
}

/** Soft shadow cast on floor by a wall to the NORTH. */
export function shadowNorth(): Pixmap {
  const pm = new Pixmap(TS, TS);
  const strengths = [150, 100, 55, 25];
  strengths.forEach((a, y) => pm.hline(0, y, TS, P.ink1, a));
  return pm;
}

export function rotate90(pm: Pixmap, times: number): Pixmap {
  let cur = pm;
  for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
    const n = new Pixmap(cur.h, cur.w);
    for (let y = 0; y < cur.h; y++)
      for (let x = 0; x < cur.w; x++) {
        const i = (y * cur.w + x) * 4;
        if (cur.data[i + 3] === 0) continue;
        const c = ((cur.data[i] << 16) | (cur.data[i + 1] << 8) | cur.data[i + 2]) >>> 0;
        // rotate clockwise: (x,y) → (h-1-y, x)
        n.set(cur.h - 1 - y, x, c, cur.data[i + 3]);
      }
    cur = n;
  }
  return cur;
}

/** Sides: 0=N,1=E,2=S,3=W (clockwise). */
export const SIDES = ['n', 'e', 's', 'w'] as const;

export function buildTileSheet(): Sheet {
  const sb = new SheetBuilder('tiles', 256, 1);
  const add = (prefix: string, n: number, fn: (seed: number, i: number) => Pixmap): void => {
    for (let i = 0; i < n; i++) sb.add(`${prefix}_${i}`, fn(1000 + i * 37 + prefix.length * 101, i));
  };
  add('grass', VARIANTS.grass, (s) => grassTile(s));
  add('flowers', VARIANTS.flowerGrass, (s) => grassTile(s + 5000, true));
  add('forest', VARIANTS.forest, (s) => forestTile(s));
  add('dirt', VARIANTS.dirt, (s) => dirtTile(s));
  add('cobble', VARIANTS.cobble, (s) => cobbleTile(s));
  add('sand', VARIANTS.sand, (s) => sandTile(s));
  for (let f = 0; f < WATER_FRAMES; f++) {
    for (let v = 0; v < VARIANTS.water; v++) sb.add(`water_${v}_${f}`, waterTile(300 + v * 17, f, false));
    for (let v = 0; v < VARIANTS.shallow; v++) sb.add(`shallow_${v}_${f}`, waterTile(700 + v * 19, f, true));
  }
  add('cave', VARIANTS.cave, (s) => caveTile(s));
  add('walltop', VARIANTS.wallTop, (s) => wallTopTile(s));
  add('wallface', VARIANTS.wallFace, (s) => wallFaceTile(s));
  add('arena', VARIANTS.arena, (s) => arenaTile(s));
  add('bridgeh', VARIANTS.bridge, (s) => bridgeTile(s, true));
  add('bridgev', VARIANTS.bridge, (s) => bridgeTile(s, false));

  // overlays (rotated per side)
  for (let f = 0; f < WATER_FRAMES; f++) {
    const foam = foamNorth(f);
    SIDES.forEach((s, i) => sb.add(`foam_${s}_${f}`, rotate90(foam, i)));
  }
  for (let v = 0; v < 2; v++) {
    const fr = fringeNorth(40 + v * 13);
    SIDES.forEach((s, i) => sb.add(`fringe_${s}_${v}`, rotate90(fr, i)));
  }
  const sh = shadowNorth();
  SIDES.forEach((s, i) => sb.add(`shadow_${s}`, rotate90(sh, i)));
  return sb.build();
}
