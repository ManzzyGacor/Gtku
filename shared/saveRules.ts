/**
 * What a save is allowed to contain, checked by the server before it stores one.
 *
 * The save is written by the game on the player's phone, so a player can edit it in the browser.
 * These rules are the server's answer to "give myself items by editing localStorage":
 *
 *  1. **Integrity** (every save): only items that exist, in real rarities and stack sizes, equipment
 *     in the slot it belongs to, a level and EXP the curve allows, coins in range, elements that a
 *     Lantern Core in the save actually teaches, and **nothing only a developer may have** —
 *     `devSave`, `devStats` — unless the account *is* a developer (the server decides that).
 *  2. **Progress per write** (players only): compared with the save the server already holds, one
 *     write may not jump more than a few levels, a few thousand coins, or a handful of rare items.
 *     A save is pushed at most every 20 seconds, so these limits are far above honest play and far
 *     below "set everything to max".
 *
 * Honest limit: a patient cheater who edits a little at a time can stay under per-write limits.
 * Closing that needs the server to *own* progression (it does, for co-op rooms: their loot is
 * rolled and written by the server). Documented in docs/BACKEND.md.
 */
import { BAG_SLOTS, DEV_STAT_IDS, DEV_STAT_MAX, ELEMENT_IDS, expForNext, ITEM_BY_ID, MAX_COINS, MAX_LEVEL, RARITY_IDS, SLOT_KIND, type Rarity } from './catalog';

export type SaveRejectReason =
  | 'bad_shape'
  | 'unknown_item'
  | 'bad_rarity'
  | 'bad_count'
  | 'bad_equip'
  | 'bad_level'
  | 'bad_exp'
  | 'bad_coins'
  | 'element_without_core'
  | 'dev_only'
  | 'too_fast';

export type SaveCheck = { ok: true } | { ok: false; reason: SaveRejectReason; detail: string };

/**
 * How much one write may add, plus how much more per minute since the server's previous copy — so a
 * phone that played two hours offline can still sync, while "max everything" in one write cannot.
 */
export const PROGRESS_LIMITS = {
  levelsPerWrite: 3,
  levelsPerMinute: 0.25,
  coinsPerWrite: 5_000,
  coinsPerMinute: 400,
  newItemsPerWrite: 30,
  newItemsPerMinute: 4,
  /** Legendary and mythic pieces that appear in one write. */
  newTopRarityPerWrite: 3,
  newTopRarityPerMinute: 0.2,
};

const bad = (reason: SaveRejectReason, detail: string): SaveCheck => ({ ok: false, reason, detail });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

interface Stack {
  id: string;
  count: number;
  rarity: Rarity;
}

function checkStack(v: unknown, where: string, equipped: boolean): SaveCheck | Stack {
  if (!isObj(v) || typeof v.id !== 'string') return bad('bad_shape', where);
  const item = ITEM_BY_ID.get(v.id);
  if (!item) return bad('unknown_item', `${where}: ${v.id}`);
  if (typeof v.rarity !== 'string' || !RARITY_IDS.includes(v.rarity as Rarity)) return bad('bad_rarity', where);
  const max = equipped ? 1 : (item.stack ?? 1);
  if (!int(v.count) || v.count < 1 || v.count > max) return bad('bad_count', `${where}: ${v.count}/${max}`);
  return { id: v.id, count: v.count, rarity: v.rarity as Rarity };
}

/** Every item the save holds, in the bag and worn. */
function allStacks(character: Record<string, unknown>): SaveCheck | Stack[] {
  const inv = character.inventory;
  if (inv === undefined) return [];
  if (!isObj(inv)) return bad('bad_shape', 'inventory');
  const out: Stack[] = [];
  const slots = inv.slots ?? [];
  if (!Array.isArray(slots) || slots.length > BAG_SLOTS) return bad('bad_shape', 'inventory.slots');
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) continue;
    const s = checkStack(slots[i], `tas[${i}]`, false);
    if ('ok' in s) return s;
    out.push(s);
  }
  const eq = inv.equipped ?? {};
  if (!isObj(eq)) return bad('bad_shape', 'inventory.equipped');
  for (const [slot, held] of Object.entries(eq)) {
    if (held === undefined || held === null) continue;
    const kind = SLOT_KIND[slot];
    if (!kind) return bad('bad_equip', `slot ${slot}`);
    const s = checkStack(held, `dipakai.${slot}`, true);
    if ('ok' in s) return s;
    if (ITEM_BY_ID.get(s.id)!.kind !== kind) return bad('bad_equip', `${s.id} di slot ${slot}`);
    out.push(s);
  }
  return out;
}

/** Rule 1: what any save may contain. `dev` is the *server's* word on the account. */
export function checkSaveIntegrity(data: unknown, dev: boolean): SaveCheck {
  if (!isObj(data)) return bad('bad_shape', 'save');
  if (!dev && (data.devSave !== undefined || (isObj(data.character) && data.character.devStats !== undefined))) {
    return bad('dev_only', 'save pengembang dari akun biasa');
  }
  const c = data.character;
  if (c === undefined) return { ok: true };
  if (!isObj(c)) return bad('bad_shape', 'character');
  if (!int(c.level) || c.level < 1 || c.level > MAX_LEVEL) return bad('bad_level', String(c.level));
  if (!int(c.exp) || c.exp < 0 || (c.level < MAX_LEVEL && c.exp >= expForNext(c.level))) return bad('bad_exp', `${String(c.exp)} di level ${c.level}`);
  if (c.coins !== undefined && (!int(c.coins) || c.coins < 0 || c.coins > MAX_COINS)) return bad('bad_coins', String(c.coins));
  const stacks = allStacks(c);
  if ('ok' in stacks) return stacks;

  if (c.elements !== undefined) {
    if (!isObj(c.elements) || !Array.isArray(c.elements.unlocked)) return bad('bad_shape', 'elements');
    const taught = new Set(stacks.map((s) => ITEM_BY_ID.get(s.id)!.element).filter(Boolean));
    for (const el of c.elements.unlocked) {
      if (typeof el !== 'string' || !ELEMENT_IDS.includes(el as never)) return bad('bad_shape', `elemen ${String(el)}`);
      // a developer may unlock every element without the cores; a player learns them from a core
      if (!dev && !taught.has(el as never)) return bad('element_without_core', el);
    }
  }
  if (c.devStats !== undefined) {
    if (!isObj(c.devStats)) return bad('bad_shape', 'devStats');
    for (const [k, v] of Object.entries(c.devStats)) {
      if (!DEV_STAT_IDS.includes(k as never) || typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > DEV_STAT_MAX) return bad('bad_shape', `devStats.${k}`);
    }
  }
  return { ok: true };
}

const TOP: ReadonlySet<Rarity> = new Set(['legendary', 'mythic']);

function tally(data: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const c = isObj(data) ? data.character : undefined;
  if (!isObj(c)) return out;
  const stacks = allStacks(c);
  if ('ok' in stacks) return out;
  for (const s of stacks) out.set(`${s.id}|${s.rarity}`, (out.get(`${s.id}|${s.rarity}`) ?? 0) + s.count);
  return out;
}

/**
 * Rule 2: how much one write may add, compared with what the server holds (players only; the first
 * write, an import of existing progress, is checked by rule 1 alone). `elapsedMs` is server time
 * since the previous write.
 */
export function checkProgression(prev: unknown, next: unknown, elapsedMs: number): SaveCheck {
  const pc = isObj(prev) && isObj(prev.character) ? prev.character : null;
  const nc = isObj(next) && isObj(next.character) ? next.character : null;
  if (!nc) return { ok: true };
  const L = PROGRESS_LIMITS;
  const min = Math.max(0, Math.min(7 * 24 * 60, elapsedMs / 60_000));
  const pLevel = pc && int(pc.level) ? pc.level : 1;
  const pCoins = pc && int(pc.coins) ? pc.coins : 0;
  if (int(nc.level) && nc.level - pLevel > L.levelsPerWrite + min * L.levelsPerMinute) return bad('too_fast', `level ${pLevel} → ${nc.level}`);
  if (int(nc.coins) && nc.coins - pCoins > L.coinsPerWrite + min * L.coinsPerMinute) return bad('too_fast', `koin ${pCoins} → ${nc.coins}`);
  const before = tally(prev);
  let added = 0;
  let top = 0;
  for (const [key, count] of tally(next)) {
    const more = count - (before.get(key) ?? 0);
    if (more <= 0) continue;
    added += more;
    if (TOP.has(key.split('|')[1] as Rarity)) top += more;
  }
  if (added > L.newItemsPerWrite + min * L.newItemsPerMinute) return bad('too_fast', `${added} barang baru sekaligus`);
  if (top > L.newTopRarityPerWrite + min * L.newTopRarityPerMinute) return bad('too_fast', `${top} barang Legendaris/Mitos baru sekaligus`);
  return { ok: true };
}
