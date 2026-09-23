/** Procedural prop art: trees, buildings, cave dressing, puzzle pieces. Frame names match world/props.ts. */
import { makeRng } from '../core/rng';
import { finish, flame, shadedBlob } from './draw';
import { P, shade } from './palette';
import { mix, Pixmap, type Color } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

const LEAF = [P.g0, P.g1, P.g2, P.g3, P.g4, P.g5] as const;
const LEAF_DARK = [P.f0, P.f1, P.f2, P.f3, P.g2, P.g3] as const;
const STONE = [P.s1, P.s2, P.s3, P.s4, P.s5] as const;
const WOOD = [P.o1, P.o2, P.o3, P.o4, P.o5] as const;

function trunk(pm: Pixmap, cx: number, bottom: number, w: number, h: number): void {
  const x0 = cx - Math.floor(w / 2);
  pm.rect(x0, bottom - h, w, h, P.o2);
  pm.vline(x0, bottom - h, h, P.o3);
  pm.vline(x0 + 1, bottom - h, h - 2, P.o4);
  pm.vline(x0 + w - 1, bottom - h, h, P.o1);
  // roots
  pm.set(x0 - 1, bottom - 1, P.o2);
  pm.set(x0 + w, bottom - 1, P.o1);
  pm.set(x0 - 1, bottom, P.o1);
  pm.set(x0 + w, bottom, P.o0);
  for (let i = 2; i < h - 2; i += 4) pm.set(x0 + 2, bottom - i, P.o1);
}

export function treeA(seed: number, dark = false): Pixmap {
  const ramp = dark ? LEAF_DARK : LEAF;
  const b = new Pixmap(32, 42);
  trunk(b, 16, 38, 6, 16);
  const clumps: [number, number, number, number][] = [
    [16, 13, 12, 11],
    [9, 17, 8, 7],
    [23, 17, 8, 7],
    [16, 21, 9, 6],
  ];
  clumps.forEach(([cx, cy, rx, ry], i) => shadedBlob(b, cx, cy, rx, ry, ramp, seed + i));
  // leaf highlights
  const rng = makeRng(seed);
  for (let i = 0; i < 9; i++) {
    const x = 6 + Math.floor(rng() * 20);
    const y = 5 + Math.floor(rng() * 14);
    if (b.alphaAt(x, y) > 0) {
      b.set(x, y, ramp[5]);
      b.set(x + 1, y, ramp[4]);
    }
  }
  return finish(b, { cx: 16, cy: 38, rx: 11, ry: 3.4 });
}

export function treePine(seed: number): Pixmap {
  const b = new Pixmap(26, 44);
  trunk(b, 13, 40, 4, 10);
  const tiers: [number, number, number][] = [
    [28, 24, 11],
    [20, 19, 9],
    [12, 14, 7],
    [5, 10, 5],
  ];
  const rng = makeRng(seed);
  tiers.forEach(([y, w, h], ti) => {
    for (let i = 0; i < h; i++) {
      const half = Math.round((w / 2) * ((i + 1) / h));
      const yy = y + i - 4;
      for (let x = -half; x <= half; x++) {
        const t = (x + half) / (half * 2 + 1);
        const c = t < 0.28 ? P.g3 : t < 0.55 ? P.g2 : t < 0.8 ? P.g1 : P.g0;
        b.set(13 + x, yy + ti * 0, i === h - 1 && rng() < 0.4 ? P.g0 : c);
      }
    }
  });
  for (let i = 0; i < 6; i++) b.set(8 + Math.floor(rng() * 10), 6 + Math.floor(rng() * 26), P.g4);
  return finish(b, { cx: 13, cy: 41, rx: 9, ry: 3 });
}

export function treeBig(seed: number): Pixmap {
  const b = new Pixmap(52, 62);
  trunk(b, 26, 57, 9, 22);
  b.set(21, 56, P.o1);
  const clumps: [number, number, number, number][] = [
    [26, 20, 20, 16],
    [12, 28, 12, 10],
    [40, 28, 12, 10],
    [26, 32, 16, 9],
    [16, 16, 9, 8],
    [37, 15, 9, 8],
  ];
  clumps.forEach(([cx, cy, rx, ry], i) => shadedBlob(b, cx, cy, rx, ry, LEAF, seed + i));
  const rng = makeRng(seed);
  for (let i = 0; i < 16; i++) {
    const x = 8 + Math.floor(rng() * 36);
    const y = 6 + Math.floor(rng() * 28);
    if (b.alphaAt(x, y) > 0) {
      b.set(x, y, P.g5);
      b.set(x + 1, y, P.g4);
    }
  }
  return finish(b, { cx: 26, cy: 58, rx: 17, ry: 4.5 });
}

export function treeDead(): Pixmap {
  const b = new Pixmap(28, 36);
  trunk(b, 14, 32, 5, 20);
  const branch = (x0: number, y0: number, x1: number, y1: number): void => {
    b.line(x0, y0, x1, y1, P.o2);
    b.line(x0 + 1, y0, x1 + 1, y1, P.o3);
  };
  branch(14, 16, 5, 8);
  branch(15, 13, 23, 6);
  branch(13, 20, 6, 17);
  branch(5, 8, 3, 4);
  branch(23, 6, 25, 3);
  return finish(b, { cx: 14, cy: 33, rx: 8, ry: 2.6 });
}

export function bush(berries: boolean, seed: number): Pixmap {
  const b = new Pixmap(20, 16);
  shadedBlob(b, 10, 9, 8, 6, LEAF, seed);
  shadedBlob(b, 6, 10, 5, 4, LEAF, seed + 1);
  shadedBlob(b, 14, 10, 5, 4, LEAF, seed + 2);
  if (berries) for (const [x, y] of [[6, 8], [11, 6], [14, 10], [9, 11]] as const) {
    b.set(x, y, P.r3);
    b.set(x + 1, y, P.r1);
  }
  return finish(b, { cx: 10, cy: 13, rx: 8, ry: 2.4 });
}

export function rock(w: number, h: number, seed: number): Pixmap {
  const b = new Pixmap(w + 4, h + 4);
  shadedBlob(b, (w + 4) / 2, h / 2 + 2, w / 2, h / 2 - 0.5, STONE, seed, -0.5, -0.85);
  const rng = makeRng(seed);
  // crack + moss
  const cx = 4 + Math.floor(rng() * (w - 4));
  b.line(cx, 4, cx + 2, 4 + Math.floor(h / 2), P.s1);
  for (let i = 0; i < 4; i++) {
    const x = 3 + Math.floor(rng() * (w - 2));
    if (b.alphaAt(x, 3 + Math.floor(rng() * 3)) > 0) b.set(x, 4, P.g3);
  }
  return finish(b, { cx: (w + 4) / 2, cy: h + 2, rx: w / 2, ry: 2.2 });
}

export function stump(): Pixmap {
  const b = new Pixmap(20, 18);
  b.ellipse(10, 11, 7, 5, P.o2);
  b.rect(3, 9, 14, 5, P.o2);
  b.ellipse(10, 14, 7, 3, P.o2);
  b.hline(3, 13, 14, P.o1);
  b.ellipse(10, 8, 7, 4, P.o5);
  b.ellipse(10, 8, 5, 2.6, P.o4);
  b.ellipse(10, 8, 2.5, 1.2, P.o5);
  b.ellipse(10, 8, 1, 0.6, P.o4);
  for (const x of [5, 8, 12, 15]) b.vline(x, 10, 4, P.o3);
  return finish(b, { cx: 10, cy: 15, rx: 8, ry: 2.4 });
}

export function log(): Pixmap {
  const b = new Pixmap(38, 18);
  b.rect(3, 5, 30, 9, P.o3);
  b.hline(3, 5, 30, P.o4);
  b.hline(3, 6, 30, P.o4);
  b.hline(3, 12, 30, P.o1);
  b.hline(3, 13, 30, P.o1);
  for (const x of [8, 14, 21, 27]) b.hline(x, 8, 3, P.o2);
  b.ellipse(33, 9, 2.6, 4.6, P.o5);
  b.ellipse(33, 9, 1.4, 2.6, P.o4);
  b.set(33, 9, P.o5);
  b.set(9, 4, P.g3);
  b.set(10, 4, P.g4);
  b.set(11, 4, P.g3);
  b.set(16, 4, P.g3);
  return finish(b, { cx: 19, cy: 14, rx: 16, ry: 2.4 });
}

export function tallGrass(frame: number): Pixmap {
  const b = new Pixmap(16, 16);
  const sway = [0, 1, 0][frame];
  const sway2 = [0, 0, -1][frame];
  const blades: [number, number, number, Color][] = [
    [3, 10, 0, P.g2],
    [5, 13, 1, P.g3],
    [7, 12, -1, P.g4],
    [9, 14, 1, P.g3],
    [11, 11, 0, P.g2],
    [13, 9, -1, P.g3],
  ];
  blades.forEach(([x, h, lean, c], i) => {
    const s = i % 2 ? sway : sway2;
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const dx = Math.round((lean + s * 2) * t * t);
      b.set(x + dx, 15 - y, y > h - 3 ? P.g5 : c);
    }
    b.set(x, 15, P.g1);
  });
  return b;
}

export function mushroomCluster(): Pixmap {
  const b = new Pixmap(16, 14);
  const cap = (cx: number, cy: number, r: number, c: Color, spot: Color): void => {
    b.rect(cx - 1, cy, 2, r + 1, P.cream);
    b.ellipse(cx, cy, r, r * 0.75, c);
    b.hline(cx - r + 1, cy - Math.floor(r * 0.5), Math.max(2, r - 1), shade(c, 0.4));
    b.set(cx + 1, cy - 1, spot);
    b.set(cx - 2, cy, spot);
  };
  cap(4, 8, 3, P.k2, P.k4);
  cap(10, 6, 4, P.c2, P.c4);
  cap(7, 10, 2, P.k3, P.white);
  return finish(b, { cx: 8, cy: 12, rx: 6, ry: 1.8 });
}

export function reeds(frame: number): Pixmap {
  const b = new Pixmap(18, 26);
  const sw = [0, 1, -1][frame];
  for (const [x, h] of [[5, 20], [9, 24], [13, 18]] as const) {
    for (let y = 0; y < h; y++) {
      const dx = Math.round((sw * y * y) / 260);
      b.set(x + dx, 25 - y, y > h - 4 ? P.g4 : P.g2);
    }
    const tx = x + Math.round((sw * h * h) / 260);
    b.rect(tx - 1, 25 - h - 4, 2, 5, P.o3);
    b.set(tx - 1, 25 - h - 4, P.o4);
  }
  return b;
}

export function lily(frame: number): Pixmap {
  const b = new Pixmap(16, 10);
  b.ellipse(8, 6, 6, 3, P.g3);
  b.hline(3, 5, 5, P.g4);
  b.line(8, 6, 14, 5, P.w2);
  if (frame === 0) {
    b.set(7, 4, P.p2);
    b.set(8, 3, P.p2);
    b.set(9, 4, P.p1);
    b.set(8, 4, P.y4);
  }
  b.ellipse(8, 8, 5, 1, P.w1, 90);
  return b;
}

export function flowerbed(): Pixmap {
  const b = new Pixmap(36, 16);
  b.rect(2, 7, 32, 7, P.d1);
  b.hline(2, 7, 32, P.d2);
  b.rect(2, 13, 32, 1, P.d0);
  b.frame(1, 6, 34, 9, P.o2);
  const rng = makeRng(31);
  for (let i = 0; i < 12; i++) {
    const x = 4 + Math.floor(rng() * 28);
    const y = 5 + Math.floor(rng() * 6);
    const c = [P.p2, P.white, P.y4, P.r3][i % 4];
    b.set(x, y + 1, P.g2);
    b.set(x, y, c);
    b.set(x - 1, y - 1, c);
    b.set(x + 1, y - 1, P.g3);
  }
  return finish(b, undefined, false);
}

export function haystack(): Pixmap {
  const b = new Pixmap(36, 28);
  shadedBlob(b, 18, 15, 15, 11, [P.d3, P.d4, P.n2, P.n3, P.n4], 5);
  b.rect(3, 15, 30, 9, P.n2);
  b.hline(3, 15, 30, P.n3);
  for (let i = 0; i < 26; i += 2) b.vline(4 + i, 16, 7, i % 4 ? P.n1 : P.n3);
  b.hline(3, 23, 30, P.d3);
  b.hline(6, 19, 24, P.o3);
  return finish(b, { cx: 18, cy: 25, rx: 15, ry: 2.6 });
}

// ───────────────────────────── buildings ─────────────────────────────

interface HouseOpts {
  w: number;
  h: number;
  roof: readonly Color[];
  wall: Color;
  wallDark: Color;
  seed: number;
  chimney?: boolean;
  thatch?: boolean;
}

export function house(o: HouseOpts): Pixmap {
  const { w, h } = o;
  const b = new Pixmap(w, h);
  const wallTop = h - 30;
  const roofBottom = wallTop + 4;
  const roofTop = 4;
  // walls
  b.rect(3, wallTop, w - 6, h - wallTop - 4, o.wall);
  b.hline(3, wallTop, w - 6, shade(o.wall, 0.25));
  b.rect(3, h - 8, w - 6, 4, o.wallDark);
  // half-timber beams
  for (const x of [3, w - 5]) b.rect(x, wallTop, 2, h - wallTop - 4, P.o2);
  b.hline(3, wallTop + 8, w - 6, P.o2);
  const mid = Math.floor(w / 2);
  // door
  b.rect(mid - 5, h - 20, 10, 16, P.o1);
  b.rect(mid - 4, h - 19, 8, 15, P.o3);
  b.vline(mid, h - 19, 15, P.o1);
  b.vline(mid - 4, h - 19, 15, P.o4);
  b.set(mid + 2, h - 12, P.y4);
  b.hline(mid - 6, h - 21, 12, P.o1);
  // windows
  for (const wx of [8, w - 17]) {
    b.rect(wx, wallTop + 11, 9, 8, P.o1);
    b.rect(wx + 1, wallTop + 12, 7, 6, P.y3);
    b.rect(wx + 1, wallTop + 12, 7, 2, P.y4);
    b.vline(wx + 4, wallTop + 12, 6, P.o1);
    b.hline(wx + 1, wallTop + 15, 7, P.o1);
    b.hline(wx - 1, wallTop + 19, 11, P.o3);
  }
  // roof (trapezoid: wider at the bottom)
  const roofH = roofBottom - roofTop;
  const rng = makeRng(o.seed);
  for (let y = 0; y < roofH; y++) {
    const inset = Math.round((1 - y / roofH) * 8);
    const x0 = 1 + inset;
    const ww = w - 2 - inset * 2;
    const rowT = y / roofH;
    const base = o.roof[Math.min(o.roof.length - 1, 1 + Math.floor((1 - rowT) * (o.roof.length - 1) * 0.9))];
    for (let x = 0; x < ww; x++) {
      if (o.thatch) {
        const c = [P.n1, P.n2, P.d4, P.n2][(x + y * 2) % 4];
        b.set(x0 + x, roofTop + y, y > roofH - 4 ? P.d3 : c);
        continue;
      }
      const off = (Math.floor(y / 3) % 2) * 2;
      let c = base;
      if (y % 3 === 2) c = shade(base, -0.28);
      else if ((x + off) % 5 === 0) c = shade(base, -0.15);
      else if (y % 3 === 0 && rng() < 0.3) c = shade(base, 0.12);
      b.set(x0 + x, roofTop + y, c);
    }
  }
  // eave shadow line + highlight ridge
  b.hline(1, roofBottom, w - 2, o.roof[0]);
  b.hline(3, roofBottom + 1, w - 6, shade(o.wall, -0.45), 180);
  b.hline(3, roofBottom + 2, w - 6, shade(o.wall, -0.3), 110);
  b.hline(Math.round(w * 0.14), roofTop, w - Math.round(w * 0.28), o.roof[o.roof.length - 1]);
  if (o.chimney) {
    b.rect(w - 18, roofTop - 3, 7, 10, P.s2);
    b.rect(w - 18, roofTop - 3, 7, 2, P.s4);
    b.vline(w - 18, roofTop - 1, 8, P.s3);
    b.rect(w - 19, roofTop - 4, 9, 2, P.s3);
  }
  return finish(b, { cx: w / 2, cy: h - 3, rx: w / 2 - 2, ry: 3.4, alpha: 100 });
}

export function hall(): Pixmap {
  const b = house({ w: 84, h: 92, roof: [P.t0, P.t1, P.t2, P.t3, P.t4], wall: P.cream, wallDark: P.n1, seed: 9, chimney: true });
  // banner + lantern emblem above the door
  const mid = 42;
  b.rect(mid - 3, 56, 7, 12, P.y1);
  b.rect(mid - 2, 56, 5, 11, P.y2);
  b.tri(mid - 3, 68, mid + 4, 68, mid, 72, P.y2);
  b.rect(mid - 1, 60, 3, 4, P.y4);
  b.set(mid, 59, P.y5);
  return b;
}

export function well(): Pixmap {
  const b = new Pixmap(36, 40);
  b.ellipse(18, 30, 14, 6, P.s2);
  b.rect(4, 20, 28, 10, P.s3);
  for (let x = 4; x < 32; x += 5) b.vline(x, 20, 10, P.s2);
  b.hline(4, 20, 28, P.s4);
  b.ellipse(18, 20, 14, 6, P.s4);
  b.ellipse(18, 20, 11, 4.4, P.s1);
  b.ellipse(18, 21, 9, 3, P.w1);
  b.ellipse(17, 20, 4, 1.2, P.w3);
  // posts + roof
  b.rect(5, 6, 3, 18, P.o3);
  b.rect(28, 6, 3, 18, P.o3);
  b.vline(5, 6, 18, P.o4);
  b.vline(28, 6, 18, P.o4);
  b.rect(3, 3, 30, 4, P.r2);
  b.hline(3, 3, 30, P.r4);
  b.hline(3, 6, 30, P.r0);
  b.rect(12, 8, 12, 2, P.o2);
  b.vline(18, 10, 6, P.o1);
  b.rect(16, 16, 5, 3, P.o3);
  return finish(b, { cx: 18, cy: 34, rx: 15, ry: 3.2 });
}

export function lamp(): Pixmap {
  const b = new Pixmap(18, 46);
  b.rect(7, 12, 3, 30, P.s2);
  b.vline(7, 12, 30, P.s4);
  b.rect(5, 39, 7, 3, P.s3);
  b.rect(4, 41, 9, 2, P.s2);
  b.hline(4, 41, 9, P.s4);
  // lantern head
  b.rect(4, 4, 9, 9, P.o1);
  b.rect(5, 5, 7, 7, P.y3);
  b.rect(5, 5, 7, 3, P.y4);
  b.hline(6, 6, 5, P.y5);
  b.vline(8, 5, 7, P.o1);
  b.tri(3, 4, 14, 4, 8.5, 0, P.o2);
  b.rect(3, 3, 11, 1, P.o3);
  b.set(8, 1, P.y5);
  return finish(b, { cx: 9, cy: 43, rx: 5, ry: 1.8 });
}

export function fenceH(): Pixmap {
  const b = new Pixmap(16, 18);
  b.rect(0, 8, 16, 2, P.o3);
  b.hline(0, 8, 16, P.o4);
  b.rect(0, 12, 16, 2, P.o2);
  b.hline(0, 12, 16, P.o3);
  b.rect(6, 4, 4, 13, P.o3);
  b.vline(6, 4, 13, P.o4);
  b.vline(9, 4, 13, P.o1);
  b.hline(6, 4, 4, P.o5);
  return finish(b, { cx: 8, cy: 16, rx: 7.5, ry: 1.6, alpha: 70 }, false);
}

export function fenceV(): Pixmap {
  const b = new Pixmap(16, 18);
  b.rect(6, 0, 4, 17, P.o2);
  b.vline(6, 0, 17, P.o3);
  b.vline(9, 0, 17, P.o1);
  b.rect(5, 2, 6, 3, P.o3);
  b.hline(5, 2, 6, P.o5);
  b.rect(5, 9, 6, 3, P.o3);
  b.hline(5, 9, 6, P.o4);
  b.rect(5, 14, 6, 3, P.o3);
  b.hline(5, 14, 6, P.o4);
  return finish(b, { cx: 8, cy: 16, rx: 5, ry: 1.4, alpha: 70 }, false);
}

export function sign(): Pixmap {
  const b = new Pixmap(20, 24);
  b.rect(9, 10, 3, 12, P.o2);
  b.vline(9, 10, 12, P.o3);
  b.rect(2, 2, 16, 9, P.o3);
  b.hline(2, 2, 16, P.o5);
  b.hline(2, 10, 16, P.o1);
  b.rect(4, 4, 12, 1, P.o1);
  b.rect(4, 6, 8, 1, P.o1);
  b.rect(4, 8, 10, 1, P.o1);
  return finish(b, { cx: 10, cy: 22, rx: 6, ry: 1.6 });
}

export function barrel(): Pixmap {
  const b = new Pixmap(20, 20);
  shadedBlob(b, 10, 11, 7, 8, WOOD, 4);
  b.rect(3, 6, 14, 10, P.o3);
  for (let x = 3; x < 17; x += 3) b.vline(x, 6, 10, P.o2);
  b.hline(3, 8, 14, P.s3);
  b.hline(3, 14, 14, P.s3);
  b.hline(3, 8, 14, P.s4);
  b.ellipse(10, 6, 7, 2.6, P.o4);
  b.ellipse(10, 6, 5, 1.6, P.o3);
  return finish(b, { cx: 10, cy: 17, rx: 7.5, ry: 2 });
}

export function crate(): Pixmap {
  const b = new Pixmap(20, 20);
  b.rect(2, 4, 16, 13, P.o3);
  b.rect(2, 4, 16, 3, P.o4);
  b.frame(2, 4, 16, 13, P.o1);
  b.hline(3, 10, 14, P.o2);
  b.line(3, 6, 16, 15, P.o2);
  b.line(3, 15, 16, 6, P.o2);
  b.hline(3, 5, 14, P.o5);
  return finish(b, { cx: 10, cy: 17, rx: 8, ry: 2 });
}

/**
 * A banded chest, the reward marker for exploring. Closed for now: opening it and its loot arrive
 * with the progression work in Batch 4 (docs/OVERHAUL.md §5), so until then it is a landmark.
 */
export function chest(): Pixmap {
  const b = new Pixmap(22, 20);
  // body
  b.rect(2, 8, 18, 9, P.o2);
  b.hline(2, 8, 18, P.o3);
  b.frame(2, 8, 18, 9, P.o1);
  for (let x = 4; x < 19; x += 4) b.vline(x, 9, 7, P.o1);
  // domed lid
  for (let i = 0; i < 5; i++) {
    const inset = i === 4 ? 3 : i === 3 ? 2 : i === 2 ? 1 : 0;
    b.hline(2 + inset, 7 - i, 18 - inset * 2, i > 2 ? P.o4 : P.o3);
  }
  b.hline(5, 3, 12, P.o5);
  // iron bands + lock
  b.vline(6, 3, 14, P.s3);
  b.vline(15, 3, 14, P.s3);
  b.vline(7, 3, 14, P.s2);
  b.vline(16, 3, 14, P.s2);
  b.rect(9, 8, 4, 5, P.y3);
  b.rect(10, 10, 2, 2, P.o0);
  b.set(9, 8, P.y4);
  b.set(12, 8, P.y4);
  return finish(b, { cx: 11, cy: 17, rx: 9, ry: 2.2 });
}

export function stall(): Pixmap {
  const b = new Pixmap(52, 44);
  // counter
  b.rect(4, 26, 44, 12, P.o3);
  b.hline(4, 26, 44, P.o5);
  b.hline(4, 27, 44, P.o4);
  for (let x = 6; x < 46; x += 8) b.vline(x, 28, 10, P.o2);
  b.hline(4, 37, 44, P.o1);
  // goods
  for (let i = 0; i < 6; i++) {
    const c = [P.r3, P.y3, P.g4, P.r3, P.y3, P.p2][i];
    b.ellipse(10 + i * 6, 24, 2.6, 2.4, c);
    b.set(9 + i * 6, 23, P.white);
  }
  // posts and striped awning
  b.rect(4, 8, 3, 20, P.o2);
  b.rect(45, 8, 3, 20, P.o2);
  for (let x = 0; x < 52; x++) {
    const c = Math.floor(x / 6) % 2 ? P.cream : P.r2;
    b.vline(x, 4, 10, c);
    b.set(x, 3, shade(c, 0.25));
    b.set(x, 13, Math.floor(x / 6) % 2 ? P.n2 : P.r0);
    if (x % 6 >= 2 && x % 6 <= 3) b.set(x, 14, Math.floor(x / 6) % 2 ? P.n2 : P.r1);
  }
  return finish(b, { cx: 26, cy: 39, rx: 24, ry: 3 });
}

// ───────────────────────────── landmarks ─────────────────────────────

export function greatLantern(frame: number, lit: boolean): Pixmap {
  const b = new Pixmap(40, 76);
  // stepped base
  b.ellipse(20, 66, 16, 7, P.s2);
  b.ellipse(20, 64, 15, 6, P.s4);
  b.ellipse(20, 62, 11, 4.4, P.s3);
  b.rect(10, 60, 20, 4, P.s3);
  b.hline(10, 60, 20, P.s5);
  // pillar
  b.rect(16, 24, 8, 38, P.s3);
  b.vline(16, 24, 38, P.s5);
  b.vline(17, 24, 38, P.s4);
  b.vline(23, 24, 38, P.s1);
  for (let y = 28; y < 60; y += 6) b.hline(16, y, 8, P.s2);
  // runes
  for (let y = 30; y < 58; y += 8) {
    b.set(19, y, lit ? P.y4 : P.s1);
    b.set(20, y + 1, lit ? P.y3 : P.s1);
    b.set(21, y, lit ? P.y4 : P.s1);
  }
  // lantern cage
  b.rect(9, 8, 22, 18, P.o1);
  b.rect(11, 10, 18, 14, lit ? P.y2 : P.s1);
  if (lit) {
    b.rect(12, 11, 16, 12, P.y3);
    flame(b, 20, 23, 12, frame);
    b.rect(13, 11, 14, 2, P.y4);
  } else {
    b.rect(12, 11, 16, 12, P.ink2);
    b.set(20, 22, P.y0);
    b.set(19, 22, P.ink3);
    b.set(21, 22, P.ink3);
    b.hline(15, 14, 4, P.ink3);
  }
  for (const x of [15, 20, 25]) b.vline(x, 10, 14, P.o2);
  b.tri(6, 9, 34, 9, 20, 0, P.o2);
  b.tri(9, 9, 31, 9, 20, 2, P.o3);
  b.rect(6, 8, 28, 2, P.o4);
  b.set(20, 0, P.y4);
  b.rect(8, 24, 24, 3, P.o2);
  b.hline(8, 24, 24, P.o4);
  return finish(b, { cx: 20, cy: 68, rx: 17, ry: 5 });
}

export function shrine(frame: number): Pixmap {
  const b = new Pixmap(28, 40);
  b.rect(6, 28, 16, 8, P.s3);
  b.hline(6, 28, 16, P.s5);
  b.rect(8, 20, 12, 9, P.s2);
  b.vline(8, 20, 9, P.s4);
  b.hline(8, 20, 12, P.s4);
  b.rect(4, 34, 20, 3, P.s2);
  // bowl
  b.ellipse(14, 17, 8, 3.4, P.s4);
  b.rect(6, 17, 16, 3, P.s3);
  b.ellipse(14, 17, 6, 2.4, P.s1);
  b.ellipse(14, 17, 5, 1.8, P.y1);
  flame(b, 14, 17, 12, frame);
  b.set(11, 26, P.y3);
  b.set(14, 24, P.y4);
  b.set(17, 26, P.y3);
  return finish(b, { cx: 14, cy: 36, rx: 11, ry: 2.6 });
}

export function torch(frame: number): Pixmap {
  const b = new Pixmap(16, 26);
  b.rect(7, 12, 3, 12, P.o2);
  b.vline(7, 12, 12, P.o4);
  b.rect(5, 10, 7, 3, P.s3);
  b.hline(5, 10, 7, P.s5);
  b.rect(6, 22, 5, 2, P.s2);
  flame(b, 8, 10, 11, frame);
  return b;
}

export function crystal(kind: 'a' | 'b'): Pixmap {
  const big = kind === 'b';
  const w = big ? 28 : 20;
  const h = big ? 36 : 28;
  const ramp = big ? [P.c0, P.c1, P.c2, P.c3, P.c4] : [P.k0, P.k1, P.k2, P.k3, P.k4];
  const b = new Pixmap(w, h);
  const shard = (cx: number, base: number, sw: number, sh: number): void => {
    for (let y = 0; y < sh; y++) {
      const t = y / sh;
      const half = t < 0.25 ? sw * (0.35 + t * 2.6) * 0.5 : sw * 0.5 * (1 - (t - 0.25) / 1.6);
      for (let x = -Math.round(half); x <= Math.round(half); x++) {
        const u = half === 0 ? 0.5 : (x + half) / (half * 2);
        const c = u < 0.3 ? ramp[3] : u < 0.62 ? ramp[2] : ramp[1];
        b.set(cx + x, base - sh + y + 1, y < 3 && x === -Math.round(half) ? ramp[4] : c);
      }
    }
    b.vline(cx - 1, base - sh + 4, Math.max(2, sh - 8), ramp[4]);
  };
  const cx = Math.floor(w / 2);
  shard(cx, h - 5, big ? 11 : 8, big ? 30 : 22);
  shard(cx - (big ? 7 : 5), h - 4, big ? 8 : 6, big ? 19 : 14);
  shard(cx + (big ? 7 : 5), h - 4, big ? 8 : 6, big ? 15 : 11);
  // rocky base
  b.ellipse(cx, h - 4, w / 2 - 3, 3, P.s2);
  b.hline(cx - 5, h - 6, 10, P.s3);
  return finish(b, { cx, cy: h - 3, rx: w / 2 - 2, ry: 2.4, alpha: 110 });
}

export function stalagmite(): Pixmap {
  const b = new Pixmap(20, 28);
  const cone = (cx: number, base: number, cw: number, ch: number): void => {
    for (let y = 0; y < ch; y++) {
      const half = Math.round((cw / 2) * (y / ch));
      for (let x = -half; x <= half; x++) {
        const u = half === 0 ? 0.5 : (x + half) / (half * 2);
        b.set(cx + x, base - ch + y + 1, u < 0.3 ? P.s4 : u < 0.65 ? P.s3 : P.s2);
      }
    }
  };
  cone(10, 25, 13, 22);
  cone(4, 25, 7, 11);
  cone(16, 25, 7, 9);
  return finish(b, { cx: 10, cy: 25, rx: 8, ry: 2, alpha: 100 });
}

export function pillar(): Pixmap {
  const b = new Pixmap(24, 52);
  b.rect(4, 6, 16, 40, P.s3);
  b.vline(4, 6, 40, P.s5);
  b.vline(5, 6, 40, P.s4);
  b.vline(19, 6, 40, P.s1);
  b.vline(18, 6, 40, P.s2);
  for (let y = 10; y < 44; y += 7) b.hline(4, y, 16, P.s2);
  b.rect(2, 2, 20, 5, P.s4);
  b.hline(2, 2, 20, P.s6);
  b.hline(2, 6, 20, P.s2);
  b.rect(2, 44, 20, 4, P.s2);
  b.hline(2, 44, 20, P.s4);
  // glowing runes
  for (const y of [14, 24, 34]) {
    b.hline(9, y, 6, P.c3);
    b.vline(12, y - 2, 5, P.c4);
    b.set(10, y + 1, P.c2);
    b.set(14, y + 1, P.c2);
  }
  return finish(b, { cx: 12, cy: 47, rx: 10, ry: 2.8 });
}

function barsDoor(w: number, h: number, open: boolean, tint: Color | null): Pixmap {
  const b = new Pixmap(w, h);
  const T = (c: Color): Color => (tint === null ? c : mix(c, tint, 0.55));
  // side posts
  for (const x of [0, w - 5]) {
    b.rect(x, 6, 5, h - 8, T(P.s3));
    b.vline(x, 6, h - 8, T(P.s5));
    b.vline(x + 4, 6, h - 8, T(P.s1));
    b.rect(x - 1, 2, 7, 5, T(P.s4));
    b.hline(x - 1, 2, 7, T(P.s6));
  }
  if (!open) {
    // bars + cross plates
    for (let x = 6; x < w - 5; x += 4) {
      b.vline(x, 8, h - 12, T(P.s2));
      b.vline(x + 1, 8, h - 12, T(P.s4));
    }
    b.rect(5, 16, w - 10, 3, T(P.s2));
    b.hline(5, 16, w - 10, T(P.s5));
    b.rect(5, h - 18, w - 10, 3, T(P.s2));
    b.hline(5, h - 18, w - 10, T(P.s5));
    // rune seal
    b.ellipse(w / 2, Math.floor(h / 2), 3, 3, P.c1);
    b.set(Math.floor(w / 2), Math.floor(h / 2) - 1, P.c4);
    b.set(Math.floor(w / 2) - 1, Math.floor(h / 2), P.c3);
  } else {
    // raised gate: bar stubs at the top only
    for (let x = 6; x < w - 5; x += 4) b.vline(x, 4, 8, T(P.s2));
    b.rect(5, 12, w - 10, 3, T(P.s2));
    // rubble
    b.set(8, h - 5, P.s3);
    b.set(11, h - 4, P.s2);
  }
  return finish(b, { cx: w / 2, cy: h - 3, rx: w / 2 - 1, ry: 2.2, alpha: 80 });
}

export function gate(open: boolean): Pixmap {
  return barsDoor(22, 62, open, null);
}
export function bossDoor(open: boolean): Pixmap {
  return barsDoor(22, 62, open, P.c1);
}

export function plate(down: boolean): Pixmap {
  const b = new Pixmap(16, 16);
  b.ellipse(8, 9, 7, 5, P.s1);
  b.ellipse(8, down ? 9 : 8, 6, 4, down ? P.s2 : P.s3);
  b.ellipse(8, down ? 9 : 8, 4, 2.6, down ? P.c3 : P.s4);
  if (down) b.set(8, 9, P.c4);
  else {
    b.hline(4, 7, 4, P.s5);
  }
  b.frame(1, 3, 14, 11, P.ink2, 0);
  return b;
}

export function pushRock(): Pixmap {
  const b = new Pixmap(20, 22);
  b.rect(2, 5, 16, 13, P.s3);
  b.rect(3, 4, 14, 1, P.s4);
  shadedBlob(b, 10, 11, 8, 8, STONE, 12);
  b.rect(3, 9, 14, 8, P.s3);
  b.hline(3, 9, 14, P.s5);
  b.vline(3, 9, 8, P.s4);
  b.vline(16, 9, 8, P.s1);
  b.hline(3, 16, 14, P.s1);
  // engraved rune
  b.hline(8, 11, 4, P.c3);
  b.vline(10, 11, 4, P.c3);
  b.set(9, 13, P.c2);
  b.set(11, 13, P.c2);
  return finish(b, { cx: 10, cy: 18, rx: 8.4, ry: 2.4 });
}

export const PROP_SHEET_KEY = 'props';

export function buildPropSheet(): Sheet {
  const sb = new SheetBuilder(PROP_SHEET_KEY, 512, 1);
  const add = (name: string, pm: Pixmap, footY = pm.h - 3): void => {
    sb.add(name, pm, Math.floor(pm.w / 2), footY);
  };
  add('tree_a', treeA(11));
  add('tree_a_dark', treeA(23, true));
  add('tree_b', treePine(5), 41);
  add('tree_c', treeBig(7), 58);
  add('tree_dead', treeDead(), 33);
  add('bush_a', bush(false, 3), 13);
  add('bush_b', bush(true, 8), 13);
  add('rock_a', rock(14, 11, 21));
  add('rock_b', rock(22, 16, 22));
  add('stump', stump(), 15);
  add('log', log(), 14);
  for (let f = 0; f < 3; f++) add(`tallgrass_${f}`, tallGrass(f), 15);
  add('mushroom', mushroomCluster(), 12);
  for (let f = 0; f < 3; f++) add(`reeds_${f}`, reeds(f), 24);
  for (let f = 0; f < 2; f++) add(`lily_${f}`, lily(f), 8);
  add('flowerbed', flowerbed(), 13);
  add('haystack', haystack(), 25);
  add('house_a', house({ w: 68, h: 78, roof: [P.r0, P.r1, P.r2, P.r3, P.r4], wall: P.cream, wallDark: P.n1, seed: 1, chimney: true }), 74);
  add('house_b', house({ w: 68, h: 78, roof: [P.t0, P.t1, P.t2, P.t3, P.t4], wall: P.n3, wallDark: P.n0, seed: 2 }), 74);
  add('house_c', house({ w: 52, h: 68, roof: [P.o1, P.o2, P.o3, P.o4, P.o5], wall: P.n3, wallDark: P.n1, seed: 3, thatch: true }), 64);
  add('hall', hall(), 88);
  add('well', well(), 34);
  add('lamp', lamp(), 43);
  add('fence_h', fenceH(), 16);
  add('fence_v', fenceV(), 16);
  add('sign', sign(), 22);
  add('barrel', barrel(), 17);
  add('crate', crate(), 17);
  add('chest', chest(), 17);
  add('stall', stall(), 40);
  for (let f = 0; f < 3; f++) add(`great_lantern_${f}`, greatLantern(f, true), 68);
  add('great_lantern_off', greatLantern(0, false), 68);
  for (let f = 0; f < 3; f++) add(`shrine_${f}`, shrine(f), 36);
  for (let f = 0; f < 3; f++) add(`torch_${f}`, torch(f), 24);
  add('crystal_a', crystal('a'), 25);
  add('crystal_b', crystal('b'), 33);
  add('stalagmite', stalagmite(), 25);
  add('pillar', pillar(), 47);
  add('gate_c', gate(false), 59);
  add('gate_o', gate(true), 59);
  add('boss_door_c', bossDoor(false), 59);
  add('boss_door_o', bossDoor(true), 59);
  add('plate_u', plate(false), 13);
  add('plate_d', plate(true), 13);
  add('pushrock', pushRock(), 19);
  return sb.build();
}

