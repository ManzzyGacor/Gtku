import { Pixmap } from './pixmap';

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor inside the frame (px from the frame's top-left), used as sprite origin. Defaults to centre. */
  ax?: number;
  ay?: number;
}

export interface Sheet {
  key: string;
  pixmap: Pixmap;
  frames: Record<string, FrameRect>;
}

/** Simple shelf packer that turns many small pixmaps into one atlas with named frames. */
export class SheetBuilder {
  private items: { name: string; pm: Pixmap; ax?: number; ay?: number }[] = [];

  constructor(
    readonly key: string,
    private readonly width: number,
    private readonly pad = 1,
  ) {}

  add(name: string, pm: Pixmap, ax?: number, ay?: number): this {
    if (this.items.some((i) => i.name === name)) throw new Error(`Duplicate frame "${name}" in sheet "${this.key}"`);
    this.items.push({ name, pm, ax, ay });
    return this;
  }

  build(): Sheet {
    const frames: Record<string, FrameRect> = {};
    let x = this.pad;
    let y = this.pad;
    let rowH = 0;
    const placed: { pm: Pixmap; x: number; y: number }[] = [];
    for (const it of this.items) {
      if (x + it.pm.w + this.pad > this.width) {
        x = this.pad;
        y += rowH + this.pad;
        rowH = 0;
      }
      if (it.pm.w + this.pad * 2 > this.width) throw new Error(`Frame "${it.name}" wider than sheet ${this.key}`);
      frames[it.name] = { x, y, w: it.pm.w, h: it.pm.h, ax: it.ax, ay: it.ay };
      placed.push({ pm: it.pm, x, y });
      x += it.pm.w + this.pad;
      rowH = Math.max(rowH, it.pm.h);
    }
    const height = y + rowH + this.pad;
    const pixmap = new Pixmap(this.width, height);
    for (const p of placed) pixmap.blit(p.pm, p.x, p.y);
    return { key: this.key, pixmap, frames };
  }
}
