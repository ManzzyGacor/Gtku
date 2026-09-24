/**
 * How big the three buffers of the pixel pipeline are. Pure arithmetic, no Three.js — because the
 * one visual bug that made the game unplayable was in exactly this maths: the old code clamped the
 * art buffer's *width* to 720, so on a 3:1 phone screen the canvas covered only 62% of it.
 */

/** Never build a drawing buffer bigger than this, however large the screen claims to be. */
export const MAX_CANVAS_PIXELS = 3.2e6;
/** Fewest art rows worth rendering. */
export const MIN_PIXEL_H = 120;

export interface PixelPlan {
  /** Canvas drawing buffer, in device pixels. */
  canvasW: number;
  canvasH: number;
  /** CSS size of the canvas — always the full viewport, so there is never a letterbox. */
  cssW: number;
  cssH: number;
  /** The art-directed pixel grid. */
  pixelW: number;
  pixelH: number;
  /** Render target actually drawn into (the pixel grid times `renderScale`). */
  renderW: number;
  renderH: number;
  /** Device pixels per art pixel. May be fractional; the upscale shader copes. */
  scale: number;
}

/**
 * @param pixelHeight rows in the art grid (the "pixel size" dial)
 * @param renderScale fraction of that actually rendered (the performance dial)
 */
export function planPixelBuffers(cssW: number, cssH: number, dpr: number, pixelHeight: number, renderScale: number): PixelPlan {
  const safeDpr = dpr > 0 ? dpr : 1;
  const wantW = Math.max(1, Math.round(cssW * safeDpr));
  const wantH = Math.max(1, Math.round(cssH * safeDpr));
  // Guard against absurd buffers on huge screens — by shrinking the buffer, never by cropping.
  const shrink = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (wantW * wantH)));
  const canvasW = Math.max(1, Math.round(wantW * shrink));
  const canvasH = Math.max(1, Math.round(wantH * shrink));
  const aspect = canvasW / canvasH;

  // Never ask for more art rows than the screen actually has, and never fewer than is sane.
  const pixelH = Math.max(MIN_PIXEL_H, Math.min(Math.round(pixelHeight), canvasH));
  const pixelW = Math.max(Math.round(MIN_PIXEL_H * aspect), Math.round(pixelH * aspect));
  const clampedScale = Math.max(0.3, Math.min(1, renderScale));
  const renderH = Math.max(90, Math.round(pixelH * clampedScale));
  const renderW = Math.max(Math.round(90 * aspect), Math.round(renderH * aspect));

  return { canvasW, canvasH, cssW, cssH, pixelW, pixelH, renderW, renderH, scale: canvasH / pixelH };
}
