/**
 * Small tiling pixel textures for the 3D greybox (docs/OVERHAUL.md, Fase 1).
 * Same palette and the same pure `Pixmap` pipeline as the 2D art, so the 3D village reads as the
 * same game and these can be swapped for hand-drawn PNGs later without touching the renderer.
 */
import { hashf } from '../core/rng';
import { P, shade } from './palette';
import { Pixmap, type Color } from './pixmap';

export type GreyboxTexture = 'stone' | 'plaster' | 'wood' | 'roof' | 'leaf' | 'dirt' | 'metal' | 'glow';

/** Value noise in [0,1) that tiles with period `w`/`h` so the texture has no visible seam. */
function tileNoise(x: number, y: number, w: number, h: number, seed: number): number {
  return hashf(((x % w) + w) % w, ((y % h) + h) % h, seed);
}

/** Rectangular blocks with mortar lines; the classic pixel wall. */
function bricks(size: number, base: Color, mortar: Color, bw: number, bh: number, seed: number): Pixmap {
  const pm = new Pixmap(size, size);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / bh);
    const offset = (row % 2) * Math.floor(bw / 2);
    for (let x = 0; x < size; x++) {
      const bx = (x + offset) % bw;
      const by = y % bh;
      const edge = bx === 0 || by === 0;
      const n = tileNoise(x, y, size, size, seed);
      let c = edge ? mortar : shade(base, (n - 0.5) * 0.28);
      if (!edge && by === 1) c = shade(c, 0.12); // a lit top lip on every block
      if (!edge && by === bh - 1) c = shade(c, -0.12);
      pm.set(x, y, c);
    }
  }
  return pm;
}

/** Vertical planks with a seam and lengthwise grain. */
function planks(size: number, base: Color, seed: number): Pixmap {
  const pm = new Pixmap(size, size);
  const pw = 4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const seam = x % pw === 0;
      const grain = tileNoise(x, y * 3, size, size, seed) - 0.5;
      pm.set(x, y, seam ? shade(base, -0.4) : shade(base, grain * 0.3));
    }
  return pm;
}

/** Overlapping scallops for roofs. */
function shingles(size: number, base: Color, seed: number): Pixmap {
  const pm = new Pixmap(size, size);
  const rh = 4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / rh);
      const inRow = y % rh;
      const offset = (row % 2) * 3;
      const col = (x + offset) % 6;
      const n = tileNoise(x, y, size, size, seed) - 0.5;
      let c = shade(base, n * 0.22);
      if (inRow === 0) c = shade(base, 0.2);
      if (col === 0) c = shade(base, -0.45);
      if (inRow === rh - 1) c = shade(c, -0.22);
      pm.set(x, y, c);
    }
  return pm;
}

/** Clumpy foliage / rough ground. */
function clumps(size: number, ramp: readonly Color[], seed: number, density = 0.5): Pixmap {
  const pm = new Pixmap(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = tileNoise(x, y, size, size, seed);
      const b = tileNoise(Math.floor(x / 2), Math.floor(y / 2), size, size, seed + 11);
      const t = a * (1 - density) + b * density;
      pm.set(x, y, ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))]);
    }
  return pm;
}

/** Flat emissive panel with a soft centre, for lantern glass and crystals. */
function glowPanel(size: number): Pixmap {
  const pm = new Pixmap(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size * 0.62);
      pm.set(x, y, d < 0.45 ? P.y5 : d < 0.8 ? P.y4 : P.y3);
    }
  return pm;
}

const SIZE = 16;

/** Build every greybox texture. Pure; used by the 3D renderer and by the PNG preview script. */
export function buildGreyboxTextures(): Record<GreyboxTexture, Pixmap> {
  return {
    stone: bricks(SIZE, P.s2, P.s0, 8, 4, 3),
    plaster: bricks(SIZE, P.n2, P.n0, 16, 8, 5),
    wood: planks(SIZE, P.o2, 7),
    roof: shingles(SIZE, P.r1, 9),
    leaf: clumps(SIZE, [P.g0, P.g1, P.g2, P.g3, P.g4], 13, 0.65),
    dirt: clumps(SIZE, [P.d1, P.d2, P.d3, P.d4], 17, 0.5),
    metal: bricks(SIZE, P.s3, P.s1, 4, 4, 19),
    glow: glowPanel(SIZE),
  };
}


/**
 * Soft tiling noise for the drifting ground fog, stored in the alpha channel so it can be
 * scrolled and layered without tinting anything. Two octaves keep it from looking like a grid.
 */
export function buildFogNoise(size = 32): Pixmap {
  const pm = new Pixmap(size, size);
  const smooth = (x: number, y: number, period: number, seed: number): number => {
    const sx = x / period;
    const sy = y / period;
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const fx = sx - x0;
    const fy = sy - y0;
    const ex = fx * fx * (3 - 2 * fx);
    const ey = fy * fy * (3 - 2 * fy);
    const cells = size / period;
    const at = (ix: number, iy: number): number => tileNoise(ix, iy, cells, cells, seed);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * ex;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * ex;
    return a + (b - a) * ey;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = smooth(x, y, size / 4, 31) * 0.65 + smooth(x, y, size / 8, 37) * 0.35;
      pm.set(x, y, 0xffffff, Math.round(Math.max(0, Math.min(1, (n - 0.25) / 0.6)) * 255));
    }
  return pm;
}
