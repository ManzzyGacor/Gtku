/** Bridges the pure art pipeline to Phaser textures. */
import Phaser from 'phaser';
import { FONT_LINE_H, FONT_SHEET_KEY, SPACE_W } from './font';
import type { FrameRect, Sheet } from './sheet';

/** All sheets by key, for anchor lookups (`frameOf`). */
export const sheets = new Map<string, Sheet>();

export function frameOf(sheetKey: string, name: string): FrameRect {
  const f = sheets.get(sheetKey)?.frames[name];
  if (!f) throw new Error(`Unknown frame ${sheetKey}/${name}`);
  return f;
}

export function hasFrame(sheetKey: string, name: string): boolean {
  return !!sheets.get(sheetKey)?.frames[name];
}

export function sheetToCanvas(sheet: Sheet): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sheet.pixmap.w;
  canvas.height = sheet.pixmap.h;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(sheet.pixmap.data), sheet.pixmap.w, sheet.pixmap.h), 0, 0);
  return canvas;
}

export function registerSheet(scene: Phaser.Scene, sheet: Sheet): void {
  sheets.set(sheet.key, sheet);
  const tex = scene.textures.addCanvas(sheet.key, sheetToCanvas(sheet));
  if (!tex) throw new Error(`Texture ${sheet.key} already exists`);
  for (const [name, f] of Object.entries(sheet.frames)) tex.add(name, 0, f.x, f.y, f.w, f.h);
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Replace a sheet's pixels with a hand-drawn PNG (same layout). Used by the override mechanism. */
export function replaceSheetPixels(scene: Phaser.Scene, key: string, image: CanvasImageSource): void {
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage() as HTMLCanvasElement;
  const ctx = src.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, src.width, src.height);
  ctx.drawImage(image, 0, 0);
  (tex as Phaser.Textures.CanvasTexture).refresh?.();
}

/** Register the baked pixel font with Phaser's bitmap-font cache under key "pix". */
export function registerFont(scene: Phaser.Scene, sheet: Sheet): void {
  const W = sheet.pixmap.w;
  const H = sheet.pixmap.h;
  const chars: Record<number, unknown> = {};
  for (const [name, f] of Object.entries(sheet.frames)) {
    const code = Number(name.slice(1));
    chars[code] = {
      x: f.x,
      y: f.y,
      width: f.w,
      height: f.h,
      centerX: Math.floor(f.w / 2),
      centerY: Math.floor(f.h / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: f.w,
      data: {},
      kerning: {},
      u0: f.x / W,
      v0: 1 - f.y / H,
      u1: (f.x + f.w) / W,
      v1: 1 - (f.y + f.h) / H,
    };
  }
  chars[32] = { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0, xOffset: 0, yOffset: 0, xAdvance: SPACE_W, data: {}, kerning: {}, u0: 0, v0: 1, u1: 0, v1: 1 };
  scene.cache.bitmapFont.add('pix', {
    data: { font: 'pix', size: FONT_LINE_H - 1, lineHeight: FONT_LINE_H, chars },
    texture: FONT_SHEET_KEY,
    frame: null,
  } as never);
}
