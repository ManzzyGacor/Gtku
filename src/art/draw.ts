/** Shared drawing helpers for procedural pixel art. */
import { clamp, hashf } from '../core/rng';
import { P, outlineOf } from './palette';
import { Pixmap, type Color } from './pixmap';

/**
 * Sphere-shaded ellipse using a colour ramp (dark→light). Light comes from the top-left; a hash dither softens band edges.
 */
export function shadedBlob(
  pm: Pixmap,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: readonly Color[],
  seed = 1,
  lx = -0.5,
  ly = -0.8,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const l = dx * lx + dy * ly + nz * 0.55;
      let t = (l + 0.7) / 1.75;
      t += (hashf(x, y, seed) - 0.5) * 0.24;
      pm.set(x, y, ramp[clamp(Math.floor(t * ramp.length), 0, ramp.length - 1)]);
    }
  }
}

/** Soft elliptical ground shadow in an otherwise transparent pixmap (drawn under the sprite). */
export function groundShadow(pm: Pixmap, cx: number, cy: number, rx: number, ry: number, alpha = 90): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) pm.set(x, y, P.ink0, d < 0.55 ? alpha : alpha * 0.55);
    }
}

/**
 * Compose a finished sprite: [ground shadow] + [body with selective outline].
 * `body` should leave a 1px transparent margin for the outline.
 */
export function finish(body: Pixmap, shadow?: { cx: number; cy: number; rx: number; ry: number; alpha?: number }, outline = true): Pixmap {
  const out = new Pixmap(body.w, body.h);
  if (shadow) groundShadow(out, shadow.cx, shadow.cy, shadow.rx, shadow.ry, shadow.alpha);
  const b = body.clone();
  if (outline) b.outline(outlineOf);
  out.blit(b, 0, 0);
  return out;
}

export function ellipseRing(pm: Pixmap, cx: number, cy: number, rx: number, ry: number, c: Color): void {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1 && d > 0.62) pm.set(x, y, c);
    }
}

/** Flame sprite pixels centred at (cx, baseY), height h. `frame` flickers the shape. */
export function flame(pm: Pixmap, cx: number, baseY: number, h: number, frame: number): void {
  const wob = [0, 1, -1][frame % 3];
  const w = Math.max(3, Math.round(h * 0.55));
  for (let i = 0; i < h; i++) {
    const t = i / h;
    const half = Math.max(0, Math.round((w / 2) * (1 - t * t) * (i < 2 ? 0.7 : 1)));
    const sway = Math.round(wob * t * 1.4);
    const y = baseY - i;
    const outer = t < 0.5 ? P.y2 : P.y3;
    pm.hline(cx - half + sway, y, half * 2 + 1, i > h - 3 ? P.y1 : outer);
    if (half >= 2 && t < 0.75) pm.hline(cx - half + 1 + sway, y, Math.max(1, half * 2 - 1), t < 0.3 ? P.y4 : P.y3);
    if (half >= 1 && t < 0.42) pm.hline(cx - Math.max(0, half - 2) + sway, y, Math.max(1, half * 2 - 3), P.y5);
  }
}
