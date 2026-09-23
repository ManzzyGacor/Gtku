import assert from 'node:assert/strict';
import { test } from 'node:test';
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
