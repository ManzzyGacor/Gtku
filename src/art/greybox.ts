/**
 * Tiling pixel textures for the 3D world.
 *
 * Tuned against `docs/reference/referensi-visual.png`. Four things separate that look from flat
 * greybox colour, and every generator here does all four:
 *
 *   1. **a four-step ramp** per material (dark / mid / light / highlight) instead of one colour;
 *   2. **baked ambient occlusion** — every seam, mortar line and shingle overlap is darkened, which
 *      is what gives a flat-shaded box the appearance of real relief;
 *   3. **edge highlights** on the lit side of each element (top-left, matching the art's key light);
 *   4. **variation** — per-brick, per-plank and per-shingle jitter plus speckle, so a texture tiled
 *      across a wall never shows an obvious grid.
 *
 * `SIZE` is 32, twice the old density: the shader scales UVs by an instance's world size, so this
 * is 32 texels per world unit against the ground's 16 px per tile.
 */
import { hashf } from '../core/rng';
import { P, shade } from './palette';
import { mix, Pixmap, type Color } from './pixmap';

export type GreyboxTexture =
  | 'stone'
  | 'plaster'
  | 'logwall'
  | 'wood'
  | 'beam'
  | 'roof'
  | 'thatch'
  | 'cloth'
  | 'leaf'
  | 'dirt'
  | 'metal'
  | 'glow';

/** Texels per world unit. */
export const SIZE = 32;

/** Value noise in [0,1) that repeats with period `w`/`h`, so the texture has no seam. */
function tileNoise(x: number, y: number, w: number, h: number, seed: number): number {
  return hashf(((x % w) + w) % w, ((y % h) + h) % h, seed);
}

/** dark → mid → light → highlight, built from one base colour. */
function ramp(base: Color): [Color, Color, Color, Color] {
  return [shade(base, -0.45), base, shade(base, 0.2), shade(base, 0.45)];
}

/** Pick a ramp step from a 0..1 value. */
const step4 = (r: readonly Color[], t: number): Color => r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))];

/**
 * Rectangular blocks with mortar, AO under and right of every block, a lit top-left edge, and
 * per-block colour jitter. The backbone of walls, kerbs and cave stone.
 */
function bricks(base: Color, mortar: Color, bw: number, bh: number, seed: number, rough = 0.28): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  const r = ramp(base);
  for (let y = 0; y < SIZE; y++) {
    const row = Math.floor(y / bh);
    const offset = (row % 2) * Math.floor(bw / 2);
    for (let x = 0; x < SIZE; x++) {
      const bx = (x + offset) % bw;
      const by = y % bh;
      const blockId = Math.floor((x + offset) / bw) * 31 + row * 17;
      if (bx === 0 || by === 0) {
        // mortar, with its own grain so the lines are not dead straight
        pm.set(x, y, shade(mortar, (tileNoise(x, y, SIZE, SIZE, seed) - 0.5) * 0.3));
        continue;
      }
      const jitter = (hashf(blockId, 0, seed) - 0.5) * 0.22;
      const grain = (tileNoise(x, y, SIZE, SIZE, seed + 1) - 0.5) * rough;
      let c = shade(base, jitter + grain);
      // baked AO: the two edges away from the light
      if (bx === 1) c = mix(c, r[0], 0.34);
      if (by === 1) c = mix(c, r[3], 0.4); // lit top lip
      if (bx === bw - 1) c = mix(c, r[0], 0.22);
      if (by === bh - 1) c = mix(c, r[0], 0.42);
      pm.set(x, y, c);
    }
  }
  return pm;
}

/** Vertical planks: grain, knots, AO in the seams, a highlight down the lit side of each plank. */
function planks(base: Color, seed: number, pw = 6): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  const r = ramp(base);
  for (let x = 0; x < SIZE; x++) {
    const plank = Math.floor(x / pw);
    const inPlank = x % pw;
    const tint = (hashf(plank, 3, seed) - 0.5) * 0.24;
    for (let y = 0; y < SIZE; y++) {
      // lengthwise grain: stretched noise
      const grain = (tileNoise(x, Math.floor(y / 3), SIZE, SIZE, seed + 2) - 0.5) * 0.3;
      let c = shade(base, tint + grain);
      if (inPlank === 0) c = mix(r[0], c, 0.15); // seam, deeply occluded
      else if (inPlank === 1) c = mix(c, r[3], 0.36); // lit edge just past the seam
      else if (inPlank === pw - 1) c = mix(c, r[0], 0.4);
      // knots
      const kn = hashf(plank, Math.floor(y / 7), seed + 5);
      if (kn > 0.965 && inPlank > 1 && inPlank < pw - 1) c = mix(c, r[0], 0.6);
      pm.set(x, y, c);
    }
  }
  return pm;
}

/** Heavy timber: like planks but coarser, with iron straps — for posts, beams and railings. */
function timber(base: Color, seed: number): Pixmap {
  const pm = planks(base, seed, 10);
  const r = ramp(base);
  for (let y of [6, 7, 22, 23]) {
    for (let x = 0; x < SIZE; x++) {
      const c = y % 2 === 0 ? shade(P.s2, (tileNoise(x, y, SIZE, SIZE, seed + 9) - 0.5) * 0.3) : shade(P.s1, 0);
      pm.set(x, y, c);
    }
    // AO below each strap
    if (y === 7 || y === 23) for (let x = 0; x < SIZE; x++) pm.set(x, y + 1, mix(pm.colorAt(x, y + 1), r[0], 0.45));
  }
  // rivets
  for (const [x, y] of [[4, 6], [15, 6], [26, 6], [9, 22], [20, 22]] as const) {
    pm.set(x, y, P.s5);
    pm.set(x + 1, y, P.s3);
  }
  return pm;
}

/**
 * Overlapping shingle tabs.
 *
 * The first attempt just tinted a brick grid and read as brickwork. A shingle roof needs three
 * things to be legible: a **rounded tab outline**, a **bright lip** where each course catches the
 * sky, and a **deep shadow** where the course above overlaps it. Drawn tab by tab for that reason.
 */
function shingles(base: Color, seed: number, rh = 6, sw = 8): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  const r = ramp(base);
  for (let y = 0; y < SIZE; y++) {
    const row = Math.floor(y / rh);
    const inRow = y % rh;
    const offset = (row % 2) * Math.floor(sw / 2);
    for (let x = 0; x < SIZE; x++) {
      const sx = (x + offset) % sw;
      const id = Math.floor((x + offset) / sw) * 13 + row * 7;
      const jitter = (hashf(id, 1, seed) - 0.5) * 0.26;
      const grain = (tileNoise(x, y, SIZE, SIZE, seed + 3) - 0.5) * 0.16;
      // the tab narrows at its bottom corners, which is what makes it read as a scallop
      const corner = inRow >= rh - 2 && (sx <= 1 || sx >= sw - 2);
      let c = shade(base, jitter + grain);
      if (inRow === 0) c = mix(c, r[3], 0.62);          // sky-lit lip
      else if (inRow === 1) c = mix(c, r[2], 0.34);
      else if (inRow === rh - 1) c = mix(c, r[0], 0.72); // overlapped by the course above
      else if (inRow === rh - 2) c = mix(c, r[0], 0.34);
      if (sx === 0) c = mix(c, r[0], 0.66);              // gap between tabs
      if (corner) c = mix(c, r[0], 0.45);
      pm.set(x, y, c);
    }
  }
  return pm;
}

/**
 * Horizontal log courses — the cabin wall in the reference art. Each log is shaded like a cylinder
 * (lit along its upper third, dark along its lower edge) with a deep shadow in the joint, and the
 * ends of alternate courses are notched so a corner reads as interlocking timber.
 */
function logWall(base: Color, seed: number, lh = 7): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  const r = ramp(base);
  for (let y = 0; y < SIZE; y++) {
    const log = Math.floor(y / lh);
    const t = (y % lh) / (lh - 1); // 0 at the top of the log, 1 at the bottom
    const tint = (hashf(log, 2, seed) - 0.5) * 0.18;
    for (let x = 0; x < SIZE; x++) {
      const grain = (tileNoise(Math.floor(x / 2), y, SIZE, SIZE, seed + 4) - 0.5) * 0.22;
      // cylinder shading: brightest a third of the way down, darkest at the very bottom
      const round = 1 - Math.abs(t - 0.32) * 1.7;
      let c = shade(base, tint + grain + round * 0.28);
      if (t > 0.86) c = mix(c, r[0], 0.7); // joint shadow
      else if (t < 0.08) c = mix(c, r[2], 0.3);
      // occasional knot
      if (hashf(Math.floor(x / 3), log, seed + 6) > 0.97 && t > 0.2 && t < 0.7) c = mix(c, r[0], 0.55);
      pm.set(x, y, c);
    }
  }
  return pm;
}

/** Straw: bundled diagonal strands with deep shadow between bundles. */
function thatch(base: Color, seed: number): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  const r = ramp(base);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const band = Math.floor(y / 6);
      const inBand = y % 6;
      const strand = (x + band * 3 + Math.floor(y / 2)) % 4;
      const n = tileNoise(x, y, SIZE, SIZE, seed) - 0.5;
      let c = shade(base, n * 0.35 + (strand === 0 ? -0.2 : strand === 2 ? 0.16 : 0));
      if (inBand === 0) c = mix(c, r[3], 0.35);
      if (inBand === 5) c = mix(c, r[0], 0.5);
      pm.set(x, y, c);
    }
  return pm;
}

/** Awning stripes: two colours, a scalloped hem, and AO in every fold. */
function stripes(a: Color, b: Color, seed: number): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  for (let x = 0; x < SIZE; x++) {
    const band = Math.floor(x / 5) % 2;
    const base = band ? a : b;
    const r = ramp(base);
    for (let y = 0; y < SIZE; y++) {
      const fold = x % 5;
      const n = (tileNoise(x, y, SIZE, SIZE, seed) - 0.5) * 0.12;
      let c = shade(base, n);
      if (fold === 0) c = mix(c, r[0], 0.4); // fold shadow
      else if (fold === 1) c = mix(c, r[3], 0.3); // fold highlight
      // hem along the bottom of the texture
      if (y >= SIZE - 3) c = mix(c, r[0], 0.3);
      pm.set(x, y, c);
    }
  }
  return pm;
}

/**
 * Clumped foliage: five levels driven by two noise octaves, with dark gaps between clumps (AO) and
 * a scatter of bright leaves catching the light.
 */
function foliage(levels: readonly Color[], seed: number, density = 0.6): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const fine = tileNoise(x, y, SIZE, SIZE, seed);
      const coarse = tileNoise(Math.floor(x / 4), Math.floor(y / 4), SIZE, SIZE, seed + 11);
      const t = fine * (1 - density) + coarse * density;
      let c = step4(levels, t);
      // gaps: where both octaves are low, go darker than the darkest leaf
      if (t < 0.12) c = shade(levels[0], -0.3);
      // highlight leaves
      if (fine > 0.965) c = shade(levels[levels.length - 1], 0.3);
      pm.set(x, y, c);
    }
  return pm;
}

/** Earth with embedded pebbles, each pebble lit on top and occluded below. */
function earth(levels: readonly Color[], seed: number): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const t = tileNoise(x, y, SIZE, SIZE, seed) * 0.45 + tileNoise(Math.floor(x / 3), Math.floor(y / 3), SIZE, SIZE, seed + 7) * 0.55;
      pm.set(x, y, step4(levels, t));
    }
  // pebbles
  for (let i = 0; i < 14; i++) {
    const px = Math.floor(hashf(i, 1, seed + 21) * SIZE);
    const py = Math.floor(hashf(i, 2, seed + 21) * SIZE);
    const rx = 1 + Math.floor(hashf(i, 3, seed + 21) * 2);
    const stone = shade(P.s3, (hashf(i, 4, seed + 21) - 0.5) * 0.3);
    for (let dy = -rx; dy <= rx; dy++)
      for (let dx = -rx; dx <= rx; dx++) {
        if (dx * dx + dy * dy > rx * rx) continue;
        const x = (px + dx + SIZE) % SIZE;
        const y = (py + dy + SIZE) % SIZE;
        pm.set(x, y, dy <= -rx + 1 ? shade(stone, 0.4) : dy >= rx ? shade(stone, -0.4) : stone);
      }
    // contact shadow under the pebble
    for (let dx = -rx; dx <= rx; dx++) pm.set((px + dx + SIZE) % SIZE, (py + rx + 1 + SIZE) % SIZE, mix(pm.colorAt((px + dx + SIZE) % SIZE, (py + rx + 1 + SIZE) % SIZE), levels[0], 0.55));
  }
  return pm;
}

/** Banded iron: plate with rivets, a bright top edge and grime in the grooves. */
function iron(base: Color, seed: number): Pixmap {
  const pm = bricks(base, shade(base, -0.55), 8, 8, seed, 0.18);
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(hashf(i, 5, seed) * SIZE);
    const y = Math.floor(hashf(i, 6, seed) * SIZE);
    pm.set(x, y, P.s5);
    pm.set(x + 1, y, P.s4);
    pm.set(x, y + 1, shade(base, -0.4));
  }
  return pm;
}

/**
 * Lantern glass and window panes: a hot core falling off to a warm rim, divided by dark mullions.
 * Drawn unlit by the renderer, so this *is* the light the player sees.
 */
function pane(): Pixmap {
  const pm = new Pixmap(SIZE, SIZE);
  const c = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const d = Math.max(Math.abs(x - c), Math.abs(y - c)) / (SIZE * 0.5);
      let col: Color = d < 0.35 ? P.y5 : d < 0.62 ? P.y4 : d < 0.86 ? P.y3 : P.y2;
      // mullions: a cross plus a border, which is what makes a window read as a window
      const border = x < 2 || y < 2 || x > SIZE - 3 || y > SIZE - 3;
      const cross = Math.abs(x - c) < 1.2 || Math.abs(y - c) < 1.2;
      if (border) col = P.o1;
      else if (cross) col = mix(P.o2, col, 0.25);
      pm.set(x, y, col);
    }
  return pm;
}

/** Scatter moss into the upper edges of a stone texture, the way damp stonework actually weathers. */
function mossy(pm: Pixmap, seed: number): Pixmap {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const n = tileNoise(Math.floor(x / 2), Math.floor(y / 2), SIZE, SIZE, seed);
      if (n < 0.72) continue;
      const strength = (n - 0.72) / 0.28;
      pm.set(x, y, mix(pm.colorAt(x, y), n > 0.93 ? P.g3 : P.f2, strength * 0.65));
    }
  return pm;
}

/** Build every texture. Pure; used by the 3D renderer and by the PNG preview script. */
export function buildGreyboxTextures(): Record<GreyboxTexture, Pixmap> {
  return {
    // Mossy grey-brown rather than blue: the reference's stonework is weathered, not slate.
    stone: mossy(bricks(mix(P.s2, P.d1, 0.3), P.s0, 11, 7, 3), 23),
    plaster: bricks(mix(P.n1, P.d3, 0.45), P.d1, 16, 11, 5, 0.22),
    logwall: logWall(P.o3, 25),
    wood: planks(P.o2, 7),
    beam: timber(P.o1, 8),
    // Slate blue with a teal cast, the most recognisable surface in the reference art.
    roof: shingles(mix(P.s1, P.b0, 0.45), 9),
    thatch: thatch(P.y2, 12),
    cloth: stripes(P.r2, P.cream, 15),
    // Darker and higher-contrast than the first attempt, which read as flat bright green.
    leaf: foliage([shade(P.f0, -0.2), P.f0, P.f1, P.g1, P.g2, P.g4], 13, 0.62),
    dirt: earth([P.d1, P.d2, P.d3, P.d4, P.d5], 17),
    metal: iron(P.s3, 19),
    glow: pane(),
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
