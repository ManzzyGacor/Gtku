/**
 * Arrow flight (`core/combat/arrows.ts`) and the bow's feel, from the first phone test: "busur
 * terasa kurang bagus". Each test pins one thing that was wrong or missing.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { makeArrow, stepArrow, type ArrowTarget } from '../src/core/combat/arrows';
import { BOW, BOW_SHOTS, fullChargeTime } from '../src/core/combat/weapons';
import { HeroCore, HERO_STATS } from '../src/core/entities/HeroCore';
import { COMBAT_TUNABLES } from '../src/core/entities/combatTuning';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';

const world = new GeneratedWorld();
const collision = new Collision(world);
const start = world.markers.playerStart;

const open = (): boolean => false;
const target = (x: number, cy: number, radius = 6): ArrowTarget => ({ x, cy, radius, dead: false });

test('a fast arrow cannot step over a small enemy between two frames', () => {
  // 30 fps and the old top speed: 17 px per frame, more than the old point test could catch
  const e = target(100, 0, 4);
  const a = makeArrow<ArrowTarget>(0, 0, 0, 520, 2, 3, 1, 0);
  const hits: ArrowTarget[] = [];
  for (let i = 0; i < 20 && a.stuck < 0; i++) stepArrow(a, 1 / 30, [e], open, (t) => (hits.push(t), true), 1);
  assert.deepEqual(hits, [e]);
});

test('a piercing arrow hits in path order and stops in the last one it may', () => {
  const far = target(120, 0);
  const near = target(40, 0);
  const mid = target(80, 0);
  const a = makeArrow<ArrowTarget>(0, 0, 0, 1000, 2, 3, 2, 1);
  const order: number[] = [];
  const phase = stepArrow(a, 0.2, [far, near, mid], open, (t) => (order.push(t.x), true), 1);
  assert.deepEqual(order, [40, 80], 'nearest first, and only as many as the pierce allows');
  assert.equal(phase, 'stuck');
  assert.equal(a.stuckTo, mid, 'it stays in the one that stopped it');
});

test('a stuck arrow rides along with its enemy and goes when the enemy dies', () => {
  const e = target(30, 0);
  const a = makeArrow<ArrowTarget>(0, 0, 0, 600, 2, 3, 1, 0);
  stepArrow(a, 0.1, [e], open, () => true, 2);
  assert.equal(a.stuckTo, e);
  e.x += 20;
  assert.equal(stepArrow(a, 0.1, [e], open, () => true, 2), 'stuck');
  assert.ok(Math.abs(a.x - (e.x + a.ox)) < 1e-9, 'moved with it');
  e.dead = true;
  assert.equal(stepArrow(a, 0.1, [e], open, () => true, 2), 'gone');
});

test('an arrow stops at a wall and stays there for the stick time', () => {
  // a wall from tile 5 (x = 80 px) on
  const wall = (tx: number): boolean => tx >= 5;
  const a = makeArrow<ArrowTarget>(8, 8, 0, 400, 2, 3, 1, 0);
  let phase = 'flying';
  for (let i = 0; i < 30 && phase === 'flying'; i++) phase = stepArrow(a, 1 / 60, [], wall, () => true, 0.5);
  assert.equal(phase, 'stuck');
  assert.ok(a.x < 80 && a.x > 70, `stopped just short of the wall (${a.x})`);
  let t = 0;
  while (stepArrow(a, 1 / 60, [], wall, () => true, 0.5) === 'stuck') t += 1 / 60;
  assert.ok(Math.abs(t - 0.5) < 0.05, `stayed ${t.toFixed(2)} s`);
});

test('a hit that does not count (invulnerable) does not use up a pierce', () => {
  const shield = target(30, 0);
  const behind = target(60, 0);
  const a = makeArrow<ArrowTarget>(0, 0, 0, 1000, 2, 3, 1, 0);
  const got: number[] = [];
  stepArrow(a, 0.1, [shield, behind], open, (t) => (got.push(t.x), t !== shield), 1);
  assert.deepEqual(got, [30, 60]);
  assert.equal(a.stuckTo, behind);
});

test('a missed arrow expires after its flight time', () => {
  const a = makeArrow<ArrowTarget>(0, 0, 0, 100, 0.3, 3, 1, 0);
  let n = 0;
  while (stepArrow(a, 1 / 60, [], open, () => true, 1) === 'flying') n++;
  assert.ok(n >= 16 && n <= 19, `${n} frames`);
});

test('the arrows fly at a speed the eye can follow', () => {
  for (const s of BOW_SHOTS) {
    assert.ok(s.speed >= 150 && s.speed <= 400, `${s.name}: ${s.speed} px/s`);
    // at 30 fps no shot moves more than one tile-and-a-bit per frame
    assert.ok(s.speed / 30 <= 12, `${s.name} moves ${(s.speed / 30).toFixed(1)} px/frame`);
  }
});

test('drawing the bow slows the walk, and the full charge time is tunable', () => {
  const walk = (charge: boolean): number => {
    const h = new HeroCore(start.x, start.y);
    h.slot = 1;
    h.invuln = 0;
    for (let i = 0; i < 40; i++) h.update(1 / 60, { mx: 1, my: 0, attack: false, attackHeld: charge, dodge: false, skill: false }, collision);
    return Math.hypot(h.vx, h.vy);
  };
  const free = walk(false);
  const drawing = walk(true);
  assert.ok(Math.abs(drawing - free * BOW.drawMove) < free * 0.1, `${drawing.toFixed(0)} vs ${free.toFixed(0)} px/s`);

  const before = BOW.fullCharge;
  BOW.fullCharge = 1.5;
  assert.equal(fullChargeTime(), 1.5);
  BOW.fullCharge = before;
  assert.ok(HERO_STATS.speed > 0);
});

test('every bow number is on the combat panel', () => {
  const ids = new Set(COMBAT_TUNABLES.map((t) => t.id));
  for (const id of ['bow.full', 'bow.move', 'bow.aimRange', 'bow.aimCone', 'bow.line', 'bow.life', 'bow.stick', 'bow.shake', 'bow.freeze', 'bow.vibrate', 'bow.hitStop'])
    assert.ok(ids.has(id), id);
  for (let i = 0; i < BOW_SHOTS.length; i++) for (const f of ['speed', 'dmg', 'draw', 'recover', 'pierce']) assert.ok(ids.has(`s${i}.${f}`), `s${i}.${f}`);
  // and the panel really moves them
  const speed = COMBAT_TUNABLES.find((t) => t.id === 's0.speed')!;
  const was = speed.get();
  speed.set(was + 10);
  assert.equal(BOW_SHOTS[0].speed, was + 10);
  speed.set(was);
});

test('the charge fires a start event and a full-charge event', () => {
  const h = new HeroCore(start.x, start.y);
  h.slot = 1;
  const levels: number[] = [];
  for (let i = 0; i < Math.ceil(fullChargeTime() * 60) + 3; i++) {
    h.update(1 / 60, { mx: 0, my: 0, attack: i === 0, attackHeld: true, dodge: false, skill: false }, collision);
    for (const e of h.events.splice(0)) if (e.type === 'charge') levels.push(e.level);
  }
  assert.ok(levels[0] < 0.3, 'the creak as it starts');
  assert.equal(levels[levels.length - 1], 1, 'the click at full draw');
});
