/**
 * The stat pipeline and the damage formula (docs/OVERHAUL.md §4 "Stats": **wajib punya tes**).
 *
 * These are the numbers every fight in the game runs through, and they are pure functions, so
 * there is no excuse for not pinning the behaviour that matters: the resolution order, the floors,
 * what rarity is worth, how DEF mitigates, and that nothing here can ever produce NaN.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { computeDamage, DEF_SCALE } from '../src/core/stats/damage';
import { elementBonus, emptyStats, formatModifier, formatStat, HERO_BASE, resolveStats, STAT_META, type Modifier } from '../src/core/stats/stats';
import { Character } from '../src/core/stats/character';
import { Inventory } from '../src/core/items/inventory';
import { itemMods, ITEMS, rarityMeta } from '../src/core/items/items';
import { levelMods, MAX_LEVEL } from '../src/core/progression';

test('flat modifiers land before percentages, and the order is the one players expect', () => {
  const base = { ...HERO_BASE, atk: 10 };
  const stats = resolveStats(base, [
    { stat: 'atk', flat: 6 },
    { stat: 'atk', pct: 50 },
  ]);
  // (10 + 6) * 1.5 = 24, not 10 * 1.5 + 6 = 21
  assert.equal(stats.atk, 24);
});

test('percentages from different sources add together rather than compounding', () => {
  const stats = resolveStats({ ...HERO_BASE, atk: 100 }, [
    { stat: 'atk', pct: 20, source: 'a' },
    { stat: 'atk', pct: 30, source: 'b' },
  ]);
  assert.equal(stats.atk, 150, '+20% and +30% is +50%, not x1.2 x1.3');
});

test('element-specific modifiers stay out of the sheet and only apply to their element', () => {
  const mods: Modifier[] = [{ stat: 'atk', pct: 15, element: 'api', source: 'Inti Bara' }];
  assert.equal(resolveStats(HERO_BASE, mods).atk, HERO_BASE.atk, 'the sheet must not show it');
  assert.equal(elementBonus(mods, 'api'), 15);
  assert.equal(elementBonus(mods, 'air'), 0);
  assert.equal(elementBonus(mods, undefined), 0);
});

test('no gear, buff or corrupt value can produce a non-finite or nonsensical stat', () => {
  const nasty: Modifier[] = [
    { stat: 'maxHp', flat: NaN },
    { stat: 'atk', pct: Infinity },
    { stat: 'def', flat: -9999 },
    { stat: 'crit', flat: 9999 },
    { stat: 'speed', pct: -9999 },
    { stat: 'lifesteal', flat: 500 },
    { stat: 'lanternRange', pct: -1000 },
  ];
  const stats = resolveStats(HERO_BASE, nasty);
  for (const meta of STAT_META) assert.ok(Number.isFinite(stats[meta.id]), `${meta.id} = ${stats[meta.id]}`);
  assert.ok(stats.maxHp >= 1, 'a hero with 0 max HP could never be alive');
  assert.equal(stats.def, 0, 'DEF floors at zero rather than going negative');
  assert.equal(stats.crit, 100, 'crit chance is a percentage');
  assert.ok(stats.speed >= 10, 'and the hero can always move');
  assert.equal(stats.lifesteal, 100);
});

test('an empty stat block is all zeroes, and every stat has display metadata', () => {
  const zero = emptyStats();
  for (const meta of STAT_META) assert.equal(zero[meta.id], 0, meta.id);
  assert.equal(Object.keys(zero).length, STAT_META.length, 'no stat without a label');
  assert.equal(formatStat('crit', 12.34), '12.3%');
  assert.equal(formatStat('atk', 12.6), '13');
  assert.equal(formatModifier({ stat: 'atk', flat: 6 }), '+6 Serangan');
  assert.equal(formatModifier({ stat: 'crit', pct: 12 }), '+12% Peluang Kritis');
});

// ───────────────────────────── damage ─────────────────────────────

const attacker = (over: Partial<typeof HERO_BASE> = {}): { stats: typeof HERO_BASE } => ({
  stats: { ...HERO_BASE, ...over },
});

test('damage is ATK times the attack, mitigated by DEF as a ratio', () => {
  const hit = computeDamage(attacker({ atk: 100, crit: 0 }), { def: 0 }, { attackMult: 1, roll: 0.99 });
  assert.equal(hit.amount, 100);
  assert.equal(hit.crit, false);

  // DEF_SCALE DEF halves it — never subtracts to zero, never scales into immunity
  const halved = computeDamage(attacker({ atk: 100, crit: 0 }), { def: DEF_SCALE }, { attackMult: 1, roll: 0.99 });
  assert.equal(halved.amount, 50);
  const armoured = computeDamage(attacker({ atk: 100, crit: 0 }), { def: 100000 }, { attackMult: 1, roll: 0.99 });
  assert.equal(armoured.amount, 1, 'a hit that connects always does something');
});

test('a critical hit multiplies by critDmg, and the roll decides — not luck in the test', () => {
  const who = attacker({ atk: 100, crit: 50, critDmg: 80 });
  const normal = computeDamage(who, { def: 0 }, { attackMult: 1, roll: 0.9 });
  const crit = computeDamage(who, { def: 0 }, { attackMult: 1, roll: 0.1 });
  assert.equal(normal.crit, false);
  assert.equal(crit.crit, true);
  assert.equal(crit.amount, 180);
  // exactly on the boundary counts as a miss, so 0% crit can never crit
  assert.equal(computeDamage(attacker({ atk: 100, crit: 0 }), { def: 0 }, { attackMult: 1, roll: 0 }).crit, false);
  assert.equal(computeDamage(who, { def: 0 }, { attackMult: 1, roll: 0.1, noCrit: true }).crit, false);
});

test('element mastery helps, with diminishing returns, and resistance cuts it back', () => {
  const plain = computeDamage(attacker({ atk: 100, crit: 0, mastery: 0 }), { def: 0 }, { attackMult: 1, element: 'api', roll: 1 });
  const some = computeDamage(attacker({ atk: 100, crit: 0, mastery: 120 }), { def: 0 }, { attackMult: 1, element: 'api', roll: 1 });
  const lots = computeDamage(attacker({ atk: 100, crit: 0, mastery: 600 }), { def: 0 }, { attackMult: 1, element: 'api', roll: 1 });
  assert.ok(some.amount > plain.amount, 'mastery must matter');
  assert.ok(lots.amount > some.amount, 'and more is still more');
  assert.ok(lots.amount - some.amount < some.amount - plain.amount, 'but with diminishing returns');
  assert.ok(lots.amount < plain.amount * 1.7, 'and it never runs away');

  const resisted = computeDamage(attacker({ atk: 100, crit: 0 }), { def: 0, resist: { api: 0.5 } }, { attackMult: 1, element: 'api', roll: 1 });
  assert.equal(resisted.amount, 50);
  const wrongElement = computeDamage(attacker({ atk: 100, crit: 0 }), { def: 0, resist: { api: 0.5 } }, { attackMult: 1, element: 'es', roll: 1 });
  assert.equal(wrongElement.amount, 100, 'fire resistance does not stop ice');
});

test('the Lantern Core element bonus reaches the damage but not the sheet', () => {
  const mods = itemMods(ITEMS.core_ember);
  const who = { stats: resolveStats(HERO_BASE, mods), mods };
  const fire = computeDamage(who, { def: 0 }, { attackMult: 1, element: 'api', roll: 1 });
  const ice = computeDamage(who, { def: 0 }, { attackMult: 1, element: 'es', roll: 1 });
  assert.ok(fire.amount > ice.amount, 'Inti Bara must make fire hit harder than ice');
});

test('the reaction multiplier lands last, and lifesteal follows the final number', () => {
  const who = attacker({ atk: 100, crit: 0, lifesteal: 10 });
  const plain = computeDamage(who, { def: 0 }, { attackMult: 1, roll: 1 });
  const reacted = computeDamage(who, { def: 0 }, { attackMult: 1, reactionMult: 2, roll: 1 });
  assert.equal(reacted.amount, plain.amount * 2);
  assert.equal(reacted.lifesteal, 20, 'lifesteal is a share of what actually landed');
  assert.equal(plain.lifesteal, 10);
});

test('nothing in the damage formula can return NaN, however bad the inputs', () => {
  const broken = computeDamage(
    { stats: { ...HERO_BASE, atk: NaN, crit: NaN, critDmg: NaN, mastery: NaN, lifesteal: NaN } },
    { def: NaN, resist: { api: NaN } },
    { attackMult: NaN, element: 'api', reactionMult: NaN, roll: NaN },
  );
  assert.ok(Number.isFinite(broken.amount) && broken.amount >= 1, `got ${broken.amount}`);
  assert.ok(Number.isFinite(broken.lifesteal));
});

// ───────────────────────────── character sheet ─────────────────────────────

test('the character sheet folds level and equipment into one set of numbers', () => {
  const c = new Character();
  const bare = { ...c.stats };
  assert.equal(bare.atk, HERO_BASE.atk, 'level 1 with nothing equipped is the base');

  c.inventory.add('sword_dawn');
  assert.equal(c.inventory.equip(0), true);
  c.refresh();
  assert.ok(c.stats.atk > bare.atk, 'a sword must show up in ATK');
  assert.ok(c.stats.crit > bare.crit, 'and its crit too');

  c.level = 10;
  c.refresh();
  const levelled = { ...c.stats };
  assert.ok(levelled.atk > c.stats.atk - 0.001 && levelled.maxHp > bare.maxHp, 'levels add on top');

  // the sheet can say where every number came from
  const labels = c.sources().map((s) => s.label);
  assert.ok(labels.some((l) => l.startsWith('Level')), labels.join(', '));
  assert.ok(labels.includes('Pedang Fajar'), labels.join(', '));
});

test('levels are worth what progression says, all the way to the cap', () => {
  assert.deepEqual(levelMods(1), [], 'level 1 adds nothing');
  const capped = levelMods(MAX_LEVEL);
  const atk = capped.find((m) => m.stat === 'atk')!;
  assert.ok((atk.flat ?? 0) > HERO_BASE.atk * 2, `the cap should roughly triple ATK, got +${atk.flat}`);
  const c = new Character();
  c.level = MAX_LEVEL;
  c.refresh();
  for (const meta of STAT_META) assert.ok(Number.isFinite(c.stats[meta.id]), meta.id);
});

test('rarity changes the numbers, not just the colour', () => {
  const def = ITEMS.helm_stone;
  const common = itemMods(def, 'common').find((m) => m.stat === 'def')!;
  const mythic = itemMods(def, 'mythic').find((m) => m.stat === 'def')!;
  assert.ok((mythic.flat ?? 0) > (common.flat ?? 0) * 2, `common +${common.flat} vs mythic +${mythic.flat}`);
  assert.equal(mythic.flat, Math.round((common.flat ?? 0) * rarityMeta('mythic').scale));
  // and rarity is monotonic, so an upgrade is never a downgrade
  const scales = (['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const).map((r) => rarityMeta(r).scale);
  for (let i = 1; i < scales.length; i++) assert.ok(scales[i] > scales[i - 1], `rarity ${i} must be stronger`);
});

test('buffs and debuffs go through the same pipeline and expire on their own', () => {
  const c = new Character(new Inventory());
  const base = c.stats.atk;
  c.addBuff('Berkat Altar', [{ stat: 'atk', pct: 25, source: 'Berkat Altar' }], 3);
  assert.ok(c.stats.atk > base, 'the buff applies immediately');
  c.tick(1);
  assert.ok(c.stats.atk > base, 'and holds for its duration');
  c.tick(2.5);
  assert.equal(c.stats.atk, base, 'then expires by itself');

  // a debuff is just a negative modifier
  c.addBuff('Lemah', [{ stat: 'atk', pct: -50, source: 'Lemah' }], 0);
  assert.ok(c.stats.atk < base);
  c.removeBuff('Lemah');
  assert.equal(c.stats.atk, base);
});

test('the Lantern Core passives are readable rules, not scattered special cases', () => {
  const c = new Character();
  assert.equal(c.passive, undefined);
  assert.equal(c.incomingMultiplier(1, 12), 1, 'no core, no mitigation');

  c.inventory.add('core_ember');
  c.inventory.equip(0);
  c.refresh();
  assert.equal(c.passive, 'emberGuard');
  assert.equal(c.coreElement, 'api');
  assert.equal(c.incomingMultiplier(12, 12), 1, 'at full HP it does nothing');
  assert.ok(c.incomingMultiplier(5, 12) < 1, 'below half it protects');

  c.inventory.unequip('lantern');
  c.inventory.add('core_storm');
  c.inventory.equip(c.inventory.slots.findIndex((s) => s?.id === 'core_storm'));
  c.refresh();
  assert.equal(c.heavyCritBonus(), 20);
  assert.equal(c.healPerKill(), 0);
});
