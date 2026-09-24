/**
 * Baked light pools for the ground.
 *
 * The reference art's night is a dark blue ambient with warm pools spilling out of every lantern
 * and window. Doing that with real lights would mean dozens of dynamic lights per screen, which no
 * phone will pay for — so the static ones are **baked into a light map per chunk** instead: one
 * small texture, no per-frame cost, and as many lamps as the village wants. Only a handful of
 * dynamic lights are kept, near the hero.
 *
 * Three.js applies this through `MeshLambertMaterial.lightMap`, whose `lightMapIntensity` we fade
 * with the night, so the pools appear at dusk and are gone by morning.
 *
 * Three-free on purpose, so the falloff can be unit-tested.
 */
import { CHUNK_TILES } from '../config';
import { b8, g8, Pixmap, r8 } from '../art/pixmap';
import type { PointLightPlan } from './worldPlan';

/** Light-map texels per tile. Two is plenty: these are soft pools, not art. */
export const LIGHTMAP_SCALE = 2;
export const LIGHTMAP_SIZE = CHUNK_TILES * LIGHTMAP_SCALE;

/**
 * Brightness of a light at ground distance `d` (world units).
 *
 * Physically a point light falls off with the square of the distance, which on a flat floor makes
 * a hard little dot. Games draw a *pool*: bright and nearly flat under the lamp, then a smooth
 * shoulder out to the radius. That is what this curve is, and the light's height above the ground
 * is what flattens the middle.
 */
export function poolFalloff(d: number, radius: number, height: number): number {
  if (radius <= 0) return 0;
  const reach = radius * 1.15;
  if (d >= reach) return 0;
  // distance through the air from the bulb to that spot on the floor
  const slant = Math.hypot(d, Math.max(0.35, height));
  const t = Math.min(1, slant / reach);
  const shoulder = 1 - t * t;
  return shoulder * shoulder;
}

/**
 * Bake every light that can reach this chunk into an RGB pool map.
 * `lights` should include the surrounding chunks' lights, because a lamp lights across a border.
 */
export function bakeLightMap(lights: readonly PointLightPlan[], cx: number, cy: number): Pixmap {
  const pm = new Pixmap(LIGHTMAP_SIZE, LIGHTMAP_SIZE);
  const originX = cx * CHUNK_TILES;
  const originZ = cy * CHUNK_TILES;
  if (!lights.length) return pm;

  // Only the lights whose reach actually overlaps this chunk.
  const near = lights.filter((l) => {
    const reach = l.radius * 1.15;
    return l.x + reach > originX && l.x - reach < originX + CHUNK_TILES && l.z + reach > originZ && l.z - reach < originZ + CHUNK_TILES;
  });
  if (!near.length) return pm;

  const step = 1 / LIGHTMAP_SCALE;
  for (let ty = 0; ty < LIGHTMAP_SIZE; ty++) {
    const wz = originZ + (ty + 0.5) * step;
    for (let tx = 0; tx < LIGHTMAP_SIZE; tx++) {
      const wx = originX + (tx + 0.5) * step;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const l of near) {
        const f = poolFalloff(Math.hypot(wx - l.x, wz - l.z), l.radius, l.y) * l.intensity;
        if (f <= 0.002) continue;
        r += r8(l.color) * f;
        g += g8(l.color) * f;
        b += b8(l.color) * f;
      }
      if (r + g + b < 1) continue;
      // Overlapping lamps add up, so clamp rather than wrap.
      pm.set(tx, ty, ((Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b)) >>> 0, 255);
    }
  }
  return pm;
}

/** True when a bake produced anything worth uploading. */
export function lightMapHasLight(pm: Pixmap): boolean {
  for (let i = 0; i < pm.data.length; i += 4) if (pm.data[i] || pm.data[i + 1] || pm.data[i + 2]) return true;
  return false;
}
