/** Day/night cycle: pure functions (testable). `t` is the day fraction: 0 = midnight, 0.5 = noon. */
import { clamp, lerp } from '../rng';

export type RGB = [number, number, number];

const KEYS: [number, RGB][] = [
  [0.0, [0.17, 0.21, 0.44]],
  [0.2, [0.26, 0.28, 0.5]],
  [0.27, [0.95, 0.68, 0.58]],
  [0.35, [1.0, 0.95, 0.88]],
  [0.5, [1, 1, 1]],
  [0.65, [1.0, 0.97, 0.9]],
  [0.74, [1.0, 0.7, 0.5]],
  [0.82, [0.5, 0.38, 0.58]],
  [0.92, [0.2, 0.23, 0.44]],
  [1.0, [0.17, 0.21, 0.44]],
];

/** Length of one full day in real seconds. */
export const DAY_SECONDS = 420;

export function wrapDay(t: number): number {
  return ((t % 1) + 1) % 1;
}

export function ambientAt(t: number): RGB {
  t = wrapDay(t);
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [t0, c0] = KEYS[i];
    const [t1, c1] = KEYS[i + 1];
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0);
      const e = k * k * (3 - 2 * k);
      return [lerp(c0[0], c1[0], e), lerp(c0[1], c1[1], e), lerp(c0[2], c1[2], e)];
    }
  }
  return [1, 1, 1];
}

export const luminance = (c: RGB): number => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;

/** 0 = full day, 1 = deep night. */
export function nightAmount(t: number): number {
  return clamp((1 - luminance(ambientAt(t))) * 1.35, 0, 1);
}

/** Smoothstep. */
export const smooth = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** Blend outdoor ambient with the cave ambient depending on how deep inside the cave (in tiles) the hero is. */
export function blendAmbient(outdoor: RGB, cave: RGB, weight: number): RGB {
  return [lerp(outdoor[0], cave[0], weight), lerp(outdoor[1], cave[1], weight), lerp(outdoor[2], cave[2], weight)];
}

/**
 * Sky and haze colours for the 3D backdrop.
 *
 * The 3D camera is orthographic, so an infinite ground plane would fill the whole screen and there
 * is no true horizon line. What the player actually sees past the edge of the world is this backdrop,
 * and distance fog dyed `haze` is what makes the far ground dissolve into it instead of just stopping.
 */
export interface SkyColors {
  /** Top of the screen. */
  top: RGB;
  /** Bottom of the screen and the colour of the distance fog. */
  haze: RGB;
}

const SKY_KEYS: [number, RGB, RGB][] = [
  // t, top, haze — tuned against docs/reference/referensi-visual.png, which is a dusk scene lit
  // almost entirely by lanterns: the distance goes deep teal-to-black, never pale grey.
  [0.0, [0.016, 0.022, 0.062], [0.035, 0.062, 0.098]],
  [0.2, [0.028, 0.040, 0.098], [0.055, 0.090, 0.135]],
  [0.27, [0.180, 0.150, 0.330], [0.560, 0.330, 0.290]],
  [0.35, [0.320, 0.500, 0.780], [0.640, 0.600, 0.540]],
  [0.5, [0.260, 0.520, 0.860], [0.560, 0.680, 0.760]],
  [0.65, [0.300, 0.500, 0.800], [0.680, 0.620, 0.520]],
  [0.74, [0.300, 0.230, 0.420], [0.680, 0.360, 0.210]],
  [0.82, [0.080, 0.080, 0.220], [0.230, 0.150, 0.250]],
  [0.92, [0.022, 0.032, 0.085], [0.060, 0.085, 0.130]],
  [1.0, [0.016, 0.022, 0.062], [0.035, 0.062, 0.098]],
];

/** Deep-cave backdrop: no sky at all, just cold stone haze. */
export const CAVE_SKY: SkyColors = { top: [0.012, 0.012, 0.030], haze: [0.045, 0.040, 0.090] };

export function skyAt(t: number): SkyColors {
  t = wrapDay(t);
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const [t0, top0, haze0] = SKY_KEYS[i];
    const [t1, top1, haze1] = SKY_KEYS[i + 1];
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0);
      const e = k * k * (3 - 2 * k);
      return {
        top: [lerp(top0[0], top1[0], e), lerp(top0[1], top1[1], e), lerp(top0[2], top1[2], e)],
        haze: [lerp(haze0[0], haze1[0], e), lerp(haze0[1], haze1[1], e), lerp(haze0[2], haze1[2], e)],
      };
    }
  }
  return { top: [0.26, 0.52, 0.86], haze: [0.56, 0.68, 0.76] };
}

/** Blend an outdoor sky toward the cave backdrop. */
export function blendSky(outdoor: SkyColors, weight: number): SkyColors {
  return {
    top: blendAmbient(outdoor.top, CAVE_SKY.top, weight),
    haze: blendAmbient(outdoor.haze, CAVE_SKY.haze, weight),
  };
}

/**
 * Direction the light comes *from*, as a unit vector (x east, y up, z south).
 *
 * The sun rises in the east at t = 0.25, stands highest at noon and sets in the west, so shadows
 * sweep across the ground over the day instead of being painted on. Once it is below the horizon
 * the vector keeps a low tilt and `sunUp` reports false, which is the renderer's cue to switch to
 * a cold moon from overhead.
 */
export function sunDirection(t: number): { x: number; y: number; z: number; up: boolean } {
  const a = (wrapDay(t) - 0.25) * Math.PI * 2;
  const elevation = Math.sin(a);
  const up = elevation > 0;
  // A little southward bias so the light is never perfectly side-on to the fixed camera.
  const x = Math.cos(a);
  const y = up ? Math.max(0.22, elevation) : 0.85;
  const z = up ? 0.38 : 0.25;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len, up };
}

export function timeLabel(t: number): string {
  const h = Math.floor(wrapDay(t + 0.0) * 24);
  return `${String(h).padStart(2, '0')}:00`;
}


/**
 * Post-process look for the time of day: how much bloom, how deep the vignette, and the colour
 * grade (a lift pushed into the shadows and a gain multiplied into the highlights).
 *
 * This is what sells the reference's night: a blue-black ambient with warm light blooming out of
 * every lantern and window. Pure, so the curve can be checked without a GPU.
 */
export interface GradeColors {
  /** 0..1 bloom strength. */
  bloom: number;
  /** 0..1 vignette depth. */
  vignette: number;
  /** Added to the shadows. */
  lift: RGB;
  /** Multiplied into the highlights. */
  gain: RGB;
}

export function gradeAt(t: number, cave = 0): GradeColors {
  const night = nightAmount(t);
  // Dusk and dawn are the golden hours: warm gain, moderate bloom.
  const golden = Math.max(0, 1 - Math.min(Math.abs(wrapDay(t) - 0.74), Math.abs(wrapDay(t) - 0.27)) * 7);

  const dayBloom = 0.22;
  const nightBloom = 0.95;
  const bloom = lerp(lerp(dayBloom, nightBloom, night) + golden * 0.25, 1.05, cave);

  const vignette = lerp(lerp(0.18, 0.34, night), 0.46, cave);

  // Shadows drift toward the night's blue, and toward violet underground.
  const lift: RGB = [
    lerp(0.0, 0.012, night) + cave * 0.01,
    lerp(0.0, 0.020, night) + cave * 0.008,
    lerp(0.0, 0.052, night) + cave * 0.042,
  ];
  // Highlights warm up at night and at golden hour, because every light source is a flame.
  const warm = Math.min(1, night * 0.8 + golden);
  const gain: RGB = [lerp(1, 1.1, warm), lerp(1, 1.0, warm), lerp(1, 0.9, warm) * lerp(1, 1.06, cave)];
  return { bloom, vignette, lift, gain };
}
