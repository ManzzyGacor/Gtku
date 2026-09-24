/**
 * The bag and the eight equipment slots (docs/OVERHAUL.md §4: "Inventaris grid per kategori").
 *
 * Pure data with no renderer anywhere near it, so every rule below is testable: what happens when
 * the bag is full, what happens when a stack is full, what happens when you equip something into a
 * slot that already holds an item (it swaps, and the old one needs a free slot to go back to).
 *
 * The bag is a **fixed grid of slots**, not an unlimited list, because "inventaris penuh" is a
 * state the game has to handle rather than a state we can pretend never happens.
 */
import { itemDef, itemMods, type EquipSlot, type ItemDef, type Rarity } from './items';
import type { Modifier } from '../stats/stats';

/** One occupied grid cell. Equipment never stacks; materials and potions do. */
export interface ItemStack {
  /** Item definition id. */
  id: string;
  count: number;
  /** Rarity of *this* copy — a drop can roll above the definition's default. */
  rarity: Rarity;
}

export const BAG_SLOTS = 48;

export type Equipped = Partial<Record<EquipSlot, ItemStack>>;

export interface InventoryJson {
  slots: (ItemStack | null)[];
  equipped: Equipped;
}

/** Why an `add` did not fully succeed, for the HUD to say something useful. */
export interface AddResult {
  /** How many were actually taken in. */
  added: number;
  /** How many had to be left behind because the bag is full. */
  overflow: number;
}

export class Inventory {
  /** Fixed-length grid; `null` is an empty cell, so the player's arrangement survives a save. */
  readonly slots: (ItemStack | null)[];
  readonly equipped: Equipped = {};

  constructor(size = BAG_SLOTS) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => null as ItemStack | null);
  }

  get size(): number {
    return this.slots.length;
  }

  get used(): number {
    return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
  }

  get full(): boolean {
    return this.used >= this.size;
  }

  countOf(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s?.id === id) n += s.count;
    return n;
  }

  /**
   * Put items in. Fills existing stacks of the same id **and rarity** first, then empty cells.
   *
   * Returns what actually happened rather than throwing: a full bag is an ordinary situation the
   * caller has to tell the player about, not an error.
   */
  add(id: string, count = 1, rarity?: Rarity): AddResult {
    const def = itemDef(id);
    if (!def || count <= 0 || !Number.isFinite(count)) return { added: 0, overflow: Math.max(0, count) };
    const rar = rarity ?? def.rarity;
    const max = Math.max(1, def.stack ?? 1);
    let left = Math.floor(count);
    let added = 0;

    if (max > 1)
      for (const s of this.slots) {
        if (left <= 0) break;
        if (!s || s.id !== id || s.rarity !== rar || s.count >= max) continue;
        const room = max - s.count;
        const take = Math.min(room, left);
        s.count += take;
        left -= take;
        added += take;
      }

    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const take = Math.min(max, left);
      this.slots[i] = { id, count: take, rarity: rar };
      left -= take;
      added += take;
    }
    return { added, overflow: left };
  }

  /** Take `count` of an item out of the bag. Returns how many were actually removed. */
  remove(id: string, count = 1): number {
    let left = Math.floor(Math.max(0, count));
    let removed = 0;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      removed += take;
      if (s.count <= 0) this.slots[i] = null;
    }
    return removed;
  }

  removeAt(index: number, count = 1): ItemStack | null {
    const s = this.slots[index];
    if (!s) return null;
    const take = Math.min(s.count, Math.max(1, count));
    const out: ItemStack = { id: s.id, count: take, rarity: s.rarity };
    s.count -= take;
    if (s.count <= 0) this.slots[index] = null;
    return out;
  }

  /**
   * Equip the item in bag cell `index`, into `slot` (or its natural slot).
   *
   * Whatever was in the slot goes back to the bag — into the cell the new item just left, so
   * equipping never needs spare space and never loses an item. Returns false when the item does
   * not fit that slot.
   */
  equip(index: number, slot?: EquipSlot): boolean {
    const stack = this.slots[index];
    if (!stack) return false;
    const def = itemDef(stack.id);
    if (!def) return false;
    const target = slot ?? this.preferredSlot(def);
    if (!target) return false;
    const meta = SLOT_KIND[target];
    if (meta !== def.kind) return false;

    // Equipment never stacks (`add` caps it at one per cell), so the swap is a straight exchange:
    // whatever was worn goes into the cell the new item just left. That is what lets a player with
    // a completely full bag still change gear.
    const previous = this.equipped[target] ?? null;
    this.equipped[target] = { id: stack.id, count: 1, rarity: stack.rarity };
    this.slots[index] = previous;
    return true;
  }

  /** Unequip into the bag. Fails (and keeps the item equipped) when there is no room. */
  unequip(slot: EquipSlot): boolean {
    const held = this.equipped[slot];
    if (!held) return false;
    const free = this.slots.findIndex((s) => !s);
    if (free < 0) return false;
    this.slots[free] = { id: held.id, count: 1, rarity: held.rarity };
    delete this.equipped[slot];
    return true;
  }

  /** Accessories go into the first free accessory slot, then slot 1. */
  private preferredSlot(def: ItemDef): EquipSlot | null {
    if (def.kind === 'accessory') return this.equipped.accessory1 ? (this.equipped.accessory2 ? 'accessory1' : 'accessory2') : 'accessory1';
    const found = (Object.keys(SLOT_KIND) as EquipSlot[]).find((s) => SLOT_KIND[s] === def.kind);
    return found ?? null;
  }

  /** Every modifier the equipped gear contributes, rarity already applied. */
  equippedMods(): Modifier[] {
    const out: Modifier[] = [];
    for (const slot of Object.keys(this.equipped) as EquipSlot[]) {
      const held = this.equipped[slot];
      const def = held && itemDef(held.id);
      if (!def) continue;
      out.push(...itemMods(def, held.rarity));
    }
    return out;
  }

  /** The equipped Lantern Core's definition, if any — the source of the element bonus + passive. */
  lanternCore(): { def: ItemDef; rarity: Rarity } | null {
    const held = this.equipped.lantern;
    const def = held && itemDef(held.id);
    return def ? { def, rarity: held.rarity } : null;
  }

  toJSON(): InventoryJson {
    return {
      slots: this.slots.map((s) => (s ? { id: s.id, count: s.count, rarity: s.rarity } : null)),
      equipped: Object.fromEntries(
        (Object.keys(this.equipped) as EquipSlot[])
          .map((k) => [k, this.equipped[k]] as const)
          .filter((e): e is [EquipSlot, ItemStack] => !!e[1]),
      ) as Equipped,
    };
  }

  /**
   * Load, dropping anything that no longer exists.
   *
   * Item ids live in code, so a save can name an item a later build removed or renamed. Skipping
   * it silently is the only sane answer — refusing the save would cost the player their progress
   * over a helmet.
   */
  load(json: Partial<InventoryJson> | null | undefined): void {
    this.slots.fill(null);
    for (const k of Object.keys(this.equipped) as EquipSlot[]) delete this.equipped[k];
    if (!json) return;

    const list = Array.isArray(json.slots) ? json.slots : [];
    for (let i = 0; i < Math.min(list.length, this.slots.length); i++) {
      const s = sane(list[i]);
      if (s) this.slots[i] = s;
    }
    const eq = json.equipped && typeof json.equipped === 'object' ? json.equipped : {};
    for (const slot of Object.keys(SLOT_KIND) as EquipSlot[]) {
      const s = sane(eq[slot]);
      if (!s) continue;
      const def = itemDef(s.id);
      if (!def || SLOT_KIND[slot] !== def.kind) continue;
      this.equipped[slot] = { ...s, count: 1 };
    }
  }
}

/** Slot → the item kind it accepts. Mirrors `EQUIP_SLOTS`, indexed for quick checks. */
const SLOT_KIND: Record<EquipSlot, ItemDef['kind']> = {
  weapon: 'weapon',
  helmet: 'helmet',
  armor: 'armor',
  gloves: 'gloves',
  boots: 'boots',
  accessory1: 'accessory',
  accessory2: 'accessory',
  lantern: 'lantern',
};

/** Coerce one stored stack, or null if it is not usable. */
function sane(value: unknown): ItemStack | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ItemStack>;
  if (typeof v.id !== 'string') return null;
  const def = itemDef(v.id);
  if (!def) return null;
  const max = Math.max(1, def.stack ?? 1);
  const count = typeof v.count === 'number' && Number.isFinite(v.count) ? Math.floor(v.count) : 1;
  if (count <= 0) return null;
  const rarity = typeof v.rarity === 'string' ? v.rarity : def.rarity;
  return { id: v.id, count: Math.min(max, count), rarity: rarity as Rarity };
}
