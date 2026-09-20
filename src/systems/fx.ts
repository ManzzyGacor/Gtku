/** Visual effects: particles, slash arcs, flipbooks, damage numbers, ground rings. Pooled; no per-frame allocation in hot paths. */
import Phaser from 'phaser';
import { pixelText } from '../ui/pixeltext';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

interface Flip {
  img: Phaser.GameObjects.Image;
  t: number;
  frames: string[];
  fps: number;
  vx: number;
  vy: number;
}

interface Num {
  text: Phaser.GameObjects.BitmapText;
  life: number;
  max: number;
  vy: number;
}

export const FX_DEPTH = 4000;

/** Quality knob: scales particle counts (adaptive quality lowers it when FPS drops). */
export class Fx {
  quality = 1;
  private sparkY: Emitter;
  private sparkC: Emitter;
  private sparkV: Emitter;
  private goo: Emitter;
  private dustL: Emitter;
  private dustD: Emitter;
  private leaves: Emitter;
  private drops: Emitter;
  private embers: Emitter;
  private smoke: Emitter;
  private flips: Flip[] = [];
  private nums: Num[] = [];
  readonly gfx: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    const mk = (cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig): Emitter =>
      scene.add.particles(0, 0, 'fx', { emitting: false, ...cfg }).setDepth(FX_DEPTH);
    this.sparkY = mk({ frame: ['spark_s', 'spark_m'], speed: { min: 40, max: 130 }, angle: { min: 0, max: 360 }, lifespan: { min: 180, max: 340 }, alpha: { start: 1, end: 0 }, gravityY: 90 });
    this.sparkC = mk({ frame: ['spark_c', 'spark_s'], speed: { min: 30, max: 110 }, angle: { min: 0, max: 360 }, lifespan: { min: 220, max: 420 }, alpha: { start: 1, end: 0 } });
    this.sparkV = mk({ frame: ['spark_v', 'spark_s'], speed: { min: 30, max: 140 }, angle: { min: 0, max: 360 }, lifespan: { min: 260, max: 520 }, alpha: { start: 1, end: 0 } });
    this.goo = mk({ frame: ['leaf_g', 'drop'], speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 }, lifespan: { min: 240, max: 420 }, alpha: { start: 1, end: 0 }, gravityY: 160 });
    this.dustL = mk({ frame: ['dust'], speed: { min: 6, max: 26 }, angle: { min: 0, max: 360 }, lifespan: { min: 260, max: 460 }, alpha: { start: 0.7, end: 0 } });
    this.dustD = mk({ frame: ['dust_dark'], speed: { min: 6, max: 26 }, angle: { min: 0, max: 360 }, lifespan: { min: 260, max: 460 }, alpha: { start: 0.7, end: 0 } });
    this.leaves = mk({ frame: ['leaf_g', 'leaf_o'], speed: { min: 14, max: 44 }, angle: { min: 200, max: 340 }, lifespan: { min: 380, max: 700 }, alpha: { start: 1, end: 0 }, gravityY: 70 });
    this.drops = mk({ frame: ['drop'], speed: { min: 30, max: 70 }, angle: { min: 230, max: 310 }, lifespan: { min: 300, max: 480 }, alpha: { start: 1, end: 0 }, gravityY: 240 });
    this.embers = mk({ frame: ['ember', 'spark_s'], speed: { min: 6, max: 20 }, angle: { min: 250, max: 290 }, lifespan: { min: 500, max: 900 }, alpha: { start: 1, end: 0 } });
    this.smoke = mk({ frame: ['smoke'], speed: { min: 6, max: 24 }, angle: { min: 240, max: 300 }, lifespan: { min: 500, max: 800 }, alpha: { start: 0.55, end: 0 } });
    this.gfx = scene.add.graphics().setDepth(FX_DEPTH - 1);
  }

  private n(count: number): number {
    return Math.max(1, Math.round(count * this.quality));
  }

  // ── bursts ──
  hitSpark(x: number, y: number): void {
    this.sparkY.explode(this.n(7), x, y);
    this.flipbook(x, y, ['burst_0', 'burst_1', 'burst_2'], 26);
  }
  gooBurst(x: number, y: number, n = 8): void {
    this.goo.explode(this.n(n), x, y);
  }
  cyanBurst(x: number, y: number, n = 12): void {
    this.sparkC.explode(this.n(n), x, y);
  }
  violetBurst(x: number, y: number, n = 12): void {
    this.sparkV.explode(this.n(n), x, y);
  }
  goldBurst(x: number, y: number, n = 16): void {
    this.sparkY.explode(this.n(n), x, y);
  }
  smokePuff(x: number, y: number, n = 6): void {
    this.smoke.explode(this.n(n), x, y);
  }
  emberAt(x: number, y: number): void {
    this.embers.explode(1, x, y);
  }

  /** Footstep / roll dust by surface. */
  step(x: number, y: number, surface: string, n = 2): void {
    switch (surface) {
      case 'grass':
        this.leaves.explode(this.n(1), x, y - 2);
        this.dustD.explode(this.n(1), x, y);
        break;
      case 'water':
        this.drops.explode(this.n(3), x, y - 1);
        break;
      case 'dirt':
        this.dustD.explode(this.n(n), x, y);
        break;
      case 'wood':
        this.dustL.explode(this.n(1), x, y);
        break;
      default:
        this.dustL.explode(this.n(n), x, y);
    }
  }

  rollDust(x: number, y: number, surface: string): void {
    this.step(x, y, surface, 5);
    this.step(x, y, surface, 3);
  }

  leafFall(x: number, y: number): void {
    this.leaves.explode(1, x, y);
  }

  // ── slash ──
  slash(x: number, y: number, angle: number, combo: number): void {
    const img = this.scene.add.image(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6, 'fx', 'slash_0').setDepth(FX_DEPTH + 1);
    img.setRotation(angle);
    if (combo === 1) img.setFlipY(true);
    if (combo === 2) img.setScale(1.28);
    this.flips.push({ img, t: 0, frames: ['slash_0', 'slash_1', 'slash_2'], fps: 17, vx: Math.cos(angle) * 22, vy: Math.sin(angle) * 22 });
  }

  private flipbook(x: number, y: number, frames: string[], fps: number): void {
    const img = this.scene.add.image(x, y, 'fx', frames[0]).setDepth(FX_DEPTH + 1);
    this.flips.push({ img, t: 0, frames, fps, vx: 0, vy: 0 });
  }

  /** Expanding additive glow (skill blast, phase change). */
  glowPulse(x: number, y: number, radius: number, color: number, ms = 380, alpha = 0.9): void {
    const img = this.scene.add.image(x, y, 'fx', 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setDepth(FX_DEPTH + 2).setAlpha(alpha);
    const s1 = (radius * 2) / 64;
    img.setScale(s1 * 0.35);
    this.scene.tweens.add({ targets: img, scale: s1, alpha: 0, duration: ms, ease: 'Cubic.easeOut', onComplete: () => img.destroy() });
  }

  // ── damage numbers ──
  number(x: number, y: number, text: string, color = 0xffffff, scale = 1): void {
    const t = pixelText(this.scene, Math.round(x), Math.round(y), text, { color, scale, origin: [0.5, 1], depth: FX_DEPTH + 5 });
    this.nums.push({ text: t, life: 0.75, max: 0.75, vy: -34 });
    if (this.nums.length > 24) {
      const o = this.nums.shift()!;
      o.text.destroy();
    }
  }

  // ── per-frame ──
  update(dt: number): void {
    for (let i = this.flips.length - 1; i >= 0; i--) {
      const f = this.flips[i];
      f.t += dt;
      const idx = Math.floor(f.t * f.fps);
      if (idx >= f.frames.length) {
        f.img.destroy();
        this.flips.splice(i, 1);
        continue;
      }
      f.img.setFrame(f.frames[idx]);
      f.img.x += f.vx * dt;
      f.img.y += f.vy * dt;
      f.vx *= 0.9;
      f.vy *= 0.9;
    }
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.life -= dt;
      if (n.life <= 0) {
        n.text.destroy();
        this.nums.splice(i, 1);
        continue;
      }
      n.vy *= 1 - Math.min(1, dt * 4);
      n.text.y += n.vy * dt;
      n.text.setAlpha(Math.min(1, n.life / (n.max * 0.4)));
    }
  }

  destroy(): void {
    for (const f of this.flips) f.img.destroy();
    for (const n of this.nums) n.text.destroy();
    this.flips.length = 0;
    this.nums.length = 0;
  }
}
