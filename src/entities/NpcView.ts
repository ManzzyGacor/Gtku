import Phaser from 'phaser';
import { frameOf } from '../art/register';
import { HeroCore } from './HeroCore';
import { pixelText } from '../ui/pixeltext';
import type { NpcDef } from '../world/source';

/** A standing NPC: idle animation, turns toward the hero when near, optional quest marker. */
export class NpcView {
  readonly sprite: Phaser.GameObjects.Image;
  private mark: Phaser.GameObjects.BitmapText;
  private t = Math.random() * 5;
  private dir: 'd' | 'u' | 's' = 'd';
  private flip = false;
  markerText = '';

  constructor(
    scene: Phaser.Scene,
    readonly def: NpcDef,
  ) {
    const name = `${def.look}_d_0`;
    const f = frameOf('npc', name);
    this.sprite = scene.add.image(def.x, def.y, 'npc', name).setOrigin((f.ax ?? 16) / f.w, (f.ay ?? 29) / f.h).setDepth(def.y);
    this.mark = pixelText(scene, def.x, def.y - 40, '', { color: 0xffd15a, origin: [0.5, 1], scale: 2, depth: 5200 });
  }

  update(dt: number, hero: { x: number; y: number }): void {
    this.t += dt;
    const dx = hero.x - this.def.x;
    const dy = hero.y - this.def.y;
    if (Math.hypot(dx, dy) < 64) {
      const { dir, flip } = HeroCore.dirOf(Math.atan2(dy, dx));
      this.dir = dir;
      this.flip = flip;
    }
    this.sprite.setFrame(`${this.def.look}_${this.dir}_${Math.floor(this.t * 1.8) % 2}`);
    this.sprite.setFlipX(this.flip);
    this.mark.setText(this.markerText);
    this.mark.setPosition(this.def.x, this.def.y - (this.def.look === 'kid' ? 30 : 34) + Math.sin(this.t * 5) * 2);
    this.mark.setVisible(this.markerText !== '');
  }

  destroy(): void {
    this.sprite.destroy();
    this.mark.destroy();
  }
}
