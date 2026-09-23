/** Settings store, FPS meter and the graphics preset ladder (pure logic, no browser). */
import assert from 'node:assert/strict';
import { test } from 'vitest';

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { SettingsStore, parseUrlOverrides, quantize, DEFAULTS } = await import('../src/core/settings');
const { PerfMeter } = await import('../src/core/perf');
const { AdaptiveQuality, suggestPreset, lowerPreset, higherPreset, PROFILES, FPS_FLOOR, FPS_CEIL } = await import('../src/core/graphics');
const { SETTINGS_KEY } = await import('../src/config');

test('URL overrides are parsed and lock their keys', () => {
  assert.deepEqual(parseUrlOverrides('?fps=1'), { fpsCounter: true });
  assert.deepEqual(parseUrlOverrides('?bloom=0'), { bloom: false });
  assert.deepEqual(parseUrlOverrides('?preset=ultra'), { preset: 'ultra', presetAuto: false });
  assert.deepEqual(parseUrlOverrides('?q=1'), { preset: 'medium', presetAuto: false });
  assert.deepEqual(parseUrlOverrides('?preset=nope&fps=x'), {});

  const s = new SettingsStore('?fps=1&preset=low');
  assert.equal(s.get('fpsCounter'), true);
  assert.equal(s.get('preset'), 'low');
  assert.equal(s.isLocked('fpsCounter'), true);
  assert.equal(s.isLocked('preset'), true);
  assert.equal(s.isLocked('presetAuto'), false, 'presetAuto is not a row of its own');
  assert.equal(s.isLocked('bloom'), false);
});

test('settings persist, notify and clamp to their step grid', () => {
  store.clear();
  const s = new SettingsStore('');
  const seen: (string | null)[] = [];
  s.on((k) => seen.push(k));
  s.set('bloom', false);
  s.set('bloom', false); // no-op, no second event
  assert.deepEqual(seen, ['bloom']);

  for (let i = 0; i < 40; i++) s.step('stickScale', 1);
  assert.equal(s.get('stickScale'), 1.8, 'clamped at the maximum');
  for (let i = 0; i < 40; i++) s.step('stickScale', -1);
  assert.equal(s.get('stickScale'), 0.7, 'clamped at the minimum');
  assert.equal(quantize('musicVol', 0.30000000000000004), 0.3);

  const reloaded = new SettingsStore('');
  assert.equal(reloaded.get('bloom'), false, 'read back from localStorage');
  assert.equal(reloaded.get('stickScale'), 0.7);
  assert.equal(reloaded.get('preset'), DEFAULTS.preset);
});

test('corrupt stored settings fall back to the defaults', () => {
  store.set(SETTINGS_KEY, '{"preset":"potato","stickScale":"big","bloom":1}');
  const s = new SettingsStore('');
  assert.equal(s.get('preset'), DEFAULTS.preset);
  assert.equal(s.get('stickScale'), DEFAULTS.stickScale);
  assert.equal(s.get('bloom'), DEFAULTS.bloom);
  store.clear();
});

test('the FPS meter reports a smoothed average and the worst half-second', () => {
  const m = new PerfMeter();
  assert.equal(m.ready, false);
  for (let i = 0; i < 60 * 3; i++) m.push(1 / 60);
  assert.ok(m.ready);
  assert.ok(Math.abs(m.avg - 60) < 1, `avg ${m.avg}`);
  for (let i = 0; i < 45; i++) m.push(1 / 30); // 1.5 s of 30 fps
  assert.ok(m.low < 34, `low ${m.low}`);
  assert.ok(m.avg > 45, `a few bad buckets barely move the average (${m.avg})`);
  m.push(5); // tab was in the background: ignored
  assert.ok(m.low > 1);
});

test('AUTO steps the quality down after a sustained dip, then settles', () => {
  const m = new PerfMeter();
  const q = new AdaptiveQuality(m);
  const changes: string[] = [];
  let preset = 'high' as Parameters<typeof lowerPreset>[0];
  q.onChange = (_from, to, why) => {
    changes.push(`${why}:${to}`);
    preset = to;
  };
  const run = (fps: number, seconds: number): void => {
    for (let i = 0; i < Math.round(fps * seconds); i++) {
      m.push(1 / fps);
      q.update(1 / fps, preset);
    }
  };
  run(60, 6);
  assert.deepEqual(changes, [], 'a healthy phone is left alone');
  run(30, 12);
  assert.deepEqual(changes, ['drop:medium'], 'one step, then a cooldown');
  run(30, 12);
  assert.deepEqual(changes, ['drop:medium', 'drop:low'], 'still bad after the cooldown: one more step');
  run(30, 12);
  assert.deepEqual(changes, ['drop:medium', 'drop:low', 'drop:vlow'], 'down to the bottom rung');
  run(30, 60);
  assert.deepEqual(changes, ['drop:medium', 'drop:low', 'drop:vlow'], 'vlow is the floor');
  assert.equal(preset, 'vlow');
  assert.ok(FPS_FLOOR === 45 && FPS_CEIL === 57);
});

test('AUTO raises the quality again when the phone proves it can cope', () => {
  const m = new PerfMeter();
  const q = new AdaptiveQuality(m);
  const changes: string[] = [];
  let preset = 'low' as Parameters<typeof lowerPreset>[0];
  q.onChange = (_from, to, why) => {
    changes.push(`${why}:${to}`);
    preset = to;
  };
  const run = (fps: number, seconds: number): void => {
    for (let i = 0; i < Math.round(fps * seconds); i++) {
      m.push(1 / fps);
      q.update(1 / fps, preset);
    }
  };
  run(60, 4);
  assert.deepEqual(changes, [], 'a raise has to be earned over several seconds');
  run(60, 20);
  assert.deepEqual(changes, ['raise:medium']);
  run(50, 40);
  assert.deepEqual(changes, ['raise:medium'], '50 fps is fine but not good enough to raise again');
});

test('a pinned preset is never touched by the watchdog', () => {
  const m = new PerfMeter();
  const q = new AdaptiveQuality(m);
  q.auto = false;
  let changed = false;
  q.onChange = () => (changed = true);
  for (let i = 0; i < 30 * 40; i++) {
    m.push(1 / 20);
    q.update(1 / 20, 'ultra');
  }
  assert.equal(changed, false);
});

test('preset suggestion follows the device, and never picks ultra by itself', () => {
  const base = { screenW: 2340, screenH: 1080, dpr: 3, touch: true, ua: '' };
  assert.equal(suggestPreset({ ...base, cores: 8, memoryGB: 8, webgl2: true }), 'high');
  assert.equal(suggestPreset({ ...base, cores: 6, memoryGB: 4, webgl2: true }), 'medium');
  assert.equal(suggestPreset({ ...base, cores: 4, memoryGB: 2, webgl2: true }), 'vlow');
  assert.equal(suggestPreset({ ...base, cores: 4, memoryGB: 2, webgl2: false }), 'vlow', 'no WebGL2 at all: bottom rung');
  assert.equal(suggestPreset({ ...base, cores: 0, memoryGB: 0, webgl2: true }), 'low', 'unknown device: err on the safe side');
  assert.notEqual(suggestPreset({ ...base, cores: 16, memoryGB: 16, webgl2: true }), 'ultra', 'ultra is opt-in, never suggested');
  assert.equal(lowerPreset('ultra'), 'high');
  assert.equal(lowerPreset('low'), 'vlow');
  assert.equal(lowerPreset('vlow'), null);
  assert.equal(higherPreset('ultra'), null);
  assert.equal(higherPreset('vlow'), 'low');
  assert.equal(PROFILES.vlow.parallax, false);
  assert.equal(PROFILES.high.bloom, true);
  assert.ok(PROFILES.ultra.pixelHeight >= PROFILES.vlow.pixelHeight);
});
