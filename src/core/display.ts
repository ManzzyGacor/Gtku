import { MAX_LOGICAL_W, MIN_LOGICAL_W, TARGET_LOGICAL_H } from '../config';

export interface DisplayPlan {
  /** Internal (canvas) resolution in logical pixels. */
  width: number;
  height: number;
  /** Integer physical-pixel scale of one logical pixel. */
  zoom: number;
  /** CSS scale to hand to Phaser (`zoom / devicePixelRatio`). */
  cssZoom: number;
}

/**
 * Pick an internal resolution so each logical pixel maps to an *integer* number of physical
 * device pixels. This keeps pixel art perfectly crisp and keeps the framebuffer tiny (fast on phones).
 *
 * `targetH` is the wanted height of the pixel buffer; the 3D renderer varies it per graphics preset
 * (docs/OVERHAUL.md §3 "pipeline pixel"), the 2D renderer always uses `TARGET_LOGICAL_H`.
 */
export function planDisplay(cssW: number, cssH: number, dpr: number, targetH = TARGET_LOGICAL_H): DisplayPlan {
  const physW = Math.max(1, Math.round(cssW * dpr));
  const physH = Math.max(1, Math.round(cssH * dpr));
  const zoom = Math.max(1, Math.round(physH / targetH));
  const height = Math.max(120, Math.floor(physH / zoom));
  const width = Math.min(MAX_LOGICAL_W, Math.max(MIN_LOGICAL_W, Math.floor(physW / zoom)));
  return { width, height, zoom, cssZoom: zoom / dpr };
}
