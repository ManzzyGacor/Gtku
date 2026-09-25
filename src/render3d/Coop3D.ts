/**
 * The co-op arena, drawn (docs/MULTIPLAYER.md). Only drawing: every position, HP and attack comes
 * from `CoopClient.draw()` — the server's world, interpolated, plus our own predicted hero.
 *
 * The arena is its own little place, built **outside the world map** (the world streamer ignores
 * chunks out of range, so nothing else is there): a round stone floor, a rim, four pillars with
 * lanterns, the party, and the boss. Telegraphs are drawn exactly where the server will resolve
 * them — a red circle for a slam, a cone for a sweep — and the embers of a volley are small bright
 * cubes, one instanced draw call.
 */
import * as THREE from 'three';
import { HeroCore } from '../core/entities/HeroCore';
import type { EnemyCore } from '../core/entities/enemies';
import type { DrawPlayer } from '../core/coop/client';
import { ARENA_RADIUS, BOSS, P_ATTACK, P_CAST, P_DOWN, P_ROLL, PILLARS, PLAYER } from '../../shared/coop/sim';
import type { SnapBoss, SnapThing } from '../../shared/coop/protocol';
import { EnemyMesh3D } from './EnemyMesh3D';
import { HeroMesh3D } from './HeroMesh3D';
import type { GearLook } from '../core/items/look';
import { u } from './worldPlan';

/** Where the arena sits, in world px: far west of the map, where no chunk exists. */
export const ARENA_ORIGIN = { x: -4200, y: 700 };

const MAX_BOLTS = 48;
const MAX_SLAMS = 8;

interface Hero {
  /** The last frame this hero was in the view; gone ones are removed (no per-frame Set). */
  seen: number;
  mesh: HeroMesh3D;
  core: HeroCore;
  state: number;
  lastX: number;
  lastY: number;
}

export class Coop3D {
  readonly root = new THREE.Group();
  private readonly heroes = new Map<number, Hero>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private boss: EnemyMesh3D | null = null;
  private readonly bossPuppet = { kind: 'boss', x: 0, y: 0, cy: 0, facing: 0, radius: BOSS.radius, dead: false, hp: 1 };
  private readonly slams: THREE.Mesh[] = [];
  private readonly sweep: THREE.Mesh;
  private readonly bolts: THREE.InstancedMesh;
  private readonly tmp = new THREE.Object3D();
  private lastBossAction = 0;
  private time = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly myLook: GearLook | null,
  ) {
    this.root.position.set(u(ARENA_ORIGIN.x), 0, u(ARENA_ORIGIN.y));
    parent.add(this.root);
    this.build();

    const ringGeo = this.geo(new THREE.RingGeometry(0.82, 1, 28));
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SLAMS; i++) {
      const mat = this.mat(new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.6, depthWrite: false }));
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.visible = false;
      ring.position.y = 0.03;
      this.slams.push(ring);
      this.root.add(ring);
    }
    // the sweep: a flat fan in front of the boss
    const half = (BOSS.sweep.arcDeg * Math.PI) / 360;
    const fan = this.geo(new THREE.CircleGeometry(u(BOSS.sweep.range), 18, -half, half * 2));
    fan.rotateX(-Math.PI / 2);
    this.sweep = new THREE.Mesh(fan, this.mat(new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })));
    this.sweep.visible = false;
    this.sweep.position.y = 0.025;
    this.root.add(this.sweep);
    this.bolts = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.28, 0.28, 0.28)), this.mat(new THREE.MeshBasicMaterial({ color: 0xffb04a })), MAX_BOLTS);
    this.bolts.count = 0;
    this.bolts.frustumCulled = false;
    this.root.add(this.bolts);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** Floor, rim, pillars and lanterns. */
  private build(): void {
    const floor = new THREE.Mesh(this.geo(new THREE.CircleGeometry(u(ARENA_RADIUS + 10), 40)), this.mat(new THREE.MeshLambertMaterial({ color: 0x3b3550 })));
    floor.rotateX(-Math.PI / 2);
    this.root.add(floor);
    const inner = new THREE.Mesh(this.geo(new THREE.RingGeometry(u(ARENA_RADIUS * 0.45), u(ARENA_RADIUS * 0.48), 40)), this.mat(new THREE.MeshBasicMaterial({ color: 0x6a5aa0 })));
    inner.rotateX(-Math.PI / 2);
    inner.position.y = 0.01;
    this.root.add(inner);
    // the rim: a ring of standing stones
    const stone = this.geo(new THREE.BoxGeometry(1.1, 1.4, 0.8));
    const stoneMat = this.mat(new THREE.MeshLambertMaterial({ color: 0x5a5470 }));
    const n = 28;
    const rim = new THREE.InstancedMesh(stone, stoneMat, n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.tmp.position.set(Math.cos(a) * u(ARENA_RADIUS + 8), 0.7, Math.sin(a) * u(ARENA_RADIUS + 8));
      this.tmp.rotation.set(0, -a, 0);
      this.tmp.updateMatrix();
      rim.setMatrixAt(i, this.tmp.matrix);
    }
    this.root.add(rim);
    // four pillars, each with a lantern on top
    const pillarMat = this.mat(new THREE.MeshLambertMaterial({ color: 0x7a7294 }));
    const lampMat = this.mat(new THREE.MeshBasicMaterial({ color: 0xffd98a }));
    for (const p of PILLARS) {
      const pillar = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(u(p.r), u(p.r) * 1.1, 3.2, 8)), pillarMat);
      pillar.position.set(u(p.x), 1.6, u(p.y));
      const lamp = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.5, 0.6, 0.5)), lampMat);
      lamp.position.set(u(p.x), 3.5, u(p.y));
      this.root.add(pillar, lamp);
    }
  }

  /** Arena px → world units (for the camera). */
  toWorld(x: number, y: number): { x: number; z: number } {
    return { x: u(ARENA_ORIGIN.x + x), z: u(ARENA_ORIGIN.y + y) };
  }

  /** Draw one frame from the client's view of the fight. */
  update(dt: number, players: DrawPlayer[], boss: SnapBoss | null, things: SnapThing[]): void {
    this.time += dt;
    this.updateHeroes(dt, players);
    this.updateBoss(dt, boss);
    this.updateThings(things);
  }

  private frame = 0;

  private updateHeroes(dt: number, players: DrawPlayer[]): void {
    const frame = ++this.frame;
    for (const p of players) {
      let h = this.heroes.get(p.id);
      if (!h) {
        const mesh = new HeroMesh3D(this.root);
        if (p.you && this.myLook) mesh.setGear(this.myLook);
        h = { seen: frame, mesh, core: new HeroCore(p.x, p.y), state: -1, lastX: p.x, lastY: p.y };
        this.heroes.set(p.id, h);
      }
      h.seen = frame;
      const c = h.core;
      // the mesh reads a hero; this one is a puppet of the server's (or our predicted) numbers
      c.vx = dt > 0 ? (p.x - h.lastX) / dt : 0;
      c.vy = dt > 0 ? (p.y - h.lastY) / dt : 0;
      h.lastX = p.x;
      h.lastY = p.y;
      c.x = p.x;
      c.y = p.y;
      c.aim = (p.aim * Math.PI) / 180;
      c.hp = Math.max(p.state === P_DOWN ? 0 : 1, p.hp);
      if (p.state !== h.state) {
        c.stateT = 0;
        h.state = p.state;
      } else c.stateT += dt;
      c.combo = 0;
      c.state = p.state === P_ATTACK ? 'attack' : p.state === P_ROLL ? 'roll' : p.state === P_CAST ? 'cast' : p.state === P_DOWN ? 'dead' : 'free';
      h.mesh.update(dt, dt, c, this.time);
      // the mesh places itself in world coordinates; inside the arena group they are arena-local
      h.mesh.root.position.set(u(p.x), 0, u(p.y));
      h.mesh.lantern.intensity = p.you ? 2.2 : 1.2;
    }
    for (const [id, h] of this.heroes)
      if (h.seen !== frame) {
        h.mesh.dispose();
        this.heroes.delete(id);
      }
  }

  private updateBoss(dt: number, b: SnapBoss | null): void {
    if (!b) return;
    if (!this.boss) this.boss = new EnemyMesh3D(this.root, this.bossPuppet as unknown as EnemyCore);
    const pup = this.bossPuppet;
    pup.x = b[0];
    pup.y = b[1];
    pup.cy = b[1] - 12;
    pup.facing = (b[2] * Math.PI) / 180;
    pup.dead = b[3] <= 0;
    // a new wind-up: the ring under the boss closes in over the telegraph time
    if (b[6] !== this.lastBossAction && b[6] !== 0 && b[7] > 0) this.boss.setTelegraph(b[7] / 10, b[6] === 4 ? 0xff3a3a : 0xff8a3a);
    this.lastBossAction = b[6];
    this.boss.update(dt, this.time);
  }

  private updateThings(things: SnapThing[]): void {
    let slam = 0;
    let bolts = 0;
    this.sweep.visible = false;
    for (const t of things) {
      if (t[0] === 1 && slam < MAX_SLAMS) {
        const ring = this.slams[slam++];
        ring.visible = true;
        ring.position.set(u(t[1]), 0.03, u(t[2]));
        // it closes in as the slam approaches
        const left = t[4] / 10;
        const s = u(t[3]) * (1 + Math.min(1, left) * 0.25);
        ring.scale.set(s, 1, s);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + (1 - Math.min(1, left)) * 0.5;
      } else if (t[0] === 2) {
        this.sweep.visible = true;
        this.sweep.position.set(u(t[1]), 0.025, u(t[2]));
        this.sweep.rotation.y = -((t[3] * Math.PI) / 180);
      } else if (t[0] === 3 && bolts < MAX_BOLTS) {
        this.tmp.position.set(u(t[1]), 0.6, u(t[2]));
        this.tmp.rotation.set(this.time * 4, this.time * 3, 0);
        this.tmp.scale.setScalar(1);
        this.tmp.updateMatrix();
        this.bolts.setMatrixAt(bolts++, this.tmp.matrix);
      }
    }
    for (let i = slam; i < MAX_SLAMS; i++) this.slams[i].visible = false;
    this.bolts.count = bolts;
    this.bolts.instanceMatrix.needsUpdate = true;
  }

  /** Where a name label goes for each player (world px, like the HUD's other labels). */
  labelSpots(players: DrawPlayer[], names: Map<number, string>): { x: number; y: number; z: number; text: string }[] {
    return players.map((p) => ({ x: u(ARENA_ORIGIN.x + p.x), y: 2.3, z: u(ARENA_ORIGIN.y + p.y), text: `${names.get(p.id) ?? '?'}${p.state === P_DOWN ? ' (jatuh)' : ''}` }));
  }

  get playerRadius(): number {
    return PLAYER.radius;
  }

  dispose(): void {
    for (const h of this.heroes.values()) h.mesh.dispose();
    this.heroes.clear();
    this.boss?.dispose();
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    void this.parent;
  }
}
