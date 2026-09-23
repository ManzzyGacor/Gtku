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
  // t, top, haze
  [0.0, [0.05, 0.06, 0.16], [0.10, 0.11, 0.24]],
  [0.2, [0.07, 0.09, 0.22], [0.15, 0.15, 0.30]],
  [0.27, [0.28, 0.24, 0.45], [0.86, 0.52, 0.42]],
  [0.35, [0.44, 0.62, 0.86], [0.85, 0.80, 0.72]],
  [0.5, [0.38, 0.62, 0.92], [0.76, 0.85, 0.92]],
  [0.65, [0.42, 0.62, 0.88], [0.88, 0.84, 0.74]],
  [0.74, [0.44, 0.34, 0.54], [0.95, 0.58, 0.34]],
  [0.82, [0.16, 0.14, 0.34], [0.46, 0.30, 0.45]],
  [0.92, [0.06, 0.08, 0.20], [0.14, 0.14, 0.28]],
  [1.0, [0.05, 0.06, 0.16], [0.10, 0.11, 0.24]],
];

/** Deep-cave backdrop: no sky at all, just cold stone haze. */
export const CAVE_SKY: SkyColors = { top: [0.03, 0.03, 0.08], haze: [0.10, 0.09, 0.18] };

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
  return { top: [0.38, 0.62, 0.92], haze: [0.76, 0.85, 0.92] };
}

/** Blend an outdoor sky toward the cave backdrop. */
export function blendSky(outdoor: SkyColors, weight: number): SkyColors {
  return {
    top: blendAmbient(outdoor.top, CAVE_SKY.top, weight),
    haze: blendAmbient(outdoor.haze, CAVE_SKY.haze, weight),
  };
}

export function timeLabel(t: number): string {
  const h = Math.floor(wrapDay(t + 0.0) * 24);
  return `${String(h).padStart(2, '0')}:00`;
}
