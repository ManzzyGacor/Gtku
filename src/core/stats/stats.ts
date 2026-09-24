/**
 * The one stat pipeline, for the player, every enemy and the boss
 * (docs/OVERHAUL.md §4 "Stats": `base + senjata + equipment + level + elemen + buff − debuff`).
 *
 * The whole point of doing this as data is that a number can then come from anywhere — a level, a
 * helmet, a Lantern Core, a burning status — and the combat code never needs to know which. It
 * asks for a resolved `StatBlock` and uses it.
 *
 * Resolution order matters and is fixed: **flat first, then percent**. So a +6 ATK ring on a hero
 * with 10 ATK and a +50% Lantern Core gives (10 + 6) × 1.5 = 24, not 10 × 1.5 + 6 = 21. One order
 * has to win, and this is the one players expect from the genre.
 */
import type { ElementId } from '../combat/elements';

/** Everything that can be modified. Kept flat so a modifier is just `{ stat, flat, pct }`. */
export type StatId =
  // primary
  | 'maxHp'
  | 'atk'
  | 'def'
  // secondary
  | 'crit'
  | 'critDmg'
  | 'speed'
  | 'mastery'
  | 'lifesteal'
  | 'lanternRange';

export type StatBlock = Record<StatId, number>;

export interface StatMeta {
  id: StatId;
  label: string;
  /** How the number is shown: a plain value or a percentage. */
  unit: '' | '%';
  /** Rounded to this many decimals for display. */
  decimals: number;
  /** Short line for the character screen. */
  note: string;
}

export const STAT_META: StatMeta[] = [
  { id: 'maxHp', label: 'HP Maks', unit: '', decimals: 0, note: 'Berapa banyak pukulan yang bisa kamu tahan' },
  { id: 'atk', label: 'Serangan', unit: '', decimals: 0, note: 'Dasar semua damage' },
  { id: 'def', label: 'Pertahanan', unit: '', decimals: 0, note: 'Mengurangi damage yang masuk' },
  { id: 'crit', label: 'Peluang Kritis', unit: '%', decimals: 1, note: 'Kemungkinan pukulan telak' },
  { id: 'critDmg', label: 'Damage Kritis', unit: '%', decimals: 0, note: 'Tambahan damage saat kritis' },
  { id: 'speed', label: 'Kecepatan', unit: '%', decimals: 0, note: 'Kecepatan jalan' },
  { id: 'mastery', label: 'Penguasaan Elemen', unit: '', decimals: 0, note: 'Memperkuat damage & reaksi elemen' },
  { id: 'lifesteal', label: 'Serap Hidup', unit: '%', decimals: 1, note: 'Sebagian damage kembali jadi HP' },
  { id: 'lanternRange', label: 'Jangkauan Lentera', unit: '%', decimals: 0, note: 'Seberapa jauh lenteramu menerangi' },
];

/** All zeroes — the starting point every resolution builds on. */
export function emptyStats(): StatBlock {
  return { maxHp: 0, atk: 0, def: 0, crit: 0, critDmg: 0, speed: 0, mastery: 0, lifesteal: 0, lanternRange: 0 };
}

/**
 * A single contribution to a stat. `flat` is added, `pct` is a percentage of the post-flat total
 * (so `pct: 12` means +12%). `source` is carried for the character screen, which shows the player
 * *where* a number came from.
 */
export interface Modifier {
  stat: StatId;
  flat?: number | undefined;
  pct?: number | undefined;
  source?: string | undefined;
  /** Only applies to this element's damage (used by Lantern Cores). */
  element?: ElementId | undefined;
}

/** The hero at level 1 with nothing equipped. Everything else is added to this. */
export const HERO_BASE: StatBlock = {
  maxHp: 12,
  atk: 10,
  def: 4,
  crit: 5,
  critDmg: 50,
  speed: 100,
  mastery: 0,
  lifesteal: 0,
  lanternRange: 100,
};

/** Guard: a NaN in a stat block propagates into damage, HP and movement and never recovers. */
const safe = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/**
 * Apply modifiers to a base block. Pure, and it never returns a non-finite number: a corrupt save
 * or a bad item definition must not be able to produce a hero with NaN HP
 * (see `tests/edgecases.test.ts` for why that is unrecoverable).
 */
export function resolveStats(base: StatBlock, mods: readonly Modifier[]): StatBlock {
  const flat = emptyStats();
  const pct = emptyStats();
  for (const m of mods) {
    // element-specific modifiers are damage-time only; they must not inflate the sheet
    if (m.element) continue;
    if (m.flat) flat[m.stat] += safe(m.flat);
    if (m.pct) pct[m.stat] += safe(m.pct);
  }
  const out = emptyStats();
  for (const meta of STAT_META) {
    const id = meta.id;
    out[id] = safe((safe(base[id]) + flat[id]) * (1 + pct[id] / 100), safe(base[id]));
  }
  // floors that keep the game playable whatever the gear says
  out.maxHp = Math.max(1, Math.round(out.maxHp));
  out.atk = Math.max(0, out.atk);
  out.def = Math.max(0, out.def);
  out.crit = Math.min(100, Math.max(0, out.crit));
  out.critDmg = Math.max(0, out.critDmg);
  out.speed = Math.max(10, out.speed);
  out.mastery = Math.max(0, out.mastery);
  out.lifesteal = Math.min(100, Math.max(0, out.lifesteal));
  out.lanternRange = Math.max(10, out.lanternRange);
  return out;
}

/** Total element-specific damage bonus (percent) from a modifier list. */
export function elementBonus(mods: readonly Modifier[], element: ElementId | undefined): number {
  if (!element) return 0;
  let pct = 0;
  for (const m of mods) if (m.element === element && m.stat === 'atk') pct += safe(m.pct ?? 0);
  return pct;
}

/** Format a stat for the character screen. */
export function formatStat(id: StatId, value: number): string {
  const meta = STAT_META.find((m) => m.id === id);
  if (!meta) return String(Math.round(value));
  const n = meta.decimals ? value.toFixed(meta.decimals) : String(Math.round(value));
  return `${n}${meta.unit}`;
}

/** Signed, for an item's stat list: `+6 ATK`, `+12% Kritis`. */
export function formatModifier(m: Modifier): string {
  const meta = STAT_META.find((s) => s.id === m.stat);
  const label = meta?.label ?? m.stat;
  if (m.pct) return `${m.pct > 0 ? '+' : ''}${m.pct}% ${label}`;
  return `${(m.flat ?? 0) > 0 ? '+' : ''}${m.flat ?? 0} ${label}`;
}
