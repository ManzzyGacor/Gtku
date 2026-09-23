import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ambientAt, blendAmbient, luminance, nightAmount, wrapDay } from '../src/core/systems/daynight';

test('noon is fully bright and midnight is dark', () => {
  assert.deepEqual(ambientAt(0.5), [1, 1, 1]);
  assert.ok(luminance(ambientAt(0)) < 0.35);
  assert.ok(nightAmount(0.5) < 0.01);
  assert.ok(nightAmount(0.0) > 0.7);
});

test('cycle is continuous and wraps', () => {
  assert.equal(wrapDay(1.25), 0.25);
  assert.equal(wrapDay(-0.25), 0.75);
  const a = ambientAt(0);
  const b = ambientAt(0.9999);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.01);
  let prev = ambientAt(0);
  for (let i = 1; i <= 1000; i++) {
    const cur = ambientAt(i / 1000);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(cur[k] - prev[k]) < 0.06, `jump at ${i}`);
    prev = cur;
  }
});

test('dusk is warmer than noon (red > blue)', () => {
  const dusk = ambientAt(0.74);
  assert.ok(dusk[0] > dusk[2]);
});

test('cave blend interpolates', () => {
  const m = blendAmbient([1, 1, 1], [0.2, 0.2, 0.4], 0.5);
  assert.ok(Math.abs(m[0] - 0.6) < 1e-9 && Math.abs(m[2] - 0.7) < 1e-9);
});

test('the 3D sky palette is continuous, plausible and darker at night than at noon', async () => {
  const { skyAt, blendSky, CAVE_SKY, nightAmount, luminance } = await import('../src/core/systems/daynight');

  // every channel stays in range and the curve never jumps
  // Sunrise is genuinely fast, so the bound is per-sample rather than absolute: a discontinuity at
  // a keyframe would be far larger than the steepest legitimate ramp.
  const STEPS = 600;
  let prev = skyAt(0);
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const s = skyAt(t);
    for (const c of [...s.top, ...s.haze]) assert.ok(c >= 0 && c <= 1, `channel ${c} out of range at t=${t}`);
    const jump = Math.max(...s.top.map((v, k) => Math.abs(v - prev.top[k])), ...s.haze.map((v, k) => Math.abs(v - prev.haze[k])));
    assert.ok(jump < 0.035, `sky jumped by ${jump.toFixed(3)} in one 1/${STEPS} step at t=${t}`);
    prev = s;
  }
  assert.deepEqual(skyAt(0), skyAt(1), 'the day loops seamlessly');

  const noon = skyAt(0.5);
  const midnight = skyAt(0);
  assert.ok(luminance(noon.top) > luminance(midnight.top) * 3, 'noon sky is much brighter than midnight');
  assert.ok(noon.top[2] > noon.top[0], 'a daytime sky leans blue');

  // dusk is the warm one: haze redder than blue
  const dusk = skyAt(0.74);
  assert.ok(dusk.haze[0] > dusk.haze[2], 'dusk haze is warm');
  assert.ok(nightAmount(0.74) < nightAmount(0.9), 'and it is not night yet');

  // the cave swallows the sky completely
  const deep = blendSky(noon, 1);
  assert.deepEqual(deep.top, CAVE_SKY.top);
  assert.deepEqual(deep.haze, CAVE_SKY.haze);
  const half = blendSky(noon, 0.5);
  assert.ok(half.haze[0] > CAVE_SKY.haze[0] && half.haze[0] < noon.haze[0], 'and blends on the way in');
  assert.deepEqual(blendSky(noon, 0), noon);
});
