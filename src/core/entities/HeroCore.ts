/**
 * Pure hero state machine: movement, 3-hit combo, dodge roll, skill, damage. No Phaser.
 * The scene drains `events` every frame to spawn hit tests, particles, sounds, camera shake, etc.
 */
import { clamp } from '../rng';
import type { Collision } from '../world/collision';

export type HeroState = 'free' | 'attack' | 'roll' | 'hurt' | 'cast' | 'dead';
export type Dir4 = 'd' | 'u' | 's';

export interface HeroInput {
  mx: number;
  my: number;
  attack: boolean;
  dodge: boolean;
  skill: boolean;
}

export interface SwingEvent {
  type: 'swing';
  x: number;
  y: number;
  angle: number;
  range: number;
  arc: number;
  dmg: number;
  knock: number;
  index: number;
}
export type HeroEvent =
  | SwingEvent
  | { type: 'swing-start'; index: number; angle: number }
  | { type: 'blast'; x: number; y: number; radius: number; dmg: number; knock: number; stun: number }
  | { type: 'roll'; x: number; y: number; angle: number }
  | { type: 'step'; x: number; y: number }
  | { type: 'hurt'; hp: number }
  | { type: 'dead' }
  | { type: 'cast-start' }
  | { type: 'skill-ready' };

interface AttackDef {
  windup: number;
  active: number;
  recover: number;
  dmg: number;
  range: number;
  arc: number; // half-angle, radians
  knock: number;
  lunge: number; // px/s
}

const D = Math.PI / 180;
export const ATTACKS: AttackDef[] = [
  { windup: 0.07, active: 0.08, recover: 0.16, dmg: 2, range: 30, arc: 64 * D, knock: 70, lunge: 90 },
  { windup: 0.06, active: 0.08, recover: 0.16, dmg: 2, range: 30, arc: 64 * D, knock: 70, lunge: 90 },
  { windup: 0.1, active: 0.1, recover: 0.24, dmg: 4, range: 36, arc: 80 * D, knock: 150, lunge: 190 },
];

export const HERO_STATS = {
  hw: 5,
  h: 7,
  speed: 82,
  accel: 760,
  decel: 980,
  maxHp: 12,
  rollTime: 0.34,
  rollInvuln: 0.3,
  rollSpeed: 178,
  rollCooldown: 0.5,
  comboWindow: 0.24,
  invulnAfterHit: 0.9,
  skillCooldown: 7,
  skillCast: 0.42,
  skillFire: 0.2,
  skillRadius: 52,
  skillDmg: 6,
};

export class HeroCore {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  hp = HERO_STATS.maxHp;
  maxHp = HERO_STATS.maxHp;
  state: HeroState = 'free';
  stateT = 0;
  /** Movement/attack direction in radians (screen coords: 0 = right, +y down). */
  aim = Math.PI / 2;
  combo = 0;
  comboTimer = 0;
  queuedAttack = false;
  rollCd = 0;
  skillCd = 0;
  invuln = 0;
  /** Set true while the roll's i-frames are running. */
  rolling = false;
  events: HeroEvent[] = [];
  private swingFired = false;
  private skillFired = false;
  private stepT = 0;
  /** Input buffers (seconds left): a press is remembered briefly so it isn't lost during recovery/roll. */
  private bufAtk = 0;
  private bufDodge = 0;
  private bufSkill = 0;
  /** Optional assist: given a desired attack angle return an adjusted one (auto-aim). */
  aimAssist: ((angle: number) => number) | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get attackDef(): AttackDef {
    return ATTACKS[Math.min(this.combo, ATTACKS.length - 1)];
  }

  /** Attack phase 0 = windup, 1 = active, 2 = recovery. */
  get attackPhase(): 0 | 1 | 2 {
    const a = this.attackDef;
    return this.stateT < a.windup ? 0 : this.stateT < a.windup + a.active ? 1 : 2;
  }

  get skillReady(): boolean {
    return this.skillCd <= 0;
  }

  get canBeHit(): boolean {
    return this.alive && this.invuln <= 0 && !this.rolling;
  }

  /** Teleport / respawn. */
  reset(x: number, y: number, hp = this.maxHp): void {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.hp = hp;
    this.state = 'free';
    this.stateT = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.invuln = 1.2;
    this.rolling = false;
    this.queuedAttack = false;
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  takeDamage(dmg: number, fromX: number, fromY: number, knock = 110): boolean {
    if (!this.canBeHit) return false;
    this.hp = Math.max(0, this.hp - dmg);
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.vx = Math.cos(a) * knock;
    this.vy = Math.sin(a) * knock;
    this.invuln = HERO_STATS.invulnAfterHit;
    this.queuedAttack = false;
    this.combo = 0;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.stateT = 0;
      this.events.push({ type: 'dead' });
    } else {
      this.state = 'hurt';
      this.stateT = 0;
      this.events.push({ type: 'hurt', hp: this.hp });
    }
    return true;
  }

  private setState(s: HeroState): void {
    this.state = s;
    this.stateT = 0;
  }

  private approach(cur: number, target: number, rate: number, dt: number): number {
    const d = target - cur;
    const step = rate * dt;
    return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
  }

  private startAttack(input: HeroInput): void {
    // choose direction: input if held, else current aim; then assist
    let angle = input.mx !== 0 || input.my !== 0 ? Math.atan2(input.my, input.mx) : this.aim;
    if (this.aimAssist) angle = this.aimAssist(angle);
    this.aim = angle;
    this.setState('attack');
    this.swingFired = false;
    this.queuedAttack = false;
    this.events.push({ type: 'swing-start', index: this.combo, angle });
  }

  private startRoll(input: HeroInput): void {
    const has = input.mx !== 0 || input.my !== 0;
    const angle = has ? Math.atan2(input.my, input.mx) : this.aim;
    this.aim = angle;
    this.setState('roll');
    this.rolling = true;
    this.rollCd = HERO_STATS.rollCooldown + HERO_STATS.rollTime;
    this.queuedAttack = false;
    this.combo = 0;
    this.events.push({ type: 'roll', x: this.x, y: this.y, angle });
  }

  update(dt: number, inp: HeroInput, col: Collision, speedMult = 1): void {
    this.bufAtk = inp.attack ? 0.18 : Math.max(0, this.bufAtk - dt);
    this.bufDodge = inp.dodge ? 0.18 : Math.max(0, this.bufDodge - dt);
    this.bufSkill = inp.skill ? 0.18 : Math.max(0, this.bufSkill - dt);
    this.rollCd = Math.max(0, this.rollCd - dt);
    const wasReady = this.skillCd <= 0;
    this.skillCd = Math.max(0, this.skillCd - dt);
    if (!wasReady && this.skillCd <= 0) this.events.push({ type: 'skill-ready' });
    this.invuln = Math.max(0, this.invuln - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && this.state === 'free') this.combo = 0;
    this.stateT += dt;

    let targetVx = 0;
    let targetVy = 0;
    let accel = HERO_STATS.accel;
    let moveMult = speedMult;

    switch (this.state) {
      case 'dead':
        targetVx = targetVy = 0;
        accel = HERO_STATS.decel;
        break;

      case 'free': {
        const mag = clamp(Math.hypot(inp.mx, inp.my), 0, 1);
        if (mag > 0.05) {
          const s = HERO_STATS.speed * moveMult * (mag < 0.35 ? 0.55 : 1);
          targetVx = (inp.mx / mag) * s * Math.min(1, mag * 1.15);
          targetVy = (inp.my / mag) * s * Math.min(1, mag * 1.15);
          this.aim = Math.atan2(inp.my, inp.mx);
        } else accel = HERO_STATS.decel;
        if (this.bufDodge > 0 && this.rollCd <= 0) {
          this.bufDodge = 0;
          this.startRoll(inp);
        } else if (this.bufSkill > 0 && this.skillReady) {
          this.bufSkill = 0;
          this.setState('cast');
          this.skillFired = false;
          this.events.push({ type: 'cast-start' });
        } else if (this.bufAtk > 0) {
          this.bufAtk = 0;
          this.combo = this.comboTimer > 0 ? Math.min(this.combo + 1, ATTACKS.length - 1) : 0;
          this.startAttack(inp);
        }
        break;
      }

      case 'attack': {
        const a = this.attackDef;
        if (this.bufAtk > 0) this.queuedAttack = true;
        // lunge along aim during windup + active
        if (this.stateT < a.windup + a.active) {
          const k = this.stateT < a.windup ? 0.35 : 1;
          targetVx = Math.cos(this.aim) * a.lunge * k;
          targetVy = Math.sin(this.aim) * a.lunge * k;
          accel = 4000;
        } else accel = HERO_STATS.decel;
        if (!this.swingFired && this.stateT >= a.windup) {
          this.swingFired = true;
          this.events.push({
            type: 'swing',
            x: this.x,
            y: this.y - 8,
            angle: this.aim,
            range: a.range,
            arc: a.arc,
            dmg: a.dmg,
            knock: a.knock,
            index: this.combo,
          });
        }
        const total = a.windup + a.active + a.recover;
        const doneActive = this.stateT >= a.windup + a.active;
        if (this.bufDodge > 0 && doneActive && this.rollCd <= 0) {
          this.bufDodge = 0;
          this.startRoll(inp);
        } else if (doneActive && this.queuedAttack && this.combo < ATTACKS.length - 1) {
          this.bufAtk = 0;
          this.combo += 1;
          this.startAttack(inp);
        } else if (this.stateT >= total) {
          this.comboTimer = this.combo < ATTACKS.length - 1 ? HERO_STATS.comboWindow : 0;
          this.setState('free');
        }
        break;
      }

      case 'roll': {
        const t = clamp(this.stateT / HERO_STATS.rollTime, 0, 1);
        const sp = HERO_STATS.rollSpeed * (1 - 0.55 * t * t) * Math.min(1.1, moveMult + 0.15);
        targetVx = Math.cos(this.aim) * sp;
        targetVy = Math.sin(this.aim) * sp;
        accel = 6000;
        this.rolling = this.stateT < HERO_STATS.rollInvuln;
        if (this.stateT >= HERO_STATS.rollTime) {
          this.rolling = false;
          this.setState('free');
        }
        break;
      }

      case 'cast': {
        accel = HERO_STATS.decel;
        if (!this.skillFired && this.stateT >= HERO_STATS.skillFire) {
          this.skillFired = true;
          this.skillCd = HERO_STATS.skillCooldown;
          this.events.push({
            type: 'blast',
            x: this.x,
            y: this.y - 6,
            radius: HERO_STATS.skillRadius,
            dmg: HERO_STATS.skillDmg,
            knock: 160,
            stun: 1.1,
          });
        }
        if (this.stateT >= HERO_STATS.skillCast) this.setState('free');
        break;
      }

      case 'hurt':
        accel = 900;
        if (this.stateT >= 0.22) this.setState('free');
        break;
    }

    this.vx = this.approach(this.vx, targetVx, accel, dt);
    this.vy = this.approach(this.vy, targetVy, accel, dt);
    const dx = this.vx * dt;
    const dy = this.vy * dt;
    if (dx !== 0 || dy !== 0) {
      const r = col.move(this.x, this.y, HERO_STATS.hw, HERO_STATS.h, dx, dy);
      if (r.hitX) this.vx = 0;
      if (r.hitY) this.vy = 0;
      this.x = r.x;
      this.y = r.y;
    }

    // footsteps
    if (this.state === 'free' && Math.hypot(this.vx, this.vy) > 30) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.22;
        this.events.push({ type: 'step', x: this.x, y: this.y });
      }
    } else this.stepT = 0.05;
  }

  /** Sprite direction (down/up/side) and horizontal flip for an aim angle. */
  static dirOf(angle: number): { dir: Dir4; flip: boolean } {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    if (Math.abs(dy) > Math.abs(dx) * 1.15) return { dir: dy > 0 ? 'd' : 'u', flip: false };
    return { dir: 's', flip: dx < 0 };
  }
}
