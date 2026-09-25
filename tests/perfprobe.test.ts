/**
 * The measuring tools (render3d/PerfProbe.ts, core/perf.ts). Each test is one way the first probe
 * lied on the phone: 16.7 ms for everything, a paused game measured, switches undone, frame time
 * and FPS disagreeing.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MEASURE_FRAMES, PerfProbe, SETTLE_FRAMES, type ProbeScenario } from '../src/render3d/PerfProbe';
import { PerfMeter, StageTimer } from '../src/core/perf';

/** A fake game: frame time and CPU depend on which features are on. */
function fakeGame() {
  const on = { bloom: true, lights: true };
  const cost = () => 12 + (on.bloom ? 4 : 0) + (on.lights ? 6 : 0);
  const scenarios: ProbeScenario[] = [
    { id: 'base', label: 'semua menyala', apply: () => undefined },
    { id: 'bloom', label: 'tanpa bloom', apply: () => void (on.bloom = false), verify: () => !on.bloom },
    { id: 'lights', label: 'tanpa lampu', apply: () => void (on.lights = false), verify: () => !on.lights },
  ];
  const restore = () => {
    on.bloom = true;
    on.lights = true;
  };
  return { on, cost, scenarios, restore };
}

function run(probe: PerfProbe, frameMs: () => number): void {
  for (let i = 0; i < 5000 && probe.running; i++) probe.update(frameMs() / 1000, true);
}

test('each feature is measured with the feature really off, and its saving shows', () => {
  const g = fakeGame();
  const probe = new PerfProbe();
  probe.start(g.scenarios, g.restore, () => ({ cpuMs: g.cost(), gpuMs: -1, calls: 10, triangles: 1000 }));
  run(probe, g.cost);
  const r = probe.results;
  assert.equal(r.length, 3);
  assert.equal(r[0].ms, 22);
  assert.equal(r[1].ms, 18, 'no bloom saves its 4 ms');
  assert.equal(r[2].ms, 16, 'no lights save their 6 ms');
  assert.ok(r.every((s) => s.verified && s.frames === MEASURE_FRAMES));
  assert.equal(probe.validity().valid, true);
  assert.match(probe.lines()[0], /VALID/);
});

test('a paused game is not measured', () => {
  const g = fakeGame();
  const probe = new PerfProbe();
  probe.start(g.scenarios, g.restore, () => ({ cpuMs: g.cost(), gpuMs: -1, calls: 1, triangles: 0 }));
  for (let i = 0; i < 300; i++) probe.update(1 / 60, false);
  assert.equal(probe.results.length, 0);
  assert.equal(probe.pausedFrames, 300);
  assert.ok(probe.running, 'it waits for the game to run');
});

test('a switch that something else turns straight back on is flagged, not reported as free', () => {
  const g = fakeGame();
  const probe = new PerfProbe();
  // "the frame code" re-enables bloom every frame, as applyGrade did
  const stubborn: ProbeScenario[] = [g.scenarios[0], { ...g.scenarios[1], apply: () => undefined }];
  probe.start(stubborn, g.restore, () => ({ cpuMs: g.cost(), gpuMs: -1, calls: 1, triangles: 0 }));
  run(probe, g.cost);
  assert.equal(probe.results[1].verified, false);
  assert.match(probe.lines().join('\n'), /TIDAK BERUBAH/);
});

test('when nothing changes anything, the run says it is invalid', () => {
  const g = fakeGame();
  const probe = new PerfProbe();
  probe.start(g.scenarios, g.restore, () => ({ cpuMs: 5, gpuMs: -1, calls: 1, triangles: 0 }));
  run(probe, () => 16.7); // what the phone reported for every row
  assert.equal(probe.validity().valid, false);
  assert.match(probe.lines()[0], /TIDAK VALID/);
});

test('under vsync the saving shows in CPU even when the frame time cannot move', () => {
  const g = fakeGame();
  const probe = new PerfProbe();
  probe.start(g.scenarios, g.restore, () => ({ cpuMs: g.cost() / 2, gpuMs: -1, calls: 1, triangles: 0 }));
  run(probe, () => 16.7);
  assert.equal(probe.validity().valid, true, 'the CPU numbers moved');
  assert.match(probe.lines().join('\n'), /terkunci vsync/);
});

test('it waits frames after each change before measuring', () => {
  const g = fakeGame();
  const probe = new PerfProbe();
  let applied = 0;
  const sc = g.scenarios.map((s) => ({ ...s, apply: () => (applied++, s.apply()) }));
  probe.start(sc, g.restore, () => ({ cpuMs: g.cost(), gpuMs: -1, calls: 1, triangles: 0 }));
  for (let i = 0; i < SETTLE_FRAMES + MEASURE_FRAMES - 1; i++) probe.update(1 / 30, true);
  assert.equal(probe.results.length, 0);
  probe.update(1 / 30, true);
  assert.equal(probe.results.length, 1);
  assert.equal(applied, 2);
});

test('frame time and FPS come from the same measurement', () => {
  const m = new PerfMeter();
  for (let i = 0; i < 300; i++) m.push(1 / 44.7);
  assert.ok(Math.abs(m.avg - 44.7) < 0.2);
  assert.ok(Math.abs(m.avgMs - 1000 / 44.7) < 0.2, `${m.avgMs} ms beside ${m.avg} fps`);
});

test('the stage timer splits a frame into its stages without allocating', () => {
  let t = 0;
  const st = new StageTimer(() => t);
  for (let f = 0; f < 400; f++) {
    st.begin();
    t += 3;
    st.lap(0);
    t += 1;
    st.lap(2);
    st.add(4, 5);
    st.end();
  }
  assert.ok(Math.abs(st.ms[0] - 3) < 0.01 && Math.abs(st.ms[2] - 1) < 0.01 && Math.abs(st.ms[4] - 5) < 0.01);
  assert.ok(Math.abs(st.total - 9) < 0.05);
});
