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

export function timeLabel(t: number): string {
  const h = Math.floor(wrapDay(t + 0.0) * 24);
  return `${String(h).padStart(2, '0')}:00`;
}
