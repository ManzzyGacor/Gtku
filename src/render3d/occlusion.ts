/**
 * The rule behind the "don't hide the hero" cutout, as plain arithmetic.
 *
 * `World3D`'s fragment shader implements exactly this test in GLSL. Keeping the maths here as well
 * means the *rule* can be unit-tested against the real camera (there is no GPU on the VPS, so the
 * shader itself can only be judged on the phone).
 */
import type { Vector2Like, Vector3Like } from 'three';

/** Half-extents of the protected ellipse around the hero, in world units (view space). */
export const FADE_RADIUS: Vector2Like = { x: 1.3, y: 1.9 };
/** A fragment must be at least this much nearer the camera than the hero before it may dissolve. */
export const FADE_BIAS = 0.2;
/** How far above the hero's feet the ellipse is centred. */
export const FADE_LIFT = 0.8;

/**
 * How much a fragment covers the hero, 0..1, given both positions **in view space** (the camera
 * looks down −Z, so a larger `z` means nearer the camera). 0 = leave it alone, 1 = dead centre.
 */
export function coverAmount(view: Vector3Like, heroView: Vector3Like, radius: Vector2Like = FADE_RADIUS): number {
  if (view.z <= heroView.z + FADE_BIAS) return 0; // behind the hero (or level with them): never cut
  const dx = (view.x - heroView.x) / radius.x;
  const dy = (view.y - heroView.y) / radius.y;
  const d2 = dx * dx + dy * dy;
  return d2 >= 1 ? 0 : 1 - d2;
}

/**
 * Ordered dithering, built from the classic Bayer recursion
 * `M2n = [[4*Mn, 4*Mn + 2], [4*Mn + 3, 4*Mn + 1]]` with `M2 = [[0, 2], [3, 1]]`.
 *
 * Written as arithmetic rather than a lookup table because the shader has to compute the same
 * thing without bit operations or dynamic array indexing (GLSL ES 1.0).
 */
function bayer2(x: number, y: number): number {
  const d = (x + y) % 2; // 1 when the two differ
  return d * (2 + y) + (1 - d) * x;
}

/** The dissolve threshold for one screen pixel, 1/32..31/32. Same pattern as the shader. */
export function ditherThreshold(px: number, py: number): number {
  const x = ((Math.floor(px) % 4) + 4) % 4;
  const y = ((Math.floor(py) % 4) + 4) % 4;
  const slot = 4 * bayer2(x % 2, y % 2) + bayer2(Math.floor(x / 2), Math.floor(y / 2));
  return (slot + 0.5) / 16;
}

/** True when this exact pixel of this fragment is dissolved away. */
export function isCutOut(view: Vector3Like, heroView: Vector3Like, px: number, py: number, radius: Vector2Like = FADE_RADIUS): boolean {
  const cover = coverAmount(view, heroView, radius);
  return cover > 0.01 && cover > ditherThreshold(px, py);
}
