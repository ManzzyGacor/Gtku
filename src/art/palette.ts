/**
 * The one and only palette. Every generated pixel comes from here (or a `mix` of two entries), which keeps the whole
 * game visually consistent. Ramps run dark → light and are hue-shifted (shadows lean violet/blue, lights lean warm).
 */
import { mix, type Color } from './pixmap';

export const P = {
  // Inks & deep shadows (violet-tinted, never pure black)
  ink0: 0x0f0b1c,
  ink1: 0x1a1430,
  ink2: 0x281f45,
  ink3: 0x3a2f5e,

  // Grass
  g0: 0x1a3d3a,
  g1: 0x25603f,
  g2: 0x36803f,
  g3: 0x55a145,
  g4: 0x82c24f,
  g5: 0xb4dd6b,
  g6: 0xdcf08c,

  // Forest floor / moss
  f0: 0x122d33,
  f1: 0x1a4536,
  f2: 0x245a3a,
  f3: 0x317540,

  // Dirt / earth
  d0: 0x3a2430,
  d1: 0x5a3a36,
  d2: 0x7e5138,
  d3: 0xa16e3f,
  d4: 0xc79456,
  d5: 0xe3bb7b,

  // Stone (blue-grey)
  s0: 0x1c1e33,
  s1: 0x30334e,
  s2: 0x4a4e6f,
  s3: 0x6a7094,
  s4: 0x9199b9,
  s5: 0xbbc2da,
  s6: 0xe0e4f0,

  // Water
  w0: 0x12305a,
  w1: 0x1a4d84,
  w2: 0x2673ac,
  w3: 0x3f9fcf,
  w4: 0x76cfe6,
  w5: 0xbdf0f4,
  w6: 0xf0fdff,

  // Sand
  n0: 0x9a7350,
  n1: 0xbf9962,
  n2: 0xdcba82,
  n3: 0xefd6a2,
  n4: 0xf9ecc4,

  // Wood
  o0: 0x2e1b22,
  o1: 0x4a2c2b,
  o2: 0x6a4129,
  o3: 0x8e5b33,
  o4: 0xb87f46,
  o5: 0xd8a466,

  // Red (roofs, cloth, heart)
  r0: 0x531a2e,
  r1: 0x882a3a,
  r2: 0xb8403f,
  r3: 0xde694d,
  r4: 0xf1996b,

  // Teal
  t0: 0x113c4d,
  t1: 0x1a5d68,
  t2: 0x298a86,
  t3: 0x4ab7a3,
  t4: 0x85dfc0,

  // Blue cloth
  b0: 0x1c2354,
  b1: 0x2a3b87,
  b2: 0x3e5dc1,
  b3: 0x6a8ef0,
  b4: 0xa5bfff,

  // Fire / gold
  y0: 0x7a2130,
  y1: 0xc1422a,
  y2: 0xef802b,
  y3: 0xffb82e,
  y4: 0xffe066,
  y5: 0xfff6b0,

  // Violet crystal / magic
  c0: 0x2a1f6b,
  c1: 0x4a3aaf,
  c2: 0x7962ef,
  c3: 0xa795ff,
  c4: 0xd8cfff,

  // Cyan crystal
  k0: 0x0e4962,
  k1: 0x1a859f,
  k2: 0x34c3cf,
  k3: 0x8befeb,
  k4: 0xd5fffa,

  // Skin
  h0: 0x794533,
  h1: 0xa46749,
  h2: 0xd18e62,
  h3: 0xefb889,
  h4: 0xffdbb3,

  // Pink flowers
  p0: 0x9f396d,
  p1: 0xd1608e,
  p2: 0xff99c0,

  white: 0xfff8e6,
  cream: 0xf2e2c2,
} as const;

export type PaletteKey = keyof typeof P;

/** Outline colour derived from a neighbouring fill: darker and pulled toward the ink violet (selective outline). */
export function outlineOf(inner: Color): Color {
  return mix(inner, P.ink1, 0.72);
}

/** Darker / lighter helper for procedural shading. */
export const shade = (c: Color, t: number): Color => (t < 0 ? mix(c, P.ink1, -t) : mix(c, P.white, t));
