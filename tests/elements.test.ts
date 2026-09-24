/**
 * Elements, statuses and reactions (docs/OVERHAUL.md §4). Pure data and pure logic, so all of it
 * is checked here: what is implemented versus merely declared, how statuses stack and tick, and
 * that every reaction in the table actually fires — and that nothing outside the table does.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  applyElement,
  ELEMENTS,
  ELEMENT_STATUS,
  IMPLEMENTED_ELEMENTS,
  REACTIONS,
  StatusBag,
  STATUSES,
  type ElementId,
} from '../src/core/combat/elements';

test('all fifteen elements are declared, and exactly the four in the plan are implemented', () => {
  const ids = Object.keys(ELEMENTS) as ElementId[];
  assert.equal(ids.length, 15, 'the plan lists fifteen elements');
  for (const id of ids) {
    assert.equal(ELEMENTS[id].id, id, 'keyed by its own id');
    assert.ok(ELEMENTS[id].name.length > 0);
    assert.ok(ELEMENTS[id].color >= 0 && ELEMENTS[id].color <= 0xffffff);
  }
  assert.deepEqual([...IMPLEMENTED_ELEMENTS].sort(), ['air', 'api', 'es', 'petir'], 'Api, Air, Es, Petir');

  // An unimplemented element must do nothing at all rather than half-work.
  const bag = new StatusBag();
  const r = applyElement(bag, 'void');
  assert.equal(r.damageMult, 1);
  assert.equal(r.reaction, null);
  assert.equal(bag.active.length, 0, 'a declared-but-unimplemented element applies nothing');
});

test('each implemented element applies its own status', () => {
  for (const id of IMPLEMENTED_ELEMENTS) {
    const status = ELEMENT_STATUS[id];
    assert.ok(status, `${id} needs a status`);
    assert.equal(STATUSES[status].implemented, true, `${status} must be implemented too`);
    const bag = new StatusBag();
    applyElement(bag, id);
    assert.equal(bag.has(status), true, `${id} should apply ${status}`);
  }
});

test('statuses stack to their limit, refresh their duration, and tick damage', () => {
  const bag = new StatusBag();
  bag.apply('burn');
  assert.equal(bag.stacks('burn'), 1);
  bag.apply('burn');
  bag.apply('burn');
  bag.apply('burn');
  assert.equal(bag.stacks('burn'), STATUSES.burn.maxStacks, 'capped at the definition');

  // three stacks of burn tick three times the damage
  let total = 0;
  for (let i = 0; i < 60; i++) total += bag.tick(1 / 60).damage;
  assert.ok(total > 0, 'burn deals damage over time');
  const single = new StatusBag();
  single.apply('burn');
  let one = 0;
  for (let i = 0; i < 60; i++) one += single.tick(1 / 60).damage;
  assert.ok(total > one * 2, `three stacks should hurt far more (${total.toFixed(1)} vs ${one.toFixed(1)})`);

  // and it wears off
  const worn = new StatusBag();
  worn.apply('burn');
  let expired: string[] = [];
  for (let i = 0; i < 60 * 10 && !expired.length; i++) expired = [...worn.tick(1 / 60).expired];
  assert.deepEqual(expired, ['burn']);
  assert.equal(worn.has('burn'), false);
});

test('freeze takes control away; shock only slows', () => {
  const frozen = new StatusBag();
  frozen.apply('freeze');
  assert.equal(frozen.disabled, true);
  assert.equal(frozen.speedMult, 0);

  const shocked = new StatusBag();
  shocked.apply('shock');
  assert.equal(shocked.disabled, false);
  assert.ok(shocked.speedMult > 0 && shocked.speedMult < 1, 'slowed but still moving');

  const clean = new StatusBag();
  assert.equal(clean.speedMult, 1);
  assert.equal(clean.disabled, false);
});

test('resistance scales a status, and full resistance makes it immune', () => {
  const tough = new StatusBag({ burn: 0.5, freeze: 0 });
  assert.equal(tough.apply('freeze'), false, 'immune to freeze');
  assert.equal(tough.has('freeze'), false);
  assert.equal(tough.apply('burn'), true);
  const half = tough.active.find((s) => s.id === 'burn')!.left;
  const normal = new StatusBag();
  normal.apply('burn');
  assert.ok(Math.abs(half - normal.active[0].left / 2) < 1e-6, 'half duration');
});

test('every reaction in the table fires when its pair is set up', () => {
  assert.ok(REACTIONS.length >= 6, `expected the documented reactions, got ${REACTIONS.length}`);
  const ids = REACTIONS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'reaction ids are unique');

  for (const r of REACTIONS) {
    assert.equal(ELEMENTS[r.element].implemented, true, `${r.id} pairs an unimplemented element`);
    assert.equal(STATUSES[r.on].implemented, true, `${r.id} pairs an unimplemented status`);
    assert.ok(r.damageMult > 1, `${r.id} should be worth triggering`);
    assert.ok(r.note.length > 10, `${r.id} needs a note explaining it`);

    const bag = new StatusBag();
    assert.equal(bag.apply(r.on), true);
    const res = applyElement(bag, r.element);
    assert.equal(res.reaction?.id, r.id, `${r.element} on ${r.on} should trigger ${r.id}`);
    assert.equal(res.damageMult, r.damageMult);
    for (const cleared of r.clears ?? []) assert.equal(bag.has(cleared), false, `${r.id} should clear ${cleared}`);
    for (const applied of r.applies ?? []) assert.equal(bag.has(applied), true, `${r.id} should apply ${applied}`);
  }
});

test('the four reactions the plan names by example behave as described', () => {
  // Api + Es mencair
  const icy = new StatusBag();
  icy.apply('freeze');
  const melt = applyElement(icy, 'api');
  assert.equal(melt.reaction?.id, 'lebur');
  assert.equal(icy.has('freeze'), false, 'the ice is gone');
  assert.equal(icy.has('burn'), true, 'and it is burning now');
  assert.equal(melt.damageMult, 2);

  // Air + Petir jadi area listrik
  const wet = new StatusBag();
  wet.apply('wet');
  const conduct = applyElement(wet, 'petir');
  assert.equal(conduct.reaction?.id, 'hantar');
  assert.ok(conduct.reaction!.burst > 0, 'it splashes to neighbours');
  assert.equal(wet.has('shock'), true);

  // Es + Air membeku
  const damp = new StatusBag();
  damp.apply('wet');
  const frozen = applyElement(damp, 'es');
  assert.equal(frozen.reaction?.id, 'beku');
  assert.equal(damp.has('freeze'), true);
  assert.equal(damp.has('wet'), false);

  // Air on a burning target puts it out, and must not leave it burning
  const burning = new StatusBag();
  burning.apply('burn');
  const doused = applyElement(burning, 'air');
  assert.equal(doused.reaction?.id, 'padam');
  assert.equal(burning.has('burn'), false);
  assert.equal(burning.has('wet'), true);
});

test('a reaction that clears its own element does not immediately re-apply it', () => {
  // Petir on a frozen target shatters it; the shatter clears freeze, and shock still lands
  const bag = new StatusBag();
  bag.apply('freeze');
  applyElement(bag, 'petir');
  assert.equal(bag.has('freeze'), false);
  assert.equal(bag.has('shock'), true, 'lightning still shocks');

  // Api on a wet target: steam clears wet, and burn lands
  const steam = new StatusBag();
  steam.apply('wet');
  applyElement(steam, 'api');
  assert.equal(steam.has('wet'), false);
  assert.equal(steam.has('burn'), true);
});

test('no reaction fires on a clean target', () => {
  for (const id of IMPLEMENTED_ELEMENTS) {
    const bag = new StatusBag();
    const r = applyElement(bag, id);
    assert.equal(r.reaction, null, `${id} on a clean target must not react`);
    assert.equal(r.damageMult, 1);
  }
});

test('every status is declared with sane numbers, implemented or not', () => {
  for (const [id, def] of Object.entries(STATUSES)) {
    assert.equal(def.id, id);
    assert.ok(def.name.length > 0);
    assert.ok(def.duration > 0, `${id} duration`);
    assert.ok(def.maxStacks >= 1, `${id} stacks`);
    assert.ok(def.tickEvery > 0, `${id} tick interval`);
    assert.ok(def.speedMult >= 0 && def.speedMult <= 1, `${id} speed`);
    // an unimplemented status must refuse to apply, so nothing can half-use it
    if (!def.implemented) assert.equal(new StatusBag().apply(def.id), false, `${id} is not implemented yet`);
  }
});
