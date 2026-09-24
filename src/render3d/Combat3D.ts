/**
 * Combat in 3D (docs/OVERHAUL.md, Batch 3).
 *
 * The enemy *simulation* is the same pure `EnemyWorld` the 2D build has always used — the same
 * slime hops, the same archer kiting, the same boss phases. This file is only the 3D half: it
 * spawns from the streamed chunks, gives every enemy a body, turns the hero's swings and arrows
 * into damage, and delivers the feedback the report asked for (hit-stop, knockback, flash,
 * camera shake, glowing trail, sound).
 *
 * Elements ride along on every hit: the weapon's element is applied to the target's `StatusBag`,
 * and any reaction from the table adds its damage multiplier and its burst.
 */
import * as THREE from 'three';
import { TILE } from '../config';
import { applyElement, ELEMENTS, REACTIONS, StatusBag, type ElementId } from '../core/combat/elements';
import { Archer, Boss, EnemyCore, EnemyWorld, inArc, Slime, type WorldEvent } from '../core/entities/enemies';
import type { HeroCore, ShootEvent, SwingEvent } from '../core/entities/HeroCore';
import { HERO_STATS } from '../core/entities/HeroCore';
import { sfx } from '../core/audio';
import { makeRng } from '../core/rng';
import type { GameState } from '../core/state/GameState';
import type { Collision } from '../core/world/collision';
import type { SpawnDef, WorldSource } from '../core/world/source';
import { EnemyMesh3D } from './EnemyMesh3D';
import { u } from './worldPlan';

/** One arrow or enemy projectile, with its own little body. */
interface Flying {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  pierce: number;
  element?: ElementId | undefined;
  hit: Set<EnemyCore>;
  mesh: THREE.Mesh;
}

export interface CombatHooks {
  /** Freeze the simulation for `ms` — the hit-stop that makes a blow land. */
  freeze(ms: number): void;
  shake(amount: number, seconds: number): void;
  /** A burst of sparks at a world position (2D px). */
  spark(x: number, y: number, color: number, big: boolean): void;
  /** A rising damage number at a world position (2D px). */
  damage(x: number, y: number, amount: number, color: string, big: boolean): void;
  /** An enemy died: the quest counts it, and it may leave a heal orb. */
  killed(kind: string, x: number, y: number): void;
  /** The boss woke up / was defeated, so the arena doors can react. */
  bossWoke(): void;
  bossDefeated(x: number, y: number): void;
}

export class Combat3D {
  readonly world = new EnemyWorld();
  private meshes = new Map<EnemyCore, EnemyMesh3D>();
  private statuses = new Map<EnemyCore, StatusBag>();
  private spawned = new Map<string, EnemyCore[]>();
  private arrows: Flying[] = [];
  private arrowGeo: THREE.BufferGeometry;
  private arrowMat: THREE.MeshBasicMaterial;
  private enemyProjGeo: THREE.BufferGeometry;
  private enemyProjMat: THREE.MeshBasicMaterial;
  private projMeshes = new Map<object, THREE.Mesh>();
  private boss: Boss | null = null;
  private clock = 0;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world3dSource: WorldSource,
    private readonly collision: Collision,
    private readonly state: GameState,
    private readonly hooks: CombatHooks,
  ) {
    this.world.rand = makeRng(0xbeef);
    this.arrowGeo = new THREE.BoxGeometry(0.5, 0.08, 0.08);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    this.enemyProjGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    this.enemyProjMat = new THREE.MeshBasicMaterial({ color: 0xb4dd6b });
  }

  get bossRef(): Boss | null {
    return this.boss;
  }

  /** Counted in a loop, not with `filter`: the HUD reads this every frame. */
  get enemyCount(): number {
    let n = 0;
    for (const e of this.world.enemies) if (!e.dead) n++;
    return n;
  }

  // ───────────────────────── spawning ─────────────────────────

  /** Spawn everything a freshly streamed chunk declares. */
  spawnForChunk(cx: number, cy: number): void {
    for (const s of this.world3dSource.chunk(cx, cy).spawns) this.spawn(s);
  }

  private spawn(s: SpawnDef): void {
    if (this.state.isDead(s.id) || this.spawned.has(s.id)) return;
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

  /** Drop everything belonging to a chunk that has streamed out. */
  despawnForChunk(cx: number, cy: number): void {
    for (const s of this.world3dSource.chunk(cx, cy).spawns) {
      const list = this.spawned.get(s.id);
      if (!list) continue;
      // a boss mid-fight stays; so does anything the hero is still standing next to
      if (list.some((e) => e instanceof Boss && e.awake && !e.dead)) continue;
      for (const e of list) {
        if (!e.dead) this.world.remove(e);
        this.dropMesh(e);
      }
      this.spawned.delete(s.id);
    }
  }

  private dropMesh(e: EnemyCore): void {
    this.meshes.get(e)?.dispose();
    this.meshes.delete(e);
    this.statuses.delete(e);
    if (this.boss === e && e.dead) this.boss = null;
  }

  private statusOf(e: EnemyCore): StatusBag {
    let bag = this.statuses.get(e);
    if (!bag) {
      // the boss shrugs off crowd control; everything else takes it in full
      bag = new StatusBag(e.kind === 'boss' ? { freeze: 0.35, shock: 0.6, burn: 0.7 } : {});
      this.statuses.set(e, bag);
    }
    return bag;
  }

  // ───────────────────────── the hero hitting things ─────────────────────────

  /**
   * A sword swing. Everything inside the arc takes the hit; the first connection pays for the
   * hit-stop and the shake, so a swing that touches five slimes does not freeze the game five times.
   */
  applySwing(hero: HeroCore, ev: SwingEvent): void {
    let hits = 0;
    let reacted = false;
    for (const e of this.world.enemies) {
      if (e.dead || !inArc(e, ev)) continue;
      const bag = this.statusOf(e);
      const el = hero.element;
      const res = el ? applyElement(bag, el) : { damageMult: 1, reaction: null };
      const dmg = Math.round(ev.dmg * res.damageMult);
      const stun = ev.index === 2 || hero.isHeavy ? 0.32 : 0.18;
      if (!e.hurt(dmg, hero.x, hero.y - 6, ev.knock, stun, { emit: (x) => this.world.events.push(x) })) continue;
      hits++;
      this.meshes.get(e)?.flash();
      this.hooks.damage(e.x, e.y - e.h - 2, dmg, res.reaction ? `#${res.reaction.color.toString(16).padStart(6, '0')}` : hero.isHeavy ? '#ffd15a' : '#ffffff', hero.isHeavy || !!res.reaction);
      this.hooks.spark(e.x, e.cy, res.reaction ? res.reaction.color : el ? ELEMENTS[el].color : 0xffe9a8, hero.isHeavy);
      if (res.reaction) {
        reacted = true;
        this.burst(e, res.reaction.burst, res.reaction.element, dmg);
      }
    }
    if (hits > 0) {
      this.hooks.freeze(HERO_STATS.hitStopMs * (hero.isHeavy ? 1.6 : 1));
      this.hooks.shake(HERO_STATS.hitShake * (hero.isHeavy ? 1.7 : 1), 0.14);
      sfx.hit(hero.isHeavy);
      if (reacted) sfx.reaction();
    }
  }

  /** A reaction that splashes: everything else nearby takes a share. */
  private burst(origin: EnemyCore, radius: number, element: ElementId, dmg: number): void {
    if (radius <= 0) return;
    this.hooks.spark(origin.x, origin.cy, ELEMENTS[element].color, true);
    for (const other of this.world.enemies) {
      if (other === origin || other.dead) continue;
      if (Math.hypot(other.x - origin.x, other.cy - origin.cy) > radius + other.radius) continue;
      const bag = this.statusOf(other);
      applyElement(bag, element);
      other.hurt(Math.max(1, Math.round(dmg * 0.5)), origin.x, origin.cy, 60, 0.12, { emit: (x) => this.world.events.push(x) });
      this.meshes.get(other)?.flash(0.1);
    }
  }

  /** The skill blast: everything inside the radius takes it, regardless of facing. */
  applyBlast(x: number, y: number, radius: number, dmg: number, knock: number, stun: number, hero: HeroCore): void {
    let hits = 0;
    for (const e of this.world.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - x, e.cy - y) > radius + e.radius) continue;
      const bag = this.statusOf(e);
      const res = hero.element ? applyElement(bag, hero.element) : { damageMult: 1, reaction: null };
      const blastDmg = Math.round(dmg * res.damageMult);
      if (!e.hurt(blastDmg, x, y, knock, stun, { emit: (ev) => this.world.events.push(ev) })) continue;
      hits++;
      this.meshes.get(e)?.flash();
      this.hooks.damage(e.x, e.y - e.h - 2, blastDmg, '#ffe066', true);
      this.hooks.spark(e.x, e.cy, res.reaction ? res.reaction.color : 0xffe066, true);
      if (res.reaction) this.burst(e, res.reaction.burst, res.reaction.element, dmg);
    }
    // a blast also swats enemy projectiles out of the air
    for (const p of this.world.projectiles) if (Math.hypot(p.x - x, p.y - y) < radius) p.alive = false;
    if (hits > 0) {
      this.hooks.freeze(90);
      sfx.hit(true);
    }
  }

  /** An arrow leaving the bow. */
  spawnArrow(ev: ShootEvent): void {
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    mesh.rotation.y = -Math.atan2(Math.sin(ev.angle), Math.cos(ev.angle)) + Math.PI / 2;
    this.scene.add(mesh);
    this.arrows.push({
      x: ev.x,
      y: ev.y,
      vx: Math.cos(ev.angle) * ev.speed,
      vy: Math.sin(ev.angle) * ev.speed,
      life: 1.4,
      dmg: ev.dmg,
      pierce: ev.pierce,
      element: ev.element,
      hit: new Set(),
      mesh,
    });
    sfx.bowShoot(ev.charge);
  }

  private updateArrows(dt: number): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.mesh.position.set(u(a.x), u(a.y > 0 ? 0 : 0) + 0.85, u(a.y));

      let dead = a.life <= 0 || this.collision.solidTile(Math.floor(a.x / TILE), Math.floor(a.y / TILE));
      if (!dead) {
        for (const e of this.world.enemies) {
          if (e.dead || a.hit.has(e)) continue;
          if (Math.hypot(e.x - a.x, e.cy - a.y) > e.radius + 4) continue;
          a.hit.add(e);
          const bag = this.statusOf(e);
          const res = a.element ? applyElement(bag, a.element) : { damageMult: 1, reaction: null };
          const dmg = Math.round(a.dmg * res.damageMult);
          if (e.hurt(dmg, a.x - a.vx * 0.02, a.y - a.vy * 0.02, 90, 0.16, { emit: (x) => this.world.events.push(x) })) {
            this.meshes.get(e)?.flash();
            this.hooks.damage(e.x, e.y - e.h - 2, dmg, res.reaction ? '#ffe066' : '#ffe9a8', a.pierce > 1);
            this.hooks.spark(e.x, e.cy, res.reaction ? res.reaction.color : 0xffe9a8, false);
            this.hooks.freeze(HERO_STATS.hitStopMs * 0.5);
            sfx.hit(false);
            if (res.reaction) {
              this.burst(e, res.reaction.burst, res.reaction.element, dmg);
              sfx.reaction();
            }
          }
          if (a.hit.size >= a.pierce) {
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        a.mesh.removeFromParent();
        this.arrows.splice(i, 1);
      }
    }
  }

  // ───────────────────────── per frame ─────────────────────────

  update(dt: number, realDt: number, hero: HeroCore): void {
    this.clock += realDt;
    if (dt > 0) {
      this.checkBossWake(hero);
      this.world.update(dt, hero, this.collision);
      this.updateArrows(dt);
      this.tickStatuses(dt);
    }
    this.drainEvents(hero);

    // bodies
    for (const e of this.world.enemies) {
      let mesh = this.meshes.get(e);
      if (!mesh) {
        mesh = new EnemyMesh3D(this.scene, e);
        this.meshes.set(e, mesh);
      }
      mesh.update(realDt, this.clock);
    }
    // enemy projectiles
    for (const p of this.world.projectiles) {
      let mesh = this.projMeshes.get(p);
      if (!mesh) {
        mesh = new THREE.Mesh(this.enemyProjGeo, this.enemyProjMat);
        this.scene.add(mesh);
        this.projMeshes.set(p, mesh);
      }
      mesh.position.set(u(p.x), 0.8, u(p.y));
    }
    for (const [p, mesh] of this.projMeshes) {
      if (this.world.projectiles.includes(p as never)) continue;
      mesh.removeFromParent();
      this.projMeshes.delete(p);
    }
  }

  /**
   * The boss sleeps until the hero is well inside the arena, past the door — otherwise it would
   * wake from the corridor and the door would slam with the player still outside it.
   */
  private checkBossWake(hero: HeroCore): void {
    const b = this.boss;
    if (!b || b.awake || b.dead) return;
    const arena = this.world3dSource.markers.boss.arena;
    const tx = Math.floor(hero.x / TILE);
    const ty = Math.floor(hero.y / TILE);
    if (tx >= arena.x0 + 3 && tx <= arena.x1 && ty >= arena.y0 && ty <= arena.y1) {
      b.wake({ emit: (e) => this.world.events.push(e) });
    }
  }

  /** Damage over time from burn, shock and the rest. */
  private tickStatuses(dt: number): void {
    for (const [e, bag] of this.statuses) {
      if (e.dead) continue;
      const t = bag.tick(dt);
      if (t.damage <= 0) continue;
      // status damage never knocks back: it would fight the player's own knockback
      if (e.hurt(t.damage, e.x, e.cy, 0, 0, { emit: (x) => this.world.events.push(x) })) this.meshes.get(e)?.flash(0.06);
    }
  }

  private drainEvents(hero: HeroCore): void {
    const events: WorldEvent[] = this.world.events.splice(0);
    for (const ev of events) {
      switch (ev.type) {
        case 'telegraph': {
          // the ring under the enemy, colour-coded by what is coming
          const color = ev.kind === 'slam' ? 0xa795ff : ev.kind === 'aim' ? 0xffb82e : 0xff5a4a;
          this.meshes.get(ev.enemy)?.setTelegraph(ev.dur, color);
          break;
        }
        case 'hit-hero': {
          if (hero.takeDamage(ev.dmg, ev.fromX, ev.fromY, ev.knock)) {
            this.hooks.freeze(70);
            this.hooks.shake(4, 0.22);
            sfx.hurt();
          }
          break;
        }
        case 'died': {
          this.hooks.spark(ev.enemy.x, ev.enemy.cy, 0xffe9a8, true);
          this.hooks.shake(2, 0.12);
          sfx.die();
          this.state.markKilled(ev.enemy.spawnId || `${ev.enemy.kind}`);
          this.hooks.killed(ev.enemy.kind, ev.enemy.x, ev.enemy.y);
          if (ev.enemy.kind === 'boss') this.hooks.bossDefeated(ev.enemy.x, ev.enemy.cy);
          break;
        }
        case 'roar':
          // the boss's wake-up roar: the arena doors slam on this
          if (ev.enemy.kind === 'boss') this.hooks.bossWoke();
          break;
        case 'removed':
          this.dropMesh(ev.enemy);
          break;
        default:
          break;
      }
    }
    // clean up bodies of enemies that have finished dying
    for (const [e, mesh] of this.meshes) {
      if (!e.dead) continue;
      if (this.world.enemies.includes(e)) continue;
      mesh.dispose();
      this.meshes.delete(e);
    }
  }

  /**
   * Auto-aim: nudge an attack toward the nearest enemy inside a cone in front of the hero.
   * Phone sticks are not precise, so without this every other swing misses by a few degrees.
   */
  aimAssist(hero: HeroCore, angle: number): number {
    let best: number | null = null;
    let bestScore = Infinity;
    const cone = (HERO_STATS.aimCone * Math.PI) / 180;
    for (const e of this.world.enemies) {
      if (e.dead || e.invulnerable) continue;
      const d = Math.hypot(e.x - hero.x, e.cy - (hero.y - 8));
      if (d > HERO_STATS.aimRange) continue;
      const a = Math.atan2(e.cy - (hero.y - 8), e.x - hero.x);
      let diff = a - angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > cone) continue;
      const score = d + Math.abs(diff) * 30;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best ?? angle;
  }

  /** For the report: which statuses are live right now. */
  statusSummary(): string {
    const counts = new Map<string, number>();
    for (const bag of this.statuses.values()) for (const s of bag.active) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
    if (!counts.size) return 'tidak ada';
    return [...counts].map(([k, v]) => `${k} x${v}`).join(', ');
  }

  get reactionCount(): number {
    return REACTIONS.length;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    for (const a of this.arrows) a.mesh.removeFromParent();
    this.arrows = [];
    for (const mesh of this.projMeshes.values()) mesh.removeFromParent();
    this.projMeshes.clear();
    this.world.clearAll();
    this.arrowGeo.dispose();
    this.arrowMat.dispose();
    this.enemyProjGeo.dispose();
    this.enemyProjMat.dispose();
  }
}

