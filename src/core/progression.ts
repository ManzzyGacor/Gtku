/**
 * Level and EXP (docs/OVERHAUL.md §4 "Progresi": EXP dari monster, quest, dungeon, boss, eksplorasi).
 *
 * The curve is deliberately gentle and short. This is a game with one quest line in it so far, so
 * a level should arrive every few fights rather than every few hours — the point of levelling here
 * is to make the numbers on the character screen move while the player explores, not to gate
 * content behind grinding.
 */
import type { Modifier } from './stats/stats';

export const MAX_LEVEL = 30;

/**
 * EXP needed to go from `level` to `level + 1`.
 *
 * Quadratic-ish: 40 at level 1, ~250 at level 10, ~900 at level 25. With a forest monster worth 12
 * EXP that is three kills for the first level and about twenty for a late one.
 */
export function expForNext(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Number.isFinite(level) ? Math.floor(level) : 1));
  if (l >= MAX_LEVEL) return Infinity;
  return Math.round(28 + l * 12 + l * l * 1.4);
}

/** Total EXP from level 1 to `level`, for the character screen's progress line. */
export function expToReach(level: number): number {
  let total = 0;
  const top = Math.max(1, Math.min(MAX_LEVEL, Number.isFinite(level) ? Math.floor(level) : 1));
  for (let l = 1; l < top; l++) total += expForNext(l);
  return total;
}

/** What each kind of source is worth. Exploration and quests are one-off; monsters repeat. */
export const EXP_REWARDS = {
  slime: 9,
  archer: 14,
  bat: 7,
  boss: 220,
  /** Reading a sign, resting at a shrine for the first time, finding a chest. */
  discovery: 18,
  chest: 26,
  questStage: 60,
} as const;

export type ExpSource = keyof typeof EXP_REWARDS;

export interface LevelUp {
  from: number;
  to: number;
}

export interface Progress {
  level: number;
  /** EXP inside the current level, never the running total: simpler to show and to migrate. */
  exp: number;
}

/**
 * Add EXP, levelling up as many times as it earns. Pure: returns new values rather than mutating,
 * so the caller decides when the HUD animates.
 */
export function gainExp(progress: Progress, amount: number): { progress: Progress; levels: LevelUp[] } {
  // `Math.max(1, Math.min(30, NaN))` is NaN, so the clamp has to be preceded by a finiteness check
  // or a corrupt save produces a hero at level NaN — permanently.
  const raw = Number.isFinite(progress.level) ? Math.floor(progress.level) : 1;
  let level = Math.max(1, Math.min(MAX_LEVEL, raw));
  let exp = Math.max(0, Number.isFinite(progress.exp) ? progress.exp : 0);
  const add = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  exp += add;
  const levels: LevelUp[] = [];
  while (level < MAX_LEVEL && exp >= expForNext(level)) {
    exp -= expForNext(level);
    level++;
    levels.push({ from: level - 1, to: level });
  }
  if (level >= MAX_LEVEL) exp = 0;
  return { progress: { level, exp }, levels };
}

/**
 * What a level is worth, as ordinary modifiers — so levelling goes through the same pipeline as a
 * helmet does and the character screen can list it as a source like any other.
 *
 * Per level: +1 HP, +1.2 ATK, +0.6 DEF, +0.25% crit. At level 30 that is roughly triple the
 * starting ATK, which keeps the cave's enemies meaningful without making the village trivial.
 */
export function levelMods(level: number): Modifier[] {
  const l = Math.max(1, Math.min(MAX_LEVEL, Number.isFinite(level) ? Math.floor(level) : 1)) - 1;
  if (l <= 0) return [];
  const source = `Level ${l + 1}`;
  return [
    { stat: 'maxHp', flat: l, source },
    { stat: 'atk', flat: Math.round(l * 1.2 * 10) / 10, source },
    { stat: 'def', flat: Math.round(l * 0.6 * 10) / 10, source },
    { stat: 'crit', flat: Math.round(l * 0.25 * 10) / 10, source },
  ];
}
