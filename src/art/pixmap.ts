/**
 * Pixmap: a tiny RGBA raster with pixel-art drawing primitives. No DOM, no Phaser — runs in Node too,
 * which lets us export PNG previews and unit-test art. Colors are 0xRRGGBB integers.
 */

export type Color = number;

export const r8 = (c: Color): number => (c >> 16) & 255;
export const g8 = (c: Color): number => (c >> 8) & 255;
export const b8 = (c: Color): number => c & 255;
export const rgb = (r: number, g: number, b: number): Color =>
  ((Math.max(0, Math.min(255, Math.round(r))) << 16) |
    (Math.max(0, Math.min(255, Math.round(g))) << 8) |
    Math.max(0, Math.min(255, Math.round(b)))) >>>
  0;

export function mix(a: Color, b: Color, t: number): Color {
  return rgb(r8(a) + (r8(b) - r8(a)) * t, g8(a) + (g8(b) - g8(a)) * t, b8(a) + (b8(b) - b8(a)) * t);
}

export interface BlitOpts {
  flipX?: boolean;
  flipY?: boolean;
  /** 0..1 multiplier on source alpha. */
  alpha?: number;
  /** Optional per-pixel recolor. Return a new color. */
  map?: (c: Color, x: number, y: number) => Color;
}

export class Pixmap {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  clone(): Pixmap {
    const p = new Pixmap(this.w, this.h);
    p.data.set(this.data);
    return p;
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Set a pixel. Alpha < 255 composites over the existing pixel ("over" operator). */
  set(x: number, y: number, c: Color, a = 255): this {
    x |= 0;
    y |= 0;
    if (!this.inb(x, y) || a <= 0) return this;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    if (a >= 255 || d[i + 3] === 0) {
      d[i] = r8(c);
      d[i + 1] = g8(c);
      d[i + 2] = b8(c);
      d[i + 3] = a;
      return this;
    }
    const sa = a / 255;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    d[i] = (r8(c) * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (g8(c) * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (b8(c) * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
    return this;
  }

  /** Read pixel as [color, alpha]. Out of bounds → alpha 0. */
  get(x: number, y: number): [Color, number] {
    if (!this.inb(x, y)) return [0, 0];
    const i = (y * this.w + x) * 4;
    const d = this.data;
    return [rgb(d[i], d[i + 1], d[i + 2]), d[i + 3]];
  }

  alphaAt(x: number, y: number): number {
    return this.inb(x, y) ? this.data[(y * this.w + x) * 4 + 3] : 0;
  }

  colorAt(x: number, y: number): Color {
    return this.get(x, y)[0];
  }

  rect(x: number, y: number, w: number, h: number, c: Color, a = 255): this {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, c, a);
    return this;
  }

  frame(x: number, y: number, w: number, h: number, c: Color, a = 255): this {
    this.hline(x, y, w, c, a);
    this.hline(x, y + h - 1, w, c, a);
    this.vline(x, y + 1, h - 2, c, a);
    this.vline(x + w - 1, y + 1, h - 2, c, a);
    return this;
  }

  hline(x: number, y: number, len: number, c: Color, a = 255): this {
    for (let i = 0; i < len; i++) this.set(x + i, y, c, a);
    return this;
  }

  vline(x: number, y: number, len: number, c: Color, a = 255): this {
    for (let i = 0; i < len; i++) this.set(x, y + i, c, a);
    return this;
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: Color, a = 255): this {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Filled ellipse centered on pixel-space (cx, cy) (may be fractional, e.g. 7.5). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color, a = 255): this {
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c, a);
      }
    }
    return this;
  }

  /** Filled triangle. */
  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Color, a = 255): this {
    const minX = Math.floor(Math.min(x0, x1, x2));
    const maxX = Math.ceil(Math.max(x0, x1, x2));
    const minY = Math.floor(Math.min(y0, y1, y2));
    const maxY = Math.ceil(Math.max(y0, y1, y2));
    const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number =>
      (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = edge(x1, y1, x2, y2, px, py);
        const w1 = edge(x2, y2, x0, y0, px, py);
        const w2 = edge(x0, y0, x1, y1, px, py);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) this.set(x, y, c, a);
      }
    }
    return this;
  }

  /** Copy `src` (or a sub-rect) into this pixmap, compositing over. */
  blit(src: Pixmap, dx: number, dy: number, opts: BlitOpts = {}, sx = 0, sy = 0, sw = src.w, sh = src.h): this {
    const alpha = opts.alpha ?? 1;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const px = opts.flipX ? sx + sw - 1 - x : sx + x;
        const py = opts.flipY ? sy + sh - 1 - y : sy + y;
        const i = (py * src.w + px) * 4;
        const a = src.data[i + 3];
        if (a === 0) continue;
        let c = rgb(src.data[i], src.data[i + 1], src.data[i + 2]);
        if (opts.map) c = opts.map(c, x, y);
        this.set(dx + x, dy + y, c, a * alpha);
      }
    }
    return this;
  }

  /** Copy a sub-rectangle into a fresh pixmap. */
  sub(x: number, y: number, w: number, h: number): Pixmap {
    const p = new Pixmap(w, h);
    p.blit(this, 0, 0, {}, x, y, w, h);
    return p;
  }

  /**
   * Add a 1px outline around opaque pixels. `color` may be a fixed color or a function of the neighbouring
   * (inside) pixel color, which lets us make "selective" colored outlines.
   */
  outline(color: Color | ((inner: Color) => Color), diagonals = false): this {
    const src = this.clone();
    for (let y = -1; y <= this.h; y++) {
      for (let x = -1; x <= this.w; x++) {
        if (src.alphaAt(x, y) > 0) continue;
        let inner = -1;
        const ns: [number, number][] = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        if (diagonals)
          ns.push([x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]);
        for (const [nx, ny] of ns) {
          if (src.alphaAt(nx, ny) > 128) {
            inner = src.colorAt(nx, ny);
            break;
          }
        }
        if (inner >= 0) this.set(x, y, typeof color === 'function' ? color(inner) : color);
      }
    }
    return this;
  }

  /** Recolor every non-transparent pixel. */
  mapColors(fn: (c: Color, x: number, y: number) => Color): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (this.data[i + 3] === 0) continue;
        const c = fn(rgb(this.data[i], this.data[i + 1], this.data[i + 2]), x, y);
        this.data[i] = r8(c);
        this.data[i + 1] = g8(c);
        this.data[i + 2] = b8(c);
      }
    }
    return this;
  }

  /** Set every opaque pixel to `c` keeping alpha (silhouette / hit-flash). */
  silhouette(c: Color): Pixmap {
    return this.clone().mapColors(() => c);
  }

  /** Multiply alpha of the whole map. */
  fade(a: number): this {
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = this.data[i] * a;
    return this;
  }

  /** Bounding box of non-transparent pixels, or null. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.data[(y * this.w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}
