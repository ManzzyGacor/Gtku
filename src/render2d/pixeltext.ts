import Phaser from 'phaser';

/** Create a crisp bitmap text with the baked pixel font (white glyphs, tint to colour). */
export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { color?: number; scale?: number; origin?: [number, number]; depth?: number; scroll?: boolean } = {},
): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(x, y, 'pix', text);
  t.setTint(opts.color ?? 0xffffff);
  t.setScale(opts.scale ?? 1);
  const o = opts.origin ?? [0, 0];
  t.setOrigin(o[0], o[1]);
  if (opts.depth !== undefined) t.setDepth(opts.depth);
  if (opts.scroll === false) t.setScrollFactor(0);
  return t;
}
