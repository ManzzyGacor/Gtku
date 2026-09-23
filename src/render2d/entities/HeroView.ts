import Phaser from 'phaser';
import { Animator } from '../../core/anim';
import { frameOf } from '../register';
import { HeroCore } from '../../core/entities/HeroCore';

const CLIP_FPS = { idle: 2.2, walk: 9.5 };

/** Phaser presentation of the hero: picks frames from the core state, squash & stretch, blink, flash. */
export class HeroView {
  readonly sprite: Phaser.GameObjects.Image;
  private anim = new Animator();
  private sx = 1;
  private sy = 1;
  private flashT = 0;
  private lastState = '';

  constructor(
    scene: Phaser.Scene,
    private readonly core: HeroCore,
  ) {
    const f = frameOf('hero', 'hero_d_idle_0');
    this.sprite = scene.add.image(core.x, core.y, 'hero', 'hero_d_idle_0').setOrigin(0.5, (f.ay ?? 29) / f.h);
  }

  squash(sx: number, sy: number): void {
    this.sx = sx;
    this.sy = sy;
  }

  flash(t = 0.09): void {
    this.flashT = t;
  }

  /** `dt` is sim time (frozen during hit-stop), `realDt` keeps springs/blink alive. */
  update(dt: number, realDt: number, time: number): void {
    const c = this.core;
    const { dir, flip } = HeroCore.dirOf(c.aim);
    let frame: string;

    switch (c.state) {
      case 'attack':
        frame = `hero_${dir}_a${c.combo + 1}_${c.attackPhase}`;
        break;
      case 'roll':
        frame = `hero_roll_${Math.floor(c.stateT * 14) % 4}`;
        break;
      case 'hurt':
        frame = `hero_${dir}_hurt_0`;
        break;
      case 'cast':
        frame = `hero_cast_${c.stateT > 0.18 ? 1 : 0}`;
        break;
      case 'dead':
        frame = 'hero_dead';
        break;
      default: {
        const speed = Math.hypot(c.vx, c.vy);
        if (speed > 14) {
          this.anim.play(`walk_${dir}`, { frames: [0, 1, 2, 3].map((i) => `hero_${dir}_walk_${i}`), fps: CLIP_FPS.walk, loop: true });
          this.anim.update(dt * Math.min(1.3, speed / 70));
        } else {
          this.anim.play(`idle_${dir}`, { frames: [0, 1].map((i) => `hero_${dir}_idle_${i}`), fps: CLIP_FPS.idle, loop: true });
          this.anim.update(dt);
        }
        frame = this.anim.frame;
      }
    }

    if (c.state !== this.lastState) {
      // squash/stretch on state changes
      if (c.state === 'attack') this.squash(1.14, 0.9);
      else if (c.state === 'roll') this.squash(1.2, 0.78);
      else if (c.state === 'hurt') this.squash(0.82, 1.22);
      else if (c.state === 'cast') this.squash(0.9, 1.15);
      else if (this.lastState === 'roll') this.squash(1.12, 0.86);
      this.lastState = c.state;
    }

    const k = Math.min(1, realDt * 16);
    this.sx += (1 - this.sx) * k;
    this.sy += (1 - this.sy) * k;
    const s = this.sprite;
    s.setFrame(frame);
    s.setFlipX(flip);
    s.setPosition(Math.round(c.x), Math.round(c.y));
    s.setDepth(c.y);
    s.setScale(this.sx, this.sy);

    this.flashT = Math.max(0, this.flashT - realDt);
    if (this.flashT > 0) s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else s.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
    s.setAlpha(c.invuln > 0 && c.alive && !c.rolling && Math.floor(time * 20) % 2 === 0 ? 0.4 : 1);
  }

  get frameName(): string {
    return String(this.sprite.frame.name);
  }
}
