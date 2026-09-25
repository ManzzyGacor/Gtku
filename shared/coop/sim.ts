/**
 * The co-op boss fight, as a pure simulation (docs/MULTIPLAYER.md).
 *
 * **The server runs this and nobody else decides anything.** Clients send only stick, aim and
 * buttons; positions, hits, damage, HP, the boss's choices and the outcome all come from here. The
 * one piece the client runs too is `stepMovement` — the same function, on its own inputs — to
 * predict its own hero between snapshots; the server's answer always wins.
 *
 * Deterministic for a given seed and input sequence (seeded RNG, fixed tick), which is what lets a
 * test play a whole fight.
 *
 * The boss is **Bayang Kolosus** — the Colossus's shadow, which the Mission Board sends parties to
 * put down. Four attacks, each announced before it lands: a slam (a circle on the ground where you
 * stand), a sweep (a cone in front of it), a volley of embers (rings of bolts), and from phase 3 a
 * charge. Players can roll through anything; a downed player gets up by themselves after a few
 * seconds — faster with a friend standing beside them — and the fight is lost only if everyone is
 * down at once.
 */
import { BTN_ATTACK, BTN_DODGE, BTN_SKILL, type SnapBoss, type SnapEvent, type SnapPlayer, type SnapThing } from './protocol';

// ───────────────────────── numbers (all tunable here) ─────────────────────────

export const ARENA_RADIUS = 170;
export const PILLARS: readonly { x: number; y: number; r: number }[] = [
  { x: -80, y: -60, r: 12 },
  { x: 80, y: -60, r: 12 },
  { x: -80, y: 70, r: 12 },
  { x: 80, y: 70, r: 12 },
];

export const PLAYER = {
  speed: 82,
  radius: 6,
  rollSpeed: 178,
  rollTime: 0.3,
  rollCooldown: 0.8,
  attackCooldown: 0.38,
  attackWindup: 0.1,
  attackTime: 0.25,
  attackRange: 38,
  attackArcDeg: 80,
  skillCooldown: 7,
  skillCast: 0.3,
  skillRadius: 56,
  skillMult: 3,
  critChance: 0.1,
  critMult: 1.8,
  downTime: 8,
  reviveRange: 22,
  reviveHp: 0.5,
};

export const BOSS = {
  hpBase: 2600,
  /** HP = hpBase × (hpShare + (1 − hpShare) × players): more friends, more boss. */
  hpShare: 0.6,
  radius: 18,
  speed: [28, 32, 40],
  keepDistance: 46,
  cooldown: [1.15, 0.9, 0.7],
  slam: { windup: [0.95, 0.85, 0.75], radius: 38, dmg: 4 },
  sweep: { windup: 0.7, range: 80, arcDeg: 110, dmg: 3 },
  volley: { windup: 0.55, bolts: [8, 12, 14], speed: 95, life: 3, dmg: 2, radius: 4 },
  charge: { windup: 0.6, speed: 230, time: 0.7, dmg: 4 },
};

/** Weapon rarity → co-op damage multiplier. */
const RARITY_MULT: Record<string, number> = { common: 1, uncommon: 1.1, rare: 1.25, epic: 1.45, legendary: 1.7, mythic: 2 };

/**
 * A player's co-op numbers, from the save the *server* holds (never from the client): level and the
 * rarity of the equipped weapon. Developer stat overrides do not apply in co-op.
 */
export function coopStats(level: number, weaponRarity: string | null): { maxHp: number; atk: number } {
  const l = Math.max(1, Math.min(30, Math.floor(level) || 1));
  return { maxHp: 12 + l * 2, atk: Math.round((6 + l * 1.2) * (RARITY_MULT[weaponRarity ?? 'common'] ?? 1) * 10) / 10 };
}

// ───────────────────────── rng ─────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── movement (shared with client prediction) ─────────────────────────

export interface MoveState {
  x: number;
  y: number;
  rollT: number;
  rollCd: number;
  rollDx: number;
  rollDy: number;
  downed: boolean;
}

export interface Input {
  /** Stick, −100..100 each. */
  x: number;
  y: number;
  /** Aim, degrees. */
  a: number;
  /** Buttons held (BTN_*). */
  b: number;
  /** Sequence number (for the client's reconciliation). */
  s: number;
}

export const NO_INPUT: Input = { x: 0, y: 0, a: 0, b: 0, s: 0 };

/** Keep a circle of radius `r` inside the arena and out of the pillars. */
export function collide(p: { x: number; y: number }, r: number): void {
  const d = Math.hypot(p.x, p.y);
  const max = ARENA_RADIUS - r;
  if (d > max) {
    p.x *= max / d;
    p.y *= max / d;
  }
  for (const c of PILLARS) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dd = Math.hypot(dx, dy);
    const min = c.r + r;
    if (dd < min && dd > 1e-6) {
      p.x = c.x + (dx / dd) * min;
      p.y = c.y + (dy / dd) * min;
    }
  }
}

/**
 * One step of a hero's movement: walking by the stick, or a roll once started. `rollPressed` is
 * true on the tick the dodge button went down. Used by the server *and* by the client's prediction,
 * so the two can only disagree when the server knows something the client does not.
 */
export function stepMovement(m: MoveState, input: Input, rollPressed: boolean, dt: number): void {
  m.rollCd = Math.max(0, m.rollCd - dt);
  if (m.downed) return;
  if (m.rollT > 0) {
    m.rollT -= dt;
    m.x += m.rollDx * PLAYER.rollSpeed * dt;
    m.y += m.rollDy * PLAYER.rollSpeed * dt;
    collide(m, PLAYER.radius);
    return;
  }
  const mag = Math.min(1, Math.hypot(input.x, input.y) / 100);
  if (rollPressed && m.rollCd <= 0) {
    const a = mag > 0.2 ? Math.atan2(input.y, input.x) : (input.a * Math.PI) / 180;
    m.rollDx = Math.cos(a);
    m.rollDy = Math.sin(a);
    m.rollT = PLAYER.rollTime;
    m.rollCd = PLAYER.rollCooldown;
    return;
  }
  if (mag > 0.05) {
    const len = Math.hypot(input.x, input.y);
    m.x += (input.x / len) * PLAYER.speed * mag * dt;
    m.y += (input.y / len) * PLAYER.speed * mag * dt;
    collide(m, PLAYER.radius);
  }
}

// ───────────────────────── the fight ─────────────────────────

export const P_IDLE = 0;
export const P_ATTACK = 1;
export const P_ROLL = 2;
export const P_CAST = 3;
export const P_DOWN = 4;

export interface SimPlayer extends MoveState {
  id: number;
  aim: number;
  hp: number;
  maxHp: number;
  atk: number;
  state: number;
  stateT: number;
  atkCd: number;
  skillCd: number;
  downT: number;
  input: Input;
  prevButtons: number;
  /** Highest input sequence applied; echoed so the client can reconcile. */
  lastSeq: number;
  threat: number;
  /** A hit this attack has already resolved. */
  struck: boolean;
  chargeHit: boolean;
  /** Disconnected players stand still (and can still be hit) until they return or time out. */
  connected: boolean;
}

export const B_IDLE = 0;
export const B_SLAM = 1;
export const B_SWEEP = 2;
export const B_VOLLEY = 3;
export const B_CHARGE = 4;
export const B_DEAD = 5;

interface Slam {
  x: number;
  y: number;
  t: number;
  total: number;
}
interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class CoopSim {
  readonly players = new Map<number, SimPlayer>();
  boss = { x: 0, y: -40, facing: Math.PI / 2, hp: 1, maxHp: 1, phase: 1, action: B_IDLE, actionT: 0, cooldown: 2, target: -1, chargeT: 0, chargeDx: 0, chargeDy: 0 };
  private slams: Slam[] = [];
  private bolts: Bolt[] = [];
  /** Things that happened since the last `drainEvents()`. */
  private events: SnapEvent[] = [];
  tick = 0;
  outcome: 'won' | 'lost' | null = null;
  private readonly rand: () => number;

  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }

  addPlayer(id: number, stats: { maxHp: number; atk: number }): SimPlayer {
    const n = this.players.size;
    const a = Math.PI / 2 + (n - 1.5) * 0.35;
    const p: SimPlayer = {
      id,
      x: Math.cos(a) * 110,
      y: Math.sin(a) * 110,
      rollT: 0,
      rollCd: 0,
      rollDx: 0,
      rollDy: 0,
      downed: false,
      aim: -Math.PI / 2,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      atk: stats.atk,
      state: P_IDLE,
      stateT: 0,
      atkCd: 0,
      skillCd: 0,
      downT: 0,
      input: { ...NO_INPUT },
      prevButtons: 0,
      lastSeq: 0,
      threat: 0,
      struck: false,
      chargeHit: false,
      connected: true,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  /** Start the fight: boss HP from the party size. */
  begin(): void {
    const n = Math.max(1, this.players.size);
    const hp = Math.round(BOSS.hpBase * (BOSS.hpShare + (1 - BOSS.hpShare) * n));
    Object.assign(this.boss, { x: 0, y: -40, hp, maxHp: hp, phase: 1, action: B_IDLE, actionT: 0, cooldown: 2, target: -1 });
    this.outcome = null;
  }

  /** The latest input from a player (the server keeps only the newest; old sequence numbers are ignored). */
  setInput(id: number, input: Input): void {
    const p = this.players.get(id);
    if (!p || input.s <= p.lastSeq) return;
    p.input = { ...input };
    p.lastSeq = input.s;
  }

  drainEvents(): SnapEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  step(dt: number): void {
    if (this.outcome) return;
    this.tick++;
    for (const p of this.players.values()) this.stepPlayer(p, dt);
    this.stepBoss(dt);
    this.stepThings(dt);
    // the outcome
    if (this.boss.hp <= 0) {
      this.boss.hp = 0;
      this.boss.action = B_DEAD;
      this.outcome = 'won';
    } else if (this.players.size > 0 && [...this.players.values()].every((p) => p.downed)) {
      this.outcome = 'lost';
    }
  }

  // ───────────────────────── players ─────────────────────────

  private stepPlayer(p: SimPlayer, dt: number): void {
    const inp = p.connected ? p.input : NO_INPUT;
    const pressed = inp.b & ~p.prevButtons;
    p.prevButtons = inp.b;
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);

    if (p.downed) {
      // a friend beside you gets you up twice as fast
      let helpers = 0;
      for (const o of this.players.values()) if (o !== p && !o.downed && Math.hypot(o.x - p.x, o.y - p.y) < PLAYER.reviveRange) helpers++;
      p.downT -= dt * (1 + helpers);
      if (p.downT <= 0) {
        p.downed = false;
        p.state = P_IDLE;
        p.hp = Math.max(1, Math.round(p.maxHp * PLAYER.reviveHp));
        this.events.push([4, p.id, p.hp]);
      }
      return;
    }

    if (Math.abs(inp.x) + Math.abs(inp.y) > 10) p.aim = (inp.a * Math.PI) / 180;
    else if (inp.b) p.aim = (inp.a * Math.PI) / 180;

    const wasRolling = p.rollT > 0;
    stepMovement(p, inp, (pressed & BTN_DODGE) !== 0 && p.state !== P_CAST, dt);
    if (p.rollT > 0) {
      p.state = P_ROLL;
      return;
    }
    if (wasRolling) p.state = P_IDLE;

    p.stateT -= dt;
    if (p.state === P_ATTACK) {
      if (!p.struck && p.stateT <= PLAYER.attackTime - PLAYER.attackWindup) {
        p.struck = true;
        this.playerHit(p, 1, PLAYER.attackRange, (PLAYER.attackArcDeg * Math.PI) / 360);
      }
      if (p.stateT <= 0) p.state = P_IDLE;
      return;
    }
    if (p.state === P_CAST) {
      if (p.stateT <= 0) {
        this.playerHit(p, PLAYER.skillMult, PLAYER.skillRadius, Math.PI);
        // the blast also swats embers out of the air
        this.bolts = this.bolts.filter((b) => Math.hypot(b.x - p.x, b.y - p.y) > PLAYER.skillRadius);
        p.state = P_IDLE;
      }
      return;
    }
    if (inp.b & BTN_SKILL && p.skillCd <= 0) {
      p.state = P_CAST;
      p.stateT = PLAYER.skillCast;
      p.skillCd = PLAYER.skillCooldown;
      return;
    }
    if (inp.b & BTN_ATTACK && p.atkCd <= 0) {
      p.state = P_ATTACK;
      p.stateT = PLAYER.attackTime;
      p.atkCd = PLAYER.attackCooldown;
      p.struck = false;
    }
  }

  /** A player's blow landing (or not) on the boss. The damage number is the server's alone. */
  private playerHit(p: SimPlayer, mult: number, range: number, halfArc: number): void {
    const b = this.boss;
    if (b.hp <= 0) return;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    if (Math.hypot(dx, dy) > range + BOSS.radius) return;
    if (halfArc < Math.PI) {
      let diff = Math.atan2(dy, dx) - p.aim;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > halfArc) return;
    }
    const crit = this.rand() < PLAYER.critChance;
    const dmg = Math.max(1, Math.round(p.atk * mult * (0.9 + this.rand() * 0.2) * (crit ? PLAYER.critMult : 1)));
    b.hp = Math.max(0, b.hp - dmg);
    p.threat += dmg;
    this.events.push([1, p.id, crit ? -dmg : dmg]);
    const phase = b.hp < b.maxHp / 3 ? 3 : b.hp < (b.maxHp * 2) / 3 ? 2 : 1;
    if (phase !== b.phase) b.phase = phase;
  }

  private hurt(p: SimPlayer, dmg: number): void {
    if (p.downed || p.rollT > 0) return;
    p.hp = Math.max(0, p.hp - dmg);
    this.events.push([2, p.id, dmg]);
    if (p.hp <= 0) {
      p.downed = true;
      p.state = P_DOWN;
      p.downT = PLAYER.downTime;
      this.events.push([3, p.id, 0]);
    }
  }

  // ───────────────────────── the boss ─────────────────────────

  private pickTarget(): SimPlayer | null {
    const alive = [...this.players.values()].filter((p) => !p.downed);
    if (!alive.length) return null;
    // mostly whoever hurts it most; sometimes anyone, so a healer-less party is not ping-ponged
    if (this.rand() < 0.3) return alive[Math.floor(this.rand() * alive.length) % alive.length];
    let best = alive[0];
    for (const p of alive) if (p.threat > best.threat) best = p;
    return best;
  }

  private stepBoss(dt: number): void {
    const b = this.boss;
    if (b.hp <= 0) return;
    const ph = b.phase - 1;
    const target = this.players.get(b.target);
    const tgt = target && !target.downed ? target : this.pickTarget();
    if (tgt) b.target = tgt.id;

    if (b.action === B_IDLE) {
      if (tgt) {
        const dx = tgt.x - b.x;
        const dy = tgt.y - b.y;
        const d = Math.hypot(dx, dy);
        b.facing = Math.atan2(dy, dx);
        if (d > BOSS.keepDistance) {
          b.x += (dx / d) * BOSS.speed[ph] * dt;
          b.y += (dy / d) * BOSS.speed[ph] * dt;
          collide(b, BOSS.radius);
        }
      }
      b.cooldown -= dt;
      if (b.cooldown <= 0 && tgt) this.startAttack(tgt);
      return;
    }

    b.actionT -= dt;
    if (b.action === B_CHARGE && b.actionT <= BOSS.charge.time) {
      // the dash itself, after the wind-up
      b.x += b.chargeDx * BOSS.charge.speed * dt;
      b.y += b.chargeDy * BOSS.charge.speed * dt;
      collide(b, BOSS.radius);
      for (const p of this.players.values())
        if (!p.chargeHit && Math.hypot(p.x - b.x, p.y - b.y) < BOSS.radius + PLAYER.radius + 2) {
          p.chargeHit = true;
          this.hurt(p, BOSS.charge.dmg);
        }
    }
    if (b.actionT > 0) return;

    // the attack lands
    if (b.action === B_SWEEP) {
      const half = (BOSS.sweep.arcDeg * Math.PI) / 360;
      for (const p of this.players.values()) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        if (Math.hypot(dx, dy) > BOSS.sweep.range + PLAYER.radius) continue;
        let diff = Math.atan2(dy, dx) - b.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) <= half) this.hurt(p, BOSS.sweep.dmg);
      }
    } else if (b.action === B_VOLLEY) {
      const n = BOSS.volley.bolts[ph];
      const turn = this.rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = turn + (i / n) * Math.PI * 2;
        this.bolts.push({ x: b.x, y: b.y, vx: Math.cos(a) * BOSS.volley.speed, vy: Math.sin(a) * BOSS.volley.speed, life: BOSS.volley.life });
      }
    }
    b.action = B_IDLE;
    b.cooldown = BOSS.cooldown[ph];
  }

  private startAttack(t: SimPlayer): void {
    const b = this.boss;
    const ph = b.phase - 1;
    const r = this.rand();
    const table: [number, number][] =
      b.phase === 1
        ? [[B_SLAM, 0.5], [B_SWEEP, 0.5]]
        : b.phase === 2
          ? [[B_SLAM, 0.35], [B_SWEEP, 0.3], [B_VOLLEY, 0.35]]
          : [[B_SLAM, 0.25], [B_SWEEP, 0.2], [B_VOLLEY, 0.25], [B_CHARGE, 0.3]];
    let acc = 0;
    let action = table[table.length - 1][0];
    for (const [a, w] of table) {
      acc += w;
      if (r < acc) {
        action = a;
        break;
      }
    }
    b.action = action;
    b.facing = Math.atan2(t.y - b.y, t.x - b.x);
    if (action === B_SLAM) {
      const w = BOSS.slam.windup[ph];
      b.actionT = w;
      // the circle goes where the target stands now: move out of it
      this.slams.push({ x: t.x, y: t.y, t: w, total: w });
    } else if (action === B_SWEEP) b.actionT = BOSS.sweep.windup;
    else if (action === B_VOLLEY) b.actionT = BOSS.volley.windup;
    else {
      b.actionT = BOSS.charge.windup + BOSS.charge.time;
      b.chargeDx = Math.cos(b.facing);
      b.chargeDy = Math.sin(b.facing);
      for (const p of this.players.values()) p.chargeHit = false;
    }
  }

  private stepThings(dt: number): void {
    for (let i = this.slams.length - 1; i >= 0; i--) {
      const s = this.slams[i];
      s.t -= dt;
      if (s.t > 0) continue;
      for (const p of this.players.values()) if (Math.hypot(p.x - s.x, p.y - s.y) <= BOSS.slam.radius + PLAYER.radius) this.hurt(p, BOSS.slam.dmg);
      this.slams.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let gone = b.life <= 0 || Math.hypot(b.x, b.y) > ARENA_RADIUS;
      if (!gone)
        for (const p of this.players.values()) {
          if (p.downed || Math.hypot(p.x - b.x, p.y - b.y) > PLAYER.radius + BOSS.volley.radius) continue;
          this.hurt(p, BOSS.volley.dmg);
          gone = p.rollT <= 0; // a rolling player lets the ember pass through
          if (gone) break;
        }
      if (gone) this.bolts.splice(i, 1);
    }
  }

  // ───────────────────────── snapshots ─────────────────────────

  snapPlayers(): SnapPlayer[] {
    const out: SnapPlayer[] = [];
    for (const p of this.players.values())
      out.push([p.id, Math.round(p.x), Math.round(p.y), Math.round((p.aim * 180) / Math.PI), Math.ceil(p.hp), p.maxHp, p.downed ? P_DOWN : p.state]);
    return out;
  }

  snapBoss(): SnapBoss {
    const b = this.boss;
    return [Math.round(b.x), Math.round(b.y), Math.round((b.facing * 180) / Math.PI), Math.ceil(b.hp), b.maxHp, b.phase, b.action, Math.max(0, Math.round(b.actionT * 10))];
  }

  snapThings(): SnapThing[] {
    const out: SnapThing[] = [];
    for (const s of this.slams) out.push([1, Math.round(s.x), Math.round(s.y), BOSS.slam.radius, Math.max(0, Math.round(s.t * 10))]);
    const b = this.boss;
    if (b.action === B_SWEEP) out.push([2, Math.round(b.x), Math.round(b.y), Math.round((b.facing * 180) / Math.PI), Math.max(0, Math.round(b.actionT * 10))]);
    for (const bolt of this.bolts) out.push([3, Math.round(bolt.x), Math.round(bolt.y), 0, 0]);
    return out;
  }
}
