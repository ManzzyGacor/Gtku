/**
 * Damage, in one place, for every hit in the game.
 *
 * `base + senjata + equipment + level + elemen + buff − debuff → final damage`, in that order:
 *
 *   1. **ATK** comes in already resolved (level + equipment + buffs are `stats.ts`'s job);
 *   2. the **attack** scales it (a light swing is ×1, the heavy finisher ×3.5 — this is what the
 *      combat tuning numbers become);
 *   3. **element mastery** and any element-specific gear bonus add on top;
 *   4. a **critical** hit multiplies by `1 + critDmg`;
 *   5. the target's **DEF** mitigates, as a ratio rather than a subtraction, so armour never makes
 *      a hit do nothing and never scales into immunity;
 *   6. the target's **resistance** to that element mitigates what is left;
 *   7. the elemental **reaction** multiplier (from `combat/elements.ts`) applies last, because a
 *      reaction is a property of the hit landing, not of the attacker.
 *
 * Everything is a pure function of its inputs, including the crit roll (the caller passes the
 * random number), so every branch is testable without a renderer and without luck.
 */
import type { ElementId } from '../combat/elements';
import { elementBonus, type Modifier, type StatBlock } from './stats';

export interface Attacker {
  stats: StatBlock;
  /** Element-specific modifiers, which the stat sheet deliberately leaves out. */
  mods?: readonly Modifier[] | undefined;
}

export interface Defender {
  def: number;
  /** 0..1 per element, 0.3 = takes 30% less of that element. */
  resist?: Partial<Record<ElementId, number>> | undefined;
}

export interface HitSpec {
  /** Multiplier from the attack itself (`ATTACKS[i].dmg` normalised). */
  attackMult: number;
  element?: ElementId | undefined;
  /** From the elemental reaction table; 1 when nothing reacted. */
  reactionMult?: number | undefined;
  /** 0..1 — the caller's roll, so tests can force both branches. */
  roll?: number | undefined;
  /** True for attacks that cannot crit (status ticks, environmental damage). */
  noCrit?: boolean | undefined;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
  /** How much HP the attacker gets back, already rounded. */
  lifesteal: number;
}

/**
 * DEF mitigation constant. `100 / (100 + def)`: 100 DEF halves the damage, 300 quarters it, and no
 * amount of DEF ever reaches zero. Subtractive armour would let a late-game DEF value make early
 * enemies harmless *and* make a big number feel like nothing — this curve does neither.
 */
export const DEF_SCALE = 100;

export function computeDamage(attacker: Attacker, defender: Defender, hit: HitSpec): DamageResult {
  const s = attacker.stats;
  const atk = Math.max(0, num(s.atk));
  const mult = Math.max(0, num(hit.attackMult, 1));

  let dmg = atk * mult;

  // element: mastery is a soft curve so early points matter and late points do not run away
  if (hit.element) {
    const mastery = Math.max(0, num(s.mastery));
    const gear = elementBonus(attacker.mods ?? [], hit.element);
    dmg *= 1 + (mastery / (mastery + 120)) * 0.6 + gear / 100;
  }

  // crit
  const roll = num(hit.roll, 1);
  const crit = !hit.noCrit && roll < Math.max(0, num(s.crit)) / 100;
  if (crit) dmg *= 1 + Math.max(0, num(s.critDmg)) / 100;

  // defence and resistance
  const def = Math.max(0, num(defender.def));
  dmg *= DEF_SCALE / (DEF_SCALE + def);
  if (hit.element) {
    const resist = Math.min(0.9, Math.max(-1, num(defender.resist?.[hit.element])));
    dmg *= 1 - resist;
  }

  // the reaction multiplier lands last
  dmg *= Math.max(0, num(hit.reactionMult, 1));

  // A hit that connects always does something: rounding to 0 reads as the game ignoring you.
  const amount = Math.max(1, Math.round(dmg));
  const lifesteal = Math.round((amount * Math.max(0, num(s.lifesteal))) / 100);
  return { amount, crit, lifesteal };
}

const num = (v: number | undefined, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
