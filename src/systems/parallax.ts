/**
 * Screen-space parallax layers that tile infinitely: forest canopy (closer than the ground → moves faster),
 * drifting cloud shadows (daytime, outdoors) and floating cave motes. Cheap: a few dozen pooled images.
 */
import Phaser from 'phaser';
import { makeRng } from '../core/rng';

interface Item {
  img: Phaser.GameObjects.Image;
  u: number;
  v: number;
  speed: number;
  bob: number;
}

interface Layer {
  items: Item[];
  factor: number;
  wrapW: number;
  wrapH: number;
  alpha: number;
  drift: number;
}

export class Parallax {
  private canopy: Layer;
  private clouds: Layer;
  private motes: Layer;
  private a = { canopy: 0, clouds: 0, motes: 0 };

  constructor(private readonly scene: Phaser.Scene) {
    const rng = makeRng(77);
    const mk = (n: number, frames: string[], depth: number, factor: number, wrapW: number, wrapH: number, alpha: number, drift: number, tint?: number, blend?: number): Layer => {
      const items: Item[] = [];
      for (let i = 0; i < n; i++) {
        const img = scene.add.image(0, 0, 'fx', frames[i % frames.length]).setScrollFactor(0).setDepth(depth).setAlpha(0).setVisible(false);
        if (tint !== undefined) img.setTint(tint);
        if (blend !== undefined) img.setBlendMode(blend);
        items.push({ img, u: rng() * wrapW, v: rng() * wrapH, speed: 0.6 + rng() * 0.8, bob: rng() * 6 });
      }
      return { items, factor, wrapW, wrapH, alpha, drift };
    };
    // canopy: above entities (depth 4800) but below the lightmap
    this.canopy = mk(9, ['canopy_0', 'canopy_1'], 4800, 1.45, 780, 520, 0.34, 0);
    this.clouds = mk(6, ['cloud'], 4790, 1.0, 900, 620, 0.16, 9);
    this.motes = mk(22, ['spark_s'], 4795, 1.2, 420, 300, 0.5, 0, 0xa795ff, Phaser.BlendModes.ADD);
  }

  private setLayer(l: Layer, scrollX: number, scrollY: number, time: number, amount: number, viewW: number, viewH: number): void {
    const show = amount > 0.01;
    for (const it of l.items) {
      if (!show) {
        it.img.setVisible(false);
        continue;
      }
      // position in "layer space" scrolls at `factor` relative to the camera
      const wx = it.u + time * l.drift * it.speed - scrollX * l.factor;
      const wy = it.v + Math.sin(time * 0.5 + it.bob) * 2 - scrollY * l.factor;
      const x = ((wx % l.wrapW) + l.wrapW) % l.wrapW - 120;
      const y = ((wy % l.wrapH) + l.wrapH) % l.wrapH - 100;
      if (x > viewW + 80 || y > viewH + 80) {
        it.img.setVisible(false);
        continue;
      }
      it.img.setVisible(true);
      it.img.setPosition(Math.round(x), Math.round(y));
      it.img.setAlpha(l.alpha * amount);
    }
  }

  /** `forest`, `outdoor` (daylight), `cave` are 0..1 weights. */
  update(scrollX: number, scrollY: number, time: number, forest: number, dayOutdoor: number, cave: number): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const k = 0.08;
    this.a.canopy += (forest - this.a.canopy) * k;
    this.a.clouds += (dayOutdoor - this.a.clouds) * k;
    this.a.motes += (cave - this.a.motes) * k;
    this.setLayer(this.canopy, scrollX, scrollY, time, this.a.canopy, w, h);
    this.setLayer(this.clouds, scrollX, scrollY, time, this.a.clouds, w, h);
    this.setLayer(this.motes, scrollX, scrollY, time, this.a.motes, w, h);
  }

  destroy(): void {
    for (const l of [this.canopy, this.clouds, this.motes]) for (const it of l.items) it.img.destroy();
  }
}
