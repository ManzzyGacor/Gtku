/**
 * Draw a `Pixmap` from the art pipeline into a canvas the overlay UI can show.
 *
 * This is how the dialogue portraits and the minimap get real pixel art without the UI layer
 * knowing anything about a renderer: the art pipeline is pure, so it works the same whether
 * Phaser, Three.js or nothing at all is running underneath.
 */
import type { Pixmap } from '../art/pixmap';

export function pixmapToCanvas(pm: Pixmap, zoom = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, pm.w * zoom);
  canvas.height = Math.max(1, pm.h * zoom);
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  if (zoom === 1) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pm.data), pm.w, pm.h), 0, 0);
    return canvas;
  }
  // Scale by hand rather than via drawImage: nearest-neighbour is not guaranteed across browsers.
  const out = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const sy = Math.floor(y / zoom);
    for (let x = 0; x < canvas.width; x++) {
      const sx = Math.floor(x / zoom);
      const si = (sy * pm.w + sx) * 4;
      const di = (y * canvas.width + x) * 4;
      out.data[di] = pm.data[si];
      out.data[di + 1] = pm.data[si + 1];
      out.data[di + 2] = pm.data[si + 2];
      out.data[di + 3] = pm.data[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
