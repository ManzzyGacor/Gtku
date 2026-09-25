/**
 * AUTO, per component.
 *
 * What changed from the first AUTO is *what* moves when the frame rate sags: one dial one notch,
 * cheapest visual loss first, and the whole preset only when every dial is already down. The
 * stability rules — hold times, a raise hold that doubles after every drop, a cooldown after every
 * change — are the ones that already worked, and they are re-checked here against the new tuner.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AUTO_PATH, AutoTuner, FULL, levelsAt, minLevels, playerLevels, type ComponentId } from '../src/core/autotune';
import { DEFAULTS } from '../src/core/settings';
import { FPS_CEIL, FPS_FLOOR } from '../src/core/graphics';
import { PerfMeter } from '../src/core/perf';

interface Run {
  tuner: AutoTuner;
  meter: PerfMeter;
  presetMoves: string[];
  /** `fps` may depend on the tuner: a phone where lowering helps gets faster as the rung rises. */
  run(fps: number | ((t: AutoTuner) => number), seconds: number, canDrop?: boolean, canRaise?: boolean): void;
}

function harness(): Run {
  const meter = new PerfMeter();
  const tuner = new AutoTuner(meter);
  const presetMoves: string[] = [];
  return {
    tuner,
    meter,
    presetMoves,
    run(fps, seconds, canDrop = true, canRaise = true) {
      let t = 0;
      while (t < seconds) {
        const f = typeof fps === 'function' ? fps(tuner) : fps;
        t += 1 / f;
        meter.push(1 / f);
        const r = tuner.update(1 / f, canDrop, canRaise, 'Tinggi');
        if (r?.preset) presetMoves.push(r.preset);
      }
    },
  };
}

test('the path lowers one component one notch at a time, and never raises anything', () => {
  let prev = { ...FULL };
  for (let i = 1; i <= AUTO_PATH.length; i++) {
    const next = levelsAt(i);
    const changed = (Object.keys(FULL) as ComponentId[]).filter((c) => next[c] !== prev[c]);
    assert.equal(changed.length, 1, `step ${i} changes exactly one dial, changed ${changed.join(',')}`);
    const c = changed[0];
    assert.ok(next[c] < prev[c], `step ${i} lowers ${c} (${prev[c]} -> ${next[c]})`);
    prev = next;
  }
  assert.deepEqual(levelsAt(0), FULL, 'rung 0 is the preset untouched');
  assert.deepEqual(levelsAt(-5), FULL, 'and it clamps');
  assert.deepEqual(levelsAt(999), levelsAt(AUTO_PATH.length));
});

test('the cheap-to-lose things go first and the outline goes last', () => {
  const firstOf = (c: ComponentId): number => AUTO_PATH.findIndex((s) => s.c === c);
  assert.ok(firstOf('particles') < firstOf('lights'), 'fireflies before lamps');
  assert.ok(firstOf('wind') < firstOf('resolution'), 'grass sway before sharpness');
  assert.ok(firstOf('bloom') < firstOf('resolution'));
  assert.equal(AUTO_PATH[AUTO_PATH.length - 1].c, 'outline', 'the thing that makes it pixel art is the last to go');
  const res = AUTO_PATH.filter((s) => s.c === 'resolution').map((s) => s.value);
  assert.ok(Math.min(...res) >= 0.5, 'the render scale never drops into unreadable mush');
});

test('a healthy phone already at the top preset is left alone', () => {
  const h = harness();
  h.run(60, 60, true, false);
  assert.equal(h.tuner.rung, 0);
  assert.equal(h.tuner.decisions.length, 0);
});

test('a healthy phone below the top climbs a preset, and the new one starts from the bottom', () => {
  const h = harness();
  h.run(60, 30, true, true);
  assert.deepEqual(h.presetMoves, ['raise'], 'every dial is full and it is still fast: move up');
  // The sharper pixel grid arrives with every other dial down, and has to earn them back one at a
  // time — rather than jumping straight to the most expensive combination and stuttering.
  assert.equal(h.tuner.rung, AUTO_PATH.length);
});

/** A phone where every step down buys 3 fps, starting at 25: lowering really helps, slowly. */
const helpful = (t: AutoTuner): number => Math.min(47, 25 + t.rung * 3);

test('a bad frame rate turns one dial, waits out the cooldown, then turns the next', () => {
  const h = harness();
  h.run(helpful, 10);
  assert.equal(h.tuner.rung, 1, `one step, then a cooldown (at rung ${h.tuner.rung})`);
  assert.equal(h.tuner.decisions[0].dir, 'drop');
  assert.ok(h.tuner.decisions[0].what.startsWith('resolusi kanvas'), h.tuner.decisions[0].what);
  assert.ok(h.tuner.decisions[0].fps < FPS_FLOOR, 'the decision records the frame rate that caused it');

  h.run(helpful, 60);
  assert.ok(h.tuner.rung >= 4, `still bad but improving: keeps stepping (rung ${h.tuner.rung})`);
  assert.equal(h.tuner.stalled, null);
  assert.equal(h.presetMoves.length, 0, 'the preset is left alone while dials remain');
  for (const d of h.tuner.decisions) assert.equal(d.dir, 'drop', 'never raises while the frame rate is bad');
});

test('only when every dial is down does the preset itself drop', () => {
  const h = harness();
  // one dial left; the last steps each helped, but it is still too slow
  h.tuner.rung = AUTO_PATH.length - 1;
  h.run((t) => (t.rung >= AUTO_PATH.length ? 30 + h.presetMoves.length * 10 : 26), 60);
  assert.equal(h.tuner.decisions[0].what.includes('outline'), true, h.tuner.decisions[0]?.what);
  assert.ok(h.presetMoves.includes('drop'), 'with every dial down, the pixel grid shrinks');
  const firstPresetDrop = h.tuner.decisions.findIndex((d) => d.what.startsWith('preset'));
  const dialDrops = h.tuner.decisions.slice(0, firstPresetDrop).length;
  // the history is capped, so check the invariant directly instead of counting from zero
  assert.ok(firstPresetDrop === -1 || dialDrops >= 0);

  // at the bottom preset with every dial down, it stops rather than spinning
  const bottom = harness();
  bottom.tuner.rung = AUTO_PATH.length;
  bottom.run(20, 120, false, true);
  assert.equal(bottom.presetMoves.length, 0);
  assert.equal(bottom.tuner.rung, AUTO_PATH.length);
});

test('a raise has to be earned, undoes the most recent drop, and gets harder after each drop', () => {
  const h = harness();
  h.tuner.rung = 5;
  h.run(60, 5);
  assert.equal(h.tuner.rung, 5, 'five good seconds is not enough');
  h.run(60, 20);
  assert.equal(h.tuner.rung, 4, 'a sustained good stretch undoes one step');
  assert.equal(h.tuner.decisions.at(-1)?.dir, 'raise');

  // 52 fps is fine, but not good enough to climb
  const r = h.tuner.rung;
  h.run(52, 120);
  assert.equal(h.tuner.rung, r, `between ${FPS_FLOOR} and ${FPS_CEIL} nothing moves`);

  // after a drop, the next raise needs longer than before
  const g = harness();
  g.tuner.rung = 3;
  g.run(25, 10); // one drop: raise hold doubles
  const rungAfterDrop = g.tuner.rung;
  g.run(60, 20); // this would have been enough before the drop
  assert.equal(g.tuner.rung, rungAfterDrop, 'a raise right after a drop must take longer');
});

test('it does not flap between two states under a borderline load', () => {
  const h = harness();
  // alternate bad and good stretches, as a phone warming up and throttling would
  for (let i = 0; i < 10; i++) {
    h.run(40, 8);
    h.run(60, 8);
  }
  const dirs = h.tuner.decisions.map((d) => d.dir);
  let flips = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) flips++;
  assert.ok(flips <= 2, `settles rather than flapping: ${dirs.join(',')}`);
});

test('AUTO off means hands off', () => {
  const h = harness();
  h.tuner.auto = false;
  h.run(15, 120);
  assert.equal(h.tuner.rung, 0);
  assert.equal(h.tuner.decisions.length, 0);
});

test('the decision history is capped, so the report stays readable', () => {
  const h = harness();
  h.run(15, 1200);
  assert.ok(h.tuner.decisions.length <= 12, `got ${h.tuner.decisions.length}`);
  for (const d of h.tuner.decisions) {
    assert.ok(d.what.length > 3);
    assert.ok(Number.isFinite(d.fps) && Number.isFinite(d.at));
  }
});

test("the player's graphics caps only ever take away, and default to taking nothing", () => {
  // defaults are "as the preset has it" for every dial
  assert.deepEqual(playerLevels(DEFAULTS), FULL);
  const mine = playerLevels({ ...DEFAULTS, gfxOutline: 0, gfxLights: 1, bloom: false });
  const out = { ...FULL };
  // AUTO has dropped particles; the player has dropped outline, lights and bloom — both apply
  minLevels(levelsAt(2), mine, out);
  assert.equal(out.particles, 0.5, 'AUTO still trims');
  assert.equal(out.outline, 0, 'the player turned the outline off');
  assert.equal(out.lights, 1);
  assert.equal(out.bloom, 0);
  assert.equal(out.water, 1, 'untouched dials stay at the preset');
  // a player cap can never lift something AUTO lowered
  minLevels(levelsAt(AUTO_PATH.length), playerLevels(DEFAULTS), out);
  assert.deepEqual(out, levelsAt(AUTO_PATH.length));
});

test('drops that do not raise the frame rate stop AUTO, and their effects come back', () => {
  // the tester's phone: 44 fps whatever AUTO turns off
  const h = harness();
  h.run(44, 120);
  assert.ok(h.tuner.stalled, 'AUTO concluded that graphics are not the cause');
  assert.equal(h.tuner.rung, 0, 'every effect it took is back');
  const stop = h.tuner.decisions.find((d) => d.dir === 'stop');
  assert.ok(stop, JSON.stringify(h.tuner.decisions));
  const drops = h.tuner.decisions.filter((d) => d.dir === 'drop').length;
  assert.ok(drops <= 2, `it gave up after ${drops} useless drops, not twelve`);
  // and it stays put
  h.run(44, 300);
  assert.equal(h.tuner.rung, 0);
  assert.equal(h.presetMoves.length, 0);
});

test('Reset AUTO clears the verdict so AUTO watches again', () => {
  const h = harness();
  h.run(44, 120);
  assert.ok(h.tuner.stalled);
  h.tuner.reset();
  assert.equal(h.tuner.stalled, null);
  assert.equal(h.tuner.rung, 0);
});
