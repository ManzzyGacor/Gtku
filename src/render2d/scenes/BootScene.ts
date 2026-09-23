import Phaser from 'phaser';
import { buildAllSheets } from '../../art';
import { FONT_SHEET_KEY } from '../../art/font';
import { registerFont, registerSheet, replaceSheetPixels } from '../register';

/** Builds all generated art, applies optional hand-drawn overrides, then starts the game. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.json('override-manifest', 'assets/override/manifest.json');
  }

  create(): void {
    const sheets = buildAllSheets();
    for (const s of sheets) registerSheet(this, s);
    const font = sheets.find((s) => s.key === FONT_SHEET_KEY)!;
    registerFont(this, font);

    const manifest = this.cache.json.get('override-manifest') as { sheets?: string[] } | undefined;
    const overrides = (manifest?.sheets ?? []).filter((k) => sheets.some((s) => s.key === k));
    if (overrides.length === 0) {
      this.finish();
      return;
    }
    for (const k of overrides) this.load.image(`override-${k}`, `assets/override/${k}.png`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      for (const k of overrides) {
        if (this.textures.exists(`override-${k}`)) replaceSheetPixels(this, k, this.textures.get(`override-${k}`).getSourceImage() as HTMLImageElement);
      }
      this.finish();
    });
    this.load.start();
  }

  private finish(): void {
    document.getElementById('boot-msg')?.remove();
    this.scene.start('Title');
  }
}
