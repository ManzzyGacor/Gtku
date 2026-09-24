/**
 * How a swing behaves. The test report said combat felt "SANGAT KAKU", and the fixes are all
 * behavioural: you keep some control during the wind-up, a dodge bails out of any frame, a held
 * button promotes the combo to a heavy finisher, and every timing is tunable from the phone.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ATTACKS, HEAVY_INDEX, HeroCore, HERO_STATS, LIGHT_COMBO, type HeroInput } from '../src/core/entities/HeroCore';
import { COMBAT_TUNABLES, isTuned, resetCombatTuning } from '../src/core/entities/combatTuning';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';

const world = new GeneratedWorld();
const collision = new Collision(world);

function hero(): HeroCore {
  const start = world.markers.playerStart;
  const h = new HeroCore(start.x, start.y);
  h.invuln = 0;
  return h;
}

const IDLE: HeroInput = { mx: 0, my: 0, attack: false, dodge: false, skill: false };

function run(h: HeroCore, frames: number, inp: Partial<HeroInput> = {}, each?: (i: number) => Partial<HeroInput> | void): void {
  for (let i = 0; i < frames; i++) {
    const extra = each?.(i) ?? {};
    h.update(1 / 60, { ...IDLE, ...inp, ...extra }, collision, 1);
    h.events.length = 0;
  }
}

test('a tap starts the light combo and chains while the player keeps tapping', () => {
  const h = hero();
  run(h, 1, { attack: true });
  assert.equal(h.state, 'attack');
  assert.equal(h.combo, 0);

  // tap again during the swing: the press is buffered and chains when the blade has passed
  const seen = new Set<number>();
  run(h, 60, {}, (i) => {
    if (h.state === 'attack') seen.add(h.combo);
    return i % 9 === 0 ? { attack: true } : {};
  });
  assert.ok(seen.has(1), 'chained to the second swing');
  assert.ok(seen.has(2), 'and the third');
  assert.equal(LIGHT_COMBO, 3);
});

test('holding the button promotes the combo to the heavy finisher', () => {
  const h = hero();
  // hold from a standing start: the hero commits to the heavy swing on its own
  run(h, Math.ceil(HERO_STATS.holdTime * 60) + 4, { attackHeld: true });
  assert.equal(h.state, 'attack');
  assert.equal(h.combo, HEAVY_INDEX, 'held without tapping → heavy');
  assert.equal(h.isHeavy, true);
  assert.ok(ATTACKS[HEAVY_INDEX].dmg > ATTACKS[0].dmg, 'and it hits harder');
  assert.ok(ATTACKS[HEAVY_INDEX].windup > ATTACKS[0].windup, 'with a longer wind-up to telegraph it');

  // a tap on its own must stay light
  const g = hero();
  run(g, 1, { attack: true });
  run(g, 4);
  assert.equal(g.isHeavy, false);
});

test('the hero keeps turning and drifting during the wind-up', () => {
  const h = hero();
  h.aim = 0; // facing +x
  run(h, 1, { attack: true });
  const startAim = h.aim;
  // hold the stick the other way during the wind-up only
  const windupFrames = Math.max(2, Math.floor(ATTACKS[0].windup * 60));
  run(h, windupFrames, { mx: -1, my: 0 });
  assert.notEqual(h.aim, startAim, 'the swing can still be steered');
  assert.ok(Math.abs(h.aim) > 0.1, `turned by ${(h.aim * 57.3).toFixed(0)}°`);

  // and the turn is rate-limited, not instant — a snap would look worse than a lock
  const g = hero();
  g.aim = 0;
  run(g, 1, { attack: true });
  run(g, 1, { mx: -1, my: 0 });
  const perFrame = Math.abs(g.aim);
  const maxPerFrame = ((HERO_STATS.attackTurnRate * Math.PI) / 180) / 60;
  assert.ok(perFrame <= maxPerFrame + 1e-9, `turned ${perFrame} rad in one frame, limit ${maxPerFrame}`);
});

test('the hero steps forward through a swing', () => {
  const h = hero();
  h.aim = 0;
  const x0 = h.x;
  run(h, 1, { attack: true });
  run(h, Math.ceil((ATTACKS[0].windup + ATTACKS[0].active) * 60));
  assert.ok(h.x > x0 + 1, `stepped forward ${(h.x - x0).toFixed(1)} px`);
  assert.ok(ATTACKS[0].lunge > 0);
});

test('a dodge cancels a swing at any point, including mid-wind-up', () => {
  for (const delay of [1, 3, 8, 14]) {
    const h = hero();
    run(h, 1, { attack: true });
    run(h, delay);
    if (h.state !== 'attack') continue; // the swing already finished; nothing to cancel
    run(h, 1, { dodge: true });
    assert.equal(h.state, 'roll', `dodge should cancel the swing ${delay} frames in`);
  }
});

test('every combat timing is exposed as a tunable, and reset restores the shipped values', () => {
  assert.ok(COMBAT_TUNABLES.length >= 30, `expected the full set, got ${COMBAT_TUNABLES.length}`);
  assert.equal(isTuned(), false, 'nothing is tuned to start with');

  const ids = COMBAT_TUNABLES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const item of COMBAT_TUNABLES) {
    assert.ok(item.min < item.max, `${item.id} range`);
    assert.ok(item.step > 0);
    const v = item.get();
    assert.ok(Number.isFinite(v), `${item.id} reads a number`);
    assert.ok(v >= item.min - 1e-9 && v <= item.max + 1e-9, `${item.id} default ${v} outside ${item.min}..${item.max}`);
  }

  // the tunables really point at the live objects the hero reads
  const windup = COMBAT_TUNABLES.find((x) => x.id === 'a0.windup')!;
  windup.set(0.3);
  assert.equal(ATTACKS[0].windup, 0.3);
  assert.equal(isTuned(), true);

  const h = hero();
  run(h, 1, { attack: true });
  run(h, 10);
  assert.equal(h.attackPhase, 0, 'a longer wind-up really delays the blade');

  resetCombatTuning();
  assert.equal(isTuned(), false);
  assert.ok(ATTACKS[0].windup < 0.2, 'reset put the shipped value back');
});
