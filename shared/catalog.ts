/**
 * What the server needs to know about the game's items, levels and elements to check a save.
 *
 * A summary of `src/core/items/items.ts` and `src/core/progression.ts`, kept in shared/ so the
 * server never imports game code. `tests/catalog.test.ts` fails the moment the two disagree — add
 * an item to the game, and that test says to add it here too.
 */

export type ItemKind = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'accessory' | 'lantern' | 'material' | 'consumable';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type ElementId = 'api' | 'air' | 'es' | 'petir';

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  /** The rarity it drops at by default. */
  rarity: Rarity;
  /** Stack size for materials and consumables; equipment does not stack. */
  stack?: number;
  /** Lantern Cores: the element they teach. */
  element?: ElementId;
}

export const CATALOG: readonly CatalogItem[] = [
  { id: 'sword_village', kind: 'weapon', rarity: 'common' },
  { id: 'sword_dawn', kind: 'weapon', rarity: 'rare' },
  { id: 'bow_whisper', kind: 'weapon', rarity: 'uncommon' },
  { id: 'helm_lamplighter', kind: 'helmet', rarity: 'common' },
  { id: 'helm_stone', kind: 'helmet', rarity: 'rare' },
  { id: 'armor_woven', kind: 'armor', rarity: 'common' },
  { id: 'armor_emberplate', kind: 'armor', rarity: 'epic' },
  { id: 'gloves_grip', kind: 'gloves', rarity: 'uncommon' },
  { id: 'boots_soft', kind: 'boots', rarity: 'common' },
  { id: 'boots_striding', kind: 'boots', rarity: 'rare' },
  { id: 'amulet_firefly', kind: 'accessory', rarity: 'uncommon' },
  { id: 'ring_thorn', kind: 'accessory', rarity: 'rare' },
  { id: 'charm_still', kind: 'accessory', rarity: 'epic' },
  { id: 'core_ember', kind: 'lantern', rarity: 'rare', element: 'api' },
  { id: 'core_tide', kind: 'lantern', rarity: 'rare', element: 'air' },
  { id: 'core_storm', kind: 'lantern', rarity: 'epic', element: 'petir' },
  { id: 'core_frost', kind: 'lantern', rarity: 'epic', element: 'es' },
  { id: 'potion_small', kind: 'consumable', rarity: 'common', stack: 9 },
  { id: 'shard_dawn', kind: 'material', rarity: 'uncommon', stack: 99 },
  { id: 'monster_hide', kind: 'material', rarity: 'common', stack: 99 },
];

export const ITEM_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((i) => [i.id, i]));
export const RARITY_IDS: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const ELEMENT_IDS: readonly ElementId[] = ['api', 'air', 'es', 'petir'];
export const BAG_SLOTS = 48;
export const MAX_LEVEL = 30;
export const MAX_COINS = 99_999_999;

/** Equipment slot → the kind it takes. */
export const SLOT_KIND: Readonly<Record<string, ItemKind>> = {
  weapon: 'weapon',
  helmet: 'helmet',
  armor: 'armor',
  gloves: 'gloves',
  boots: 'boots',
  accessory1: 'accessory',
  accessory2: 'accessory',
  lantern: 'lantern',
};

/** Same curve as `expForNext` in src/core/progression.ts. */
export function expForNext(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level) || 1));
  if (l >= MAX_LEVEL) return Infinity;
  return Math.round(28 + l * 12 + l * l * 1.4);
}

/** The stats a developer may set freely (`character.devStats`), and their bounds. */
export const DEV_STAT_IDS = ['maxHp', 'atk', 'def', 'crit', 'critDmg', 'speed', 'mastery', 'lifesteal', 'lanternRange'] as const;
export type DevStatId = (typeof DEV_STAT_IDS)[number];
export const DEV_STAT_MAX = 100_000;
