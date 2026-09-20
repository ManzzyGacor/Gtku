/** Effect sprites: slashes, sparks, particles, projectiles, glows. */
import { shadedBlob } from './draw';
import { P } from './palette';
import { Pixmap, type Color } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

export const FX_SHEET_KEY = 'fx';

/** Crescent slash facing +x (angle 0), centred on the sprite centre. `k` 0..2 = fade stages. */
function slash(k: number): Pixmap {
  const S = 56;
  const pm = new Pixmap(S, S);
  const c = S / 2;
  const half = [58, 50, 42][k] * (Math.PI / 180);
  const r0 = [15, 17, 19][k];
  const r1 = [31, 30, 29][k];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (Math.abs(a) > half) continue;
      // crescent: inner radius curves outward toward the tips
      const t = Math.abs(a) / half;
      const inner = r0 + (r1 - r0) * t * t * 0.95;
      const outer = r1 - t * 2;
      if (d < inner || d > outer) continue;
      const u = (d - inner) / Math.max(1, outer - inner);
      const col: Color = u > 0.72 ? P.white : u > 0.4 ? P.y5 : u > 0.18 ? P.y4 : P.y3;
      const fade = k === 0 ? 255 : k === 1 ? 210 : 140;
      pm.set(x, y, col, fade);
    }
  return pm;
}

function spark(size: number, c1: Color, c2: Color): Pixmap {
  const pm = new Pixmap(size, size);
  const m = Math.floor(size / 2);
  pm.hline(0, m, size, c1);
  pm.vline(m, 0, size, c1);
  if (size >= 5) {
    pm.set(m - 1, m - 1, c2);
    pm.set(m + 1, m + 1, c2);
    pm.set(m + 1, m - 1, c2);
    pm.set(m - 1, m + 1, c2);
  }
  pm.set(m, m, P.white);
  return pm;
}

function burst(frame: number): Pixmap {
  const pm = new Pixmap(20, 20);
  const c = 10;
  const len = [6, 9, 8][frame];
  const inner = [1, 4, 6][frame];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + 0.2;
    const l = i % 2 ? len * 0.6 : len;
    pm.line(c + Math.cos(a) * inner, c + Math.sin(a) * inner, c + Math.cos(a) * l, c + Math.sin(a) * l, frame === 2 ? P.y3 : P.white);
  }
  if (frame < 2) pm.ellipse(c, c, [3, 2][frame], [3, 2][frame], P.y5);
  return pm;
}

function blob(size: number, color: Color, hi: Color): Pixmap {
  const pm = new Pixmap(size, size);
  const c = size / 2;
  pm.ellipse(c, c, size / 2, size / 2, color);
  pm.set(Math.floor(c) - 1, Math.floor(c) - 1, hi);
  return pm;
}

/** Radial soft glow (white; tint at runtime). */
function glow(size: number): Pixmap {
  const pm = new Pixmap(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, 1.8);
      pm.set(x, y, 0xffffff, Math.round(a * 255));
    }
  return pm;
}

function thorn(): Pixmap {
  const pm = new Pixmap(14, 5);
  pm.hline(1, 2, 11, P.cream);
  pm.hline(2, 1, 8, P.o5);
  pm.hline(2, 3, 8, P.o3);
  pm.tri(12, 0, 12, 5, 14, 2.5, P.white);
  pm.set(0, 1, P.g3);
  pm.set(0, 3, P.g3);
  pm.set(1, 2, P.g2);
  return pm;
}

function rockProj(): Pixmap {
  const pm = new Pixmap(14, 14);
  pm.ellipse(7, 7, 6, 6, P.s3);
  pm.ellipse(6, 6, 4, 4, P.s4);
  pm.set(4, 4, P.s5);
  pm.set(9, 9, P.c3);
  pm.set(8, 9, P.c2);
  pm.hline(4, 11, 6, P.s1);
  pm.outline(P.ink0);
  return pm;
}

function orb(): Pixmap {
  const pm = new Pixmap(12, 12);
  pm.ellipse(6, 6, 5, 5, P.c1);
  pm.ellipse(6, 6, 3.6, 3.6, P.c2);
  pm.ellipse(5, 5, 2, 2, P.c4);
  pm.set(4, 4, P.white);
  return pm;
}

function healOrb(): Pixmap {
  const pm = new Pixmap(11, 11);
  pm.ellipse(5.5, 5.5, 5, 5, P.g1);
  pm.ellipse(5.5, 5.5, 4, 4, P.g3);
  pm.ellipse(4.5, 4.5, 2.2, 2.2, P.g5);
  pm.set(3, 3, P.white);
  pm.hline(4, 9, 3, P.g0);
  pm.outline(P.ink0);
  return pm;
}

/** Dark leafy silhouette used by the forest parallax canopy layer. */
function canopy(seed: number): Pixmap {
  const pm = new Pixmap(72, 56);
  const clumps: [number, number, number, number][] = [
    [36, 26, 26, 18],
    [16, 30, 14, 12],
    [56, 30, 14, 12],
    [30, 14, 14, 11],
    [46, 40, 15, 10],
  ];
  clumps.forEach(([cx, cy, rx, ry], i) => shadedBlob(pm, cx + (seed % 3), cy, rx, ry, [P.f0, P.g0, P.f1, P.f2], seed + i));
  return pm;
}

function cloud(): Pixmap {
  const pm = new Pixmap(110, 44);
  for (const [cx, cy, rx, ry] of [[40, 22, 32, 14], [72, 24, 28, 12], [56, 18, 24, 12]] as const) pm.ellipse(cx, cy, rx, ry, P.ink0, 255);
  return pm;
}

function softShadow(w: number, h: number): Pixmap {
  const pm = new Pixmap(w, h);
  pm.ellipse(w / 2, h / 2, w / 2, h / 2, P.ink0, 100);
  return pm;
}

export function buildFxSheet(): Sheet {
  const sb = new SheetBuilder(FX_SHEET_KEY, 256, 1);
  for (let k = 0; k < 3; k++) sb.add(`slash_${k}`, slash(k), 28, 28);
  for (let k = 0; k < 3; k++) sb.add(`burst_${k}`, burst(k), 10, 10);
  sb.add('spark_s', spark(3, P.y5, P.y4));
  sb.add('spark_m', spark(5, P.y4, P.y3));
  sb.add('spark_c', spark(5, P.k3, P.k2));
  sb.add('spark_v', spark(5, P.c3, P.c2));
  sb.add('dust', blob(5, P.n3, P.n4));
  sb.add('dust_dark', blob(4, P.d4, P.d5));
  sb.add('leaf_g', blob(4, P.g4, P.g5));
  sb.add('leaf_o', blob(4, P.y2, P.y4));
  sb.add('drop', blob(3, P.w4, P.w6));
  sb.add('ember', blob(2, P.y3, P.y5));
  sb.add('smoke', blob(6, P.ink3, P.s2));
  sb.add('glow', glow(64), 32, 32);
  sb.add('thorn', thorn(), 7, 2);
  sb.add('rock_proj', rockProj(), 7, 7);
  sb.add('orb', orb(), 6, 6);
  sb.add('heal_orb', healOrb(), 6, 6);
  sb.add('canopy_0', canopy(1), 36, 28);
  sb.add('canopy_1', canopy(2), 36, 28);
  sb.add('cloud', cloud(), 55, 22);
  sb.add('shadow_s', softShadow(12, 5), 6, 2);
  return sb.build();
}
