/**
 * What a fallen enemy leaves behind (Batch 4).
 *
 * A table rather than code scattered through the combat: each enemy kind has a list of entries
 * with a chance, a count and an optional rarity roll. Pure, and the random source is passed in, so
 * a test can walk every branch instead of hoping.
 *
 * The rates are deliberately low for gear and generous for materials. Finding a Lantern Core should
 * be an event, not a chore — there are only four, and they change how the hero fights.
 */
import { ITEMS, rarityIndex, RARITIES, type Rarity } from './items';

export interface DropEntry {
  id: string;
  /** 0..1 chance this entry drops at all. */
  chance: number;
  /** How many, inclusive range. */
  min?: number;
  max?: number;
  /**
   * Chance (0..1) the drop rolls one rarity above the item's default, per step, up to `maxUp`.
   * This is what makes a lucky drop worth something: the same helmet, genuinely stronger.
   */
  upgrade?: number;
  maxUp?: number;
}

export interface Drop {
  id: string;
  count: number;
  rarity: Rarity;
}

export const DROP_TABLES: Record<string, DropEntry[]> = {
  slime: [
    { id: 'monster_hide', chance: 0.45, min: 1, max: 2 },
    { id: 'potion_small', chance: 0.08 },
    { id: 'boots_soft', chance: 0.02, upgrade: 0.25, maxUp: 2 },
  ],
  bat: [
    { id: 'monster_hide', chance: 0.3 },
    { id: 'shard_dawn', chance: 0.1 },
    { id: 'helm_lamplighter', chance: 0.02, upgrade: 0.25, maxUp: 2 },
  ],
  archer: [
    { id: 'shard_dawn', chance: 0.35, min: 1, max: 2 },
    { id: 'potion_small', chance: 0.12 },
    { id: 'gloves_grip', chance: 0.04, upgrade: 0.3, maxUp: 2 },
    { id: 'bow_whisper', chance: 0.03, upgrade: 0.3, maxUp: 2 },
    { id: 'dagger_mist', chance: 0.04, upgrade: 0.3, maxUp: 2 },
  ],
  boss: [
    { id: 'core_ember', chance: 1 },
    { id: 'shard_dawn', chance: 1, min: 4, max: 7 },
  ],
  /** Chests, which the world scatters around for exploring. */
  chest: [
    { id: 'shard_dawn', chance: 0.7, min: 2, max: 4 },
    { id: 'potion_small', chance: 0.5, min: 1, max: 2 },
    { id: 'amulet_firefly', chance: 0.2, upgrade: 0.3, maxUp: 3 },
    { id: 'ring_thorn', chance: 0.14, upgrade: 0.3, maxUp: 2 },
    { id: 'armor_woven', chance: 0.16, upgrade: 0.3, maxUp: 3 },
    { id: 'sword_village', chance: 0.12, upgrade: 0.3, maxUp: 3 },
    { id: 'hammer_ember', chance: 0.07, upgrade: 0.25, maxUp: 2 },
    { id: 'spear_tide', chance: 0.07, upgrade: 0.25, maxUp: 2 },
  ],
};

/** Roll the rarity for one entry: its base rarity, pushed up while the dice keep agreeing. */
export function rollRarity(base: Rarity, entry: DropEntry, rand: () => number): Rarity {
  let index = rarityIndex(base);
  const steps = Math.max(0, entry.maxUp ?? 0);
  const chance = Math.max(0, Math.min(1, entry.upgrade ?? 0));
  for (let i = 0; i < steps; i++) {
    if (rand() >= chance) break;
    index = Math.min(RARITIES.length - 1, index + 1);
  }
  return RARITIES[index].id;
}

/**
 * Roll a table once. Returns **at most one** drop per kill for monsters (the first entry that
 * passes), because a stream of pickups turns a fight into paperwork; chests roll every entry.
 */
export function rollDrop(kind: string, rand: () => number = Math.random): Drop | null {
  const all = rollDrops(kind, rand, 1);
  return all[0] ?? null;
}

/** Roll a table, keeping up to `limit` drops (chests use the whole table). */
export function rollDrops(kind: string, rand: () => number = Math.random, limit = Infinity): Drop[] {
  const table = DROP_TABLES[kind];
  if (!table) return [];
  const out: Drop[] = [];
  for (const entry of table) {
    if (out.length >= limit) break;
    if (rand() >= entry.chance) continue;
    const min = Math.max(1, Math.floor(entry.min ?? 1));
    const max = Math.max(min, Math.floor(entry.max ?? min));
    const count = min + Math.floor(rand() * (max - min + 1));
    out.push({ id: entry.id, count, rarity: rollRarity(baseRarityOf(entry.id), entry, rand) });
  }
  return out;
}

/** The rarity an item drops at before any upgrade roll. */
function baseRarityOf(id: string): Rarity {
  return ITEMS[id]?.rarity ?? 'common';
}
