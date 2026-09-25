/** shared/catalog.ts must say exactly what the game's item catalogue and level curve say. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { BAG_SLOTS as SHARED_BAG, CATALOG, ELEMENT_IDS, expForNext as sharedExp, MAX_LEVEL as SHARED_MAX, RARITY_IDS, SLOT_KIND } from '../shared/catalog';
import { ITEMS, RARITIES, EQUIP_SLOTS } from '../src/core/items/items';
import { BAG_SLOTS } from '../src/core/items/inventory';
import { expForNext, MAX_LEVEL } from '../src/core/progression';
import { ELEMENTS } from '../src/core/combat/elements';
import { STAT_META } from '../src/core/stats/stats';
import { DEV_STAT_IDS } from '../shared/catalog';

test('every game item is in the shared catalogue, with the same kind, rarity, stack and element', () => {
  const game = Object.values(ITEMS).map((d) => {
    const row: Record<string, unknown> = { id: d.id, kind: d.kind, rarity: d.rarity };
    if (d.stack) row.stack = d.stack;
    if (d.element) row.element = d.element;
    return row;
  });
  assert.deepEqual([...CATALOG], game, 'shared/catalog.ts is out of date: copy the new items across');
});

test('rarities, elements, slots, bag, levels and stats agree', () => {
  assert.deepEqual([...RARITY_IDS], RARITIES.map((r) => r.id));
  assert.deepEqual([...ELEMENT_IDS].sort(), Object.keys(ELEMENTS).filter((k) => ELEMENTS[k as keyof typeof ELEMENTS].implemented).sort());
  assert.deepEqual(Object.keys(SLOT_KIND), EQUIP_SLOTS.map((s) => s.id));
  for (const s of EQUIP_SLOTS) assert.equal(SLOT_KIND[s.id], s.kind);
  assert.equal(SHARED_BAG, BAG_SLOTS);
  assert.equal(SHARED_MAX, MAX_LEVEL);
  for (let l = 1; l <= MAX_LEVEL; l++) assert.equal(sharedExp(l), expForNext(l), `level ${l}`);
  assert.deepEqual([...DEV_STAT_IDS], STAT_META.map((s) => s.id));
});
