import Phaser from 'phaser';
import { frameOf } from '../art/register';
import { HeroCore } from './HeroCore';
import { Archer, Bat, Boss, EnemyCore, Slime } from './enemies';
import { pixelText } from '../ui/pixeltext';

const ANCHOR: Record<string, string> = { slime: 'slime_idle_0', archer: 'archer_d_idle_0', bat: 'bat_0', boss: 'boss_idle_0' };

/** Phaser presentation for one enemy core: frame selection, hover, telegraph blink, hit flash, death fade. */
export class EnemyView {
  readonly sprite: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Image | null = null;
  private mark: Phaser.GameObjects.BitmapText | null = null;
  private teleT = 0;
  teleKind = '';
  teleDur = 1;
  private t = Math.random() * 10;
  private sx = 1;
  private sy = 1;
  private lastState = '';

  constructor(
    private readonly scene: Phaser.Scene,
    readonly core: EnemyCore,
  ) {
    const name = ANCHOR[core.kind];
    const f = frameOf('enemies', name);
    this.sprite = scene.add.image(core.x, core.y, 'enemies', name).setOrigin((f.ax ?? f.w / 2) / f.w, (f.ay ?? f.h) / f.h);
    if (core.kind === 'bat') this.shadow = scene.add.image(core.x, core.y, 'fx', 'shadow_s').setDepth(1).setAlpha(0.8);
  }

  telegraph(kind: string, dur: number): void {
    this.teleKind = kind;
    this.teleDur = dur;
    this.teleT = dur;
    if (!this.mark) this.mark = pixelText(this.scene, 0, 0, '!', { color: 0xff5a4a, origin: [0.5, 1], scale: 2, depth: 5200 });
    this.mark.setVisible(true);
  }

  /** 0..1 progress of the running telegraph (0 = just started). */
  get teleProgress(): number {
    return this.teleT > 0 ? 1 - this.teleT / this.teleDur : 0;
  }

  get telegraphing(): boolean {
    return this.teleT > 0;
  }

  squash(sx: number, sy: number): void {
    this.sx = sx;
    this.sy = sy;
  }

  update(dt: number, realDt: number): void {
    const c = this.core;
    this.t += dt;
    let frame = '';
    let lift = 0;
    let flip = false;
    let scaleX = 1;
    let scaleY = 1;

    if (c instanceof Slime) {
      if (c.state === 'windup') {
        frame = 'slime_atk_0';
        scaleX = 1 + Math.sin(this.t * 60) * 0.04;
      } else if (c.state === 'lunge') frame = 'slime_atk_1';
      else if (c.state === 'recover') frame = 'slime_hop_0';
      else if (c.hopPhase === 1) {
        frame = 'slime_hop_1';
        lift = Math.sin(Math.min(1, (c.stateT % 0.7) / 0.34) * Math.PI) * 3;
      } else if (c.hopPhase === 2) frame = 'slime_hop_2';
      else frame = Math.floor(this.t * 2.2) % 2 ? 'slime_idle_1' : 'slime_idle_0';
      flip = Math.cos(c.facing) < 0;
    } else if (c instanceof Archer) {
      const { dir, flip: fl } = HeroCore.dirOf(c.facing);
      const d = dir === 's' ? 's' : 'd';
      flip = fl;
      if (c.state === 'aim') frame = `archer_${d}_aim_${c.stateT > 0.3 ? 1 : 0}`;
      else if (Math.hypot(c.wx, c.wy) > 8) frame = `archer_${d}_walk_${Math.floor(this.t * 6) % 2}`;
      else frame = `archer_${d}_idle_${Math.floor(this.t * 2) % 2}`;
    } else if (c instanceof Bat) {
      frame = c.state === 'dive' ? 'bat_dive' : `bat_${[0, 1, 2, 1][Math.floor(this.t * 11) % 4]}`;
      lift = 14 + Math.sin(this.t * 4 + c.angle) * 2;
      flip = Math.cos(c.facing) < 0 && c.state === 'dive';
    } else if (c instanceof Boss) {
      switch (c.pose) {
        case 'slam-up':
          frame = 'boss_slam_0';
          break;
        case 'slam-down':
          frame = 'boss_slam_1';
          break;
        case 'cast':
          frame = 'boss_cast_0';
          break;
        case 'hurt':
          frame = 'boss_hurt';
          break;
        default:
          frame = Math.floor(this.t * 1.6) % 2 ? 'boss_idle_1' : 'boss_idle_0';
      }
    }

    if (c.state !== this.lastState) {
      if (c.kind === 'slime' && c.state === 'lunge') this.squash(1.2, 0.85);
      this.lastState = c.state;
    }
    const k = Math.min(1, realDt * 14);
    this.sx += (1 - this.sx) * k;
    this.sy += (1 - this.sy) * k;

    const s = this.sprite;
    s.setFrame(frame);
    s.setFlipX(flip);
    s.setPosition(Math.round(c.x), Math.round(c.y - lift));
    s.setDepth(c.kind === 'bat' ? c.y + 30 : c.y);
    let alpha = 1;
    if (c.dead) {
      const p = Math.min(1, c.deathT / 0.45);
      alpha = 1 - p;
      scaleX *= 1 + p * 0.25;
      scaleY *= 1 - p * 0.6;
    }
    s.setScale(this.sx * scaleX, this.sy * scaleY);
    s.setAlpha(alpha);

    // hit flash + telegraph blink
    this.teleT = Math.max(0, this.teleT - realDt);
    const blink = this.teleT > 0 && Math.floor(this.teleT * 14) % 2 === 0;
    if (c.flash > 0) s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else if (blink) s.setTint(0xff6a5a).setTintMode(Phaser.TintModes.FILL);
    else s.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();

    if (this.mark) {
      const show = this.teleT > 0 && !c.dead;
      this.mark.setVisible(show);
      if (show) this.mark.setPosition(Math.round(c.x), Math.round(c.y - c.h - lift - 6 - Math.sin(this.t * 20) * 1.5));
    }
    if (this.shadow) {
      this.shadow.setPosition(Math.round(c.x), Math.round(c.y));
      this.shadow.setAlpha(c.dead ? 0 : 0.75);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow?.destroy();
    this.mark?.destroy();
  }
}
