/**
 * The buffer maths behind the pixel pipeline.
 *
 * This file exists because of a real bug: at the Ultra preset the image covered only about 62% of
 * the tester's screen width. The old code reused the 2D renderer's `MAX_LOGICAL_W = 720` clamp, so
 * on a 3:1 phone the canvas was simply too narrow. Every assertion below is a guard against that
 * class of mistake coming back.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MIN_PIXEL_H, planPixelBuffers } from '../src/render3d/pixelPlan';
import { PRESET_IDS } from '../src/core/settings';
import { profileOf } from '../src/core/graphics';

/** The device from the Batch 2 test report. */
const PHONE = { cssW: 828, cssH: 271, dpr: 2.8 };

const SCREENS: { name: string; cssW: number; cssH: number; dpr: number }[] = [
  { name: 'phone from the report (3:1, dpr 2.8)', ...PHONE },
  { name: 'phone 16:9 dpr 3', cssW: 740, cssH: 416, dpr: 3 },
  { name: 'phone 20:9 dpr 2', cssW: 800, cssH: 360, dpr: 2 },
  { name: 'tablet dpr 2', cssW: 1180, cssH: 820, dpr: 2 },
  { name: 'desktop dpr 1', cssW: 1920, cssH: 1080, dpr: 1 },
  { name: 'tiny window', cssW: 320, cssH: 180, dpr: 1 },
  { name: 'portrait', cssW: 360, cssH: 780, dpr: 3 },
];

test('every preset on every screen fills the viewport exactly', () => {
  for (const s of SCREENS)
    for (const id of PRESET_IDS) {
      const p = profileOf(id);
      const plan = planPixelBuffers(s.cssW, s.cssH, s.dpr, p.pixelHeight, p.renderScale);
      assert.equal(plan.cssW, s.cssW, `${id} on ${s.name}: canvas CSS width must be the whole viewport`);
      assert.equal(plan.cssH, s.cssH, `${id} on ${s.name}: canvas CSS height must be the whole viewport`);
      // the art grid keeps the screen's shape, so nothing is squashed
      const planAspect = plan.pixelW / plan.pixelH;
      const screenAspect = plan.canvasW / plan.canvasH;
      assert.ok(Math.abs(planAspect - screenAspect) < 0.02, `${id} on ${s.name}: aspect ${planAspect.toFixed(3)} vs ${screenAspect.toFixed(3)}`);
    }
});

test('the drawing buffer is the device resolution, not a fixed maximum width', () => {
  const plan = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 540, 1);
  assert.equal(plan.canvasW, Math.round(PHONE.cssW * PHONE.dpr));
  assert.equal(plan.canvasH, Math.round(PHONE.cssH * PHONE.dpr));
  // the old bug: 720 art columns whatever the screen
  assert.ok(plan.pixelW > 720, `a 3:1 screen at 540 rows needs ${plan.pixelW} columns, not 720`);
});

test('the art grid honours the requested row count, capped by the screen', () => {
  for (const rows of [216, 270, 360, 450, 540]) {
    const plan = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, rows, 1);
    assert.equal(plan.pixelH, rows, `asked for ${rows} rows`);
    assert.ok(plan.scale > 1, 'and the screen has room to upscale it');
  }
  // a screen with fewer device rows than the preset asks for renders at the screen's resolution
  const small = planPixelBuffers(320, 180, 1, 540, 1);
  assert.equal(small.pixelH, 180, 'never render above the device resolution');
  assert.equal(small.scale, 1);
  const tiny = planPixelBuffers(40, 20, 1, 540, 1);
  assert.equal(tiny.pixelH, MIN_PIXEL_H, 'and never below a usable minimum');
});

test('raising the pixel resolution does not change the framing, only the sharpness', () => {
  const low = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 270, 1);
  const high = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 540, 1);
  assert.ok(high.pixelH > low.pixelH, 'more rows');
  assert.ok(high.pixelW > low.pixelW, 'and more columns');
  // same shape, so the camera (which works in tiles) sees exactly the same world either way
  assert.ok(Math.abs(high.pixelW / high.pixelH - low.pixelW / low.pixelH) < 0.02);
  assert.ok(high.scale < low.scale, 'smaller pixels on screen');
});

test('renderScale shrinks only the render target, never the canvas or the art grid', () => {
  const full = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 360, 1);
  const half = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 360, 0.5);
  assert.deepEqual([half.canvasW, half.canvasH], [full.canvasW, full.canvasH]);
  assert.deepEqual([half.pixelW, half.pixelH], [full.pixelW, full.pixelH]);
  assert.ok(half.renderH < full.renderH, 'the expensive buffer is the one that shrinks');
  assert.ok(Math.abs(half.renderH - full.renderH / 2) <= 1);
  // an out-of-range scale is clamped rather than producing a degenerate target
  const silly = planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 360, 0);
  assert.ok(silly.renderH >= 90);
  assert.equal(planPixelBuffers(PHONE.cssW, PHONE.cssH, PHONE.dpr, 360, 5).renderH, full.renderH);
});

test('an enormous screen shrinks the buffer instead of cropping the view', () => {
  const huge = planPixelBuffers(3840, 2160, 2, 540, 1);
  assert.equal(huge.cssW, 3840, 'still covers the whole screen');
  assert.ok(huge.canvasW * huge.canvasH <= 3.3e6, `buffer capped, got ${huge.canvasW}x${huge.canvasH}`);
  assert.ok(Math.abs(huge.canvasW / huge.canvasH - 3840 / 2160) < 0.02, 'and keeps the aspect ratio');
});

test('the presets step the pixel resolution up in order', () => {
  const rows = PRESET_IDS.map((id) => profileOf(id).pixelHeight);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i] >= rows[i - 1], `preset ${PRESET_IDS[i]} must not be coarser than ${PRESET_IDS[i - 1]}`);
  assert.deepEqual(rows, [216, 270, 360, 450, 540], 'the resolutions asked for in the Batch 2 report');
});
