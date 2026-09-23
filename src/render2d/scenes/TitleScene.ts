import Phaser from 'phaser';
import { clearSave, hasSave } from '../../core/save';
import { P } from '../../art/palette';
import { pixelText } from '../pixeltext';

interface Choice {
  label: string;
  cont: boolean;
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.BitmapText;
}

/** Title screen: glowing lantern, fireflies, "Lanjutkan" / "Main Baru". Works with touch, mouse and keyboard. */
export class TitleScene extends Phaser.Scene {
  private choices: Choice[] = [];
  private sel = 0;
  private lantern!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.Image;
  private t = 0;
  private starting = false;

  constructor() {
    super('Title');
  }

  create(): void {
    this.starting = false;
    this.choices = [];
    const w = this.scale.width;
    const h = this.scale.height;

    // night sky gradient bands
    const bands = [0x0f0b1c, 0x140f26, 0x1a1430, 0x211a3c, 0x2a2140, 0x33294c];
    bands.forEach((c, i) => this.add.rectangle(0, (h * i) / bands.length, w, h / bands.length + 1, c).setOrigin(0));
    for (let i = 0; i < 46; i++) {
      const s = this.add.image(Math.random() * w, Math.random() * h * 0.6, 'fx', 'spark_s').setAlpha(0.3 + Math.random() * 0.6);
      this.tweens.add({ targets: s, alpha: 0.1, duration: 800 + Math.random() * 1600, yoyo: true, repeat: -1, delay: Math.random() * 1000 });
    }

    // dark tree line + ground
    this.add.rectangle(0, h - 34, w, 34, 0x140f26).setOrigin(0);
    for (let x = -10; x < w + 20; x += 24) {
      const t = this.add.image(x + Math.random() * 10, h - 30, 'props', Math.random() < 0.6 ? 'tree_b' : 'tree_a').setOrigin(0.5, 0.95).setTint(0x1a1430).setScale(2);
      t.setDepth(1);
    }

    // the Great Lantern (dark, then it flickers alive)
    const lx = Math.round(w * 0.27);
    this.glow = this.add.image(lx, h - 92, 'fx', 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffb04a).setScale(5).setAlpha(0.5).setDepth(2);
    this.lantern = this.add.image(lx, h - 26, 'props', 'great_lantern_0').setOrigin(0.5, 0.95).setScale(2).setDepth(3);

    // fireflies
    this.add
      .particles(0, 0, 'fx', {
        frame: 'ember',
        x: { min: 0, max: w },
        y: { min: h * 0.45, max: h },
        speedX: { min: -8, max: 8 },
        speedY: { min: -14, max: -3 },
        lifespan: 3200,
        alpha: { start: 0, end: 0.9, ease: 'Sine.easeInOut' },
        frequency: 180,
        quantity: 1,
      })
      .setDepth(4);

    // title
    pixelText(this, Math.round(w * 0.62), 40, 'LENTERA', { color: 0xffd98a, scale: 4, origin: [0.5, 0], depth: 10 });
    pixelText(this, Math.round(w * 0.62), 40 + 44, 'MALAM', { color: 0xa795ff, scale: 4, origin: [0.5, 0], depth: 10 });
    pixelText(this, Math.round(w * 0.62), 40 + 92, 'Nyalakan kembali cahaya desa', { color: 0xd9cfff, origin: [0.5, 0], depth: 10 });

    const opts: { label: string; cont: boolean }[] = [];
    if (hasSave()) opts.push({ label: 'LANJUTKAN', cont: true });
    opts.push({ label: 'MAIN BARU', cont: false });
    opts.forEach((o, i) => {
      const y = Math.round(h * 0.6) + i * 34;
      const bg = this.add.rectangle(Math.round(w * 0.62), y, 168, 28, 0x0f0b1c, 0.85).setStrokeStyle(1, P.s4).setDepth(10).setInteractive({ useHandCursor: true });
      const text = pixelText(this, Math.round(w * 0.62), y, o.label, { color: 0xffffff, scale: 2, origin: [0.5, 0.5], depth: 11 });
      bg.on('pointerover', () => this.select(i));
      bg.on('pointerdown', () => {
        this.select(i);
        this.start(o.cont);
      });
      this.choices.push({ ...o, bg, text });
    });
    this.sel = 0;
    this.select(0);
    pixelText(this, w / 2, h - 8, 'WASD/Panah + J/K/L/E   |   Sentuh: joystick kiri, tombol kanan', { color: 0x8189a8, origin: [0.5, 1], depth: 10 });

    const kb = this.input.keyboard;
    kb?.on('keydown-UP', () => this.select(this.sel - 1));
    kb?.on('keydown-W', () => this.select(this.sel - 1));
    kb?.on('keydown-DOWN', () => this.select(this.sel + 1));
    kb?.on('keydown-S', () => this.select(this.sel + 1));
    for (const k of ['ENTER', 'SPACE', 'E', 'J']) kb?.on(`keydown-${k}`, () => this.start(this.choices[this.sel].cont));
  }

  private select(i: number): void {
    this.sel = Phaser.Math.Clamp(i, 0, this.choices.length - 1);
    this.choices.forEach((c, k) => {
      c.bg.setStrokeStyle(k === this.sel ? 2 : 1, k === this.sel ? P.y4 : P.s4);
      c.text.setTint(k === this.sel ? 0xffe066 : 0xffffff);
    });
  }

  private start(cont: boolean): void {
    if (this.starting) return;
    this.starting = true;
    if (!cont) clearSave();
    this.cameras.main.fadeOut(350, 8, 4, 16);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Game', { continue: cont }));
  }

  override update(_t: number, dtMs: number): void {
    this.t += dtMs / 1000;
    const f = Math.floor(this.t * 6) % 3;
    this.lantern.setFrame(`great_lantern_${f}`);
    this.glow.setAlpha(0.42 + Math.sin(this.t * 3) * 0.08 + (f === 1 ? 0.05 : 0));
  }
}
