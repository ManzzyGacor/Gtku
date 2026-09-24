/**
 * Pure enemy AI (no Phaser): Lendir Lumut (chaser), Pemanah Duri (ranged kiter), Kelelawar Kelam (pack flankers),
 * Kolosus Kelam (boss). The scene renders them and feeds `EnemyEvent`s back into hero damage, particles, camera shake.
 */
import { clamp } from '../rng';
import type { Collision } from '../world/collision';

export type EnemyKind = 'slime' | 'archer' | 'bat' | 'boss';

export interface HeroRef {
  x: number;
  y: number;
  alive: boolean;
  canBeHit: boolean;
}

export type EnemyEvent =
  | { type: 'hit-hero'; dmg: number; fromX: number; fromY: number; knock: number; source: EnemyCore | null }
  | { type: 'shoot'; x: number; y: number; vx: number; vy: number; dmg: number; proj: 'thorn' | 'rock' | 'orb'; life: number; radius: number }
  | { type: 'shockwave'; x: number; y: number; maxR: number; speed: number; dmg: number }
  | { type: 'summon'; x: number; y: number; count: number }
  | { type: 'telegraph'; enemy: EnemyCore; kind: 'lunge' | 'aim' | 'slam' | 'volley' | 'summon' | 'dive'; dur: number }
  | { type: 'slam'; x: number; y: number; radius: number }
  | { type: 'phase'; enemy: EnemyCore; phase: number }
  | { type: 'roar'; enemy: EnemyCore }
  | { type: 'died'; enemy: EnemyCore };

export interface EnemyCtx {
  hero: HeroRef;
  col: Collision;
  emit: (e: EnemyEvent) => void;
  rand: () => number;
  /** How many minions the boss can still spawn (scene decides). */
  minionsAlive: number;
}

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

let nextId = 1;

export abstract class EnemyCore {
  readonly uid = nextId++;
  x: number;
  y: number;
  /** Desired velocity set by AI each frame. */
  wx = 0;
  wy = 0;
  /** Knockback velocity (decays). */
  kx = 0;
  ky = 0;
  hp: number;
  dead = false;
  /** Seconds left in stun (can't act). */
  stun = 0;
  flash = 0;
  state = 'idle';
  stateT = 0;
  facing = Math.PI / 2;
  aggro = false;
  /** Seconds since death began (for fade-out). */
  deathT = 0;
  /** Boss/minion immunity flags. */
  invulnerable = false;
  knockResist = 1;
  readonly home: { x: number; y: number };
  spawnId = '';

  constructor(
    readonly kind: EnemyKind,
    x: number,
    y: number,
    readonly maxHp: number,
    readonly hw: number,
    readonly h: number,
    readonly flying = false,
  ) {
    this.x = x;
    this.y = y;
    this.hp = maxHp;
    this.home = { x, y };
  }

  /** Body centre used for hit tests. */
  get cy(): number {
    return this.y - this.h / 2;
  }

  get radius(): number {
    return Math.max(this.hw, this.h / 2);
  }

  protected setState(s: string): void {
    this.state = s;
    this.stateT = 0;
  }

  /** Returns true if the hit landed. */
  hurt(dmg: number, fromX: number, fromY: number, knock: number, stun: number, ctx: { emit: (e: EnemyEvent) => void }): boolean {
    if (this.dead || this.invulnerable) return false;
    this.hp -= dmg;
    this.flash = 0.11;
    const a = Math.atan2(this.cy - fromY, this.x - fromX);
    this.kx = Math.cos(a) * knock * this.knockResist;
    this.ky = Math.sin(a) * knock * this.knockResist;
    if (stun > 0 && this.knockResist >= 0.5) this.stun = Math.max(this.stun, stun);
    this.aggro = true;
    this.onHurt();
    if (this.hp <= 0) {
      this.dead = true;
      this.deathT = 0;
      this.wx = this.wy = 0;
      ctx.emit({ type: 'died', enemy: this });
    }
    return true;
  }

  protected onHurt(): void {
    /* subclasses may react */
  }

  update(dt: number, ctx: EnemyCtx): void {
    this.stateT += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.dead) {
      this.deathT += dt;
      return;
    }
    if (this.stun > 0) {
      this.stun -= dt;
      this.wx = this.wy = 0;
    } else this.think(dt, ctx);
    // integrate: AI velocity + decaying knockback
    const vx = this.wx + this.kx;
    const vy = this.wy + this.ky;
    const decay = Math.exp(-9 * dt);
    this.kx *= decay;
    this.ky *= decay;
    if (Math.abs(this.kx) < 1) this.kx = 0;
    if (Math.abs(this.ky) < 1) this.ky = 0;
    if (vx !== 0 || vy !== 0) {
      const r = ctx.col.move(this.x, this.y, this.hw, this.h, vx * dt, vy * dt);
      this.x = r.x;
      this.y = r.y;
      if (r.hitX) this.kx = 0;
      if (r.hitY) this.ky = 0;
    }
  }

  protected abstract think(dt: number, ctx: EnemyCtx): void;

  protected moveToward(tx: number, ty: number, speed: number): void {
    const a = Math.atan2(ty - this.y, tx - this.x);
    this.wx = Math.cos(a) * speed;
    this.wy = Math.sin(a) * speed;
    this.facing = a;
  }

  protected stop(): void {
    this.wx = this.wy = 0;
  }

  /** Nearby check for aggro (distance + line of sight through tiles). */
  protected sees(ctx: EnemyCtx, range: number): boolean {
    const d = dist(this.x, this.cy, ctx.hero.x, ctx.hero.y - 6);
    return ctx.hero.alive && d < range && ctx.col.lineClear(this.x, this.cy, ctx.hero.x, ctx.hero.y - 6);
  }
}

// ───────────────────────────── Lendir Lumut: chaser ─────────────────────────────

export class Slime extends EnemyCore {
  private hopT = 0;
  private wanderT = 1 + Math.random() * 2;
  private wanderA = 0;
  private lungeA = 0;
  private hitDone = false;
  private lost = 0;
  /** 0 squash, 1 air, 2 land — drives animation. */
  hopPhase = 0;

  constructor(x: number, y: number) {
    super('slime', x, y, 6, 6, 8);
  }

  protected override onHurt(): void {
    if (this.state === 'windup') this.setState('chase');
  }

  protected think(dt: number, ctx: EnemyCtx): void {
    const hero = ctx.hero;
    const d = dist(this.x, this.cy, hero.x, hero.y - 6);
    if (!this.aggro && this.sees(ctx, 84)) this.aggro = true;
    if (this.aggro && d > 190) {
      this.lost += dt;
      if (this.lost > 2.5) {
        this.aggro = false;
        this.lost = 0;
      }
    } else this.lost = 0;

    switch (this.state) {
      case 'idle':
      case 'chase': {
        if (!this.aggro || !hero.alive) {
          this.setState('idle');
          this.wanderT -= dt;
          if (this.wanderT <= 0) {
            this.wanderT = 1.4 + ctx.rand() * 2.2;
            // drift back toward home if far, otherwise random
            const away = dist(this.x, this.y, this.home.x, this.home.y);
            this.wanderA = away > 40 ? Math.atan2(this.home.y - this.y, this.home.x - this.x) : ctx.rand() * Math.PI * 2;
            this.hopT = 0;
          }
          this.hopT += dt;
          const air = this.hopT < 0.3;
          this.hopPhase = air ? 1 : 0;
          if (air && this.wanderT > 0.1) {
            this.wx = Math.cos(this.wanderA) * 16;
            this.wy = Math.sin(this.wanderA) * 16;
          } else this.stop();
          break;
        }
        this.state = 'chase';
        this.hopT = (this.hopT + dt) % 0.7;
        if (this.hopT < 0.34) {
          this.hopPhase = 1;
          this.moveToward(hero.x, hero.y, 58);
        } else {
          this.hopPhase = this.hopT < 0.5 ? 2 : 0;
          this.stop();
        }
        if (d < 30 && this.stateT > 0.25 && this.hopT > 0.34) {
          this.lungeA = Math.atan2(hero.y - 6 - this.cy, hero.x - this.x);
          this.setState('windup');
          this.hitDone = false;
          ctx.emit({ type: 'telegraph', enemy: this, kind: 'lunge', dur: 0.42 });
        }
        break;
      }
      case 'windup': {
        this.stop();
        this.facing = this.lungeA;
        if (this.stateT >= 0.42) this.setState('lunge');
        break;
      }
      case 'lunge': {
        this.wx = Math.cos(this.lungeA) * 150;
        this.wy = Math.sin(this.lungeA) * 150;
        if (!this.hitDone && hero.canBeHit && dist(this.x, this.cy, hero.x, hero.y - 6) < 12) {
          this.hitDone = true;
          ctx.emit({ type: 'hit-hero', dmg: 2, fromX: this.x, fromY: this.cy, knock: 120, source: this });
        }
        if (this.stateT >= 0.22) this.setState('recover');
        break;
      }
      case 'recover': {
        this.stop();
        this.hopPhase = 0;
        if (this.stateT >= 0.75) this.setState('chase');
        break;
      }
    }
  }
}

// ───────────────────────────── Pemanah Duri: ranged kiter ─────────────────────────────

export class Archer extends EnemyCore {
  private cd = 0.8;
  private strafe = 1;
  private strafeT = 0;
  private lost = 0;
  private aimA = 0;

  constructor(x: number, y: number) {
    super('archer', x, y, 4, 5, 12);
  }

  protected think(dt: number, ctx: EnemyCtx): void {
    const hero = ctx.hero;
    const d = dist(this.x, this.cy, hero.x, hero.y - 6);
    this.cd -= dt;
    if (!this.aggro && this.sees(ctx, 130)) this.aggro = true;
    if (this.aggro && d > 230) {
      this.lost += dt;
      if (this.lost > 3) this.aggro = false;
    } else this.lost = 0;
    if (!this.aggro || !hero.alive) {
      this.setState('idle');
      this.stop();
      return;
    }
    const toHero = Math.atan2(hero.y - 6 - this.cy, hero.x - this.x);

    switch (this.state) {
      case 'idle':
      case 'kite': {
        this.state = 'kite';
        this.facing = toHero;
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = 0.9 + ctx.rand() * 1.1;
          this.strafe = ctx.rand() < 0.5 ? -1 : 1;
        }
        const perp = toHero + Math.PI / 2;
        if (d < 62) {
          // retreat, with a little sideways drift; if cornered, strafe hard
          const a = toHero + Math.PI;
          this.wx = Math.cos(a) * 54 + Math.cos(perp) * this.strafe * 16;
          this.wy = Math.sin(a) * 54 + Math.sin(perp) * this.strafe * 16;
        } else if (d > 122) {
          this.wx = Math.cos(toHero) * 42;
          this.wy = Math.sin(toHero) * 42;
        } else {
          this.wx = Math.cos(perp) * this.strafe * 28;
          this.wy = Math.sin(perp) * this.strafe * 28;
        }
        if (this.cd <= 0 && d < 150 && d > 40 && ctx.col.lineClear(this.x, this.cy, hero.x, hero.y - 6)) {
          this.setState('aim');
          this.stop();
          ctx.emit({ type: 'telegraph', enemy: this, kind: 'aim', dur: 0.6 });
        }
        break;
      }
      case 'aim': {
        this.stop();
        this.facing = toHero;
        this.aimA = toHero;
        if (this.stateT >= 0.6) {
          const speed = 128;
          ctx.emit({
            type: 'shoot',
            x: this.x + Math.cos(toHero) * 8,
            y: this.cy + Math.sin(toHero) * 6,
            vx: Math.cos(toHero) * speed,
            vy: Math.sin(toHero) * speed,
            dmg: 2,
            proj: 'thorn',
            life: 1.7,
            radius: 3,
          });
          this.cd = 1.7 + ctx.rand() * 0.7;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.stop();
        if (this.stateT >= 0.4) this.setState('kite');
        break;
      }
    }
  }

  get aimAngle(): number {
    return this.aimA;
  }
}

// ───────────────────────────── Kelelawar Kelam: pack ─────────────────────────────

export class Bat extends EnemyCore {
  angle: number; // orbit slot angle
  orbitR = 52;
  cooldown = 0;
  private diveA = 0;
  private hitDone = false;
  pack: BatPack | null = null;
  private clock = 0;

  constructor(x: number, y: number, slotAngle: number) {
    super('bat', x, y, 2, 4, 6, true);
    this.angle = slotAngle;
    this.cooldown = 1 + Math.random() * 1.5;
  }

  get busy(): boolean {
    return this.state === 'telegraph' || this.state === 'dive' || this.state === 'retreat';
  }

  /** Called by the pack when it's this bat's turn. */
  commandDive(ctx: EnemyCtx): void {
    this.setState('telegraph');
    ctx.emit({ type: 'telegraph', enemy: this, kind: 'dive', dur: 0.42 });
  }

  protected think(dt: number, ctx: EnemyCtx): void {
    const hero = ctx.hero;
    this.cooldown -= dt;
    this.clock += dt;
    const packAggro = this.pack ? this.pack.aggro : this.aggro;
    if (!this.aggro && this.sees(ctx, 110)) this.aggro = true;
    if (this.aggro && this.pack) this.pack.aggro = true;

    switch (this.state) {
      case 'idle':
      case 'orbit': {
        if (!packAggro || !hero.alive) {
          // roost: lazy hover around home
          this.setState('idle');
          const t = this.clock + this.angle;
          this.moveToward(this.home.x + Math.cos(t * 0.8) * 18, this.home.y + Math.sin(t * 1.3) * 10, 22);
          return;
        }
        this.state = 'orbit';
        // circle the hero on our slot angle (slots rotate over time => flanking)
        const tt = this.clock;
        const a = this.angle + tt * 0.9;
        const r = this.orbitR + Math.sin(tt * 2 + this.angle * 3) * 8;
        this.moveToward(hero.x + Math.cos(a) * r, hero.y - 8 + Math.sin(a) * r * 0.75, 74);
        break;
      }
      case 'telegraph': {
        // hover in place, shaking; lock the dive direction at the end
        this.stop();
        this.diveA = Math.atan2(hero.y - 8 - this.cy, hero.x - this.x);
        if (this.stateT >= 0.42) {
          this.setState('dive');
          this.hitDone = false;
        }
        break;
      }
      case 'dive': {
        this.wx = Math.cos(this.diveA) * 170;
        this.wy = Math.sin(this.diveA) * 170;
        this.facing = this.diveA;
        if (!this.hitDone && hero.canBeHit && dist(this.x, this.cy, hero.x, hero.y - 8) < 10) {
          this.hitDone = true;
          ctx.emit({ type: 'hit-hero', dmg: 1, fromX: this.x, fromY: this.cy, knock: 90, source: this });
        }
        if (this.stateT >= 0.5) this.setState('retreat');
        break;
      }
      case 'retreat': {
        const a = this.diveA + Math.PI - 0.5 + ctx.rand();
        this.wx = Math.cos(a) * 80;
        this.wy = Math.sin(a) * 80 - 20;
        if (this.stateT >= 0.55) {
          this.cooldown = 1.6 + ctx.rand();
          this.setState('orbit');
        }
        break;
      }
    }
  }
}

/** Coordinates a group of bats: at most `maxDivers` attack at once, the rest circle (flank) the hero. */
export class BatPack {
  members: Bat[] = [];
  aggro = false;
  private timer = 1.2;

  add(b: Bat): void {
    b.pack = this;
    this.members.push(b);
  }

  get alive(): Bat[] {
    return this.members.filter((m) => !m.dead);
  }

  update(dt: number, ctx: EnemyCtx): void {
    const live = this.alive;
    if (live.length === 0) return;
    // spread the orbit slots evenly among survivors
    live.forEach((b, i) => {
      const target = (i / live.length) * Math.PI * 2;
      let diff = target - b.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      b.angle += diff * Math.min(1, dt * 1.5);
    });
    if (!this.aggro || !ctx.hero.alive) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const divers = live.filter((b) => b.busy).length;
    const maxDivers = live.length >= 3 ? 2 : 1;
    if (divers >= maxDivers) {
      this.timer = 0.3;
      return;
    }
    const ready = live.filter((b) => !b.busy && b.cooldown <= 0 && b.stun <= 0 && b.state === 'orbit');
    if (ready.length === 0) {
      this.timer = 0.3;
      return;
    }
    // pick the one closest to the hero
    ready.sort((a, b) => dist(a.x, a.y, ctx.hero.x, ctx.hero.y) - dist(b.x, b.y, ctx.hero.x, ctx.hero.y));
    ready[0].commandDive(ctx);
    this.timer = 0.9 + ctx.rand() * 0.7;
  }
}

// ───────────────────────────── Kolosus Kelam: boss ─────────────────────────────

export class Boss extends EnemyCore {
  phase = 1;
  awake = false;
  private attackIdx = 0;
  private slamDone = false;
  private volleyDone = false;
  private summonDone = false;
  private idleFor = 1.2;
  /** Animation hint for the view. */
  pose: 'idle' | 'slam-up' | 'slam-down' | 'cast' | 'hurt' = 'idle';

  constructor(x: number, y: number) {
    super('boss', x, y, 64, 13, 22);
    this.invulnerable = true;
    this.knockResist = 0.15;
    this.state = 'sleep';
  }

  wake(ctx: { emit: (e: EnemyEvent) => void }): void {
    if (this.awake || this.dead) return;
    this.awake = true;
    this.aggro = true;
    this.invulnerable = true; // stays invulnerable during the roar
    this.setState('roar');
    ctx.emit({ type: 'roar', enemy: this });
  }

  private static readonly PATTERNS: Record<number, string[]> = {
    1: ['slam', 'volley', 'slam'],
    2: ['slam', 'volley', 'summon', 'slam'],
    3: ['slam', 'ring', 'slam', 'summon', 'volley'],
  };

  private computePhase(): number {
    const r = this.hp / this.maxHp;
    return r > 0.66 ? 1 : r > 0.33 ? 2 : 3;
  }

  protected override onHurt(): void {
    this.pose = 'hurt';
  }

  protected think(_dt: number, ctx: EnemyCtx): void {
    const hero = ctx.hero;
    if (this.state === 'sleep') {
      this.stop();
      return;
    }
    const np = this.computePhase();
    if (np > this.phase && this.state !== 'phase') {
      this.phase = np;
      this.attackIdx = 0;
      this.invulnerable = true;
      this.setState('phase');
      ctx.emit({ type: 'phase', enemy: this, phase: np });
      return;
    }
    const d = dist(this.x, this.cy, hero.x, hero.y);
    const toHero = Math.atan2(hero.y - this.cy, hero.x - this.x);
    this.facing = toHero;
    if (this.pose === 'hurt' && this.flash <= 0) this.pose = 'idle';

    switch (this.state) {
      case 'roar':
        this.stop();
        this.pose = 'cast';
        if (this.stateT >= 1.6) {
          this.invulnerable = false;
          this.pose = 'idle';
          this.setState('idle');
          this.idleFor = 0.6;
        }
        break;

      case 'phase':
        this.stop();
        this.pose = 'cast';
        if (this.stateT >= 1.4) {
          this.invulnerable = false;
          this.pose = 'idle';
          ctx.emit({ type: 'slam', x: this.x, y: this.y, radius: 40 });
          ctx.emit({ type: 'shockwave', x: this.x, y: this.y, maxR: 110, speed: 120, dmg: 2 });
          ctx.emit({ type: 'summon', x: this.x, y: this.cy, count: 2 });
          this.setState('idle');
          this.idleFor = 0.9;
        }
        break;

      case 'idle': {
        if (!hero.alive) {
          this.stop();
          return;
        }
        // lumber toward the hero while waiting for the next attack (vulnerable window)
        if (d > 40) this.moveToward(hero.x, hero.y, 26);
        else this.stop();
        this.pose = this.pose === 'hurt' ? 'hurt' : 'idle';
        if (this.stateT >= this.idleFor) {
          const pattern = Boss.PATTERNS[this.phase];
          let next = pattern[this.attackIdx % pattern.length];
          this.attackIdx += 1;
          if (next === 'summon' && ctx.minionsAlive >= 3) next = 'slam';
          this.setState(next);
          this.slamDone = this.volleyDone = this.summonDone = false;
          if (next === 'slam') ctx.emit({ type: 'telegraph', enemy: this, kind: 'slam', dur: 0.95 });
          else if (next === 'summon') ctx.emit({ type: 'telegraph', enemy: this, kind: 'summon', dur: 1 });
          else ctx.emit({ type: 'telegraph', enemy: this, kind: 'volley', dur: 0.75 });
        }
        break;
      }

      case 'slam': {
        // close the distance during the first half, then plant and smash
        if (this.stateT < 0.45 && d > 44) this.moveToward(hero.x, hero.y, 46);
        else this.stop();
        this.pose = this.stateT < 0.95 ? 'slam-up' : 'slam-down';
        if (!this.slamDone && this.stateT >= 0.95) {
          this.slamDone = true;
          const fx = this.x + Math.cos(this.facing) * 16;
          const fy = this.y + Math.sin(this.facing) * 10;
          ctx.emit({ type: 'slam', x: fx, y: fy, radius: 36 });
          if (hero.canBeHit && dist(fx, fy, hero.x, hero.y - 4) < 36) {
            ctx.emit({ type: 'hit-hero', dmg: 4, fromX: fx, fromY: fy, knock: 200, source: this });
          }
          ctx.emit({ type: 'shockwave', x: fx, y: fy, maxR: 96, speed: 125, dmg: 2 });
        }
        if (this.stateT >= 1.75) this.toIdle(this.phase === 3 ? 0.7 : 1.1);
        break;
      }

      case 'volley':
      case 'ring': {
        this.stop();
        this.pose = 'cast';
        if (!this.volleyDone && this.stateT >= 0.75) {
          this.volleyDone = true;
          const n = this.state === 'ring' ? 12 : this.phase === 1 ? 3 : this.phase === 2 ? 5 : 7;
          const fan = this.state === 'ring' ? Math.PI * 2 : 0.9;
          for (let i = 0; i < n; i++) {
            const a = this.state === 'ring' ? toHero + (i / n) * fan : toHero + (i / (n - 1) - 0.5) * fan;
            ctx.emit({
              type: 'shoot',
              x: this.x + Math.cos(a) * 14,
              y: this.cy + Math.sin(a) * 10,
              vx: Math.cos(a) * 92,
              vy: Math.sin(a) * 92,
              dmg: 2,
              proj: 'rock',
              life: 2.4,
              radius: 5,
            });
          }
        }
        if (this.stateT >= 1.5) this.toIdle(0.9);
        break;
      }

      case 'summon': {
        this.stop();
        this.pose = 'cast';
        if (!this.summonDone && this.stateT >= 1) {
          this.summonDone = true;
          ctx.emit({ type: 'summon', x: this.x, y: this.cy, count: 2 });
        }
        if (this.stateT >= 1.6) this.toIdle(1.0);
        break;
      }
    }
  }

  private toIdle(t: number): void {
    this.pose = 'idle';
    this.setState('idle');
    this.idleFor = t;
  }
}

// ───────────────────────────── projectiles & shockwaves ─────────────────────────────

export class Projectile {
  alive = true;
  age = 0;
  constructor(
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
    readonly dmg: number,
    readonly proj: 'thorn' | 'rock' | 'orb',
    public life: number,
    readonly radius: number,
  ) {}

  get angle(): number {
    return Math.atan2(this.vy, this.vx);
  }

  update(dt: number, col: Collision, hero: HeroRef, onHit: (p: Projectile) => void, onWall: (p: Projectile) => void): void {
    if (!this.alive) return;
    this.age += dt;
    this.life -= dt;
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy) * dt) / 4));
    for (let i = 0; i < steps && this.alive; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      if (col.solidAtPx(this.x, this.y)) {
        this.alive = false;
        onWall(this);
        return;
      }
      if (hero.canBeHit && Math.hypot(hero.x - this.x, hero.y - 6 - this.y) < this.radius + 5) {
        this.alive = false;
        onHit(this);
        return;
      }
    }
    if (this.life <= 0) this.alive = false;
  }
}

export class Shockwave {
  r = 0;
  alive = true;
  private hit = false;
  constructor(
    readonly x: number,
    readonly y: number,
    readonly maxR: number,
    readonly speed: number,
    readonly dmg: number,
  ) {}

  update(dt: number, hero: HeroRef, onHit: (s: Shockwave) => void): void {
    if (!this.alive) return;
    this.r += this.speed * dt;
    if (!this.hit && hero.canBeHit) {
      const d = Math.hypot(hero.x - this.x, (hero.y - 4 - this.y) / 0.7);
      if (Math.abs(d - this.r) < 6) {
        this.hit = true;
        onHit(this);
      }
    }
    if (this.r >= this.maxR) this.alive = false;
  }

  get fade(): number {
    return clamp(1 - this.r / this.maxR, 0, 1);
  }
}

// ───────────────────────────── enemy world ─────────────────────────────

export type WorldEvent =
  | EnemyEvent
  | { type: 'projectile-wall'; p: Projectile }
  | { type: 'projectile-hit'; p: Projectile }
  | { type: 'spawned'; enemy: EnemyCore }
  | { type: 'removed'; enemy: EnemyCore };

/** Owns every live enemy, projectile and shockwave, and updates them together. Pure and testable. */
export class EnemyWorld {
  enemies: EnemyCore[] = [];
  projectiles: Projectile[] = [];
  shockwaves: Shockwave[] = [];
  packs: BatPack[] = [];
  events: WorldEvent[] = [];
  rand: () => number = Math.random;

  add<T extends EnemyCore>(e: T): T {
    this.enemies.push(e);
    this.events.push({ type: 'spawned', enemy: e });
    return e;
  }

  spawnBats(x: number, y: number, count: number, spawnId = ''): Bat[] {
    const pack = new BatPack();
    this.packs.push(pack);
    const out: Bat[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const b = new Bat(x + Math.cos(a) * 14, y + Math.sin(a) * 10, a);
      b.spawnId = spawnId;
      pack.add(b);
      this.add(b);
      out.push(b);
    }
    return out;
  }

  remove(e: EnemyCore): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    this.events.push({ type: 'removed', enemy: e });
  }

  clearAll(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) this.remove(this.enemies[i]);
    this.projectiles.length = 0;
    this.shockwaves.length = 0;
    this.packs.length = 0;
  }

  get minions(): number {
    return this.enemies.filter((e) => e.kind === 'bat' && !e.dead).length;
  }

  update(dt: number, hero: HeroRef, col: Collision): void {
    const ctx: EnemyCtx = {
      hero,
      col,
      rand: this.rand,
      minionsAlive: this.minions,
      emit: (e) => {
        this.events.push(e);
        if (e.type === 'shoot') this.projectiles.push(new Projectile(e.x, e.y, e.vx, e.vy, e.dmg, e.proj, e.life, e.radius));
        else if (e.type === 'shockwave') this.shockwaves.push(new Shockwave(e.x, e.y, e.maxR, e.speed, e.dmg));
      },
    };
    for (const p of this.packs) p.update(dt, ctx);
    for (const e of this.enemies) e.update(dt, ctx);
    this.separate();
    for (const p of this.projectiles)
      p.update(
        dt,
        col,
        hero,
        (pp) => {
          this.events.push({ type: 'projectile-hit', p: pp });
          this.events.push({ type: 'hit-hero', dmg: pp.dmg, fromX: pp.x - pp.vx * 0.05, fromY: pp.y - pp.vy * 0.05, knock: 110, source: null });
        },
        (pp) => this.events.push({ type: 'projectile-wall', p: pp }),
      );
    this.projectiles = this.projectiles.filter((p) => p.alive);
    for (const s of this.shockwaves)
      s.update(dt, hero, (sw) => this.events.push({ type: 'hit-hero', dmg: sw.dmg, fromX: sw.x, fromY: sw.y, knock: 140, source: null }));
    this.shockwaves = this.shockwaves.filter((s) => s.alive);
  }

  /** Soft push-apart so enemies don't stack. */
  private separate(): void {
    const list = this.enemies.filter((e) => !e.dead && e.kind !== 'boss');
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.flying !== b.flying) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.hw + b.hw + 2;
        if (d > 0 && d < min) {
          const push = (min - d) * 0.25;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
  }

  drainEvents(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export interface HitArc {
  x: number;
  y: number;
  angle: number;
  range: number;
  arc: number;
}

/** Is an enemy inside a swing arc? Uses the enemy's body radius so big enemies are easier to hit. */
export function inArc(e: EnemyCore, a: HitArc): boolean {
  const dx = e.x - a.x;
  const dy = e.cy - a.y;
  const d = Math.hypot(dx, dy);
  if (d > a.range + e.radius) return false;
  if (d < e.radius + 6) return true;
  let diff = Math.atan2(dy, dx) - a.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // widen the arc for close targets so they can't slip past the edge
  const widen = Math.asin(clamp(e.radius / Math.max(d, 1), 0, 1));
  return Math.abs(diff) <= a.arc + widen;
}
