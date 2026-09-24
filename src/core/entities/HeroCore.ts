/**
 * Pure hero state machine: movement, 3-hit combo, dodge roll, skill, damage. No Phaser.
 * The scene drains `events` every frame to spawn hit tests, particles, sounds, camera shake, etc.
 */
import { clamp } from '../rng';
import type { Collision } from '../world/collision';
import type { ElementId } from '../combat/elements';
import { DEFAULT_LOADOUT, FULL_CHARGE_TIME, shotForCharge, WEAPONS, type ShotDef, type WeaponId } from '../combat/weapons';

export type HeroState = 'free' | 'attack' | 'roll' | 'hurt' | 'cast' | 'dead' | 'shoot' | 'swap';
export type Dir4 = 'd' | 'u' | 's';

export interface HeroInput {
  mx: number;
  my: number;
  /** True on the frame the attack was pressed. */
  attack: boolean;
  /** True while the attack button stays down — this is what turns a tap into a heavy swing. */
  attackHeld?: boolean;
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
/** An arrow leaving the bow. The renderer turns this into a projectile it owns. */
export interface ShootEvent {
  type: 'shoot';
  x: number;
  y: number;
  angle: number;
  speed: number;
  dmg: number;
  pierce: number;
  /** 0..1, for effect scale and sound pitch. */
  charge: number;
  element?: ElementId | undefined;
  shot: string;
}

export type HeroEvent =
  | SwingEvent
  | ShootEvent
  | { type: 'swap'; to: WeaponId }
  | { type: 'charge'; level: number }
  | { type: 'swing-start'; index: number; angle: number }
  | { type: 'blast'; x: number; y: number; radius: number; dmg: number; knock: number; stun: number }
  | { type: 'roll'; x: number; y: number; angle: number }
  | { type: 'step'; x: number; y: number }
  | { type: 'hurt'; hp: number }
  | { type: 'dead' }
  | { type: 'cast-start' }
  | { type: 'skill-ready' };

export interface AttackDef {
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

/**
 * The combo, as data. Index 3 is the **heavy** finisher, reached by holding the attack button
 * rather than by tapping. Every field here is adjustable at runtime from the combat panel
 * (see `combatTuning.ts`), because how a swing feels can only be judged on the device.
 */
export const ATTACKS: AttackDef[] = [
  { windup: 0.08, active: 0.09, recover: 0.14, dmg: 2, range: 32, arc: 70 * D, knock: 70, lunge: 130 },
  { windup: 0.07, active: 0.09, recover: 0.14, dmg: 2, range: 32, arc: 70 * D, knock: 80, lunge: 150 },
  { windup: 0.11, active: 0.11, recover: 0.22, dmg: 4, range: 38, arc: 84 * D, knock: 150, lunge: 210 },
  { windup: 0.22, active: 0.13, recover: 0.32, dmg: 7, range: 44, arc: 100 * D, knock: 230, lunge: 250 },
];
/** Index of the heavy finisher in `ATTACKS`. */
export const HEAVY_INDEX = 3;
/** How many swings a tapped combo runs through before it loops. */
export const LIGHT_COMBO = 3;

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
  comboWindow: 0.3,
  invulnAfterHit: 0.9,
  /** Holding the attack button this long turns the swing into the heavy finisher. */
  holdTime: 0.26,
  /** How fast the hero may keep turning during a swing's wind-up, in degrees per second. */
  attackTurnRate: 420,
  /** Fraction of walking speed the player keeps during a swing's wind-up. */
  attackSteer: 0.3,
  /** Simulation freeze on a landed hit, in milliseconds. */
  hitStopMs: 70,
  /** Camera shake on a landed hit, in pixels. */
  hitShake: 3.5,
  /** Half-angle of the auto-aim cone, in degrees. */
  aimCone: 55,
  /** How far auto-aim looks for a target, in pixels. */
  aimRange: 62,
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
  /** Set when the attack button has been held long enough to promote the follow-up to heavy. */
  queuedHeavy = false;
  private holdT = 0;

  // ── weapons ──
  /** The two slots the player carries, and which one is in hand. */
  loadout: [WeaponId, WeaponId] = [...DEFAULT_LOADOUT];
  slot: 0 | 1 = 0;
  /** Bow draw progress, 0..1. Only meaningful while the attack button is held with the bow out. */
  charge = 0;
  /** Element the next hit carries, from the weapon or a buff. */
  element: ElementId | undefined = undefined;
  private shot: ShotDef | null = null;
  private shotFired = false;
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
  get weapon(): WeaponId {
    return this.loadout[this.slot];
  }

  get weaponDef(): (typeof WEAPONS)[WeaponId] {
    return WEAPONS[this.weapon];
  }

  get isRanged(): boolean {
    return this.weaponDef.kind === 'ranged';
  }

  /**
   * Swap to the other slot. Quick on purpose — the plan wants swapping to be usable *inside* a
   * combo, so it interrupts recovery but not an active swing.
   */
  swapWeapon(): boolean {
    if (this.state === 'dead' || this.state === 'swap' || this.state === 'roll') return false;
    if (this.state === 'attack' && this.stateT < this.attackDef.windup + this.attackDef.active) return false;
    this.slot = this.slot === 0 ? 1 : 0;
    this.charge = 0;
    this.shot = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.setState('swap');
    this.events.push({ type: 'swap', to: this.weapon });
    return true;
  }

  /** True while this swing is the heavy finisher. */
  get isHeavy(): boolean {
    return this.combo === HEAVY_INDEX;
  }

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
    this.queuedHeavy = false;
    this.holdT = 0;
    this.charge = 0;
    this.shot = null;
  }

  heal(n: number): void {
    // A "heal" that is negative or NaN must never take HP away: healing and damage are separate
    // doors on purpose, and Batch 4's equipment modifiers will be doing the arithmetic upstream.
    if (!Number.isFinite(n) || n <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  takeDamage(dmg: number, fromX: number, fromY: number, knock = 110): boolean {
    if (!this.canBeHit) return false;
    /*
     * Damage is clamped into [0, maxHp] before it is applied, for two reasons that are about to
     * matter a lot more: a defence modifier that overshoots would otherwise *heal* the hero (and
     * past maxHp at that), and a NaN would make `hp` NaN — after which `hp <= 0` is false and
     * `hp > 0` is false too, so the hero is neither alive nor dead and the game never recovers.
     */
    const amount = Number.isFinite(dmg) ? Math.max(0, dmg) : 0;
    this.hp = Math.max(0, Math.min(this.maxHp, this.hp - amount));
    // A knockback from a non-finite source position would poison the velocity the same way.
    const a = Number.isFinite(fromX) && Number.isFinite(fromY) ? Math.atan2(this.y - fromY, this.x - fromX) : 0;
    const push = Number.isFinite(knock) ? knock : 0;
    this.vx = Math.cos(a) * push;
    this.vy = Math.sin(a) * push;
    this.invuln = HERO_STATS.invulnAfterHit;
    this.queuedAttack = false;
    this.queuedHeavy = false;
    this.charge = 0;
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
    this.queuedHeavy = false;
    this.holdT = 0;
    this.events.push({ type: 'swing-start', index: this.combo, angle });
  }

  /** Loose an arrow. Which shot it is depends on how long the string was drawn. */
  private startShot(input: HeroInput): void {
    const has = input.mx !== 0 || input.my !== 0;
    let angle = has ? Math.atan2(input.my, input.mx) : this.aim;
    if (this.aimAssist) angle = this.aimAssist(angle);
    this.aim = angle;
    this.shot = shotForCharge(this.charge);
    this.shotFired = false;
    this.setState('shoot');
    this.queuedAttack = false;
  }

  /** Begin the heavy finisher. Reached by holding rather than tapping. */
  private startHeavy(input: HeroInput): void {
    this.combo = HEAVY_INDEX;
    this.startAttack(input);
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
    /*
     * One bad frame must not break the hero permanently. A non-finite `dt` or speed multiplier
     * would turn the velocity into NaN, and from then on `Collision.move` computes NaN sub-steps,
     * runs zero of them and returns the hero to where they were — forever. The game loop clamps
     * `dt` already; this is the backstop for everything else that can call in here.
     */
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!Number.isFinite(speedMult) || speedMult <= 0) speedMult = 1;
    if (!Number.isFinite(this.vx) || !Number.isFinite(this.vy)) this.vx = this.vy = 0;
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
        } else if (this.isRanged) {
          /*
           * The bow: holding draws the string, releasing lets the arrow go. A tap fires the quick
           * shot immediately, so the weapon never feels laggy, and holding is what buys the
           * piercing shot.
           */
          if (inp.attackHeld) {
            const before = this.charge;
            this.charge = Math.min(1, this.charge + dt / FULL_CHARGE_TIME);
            if (Math.floor(this.charge * 4) !== Math.floor(before * 4)) this.events.push({ type: 'charge', level: this.charge });
          } else if (this.bufAtk > 0 || this.charge > 0) {
            this.bufAtk = 0;
            this.startShot(inp);
          }
        } else if (this.bufAtk > 0) {
          this.bufAtk = 0;
          this.combo = this.comboTimer > 0 ? Math.min(this.combo + 1, LIGHT_COMBO - 1) : 0;
          this.startAttack(inp);
          this.holdT = 0;
        } else if (inp.attackHeld) {
          // holding without a fresh tap (e.g. the button was already down) goes straight to heavy
          this.holdT += dt;
          if (this.holdT >= HERO_STATS.holdTime) this.startHeavy(inp);
        } else this.holdT = 0;
        break;
      }

      case 'attack': {
        const a = this.attackDef;
        if (this.bufAtk > 0) this.queuedAttack = true;
        // holding the button past the threshold turns the follow-up into the heavy finisher
        if (inp.attackHeld && this.combo !== HEAVY_INDEX) {
          this.holdT += dt;
          if (this.holdT >= HERO_STATS.holdTime) this.queuedHeavy = true;
        } else this.holdT = 0;

        const inWindup = this.stateT < a.windup;
        /*
         * During the wind-up the player still has *some* control: the hero keeps turning toward
         * the stick (at a limited rate) and keeps a fraction of walking speed. A swing that locks
         * you in place and facing the wrong way is exactly what makes combat feel stiff.
         */
        const mag = clamp(Math.hypot(inp.mx, inp.my), 0, 1);
        if (inWindup && mag > 0.15) {
          const want = Math.atan2(inp.my, inp.mx);
          let d = want - this.aim;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const maxTurn = (HERO_STATS.attackTurnRate * Math.PI) / 180 * dt;
          this.aim += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
        }

        // step forward along the aim through wind-up and the swing itself
        if (this.stateT < a.windup + a.active) {
          const k = inWindup ? 0.4 : 1;
          targetVx = Math.cos(this.aim) * a.lunge * k;
          targetVy = Math.sin(this.aim) * a.lunge * k;
          if (inWindup && mag > 0.15) {
            const steer = HERO_STATS.speed * HERO_STATS.attackSteer;
            targetVx += (inp.mx / mag) * steer;
            targetVy += (inp.my / mag) * steer;
          }
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
        // A dodge cancels a swing at *any* point, not only after the blade has passed. Being
        // unable to bail out of a committed animation is the other half of feeling stiff.
        if (this.bufDodge > 0 && this.rollCd <= 0) {
          this.bufDodge = 0;
          this.startRoll(inp);
        } else if (doneActive && this.queuedHeavy && this.combo !== HEAVY_INDEX) {
          this.bufAtk = 0;
          this.startHeavy(inp);
        } else if (doneActive && this.queuedAttack && this.combo < LIGHT_COMBO - 1) {
          this.bufAtk = 0;
          this.combo += 1;
          this.startAttack(inp);
        } else if (this.stateT >= total) {
          this.comboTimer = this.combo < LIGHT_COMBO - 1 ? HERO_STATS.comboWindow : 0;
          this.setState('free');
        }
        break;
      }

      case 'shoot': {
        const shot = this.shot!;
        accel = HERO_STATS.decel;
        // a little backward drift, like absorbing the recoil
        if (this.stateT < shot.draw) {
          targetVx = -Math.cos(this.aim) * 24;
          targetVy = -Math.sin(this.aim) * 24;
        }
        // the player may keep turning while drawing, same as a sword wind-up
        const mag = clamp(Math.hypot(inp.mx, inp.my), 0, 1);
        if (this.stateT < shot.draw && mag > 0.15) {
          const want = Math.atan2(inp.my, inp.mx);
          let d = want - this.aim;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const maxTurn = ((HERO_STATS.attackTurnRate * Math.PI) / 180) * dt;
          this.aim += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
        }
        if (!this.shotFired && this.stateT >= shot.draw) {
          this.shotFired = true;
          const angle = this.aimAssist ? this.aimAssist(this.aim) : this.aim;
          this.aim = angle;
          this.events.push({
            type: 'shoot',
            x: this.x,
            y: this.y - 8,
            angle,
            speed: shot.speed,
            dmg: shot.dmg,
            pierce: shot.pierce,
            charge: this.charge,
            element: this.element,
            shot: shot.id,
          });
          this.charge = 0;
        }
        if (this.bufDodge > 0 && this.rollCd <= 0) {
          this.bufDodge = 0;
          this.startRoll(inp);
        } else if (this.stateT >= shot.draw + shot.recover) this.setState('free');
        break;
      }

      case 'swap': {
        accel = HERO_STATS.decel;
        const mag = clamp(Math.hypot(inp.mx, inp.my), 0, 1);
        // swapping never roots you: you keep walking at half speed through it
        if (mag > 0.05) {
          const sp = HERO_STATS.speed * moveMult * 0.5;
          targetVx = (inp.mx / mag) * sp;
          targetVy = (inp.my / mag) * sp;
          this.aim = Math.atan2(inp.my, inp.mx);
        }
        if (this.stateT >= this.weaponDef.swapTime) this.setState('free');
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
