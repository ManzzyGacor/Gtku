import Phaser from 'phaser';
import { WORLD_PX_H, WORLD_PX_W } from '../config';
import { input } from '../core/input';
import { sheets } from '../art/register';
import { EnemyDirector } from '../systems/EnemyDirector';
import { CameraRig } from '../systems/cameraRig';
import { ChunkManager, type LoadedChunk } from '../systems/chunks';
import { Fx } from '../systems/fx';
import { Lighting } from '../systems/lighting';
import { Parallax } from '../systems/parallax';
import { blendAmbient, ambientAt, nightAmount, smooth, DAY_SECONDS } from '../systems/daynight';
import { AREAS, CAVE_X0, FOREST_X0 } from '../world/areas';
import { Quality, type QualityLevel } from '../core/quality';
import { HeroCore, type HeroEvent, type HeroInput } from '../entities/HeroCore';
import { HeroView } from '../entities/HeroView';
import type { EnemyCore } from '../entities/enemies';
import { GameState } from '../state/GameState';
import { Collision } from '../world/collision';
import { GeneratedWorld } from '../world/worldgen';
import type { UIScene } from './UIScene';

interface Pickup {
  x: number;
  y: number;
  img: Phaser.GameObjects.Image;
  age: number;
  heal: number;
}

export class GameScene extends Phaser.Scene {
  world!: GeneratedWorld;
  collision!: Collision;
  chunks!: ChunkManager;
  hero!: HeroCore;
  heroView!: HeroView;
  rig!: CameraRig;
  fx!: Fx;
  state = new GameState();
  director!: EnemyDirector;
  lighting!: Lighting;
  private parallax!: Parallax;
  private quality = new Quality();
  private bloom: { setActive(v: boolean): unknown } | null = null;
  private leafT = 0;
  /** Seconds of game time (frozen during hit-stop). */
  simTime = 0;
  private freezeLeft = 0;
  private pickups: Pickup[] = [];
  private deathT = -1;
  private lastHp = 0;

  constructor() {
    super('Game');
  }

  get ui(): UIScene | undefined {
    return this.scene.isActive('UI') ? (this.scene.get('UI') as UIScene) : undefined;
  }

  create(): void {
    this.world = new GeneratedWorld();
    this.collision = new Collision(this.world);
    this.fx = new Fx(this);
    this.director = new EnemyDirector(this);
    this.chunks = new ChunkManager(this, this.world, sheets.get('tiles')!);
    this.lighting = new Lighting(this);
    this.parallax = new Parallax(this);
    this.chunks.onLoad = (c) => this.onChunkLoad(c);
    this.chunks.onUnload = (c) => this.onChunkUnload(c);

    const start = this.world.markers.playerStart;
    this.hero = new HeroCore(start.x, start.y);
    this.lastHp = this.hero.hp;
    this.hero.aimAssist = (angle) => this.aimAssist(angle);
    this.heroView = new HeroView(this, this.hero);

    const cam = this.cameras.main;
    cam.setBackgroundColor(0x0f0b1c);
    this.rig = new CameraRig(cam, WORLD_PX_W, WORLD_PX_H);
    this.rig.snap(start.x, start.y);
    this.chunks.preload(this.rig.view, 1);
    this.setupPost();
    this.quality.onChange = (l) => this.applyQuality(l);
    this.applyQuality(this.quality.level);

    this.events.on('enemy-killed', (e: EnemyCore) => this.onEnemyKilled(e));
    this.scene.launch('UI');
    this.scene.bringToTop('UI');
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.rig.snap(this.hero.x, this.hero.y));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.lighting.destroy();
      this.parallax.destroy();
      this.chunks.destroy();
      this.director.destroy();
      this.fx.destroy();
    });
  }

  // ───────────────────────── chunk hooks ─────────────────────────

  private onChunkLoad(c: LoadedChunk): void {
    this.lighting.addChunk(c);
    this.director.spawnForChunk(c);
  }

  private onChunkUnload(c: LoadedChunk): void {
    this.lighting.removeChunk(c);
    this.director.despawnForChunk(c);
  }

  // ───────────────────────── post-processing & quality ─────────────────────────

  /** Bloom via camera filters (WebGL only). Wrapped so an unsupported device just skips it. */
  private setupPost(): void {
    if (new URLSearchParams(location.search).get('bloom') === '0') return;
    try {
      if (this.renderer.type !== Phaser.WEBGL) return;
      const out = Phaser.Actions.AddEffectBloom(this.cameras.main, { threshold: 0.66, blurRadius: 2, blurSteps: 3, blendAmount: 0.5 });
      this.bloom = out[0].parallelFilters;
    } catch (err) {
      console.warn('bloom unavailable', err);
      this.bloom = null;
    }
  }

  private applyQuality(level: QualityLevel): void {
    this.bloom?.setActive(level >= 2);
    this.fx.quality = level >= 1 ? 1 : 0.5;
    this.lighting.everyN = level >= 1 ? 1 : 2;
  }

  // ───────────────────────── helpers ─────────────────────────

  /** Hit-stop: freeze simulation for `ms` while rendering keeps going. */
  freeze(ms: number): void {
    this.freezeLeft = Math.max(this.freezeLeft, ms / 1000);
  }

  /** Nudge the attack toward a nearby enemy (makes touch aiming forgiving). */
  private aimAssist(angle: number): number {
    const h = this.hero;
    let best: number | null = null;
    let bestScore = 1e9;
    for (const e of this.director.world.enemies) {
      if (e.dead || e.invulnerable) continue;
      const d = Math.hypot(e.x - h.x, e.cy - (h.y - 8));
      if (d > 62) continue;
      const a = Math.atan2(e.cy - (h.y - 8), e.x - h.x);
      let diff = a - angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > (55 * Math.PI) / 180) continue;
      const score = d + Math.abs(diff) * 30;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best ?? angle;
  }

  private onEnemyKilled(e: EnemyCore): void {
    if (e.kind !== 'boss' && Math.random() < 0.3) this.dropHeal(e.x, e.cy);
  }

  private dropHeal(x: number, y: number): void {
    const img = this.add.image(x, y, 'fx', 'heal_orb').setDepth(3500);
    this.pickups.push({ x, y, img, age: 0, heal: 2 });
  }

  /** Boss hooks (door + music handled by later systems). */
  onBossWake(): void {
    this.events.emit('boss-wake');
  }

  onBossDefeated(x: number, y: number): void {
    this.fx.goldBurst(x, y, 40);
    this.fx.glowPulse(x, y - 10, 90, 0xffd98a, 900);
    this.events.emit('boss-defeated', x, y);
  }

  // ───────────────────────── hero events ─────────────────────────

  private handleHeroEvents(): void {
    const h = this.hero;
    const evs: HeroEvent[] = h.events.splice(0);
    for (const e of evs) {
      switch (e.type) {
        case 'swing-start':
          this.lighting.flash(h.x + Math.cos(e.angle) * 14, h.y - 10 + Math.sin(e.angle) * 10, 46, 0xffd98a, 0.85, 0.16);
          this.fx.slash(h.x, h.y - 9, e.angle, e.index);
          this.heroView.squash(e.index === 2 ? 1.28 : 1.16, e.index === 2 ? 0.8 : 0.88);
          break;
        case 'swing':
          this.director.applySwing(e);
          break;
        case 'cast-start':
          this.fx.cyanBurst(h.x, h.y - 10, 10);
          break;
        case 'blast':
          this.fx.glowPulse(e.x, e.y, e.radius + 14, 0xffe4a0, 420);
          this.lighting.flash(e.x, e.y, 140, 0xffe4a0, 1, 0.5);
          this.fx.goldBurst(e.x, e.y, 30);
          this.fx.smokePuff(e.x, e.y + 6, 6);
          this.rig.shake(4, 0.28);
          this.ui?.flash(0xfff2c0, 0.32, 200);
          this.director.applyBlast(e.x, e.y, e.radius, e.dmg, e.knock, e.stun);
          break;
        case 'roll':
          this.fx.rollDust(e.x, e.y, this.collision.surfaceAt(e.x, e.y));
          break;
        case 'step':
          this.fx.step(e.x, e.y, this.collision.surfaceAt(e.x, e.y));
          break;
        case 'hurt': {
          const dmg = this.lastHp - e.hp;
          this.fx.number(h.x, h.y - 26, `-${dmg}`, 0xff6a5a, 1);
          this.rig.shake(3.5, 0.22);
          this.freeze(70);
          this.heroView.flash(0.1);
          this.ui?.flash(0xff2a2a, 0.35, 260);
          break;
        }
        case 'dead':
          this.deathT = 0;
          this.rig.shake(4, 0.4);
          this.ui?.flash(0xff2a2a, 0.5, 500);
          break;
        default:
          break;
      }
    }
    this.lastHp = h.hp;
  }

  // ───────────────────────── death / respawn ─────────────────────────

  private updateDeath(realDt: number): void {
    if (this.deathT < 0) return;
    const prev = this.deathT;
    this.deathT += realDt;
    if (prev < 1.5 && this.deathT >= 1.5) this.cameras.main.fadeOut(450, 8, 4, 16);
    if (prev < 2.05 && this.deathT >= 2.05) this.respawn();
  }

  respawn(): void {
    const cp = this.world.markers.checkpoints.find((c) => c.id === this.state.checkpoint) ?? this.world.markers.checkpoints[0];
    this.hero.reset(cp.x, cp.y + 14);
    this.lastHp = this.hero.hp;
    this.deathT = -1;
    this.rig.snap(cp.x, cp.y);
    this.chunks.preload(this.rig.view, 1);
    this.director.resetAll(this.chunks.loaded.values());
    this.cameras.main.fadeIn(500, 8, 4, 16);
    this.ui?.toast('Kamu pingsan… bangun di ' + cp.name);
  }

  // ───────────────────────── main loop ─────────────────────────

  private updatePickups(realDt: number): void {
    const h = this.hero;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += realDt;
      const d = Math.hypot(h.x - p.x, h.y - 6 - p.y);
      if (p.age > 0.35 && d < 46 && h.alive) {
        p.x += ((h.x - p.x) / d) * 120 * realDt;
        p.y += ((h.y - 6 - p.y) / d) * 120 * realDt;
      }
      p.img.setPosition(Math.round(p.x), Math.round(p.y + Math.sin(p.age * 5) * 1.5));
      p.img.setAlpha(p.age > 12 ? (Math.floor(p.age * 8) % 2 ? 0.4 : 1) : 1);
      if (d < 8 && h.alive && h.hp < h.maxHp) {
        h.heal(p.heal);
        this.lastHp = h.hp;
        this.fx.number(h.x, h.y - 26, `+${p.heal}`, 0x7cf07c, 1);
        this.fx.goldBurst(p.x, p.y, 6);
        p.img.destroy();
        this.pickups.splice(i, 1);
      } else if (p.age > 16) {
        p.img.destroy();
        this.pickups.splice(i, 1);
      }
    }
  }

  /** Day/night, lightmap, parallax, drifting leaves. */
  private updateAtmosphere(dt: number, realDt: number, time: number): void {
    this.state.dayTime = (this.state.dayTime + dt / DAY_SECONDS) % 1;
    const h = this.hero;
    const tx = h.x / 16;
    const caveW = smooth(CAVE_X0 - 6, CAVE_X0 + 3, tx);
    const outdoor = ambientAt(this.state.dayTime);
    const ambient = blendAmbient(outdoor, AREAS.cave.ambient, caveW);
    const night = nightAmount(this.state.dayTime) * (1 - caveW);
    const cam = this.cameras.main;

    // hero lantern: the keeper's lamp always burns; stronger when it's dark
    const dark = Math.max(night, caveW);
    this.lighting.light(h.x, h.y - 12, 58 + dark * 34, 0xffd9a0, 0.5 + dark * 0.5, 0.03);
    const boss = this.director.bossRef;
    if (boss && boss.awake && !boss.dead) this.lighting.light(boss.x, boss.cy, 80, 0xa795ff, 0.9, 0.08);
    this.lighting.update(realDt, time, cam.scrollX, cam.scrollY, ambient, night, caveW);

    const forest = smooth(FOREST_X0 - 4, FOREST_X0 + 4, tx) * (1 - smooth(CAVE_X0 - 6, CAVE_X0 - 1, tx));
    const outdoorDay = (1 - caveW) * (1 - night);
    this.parallax.update(cam.scrollX, cam.scrollY, time, forest, outdoorDay, caveW);

    // occasional leaf drifting off a tree crown in the forest
    this.leafT -= realDt;
    if (this.leafT <= 0 && forest > 0.3) {
      this.leafT = 0.35 + Math.random() * 0.6;
      const p = this.chunks.randomProp(this.rig.view, ['tree_a', 'tree_c', 'tree_b']);
      if (p) this.fx.fallingLeaf(p.x + (Math.random() - 0.5) * 18, p.y - 22 - Math.random() * 12);
    }
  }

  override update(time: number, deltaMs: number): void {
    const realDt = Math.min(deltaMs / 1000, 1 / 20);
    let dt = realDt;
    if (this.freezeLeft > 0) {
      this.freezeLeft -= realDt;
      dt = 0;
    }
    this.simTime += dt;
    this.state.worldTime += dt;

    const ax = input.axis();
    const inp: HeroInput = {
      mx: ax.x,
      my: ax.y,
      attack: input.consume('attack'),
      dodge: input.consume('dodge'),
      skill: input.consume('skill'),
    };
    if (dt > 0) {
      const speedMult = this.collision.speedAt(this.hero.x, this.hero.y);
      this.hero.update(dt, inp, this.collision, speedMult);
    }
    this.director.update(dt, realDt);
    this.handleHeroEvents();
    this.updateDeath(realDt);
    this.updatePickups(realDt);
    this.heroView.update(dt, realDt, time / 1000);
    this.fx.update(realDt);
    this.quality.update(realDt);

    // walking through tall grass bends it and kicks up a leaf
    if (dt > 0 && Math.hypot(this.hero.vx, this.hero.vy) > 20 && this.chunks.disturb(this.hero.x, this.hero.y, 11) > 0) {
      this.fx.leafFall(this.hero.x, this.hero.y - 4);
    }

    this.rig.update(realDt, this.hero.x, this.hero.y - 6, this.hero.vx, this.hero.vy);
    this.chunks.update(this.rig.view);
    this.chunks.step(5);
    this.chunks.animate(this.simTime, dt);
    this.updateAtmosphere(dt, realDt, time / 1000);
  }
}
