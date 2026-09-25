/**
 * Developer grants, applied **by the server** to a developer's save (`POST /dev/action`).
 *
 * Pure: a save in, a new save out. Every grant keeps the save valid by the same rules the server
 * checks any save with (`shared/saveRules.ts`, developer mode), and marks it `devSave`, so a
 * developer's progress can never be mistaken for a player's.
 */
import { BAG_SLOTS, CATALOG, ELEMENT_IDS, expForNext, ITEM_BY_ID, MAX_LEVEL, SLOT_KIND, type ItemKind } from '../../shared/catalog';
import type { DevGrant } from '../../shared/devActions';

type Stack = { id: string; count: number; rarity: string } | null;
interface Char {
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
function characterOf(save: Record<string, unknown>): Char {
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
function add(c: Char, id: string, rarity: string, count: number): number {
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

export type GrantResult = { ok: true; save: Record<string, unknown> | null; note: string } | { ok: false; error: string };

/** The best item of each equipment kind (the last one defined), for "give kit". */
const KIT: string[] = (() => {
  const best = new Map<ItemKind, string>();
  for (const i of CATALOG) if (i.kind !== 'lantern' && i.kind !== 'material' && i.kind !== 'consumable') best.set(i.kind, i.id);
  return [...best.values()];
})();

export function applyGrant(base: unknown, grant: DevGrant): GrantResult {
  if (grant.type === 'reset_save') return { ok: true, save: null, note: 'Save dihapus.' };
  const save: Record<string, unknown> = isObj(base) ? structuredClone(base) : { v: 2, hero: { x: 0, y: 0, hp: 12 } };
  const c = characterOf(save);
  let note = '';
  switch (grant.type) {
    case 'give_item': {
      const n = add(c, grant.item, grant.rarity, grant.count);
      if (n === 0) return { ok: false, error: 'Tas penuh.' };
      note = `${n}x ${grant.item} (${grant.rarity}) masuk tas.`;
      break;
    }
    case 'give_all_cores': {
      let n = 0;
      for (const i of CATALOG) if (i.kind === 'lantern') n += add(c, i.id, i.rarity, 1);
      note = `${n} Inti Lentera masuk tas.`;
      break;
    }
    case 'give_kit': {
      let n = 0;
      for (const id of KIT) n += add(c, id, 'legendary', 1);
      note = `${n} perlengkapan Legendaris masuk tas.`;
      break;
    }
    case 'set_coins':
      c.coins = grant.amount;
      note = `Koin: ${c.coins}.`;
      break;
    case 'set_level':
      c.level = grant.level;
      c.exp = 0;
      note = `Level ${c.level}.`;
      break;
    case 'add_exp': {
      c.exp += grant.amount;
      while (c.level < MAX_LEVEL && c.exp >= expForNext(c.level)) {
        c.exp -= expForNext(c.level);
        c.level++;
      }
      if (c.level >= MAX_LEVEL) c.exp = 0;
      note = `Level ${c.level}, EXP ${c.exp}.`;
      break;
    }
    case 'unlock_elements':
      c.elements.unlocked = [...ELEMENT_IDS];
      note = 'Semua elemen terbuka.';
      break;
    case 'set_elements':
      for (const el of [grant.primary, grant.secondary]) if (el && !c.elements.unlocked.includes(el)) c.elements.unlocked.push(el);
      c.elements.primary = grant.primary;
      c.elements.secondary = grant.secondary;
      note = `Primer ${grant.primary ?? '-'}, sekunder ${grant.secondary ?? '-'}.`;
      break;
    case 'set_stats':
      c.devStats = { ...c.devStats, ...grant.stats };
      for (const [k, v] of Object.entries(c.devStats)) if (v === 0) delete c.devStats[k];
      note = 'Stats pengembang diperbarui.';
      break;
    case 'reset_cutscenes':
      save.cutscenesSeen = [];
      note = 'Status cutscene direset.';
      break;
    default:
      return { ok: false, error: 'Aksi tidak dikenal.' };
  }
  // equipped items keep count 1, bag trimmed back to its size
  c.inventory.slots = c.inventory.slots.slice(0, BAG_SLOTS);
  for (const [slot, held] of Object.entries(c.inventory.equipped)) if (held && !SLOT_KIND[slot]) delete c.inventory.equipped[slot];
  save.character = c;
  save.devSave = true;
  return { ok: true, save, note };
}
