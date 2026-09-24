/**
 * The bag, the eight slots and the level curve.
 *
 * "Inventaris penuh" is one of the edge cases this pass was asked to handle, and it is the reason
 * the bag is a fixed grid rather than an endless list: every rule about what happens when there is
 * no room is written down here.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { BAG_SLOTS, Inventory } from '../src/core/items/inventory';
import { EQUIP_SLOTS, isEquipment, ITEMS, itemScore, PASSIVES, RARITIES, slotsFor } from '../src/core/items/items';
import { expForNext, expToReach, EXP_REWARDS, gainExp, MAX_LEVEL } from '../src/core/progression';

test('the catalogue is coherent: every slot fillable, every core an implemented element', () => {
  for (const slot of EQUIP_SLOTS) {
    const fits = Object.values(ITEMS).filter((i) => i.kind === slot.kind);
    assert.ok(fits.length > 0, `nothing fits ${slot.id}`);
  }
  for (const def of Object.values(ITEMS)) {
    assert.ok(def.name.length > 3, `${def.id} needs a name`);
    assert.ok(def.note.length > 10, `${def.id} needs a description`);
    assert.ok(RARITIES.some((r) => r.id === def.rarity), `${def.id} has an unknown rarity`);
    if (def.kind === 'lantern') {
      assert.ok(def.element, `${def.id} is a core and needs an element`);
      assert.ok(def.passive && PASSIVES.some((p) => p.id === def.passive), `${def.id} needs a real passive`);
    }
    if (def.mods.length === 0) assert.ok(!isEquipment(def), `${def.id} is gear with no stats`);
  }
  // a Lantern Core for each of the four implemented elements
  const coreElements = Object.values(ITEMS).filter((i) => i.kind === 'lantern').map((i) => i.element);
  for (const el of ['api', 'air', 'es', 'petir']) assert.ok(coreElements.includes(el as never), `no core for ${el}`);
});

test('accessories fit both accessory slots and nothing else', () => {
  assert.deepEqual(slotsFor(ITEMS.ring_thorn), ['accessory1', 'accessory2']);
  assert.deepEqual(slotsFor(ITEMS.helm_stone), ['helmet']);
  assert.deepEqual(slotsFor(ITEMS.potion_small), [], 'a potion is not equipment');
});

test('stacking fills existing stacks first, then empty cells', () => {
  const inv = new Inventory(4);
  assert.deepEqual(inv.add('shard_dawn', 5), { added: 5, overflow: 0 });
  assert.equal(inv.used, 1, 'five of a stackable item is one cell');
  inv.add('shard_dawn', 3);
  assert.equal(inv.used, 1);
  assert.equal(inv.countOf('shard_dawn'), 8);

  // a stack has a limit, and the overflow opens a new cell
  inv.add('potion_small', 12);
  assert.equal(inv.countOf('potion_small'), 12);
  assert.equal(inv.used, 3, 'nine per stack, so twelve potions is two cells');
});

test('a full bag reports the overflow instead of silently eating items', () => {
  const inv = new Inventory(2);
  inv.add('sword_dawn');
  inv.add('helm_stone');
  assert.equal(inv.full, true);
  const result = inv.add('boots_soft');
  assert.deepEqual(result, { added: 0, overflow: 1 }, 'the caller has to be told');
  assert.equal(inv.countOf('boots_soft'), 0, 'and nothing is created out of thin air');

  // a partial take is reported as a partial take
  const inv2 = new Inventory(1);
  inv2.add('shard_dawn', 99);
  assert.deepEqual(inv2.add('shard_dawn', 5), { added: 0, overflow: 5 }, 'stack is full and there are no cells left');
});

test('equipping with a completely full bag still works, because it is a swap', () => {
  const inv = new Inventory(3);
  inv.add('helm_stone');
  inv.add('helm_lamplighter');
  inv.add('shard_dawn', 99);
  assert.equal(inv.full, true);

  assert.equal(inv.equip(0), true, 'equip the stone helm');
  assert.equal(inv.equipped.helmet?.id, 'helm_stone');
  assert.equal(inv.slots[0], null, 'its cell is now free');

  assert.equal(inv.equip(1), true, 'swap in the other helm');
  assert.equal(inv.equipped.helmet?.id, 'helm_lamplighter');
  assert.equal(inv.slots[1]?.id, 'helm_stone', 'the old one lands in the cell the new one left');
  assert.equal(inv.countOf('shard_dawn'), 99, 'and nothing else was disturbed');
});

test('unequipping needs a free cell and says so when there is none', () => {
  const inv = new Inventory(1);
  inv.add('helm_stone');
  inv.equip(0);
  inv.add('shard_dawn', 99);
  assert.equal(inv.full, true);
  assert.equal(inv.unequip('helmet'), false, 'it must refuse rather than delete the helm');
  assert.equal(inv.equipped.helmet?.id, 'helm_stone', 'still worn');

  inv.remove('shard_dawn', 99);
  assert.equal(inv.unequip('helmet'), true);
  assert.equal(inv.equipped.helmet, undefined);
  assert.equal(inv.slots[0]?.id, 'helm_stone');
});

test('an item cannot go into the wrong slot', () => {
  const inv = new Inventory();
  inv.add('helm_stone');
  assert.equal(inv.equip(0, 'boots'), false);
  assert.equal(inv.equipped.boots, undefined);
  inv.add('potion_small');
  assert.equal(inv.equip(1), false, 'a potion is not equipment');
  assert.equal(inv.equip(99), false, 'and an empty cell equips nothing');
});

test('two accessories can be worn at once, in either order', () => {
  const inv = new Inventory();
  inv.add('ring_thorn');
  inv.add('amulet_firefly');
  assert.equal(inv.equip(0), true);
  assert.equal(inv.equipped.accessory1?.id, 'ring_thorn');
  assert.equal(inv.equip(1), true);
  assert.equal(inv.equipped.accessory2?.id, 'amulet_firefly');
  assert.equal(inv.equippedMods().length > 2, true, 'both contribute stats');
});

test('rarity travels with the individual copy, not with the item type', () => {
  const inv = new Inventory();
  inv.add('helm_stone', 1, 'mythic');
  inv.add('helm_stone', 1, 'common');
  assert.equal(inv.used, 2, 'different rarities never share a stack');
  inv.equip(0);
  assert.equal(inv.equipped.helmet?.rarity, 'mythic');
  const mods = inv.equippedMods();
  const def = mods.find((m) => m.stat === 'def')!;
  assert.ok((def.flat ?? 0) > (ITEMS.helm_stone.mods.find((m) => m.stat === 'def')?.flat ?? 0), 'the mythic copy is stronger');
});

test('a save round-trips, and survives an item that no longer exists', () => {
  const inv = new Inventory();
  inv.add('sword_dawn');
  inv.add('shard_dawn', 7);
  inv.add('core_frost');
  inv.equip(0);
  inv.equip(inv.slots.findIndex((s) => s?.id === 'core_frost'));
  const json = JSON.parse(JSON.stringify(inv.toJSON()));

  const back = new Inventory();
  back.load(json);
  assert.equal(back.equipped.weapon?.id, 'sword_dawn');
  assert.equal(back.equipped.lantern?.id, 'core_frost');
  assert.equal(back.countOf('shard_dawn'), 7);
  assert.deepEqual(back.toJSON(), inv.toJSON(), 'byte for byte');

  // an item id a later build removed, a slot/kind mismatch, and outright garbage
  const dirty = new Inventory();
  dirty.load({
    slots: [{ id: 'pedang_yang_dihapus', count: 1, rarity: 'rare' }, null, { id: 'shard_dawn', count: -5, rarity: 'common' }, { id: 'shard_dawn', count: 3, rarity: 'common' }],
    equipped: { helmet: { id: 'boots_soft', count: 1, rarity: 'common' }, lantern: { id: 'core_ember', count: 9, rarity: 'legendary' } },
  } as never);
  assert.equal(dirty.countOf('pedang_yang_dihapus'), 0, 'an unknown item is dropped');
  assert.equal(dirty.countOf('shard_dawn'), 3, 'a negative count is dropped');
  assert.equal(dirty.equipped.helmet, undefined, 'boots cannot be worn on the head');
  assert.equal(dirty.equipped.lantern?.count, 1, 'equipment is always a single copy');

  // and the empty/broken cases
  const blank = new Inventory();
  blank.load(null);
  assert.equal(blank.used, 0);
  blank.load({ slots: 'nope', equipped: 7 } as never);
  assert.equal(blank.used, 0);
});

test('the bag is a real grid, and loading a bigger one does not overflow it', () => {
  const inv = new Inventory();
  assert.equal(inv.size, BAG_SLOTS);
  inv.load({ slots: new Array(200).fill({ id: 'shard_dawn', count: 1, rarity: 'common' }), equipped: {} });
  assert.equal(inv.slots.length, BAG_SLOTS, 'the grid stays the size it is');
  assert.equal(inv.used, BAG_SLOTS);
});

test('the power score ranks gear the way a player would', () => {
  assert.ok(itemScore(ITEMS.sword_dawn) > itemScore(ITEMS.sword_village), 'the rarer sword is better');
  assert.ok(itemScore(ITEMS.helm_stone, 'mythic') > itemScore(ITEMS.helm_stone, 'common'));
  assert.ok(itemScore(ITEMS.armor_emberplate) > itemScore(ITEMS.armor_woven));
});

// ───────────────────────────── progression ─────────────────────────────

test('the level curve rises, and a level arrives in a handful of fights', () => {
  let last = 0;
  for (let l = 1; l < MAX_LEVEL; l++) {
    const need = expForNext(l);
    assert.ok(Number.isFinite(need) && need > last, `level ${l} must cost more than ${l - 1}`);
    last = need;
  }
  assert.equal(expForNext(MAX_LEVEL), Infinity, 'the cap is the cap');
  const firstLevel = expForNext(1) / EXP_REWARDS.slime;
  assert.ok(firstLevel >= 2 && firstLevel <= 8, `the first level should take a few kills, got ${firstLevel.toFixed(1)}`);
  assert.ok(expToReach(1) === 0 && expToReach(5) > expToReach(4));
});

test('EXP levels up as many times as it earns, and stops at the cap', () => {
  const one = gainExp({ level: 1, exp: 0 }, EXP_REWARDS.slime);
  assert.equal(one.progress.level, 1);
  assert.equal(one.progress.exp, EXP_REWARDS.slime);
  assert.deepEqual(one.levels, []);

  const boss = gainExp({ level: 1, exp: 0 }, EXP_REWARDS.boss);
  assert.ok(boss.levels.length >= 2, `a boss should be worth multiple levels early on, got ${boss.levels.length}`);
  assert.equal(boss.progress.level, 1 + boss.levels.length);
  assert.deepEqual(boss.levels[0], { from: 1, to: 2 }, 'and each step is reported for the HUD');

  const capped = gainExp({ level: MAX_LEVEL, exp: 0 }, 99999);
  assert.equal(capped.progress.level, MAX_LEVEL);
  assert.equal(capped.progress.exp, 0, 'no bar creeping past full at the cap');
  assert.deepEqual(capped.levels, []);

  // garbage in, sane out
  const broken = gainExp({ level: NaN, exp: NaN }, NaN);
  assert.equal(broken.progress.level, 1);
  assert.equal(broken.progress.exp, 0);
  assert.equal(gainExp({ level: 1, exp: 10 }, -50).progress.exp, 10, 'EXP is never taken away by a bad number');
});
