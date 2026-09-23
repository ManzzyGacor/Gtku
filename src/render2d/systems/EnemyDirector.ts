/**
 * Phaser-side owner of the enemy simulation: spawns from chunk data, runs the pure `EnemyWorld`,
 * turns its events into FX / hero damage / camera shake, and draws telegraphs, shockwaves and projectiles.
 */
import Phaser from 'phaser';
import { TILE } from '../../config';
import { makeRng } from '../../core/rng';
import { Archer, Boss, EnemyCore, EnemyWorld, inArc, Slime, type Projectile, type WorldEvent } from '../../core/entities/enemies';
import { EnemyView } from '../entities/EnemyView';
import type { SwingEvent } from '../../core/entities/HeroCore';
import { P } from '../../art/palette';
import type { SpawnDef } from '../../core/world/source';
import { frameOf } from '../register';
import type { GameScene } from '../scenes/GameScene';
import type { LoadedChunk } from './chunks';
import { OVERLIGHT } from './fx';

const PROJ_FRAME: Record<string, string> = { thorn: 'thorn', rock: 'rock_proj', orb: 'orb' };

export class EnemyDirector {
  readonly world = new EnemyWorld();
  private views = new Map<EnemyCore, EnemyView>();
  private projViews = new Map<Projectile, Phaser.GameObjects.Image>();
  private spawned = new Map<string, EnemyCore[]>();
  private boss: Boss | null = null;
  private bossDeathT = -1;
  private bossDeathNext = 0;
  private time = 0;

  constructor(private readonly game: GameScene) {
    this.world.rand = makeRng(0xbeef);
  }

  private get sink(): { emit: (e: WorldEvent) => void } {
    return { emit: (e) => this.world.events.push(e) };
  }

  get bossRef(): Boss | null {
    return this.boss;
  }

  // ───────────────────────── spawning ─────────────────────────

  spawnForChunk(chunk: LoadedChunk): void {
    for (const s of chunk.data.spawns) this.spawn(s);
  }

  private spawn(s: SpawnDef): void {
    if (this.game.state.isDead(s.id) || this.spawned.has(s.id)) return;
    const list: EnemyCore[] = [];
    if (s.kind === 'slime') list.push(this.world.add(new Slime(s.x, s.y)));
    else if (s.kind === 'archer') list.push(this.world.add(new Archer(s.x, s.y)));
    else if (s.kind === 'bats') list.push(...this.world.spawnBats(s.x, s.y, s.count ?? 3, s.id));
    else if (s.kind === 'boss') {
      const b = this.world.add(new Boss(s.x, s.y));
      this.boss = b;
      list.push(b);
    }
    for (const e of list) e.spawnId = s.id;
    this.spawned.set(s.id, list);
  }

  despawnForChunk(chunk: LoadedChunk): void {
    for (const s of chunk.data.spawns) {
      const list = this.spawned.get(s.id);
      if (!list) continue;
      // don't yank enemies that are actively fighting the hero
      if (list.some((e) => !e.dead && (e.aggro || e.kind === 'boss'))) continue;
      for (const e of list) this.world.remove(e);
      this.spawned.delete(s.id);
    }
  }

  /** Forget everything and respawn for the given chunks (after the hero respawns). */
  resetAll(chunks: Iterable<LoadedChunk>): void {
    this.world.clearAll();
    this.spawned.clear();
    this.boss = null;
    this.bossDeathT = -1;
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    for (const p of this.projViews.values()) p.destroy();
    this.projViews.clear();
    this.game.ui?.setBoss(null);
    for (const c of chunks) this.spawnForChunk(c);
  }

  // ───────────────────────── hero → enemies ─────────────────────────

  nearest(x: number, y: number, maxD: number): EnemyCore | null {
    let best: EnemyCore | null = null;
    let bd = maxD;
    for (const e of this.world.enemies) {
      if (e.dead || e.invulnerable) continue;
      const d = Math.hypot(e.x - x, e.cy - y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  applySwing(ev: SwingEvent): void {
    const g = this.game;
    let hits = 0;
    for (const e of this.world.enemies) {
      if (e.dead || !inArc(e, ev)) continue;
      const stun = ev.index === 2 ? 0.32 : 0.18;
      if (!e.hurt(ev.dmg, g.hero.x, g.hero.y - 6, ev.knock, stun, this.sink)) continue;
      hits++;
      const ang = Math.atan2(e.cy - ev.y, e.x - ev.x);
      const hx = e.x - Math.cos(ang) * (e.radius * 0.5);
      const hy = e.cy - Math.sin(ang) * (e.radius * 0.5);
      g.fx.hitSpark(hx, hy);
      this.hurtFx(e, hx, hy);
      g.fx.number(e.x, e.y - e.h - 2, String(ev.dmg), ev.index === 2 ? 0xffd15a : 0xffffff, ev.index === 2 ? 2 : 1);
      this.views.get(e)?.squash(0.85, 1.18);
      if (e.kind === 'boss') this.updateBossBar();
    }
    if (hits > 0) {
      g.freeze(ev.index === 2 ? 110 : 60);
      g.rig.shake(ev.index === 2 ? 3 : 1.5, 0.14);
    }
  }

  applyBlast(x: number, y: number, radius: number, dmg: number, knock: number, stun: number): void {
    const g = this.game;
    let hits = 0;
    for (const e of this.world.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - x, e.cy - y) > radius + e.radius) continue;
      if (!e.hurt(dmg, x, y, knock, stun, this.sink)) continue;
      hits++;
      g.fx.hitSpark(e.x, e.cy);
      this.hurtFx(e, e.x, e.cy);
      g.fx.number(e.x, e.y - e.h - 2, String(dmg), 0xffe066, 2);
      if (e.kind === 'boss') this.updateBossBar();
    }
    // blast also cancels projectiles
    for (const p of this.world.projectiles) if (Math.hypot(p.x - x, p.y - y) < radius) p.alive = false;
    if (hits > 0) g.freeze(90);
  }

  private hurtFx(e: EnemyCore, x: number, y: number): void {
    const fx = this.game.fx;
    if (e.kind === 'slime') fx.gooBurst(x, y, 6);
    else if (e.kind === 'archer') fx.leafFall(x, y);
    else if (e.kind === 'bat') fx.violetBurst(x, y, 5);
    else fx.violetBurst(x, y, 8);
  }

  // ───────────────────────── update ─────────────────────────

  update(dt: number, realDt: number): void {
    const g = this.game;
    this.time += realDt;
    const hero = g.hero;
    const ref = { x: hero.x, y: hero.y, alive: hero.alive, canBeHit: hero.canBeHit };
    if (dt > 0) {
      this.checkBossWake();
      this.world.update(dt, ref, g.collision);
    }
    for (const ev of this.world.drainEvents()) this.handle(ev);

    // views
    for (const e of this.world.enemies) {
      let v = this.views.get(e);
      if (!v) {
        v = new EnemyView(g, e);
        this.views.set(e, v);
      }
      v.update(dt, realDt);
    }
    for (const [e, v] of [...this.views]) {
      if (!this.world.enemies.includes(e)) {
        v.destroy();
        this.views.delete(e);
      } else if (e.dead && e.kind !== 'boss' && e.deathT > 0.55) {
        this.world.remove(e);
        v.destroy();
        this.views.delete(e);
      }
    }
    this.syncProjectiles();
    this.drawOverlays();
    this.updateBossDeath(realDt);
  }

  private handle(ev: WorldEvent): void {
    const g = this.game;
    switch (ev.type) {
      case 'hit-hero':
        g.hero.takeDamage(ev.dmg, ev.fromX, ev.fromY, ev.knock);
        break;
      case 'telegraph':
        this.views.get(ev.enemy)?.telegraph(ev.kind, ev.dur);
        break;
      case 'summon': {
        const n = ev.count;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.PI / 2;
          const bx = ev.x + Math.cos(a) * 44;
          const by = ev.y + Math.sin(a) * 30;
          const bats = this.world.spawnBats(bx, by, 1, 'minion');
          for (const b of bats) b.aggro = true;
          g.fx.violetBurst(bx, by, 10);
        }
        g.rig.shake(2, 0.2);
        break;
      }
      case 'slam':
        g.rig.shake(5, 0.35);
        g.fx.smokePuff(ev.x, ev.y, 10);
        for (let i = 0; i < 8; i++) g.fx.step(ev.x + Math.cos(i) * ev.radius * 0.7, ev.y + Math.sin(i) * ev.radius * 0.4, 'stone', 3);
        g.freeze(60);
        break;
      case 'roar':
        g.rig.shake(4, 1.4);
        g.ui?.showBanner('Kolosus Kelam');
        g.onBossWake();
        this.updateBossBar();
        break;
      case 'phase':
        g.rig.shake(6, 0.6);
        g.fx.violetBurst(ev.enemy.x, ev.enemy.cy, 26);
        g.ui?.flash(0xa795ff, 0.4, 260);
        this.updateBossBar();
        break;
      case 'projectile-wall':
        g.fx.step(ev.p.x, ev.p.y, ev.p.proj === 'rock' ? 'stone' : 'grass', 2);
        break;
      case 'projectile-hit':
        g.fx.hitSpark(ev.p.x, ev.p.y);
        break;
      case 'died':
        this.onDied(ev.enemy);
        break;
      default:
        break;
    }
  }

  private onDied(e: EnemyCore): void {
    const g = this.game;
    const fx = g.fx;
    if (e.kind === 'boss') {
      this.bossDeathT = 0;
      this.bossDeathNext = 0;
      g.freeze(220);
      g.rig.shake(6, 0.5);
      this.game.ui?.setBoss(null);
      return;
    }
    if (e.kind === 'slime') fx.gooBurst(e.x, e.cy, 16);
    else if (e.kind === 'archer') {
      fx.leafFall(e.x, e.cy);
      fx.step(e.x, e.y, 'grass', 3);
    } else fx.violetBurst(e.x, e.cy, 12);
    fx.smokePuff(e.x, e.cy, 3);
    // record permanent-ish kill when the whole spawn group is gone
    const list = this.spawned.get(e.spawnId);
    if (e.spawnId && e.spawnId !== 'minion' && list && list.every((m) => m.dead)) g.state.markKilled(e.spawnId);
    g.events.emit('enemy-killed', e);
  }

  private updateBossBar(): void {
    const b = this.boss;
    if (!b || !b.awake) return;
    this.game.ui?.setBoss('Kolosus Kelam', Math.max(0, b.hp / b.maxHp));
  }

  private checkBossWake(): void {
    const b = this.boss;
    if (!b || b.awake || b.dead) return;
    const arena = this.game.world.markers.boss.arena;
    const tx = this.game.hero.x / TILE;
    const ty = this.game.hero.y / TILE;
    // wake once the hero is well inside the arena (past the door)
    if (tx >= arena.x0 + 3 && tx <= arena.x1 && ty >= arena.y0 && ty <= arena.y1) b.wake(this.sink);
  }

  private updateBossDeath(realDt: number): void {
    if (this.bossDeathT < 0 || !this.boss) return;
    const b = this.boss;
    this.bossDeathT += realDt;
    this.bossDeathNext -= realDt;
    if (this.bossDeathNext <= 0 && this.bossDeathT < 2.2) {
      this.bossDeathNext = 0.14;
      const ox = (Math.random() - 0.5) * 40;
      const oy = (Math.random() - 0.5) * 50;
      this.game.fx.violetBurst(b.x + ox, b.cy + oy, 10);
      this.game.fx.goldBurst(b.x + ox, b.cy + oy, 6);
      this.game.fx.smokePuff(b.x + ox, b.cy + oy, 3);
      this.game.rig.shake(3, 0.2);
    }
    const v = this.views.get(b);
    if (v) v.sprite.setAlpha(this.bossDeathT > 1.6 ? Math.max(0, 1 - (this.bossDeathT - 1.6) / 0.6) : 1);
    if (this.bossDeathT >= 2.3) {
      this.bossDeathT = -1;
      this.world.remove(b);
      this.views.get(b)?.destroy();
      this.views.delete(b);
      this.game.state.bossDefeated = true;
      this.game.onBossDefeated(b.x, b.y);
    }
  }

  // ───────────────────────── views ─────────────────────────

  private syncProjectiles(): void {
    for (const p of this.world.projectiles) {
      let img = this.projViews.get(p);
      if (!img) {
        const name = PROJ_FRAME[p.proj];
        const f = frameOf('fx', name);
        img = this.game.add.image(p.x, p.y, 'fx', name).setOrigin((f.ax ?? f.w / 2) / f.w, (f.ay ?? f.h / 2) / f.h).setDepth(OVERLIGHT);
        this.projViews.set(p, img);
      }
      img.setPosition(Math.round(p.x), Math.round(p.y));
      if (p.proj !== 'thorn') this.game.lighting.light(p.x, p.y, 26, 0xa795ff, 0.55);
      if (p.proj !== 'rock') img.setRotation(p.angle);
      else img.setRotation(p.age * 8);
    }
    for (const [p, img] of [...this.projViews]) {
      if (!p.alive) {
        img.destroy();
        this.projViews.delete(p);
      }
    }
  }

  /** Ground rings (shockwaves) + telegraph indicators. */
  private drawOverlays(): void {
    const gfx = this.game.fx.gfx;
    gfx.clear();
    for (const s of this.world.shockwaves) {
      gfx.lineStyle(2, P.c4, s.fade);
      gfx.strokeEllipse(Math.round(s.x), Math.round(s.y), Math.round(s.r * 2), Math.round(s.r * 1.4));
      gfx.lineStyle(1, P.c2, s.fade * 0.8);
      gfx.strokeEllipse(Math.round(s.x), Math.round(s.y), Math.round(s.r * 2 - 5), Math.round(s.r * 1.4 - 4));
    }
    for (const [e, v] of this.views) {
      if (!v.telegraphing || e.dead) continue;
      const p = v.teleProgress;
      if (v.teleKind === 'slam' && e instanceof Boss) {
        const fx = e.x + Math.cos(e.facing) * 16;
        const fy = e.y + Math.sin(e.facing) * 10;
        gfx.lineStyle(1, 0xff5a4a, 0.9);
        gfx.strokeEllipse(Math.round(fx), Math.round(fy), 72, 50);
        gfx.fillStyle(0xff5a4a, 0.12 + p * 0.28);
        gfx.fillEllipse(Math.round(fx), Math.round(fy), Math.round(72 * p), Math.round(50 * p));
      } else if (v.teleKind === 'aim' && e instanceof Archer) {
        const hero = this.game.hero;
        gfx.lineStyle(1, 0xff5a4a, 0.35 + p * 0.5);
        gfx.lineBetween(Math.round(e.x), Math.round(e.cy), Math.round(hero.x), Math.round(hero.y - 6));
      } else if (v.teleKind === 'lunge' || v.teleKind === 'dive') {
        gfx.lineStyle(1, 0xff5a4a, 0.5);
        gfx.strokeEllipse(Math.round(e.x), Math.round(e.y), 14 + Math.round(p * 6), 7 + Math.round(p * 3));
      }
    }
  }

  destroy(): void {
    for (const v of this.views.values()) v.destroy();
    for (const p of this.projViews.values()) p.destroy();
    this.views.clear();
    this.projViews.clear();
  }
}
