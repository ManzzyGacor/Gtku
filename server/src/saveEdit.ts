/**
 * Editing a save on the server: the few operations both developer grants and co-op loot need.
 * Every result stays valid by `shared/saveRules.ts`.
 */
import { BAG_SLOTS, expForNext, ITEM_BY_ID, MAX_COINS, MAX_LEVEL } from '../../shared/catalog';

export type Stack = { id: string; count: number; rarity: string } | null;
export interface Char {
  level: number;
  exp: number;
  coins: number;
  inventory: { slots: Stack[]; equipped: Record<string, Stack | undefined> };
  elements: { unlocked: string[]; primary: string | null; secondary: string | null };
  devStats?: Record<string, number>;
  [k: string]: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The character inside a save, with every part present (a fresh one when the save has none). */
export function characterOf(save: Record<string, unknown>): Char {
  const c = isObj(save.character) ? (save.character as Partial<Char>) : {};
  const inv = isObj(c.inventory) ? c.inventory : { slots: [], equipped: {} };
  const slots = Array.isArray(inv.slots) ? [...inv.slots] : [];
  while (slots.length < BAG_SLOTS) slots.push(null);
  return {
    ...c,
    level: typeof c.level === 'number' ? c.level : 1,
    exp: typeof c.exp === 'number' ? c.exp : 0,
    coins: typeof c.coins === 'number' ? c.coins : 0,
    inventory: { slots, equipped: isObj(inv.equipped) ? { ...inv.equipped } : {} },
    elements: isObj(c.elements)
      ? { unlocked: Array.isArray(c.elements.unlocked) ? [...c.elements.unlocked] : [], primary: c.elements.primary ?? null, secondary: c.elements.secondary ?? null }
      : { unlocked: [], primary: null, secondary: null },
  };
}

/** Put `count` of an item in the bag (stacking where it can). Returns how many fitted. */
export function add(c: Char, id: string, rarity: string, count: number): number {
  const item = ITEM_BY_ID.get(id)!;
  const max = item.stack ?? 1;
  let left = count;
  for (const s of c.inventory.slots) {
    if (left <= 0) break;
    if (s && s.id === id && s.rarity === rarity && s.count < max) {
      const put = Math.min(left, max - s.count);
      s.count += put;
      left -= put;
    }
  }
  for (let i = 0; i < c.inventory.slots.length && left > 0; i++) {
    if (c.inventory.slots[i]) continue;
    const put = Math.min(left, max);
    c.inventory.slots[i] = { id, count: put, rarity };
    left -= put;
  }
  return count - left;
}

/** Add EXP, levelling up along the game's curve. */
export function addExp(c: Char, amount: number): void {
  c.exp += Math.max(0, Math.floor(amount));
  while (c.level < MAX_LEVEL && c.exp >= expForNext(c.level)) {
    c.exp -= expForNext(c.level);
    c.level++;
  }
  if (c.level >= MAX_LEVEL) c.exp = 0;
}

export function addCoins(c: Char, amount: number): void {
  c.coins = Math.max(0, Math.min(MAX_COINS, Math.floor(c.coins + amount)));
}
