/**
 * The baked light pools. These are what give the reference's night its warm puddles of lamp light
 * without paying for dozens of dynamic lights, so the falloff and the bake are tested directly.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CHUNK_TILES } from '../src/config';
import { bakeLightMap, lightMapHasLight, LIGHTMAP_SIZE, poolFalloff } from '../src/render3d/lightmap';
import type { PointLightPlan } from '../src/render3d/worldPlan';

const lamp = (x: number, z: number, radius = 5, color = 0xffc46a): PointLightPlan => ({
  x,
  y: 1.9,
  z,
  color,
  radius,
  intensity: 1,
  nightOnly: true,
  flicker: 0,
});

test('the pool falloff is bright and flat under the lamp, then fades out to nothing', () => {
  const r = 5;
  const h = 1.9;
  const centre = poolFalloff(0, r, h);
  assert.ok(centre > 0.5, `bright under the lamp, got ${centre.toFixed(2)}`);
  // flat in the middle: a real inverse-square light would make a hard dot instead of a pool
  assert.ok(poolFalloff(0.8, r, h) > centre * 0.85, 'still bright a step away');

  let prev = centre;
  for (let d = 0.5; d <= r * 1.2; d += 0.25) {
    const v = poolFalloff(d, r, h);
    assert.ok(v <= prev + 1e-9, `falloff must never brighten with distance (at ${d})`);
    assert.ok(v >= 0);
    prev = v;
  }
  assert.equal(poolFalloff(r * 1.2, r, h), 0, 'and reaches exactly zero');
  assert.equal(poolFalloff(3, 0, h), 0, 'a zero-radius light lights nothing');

  // a lamp on a tall post spreads a wider, softer pool than one at ankle height
  assert.ok(poolFalloff(2, r, 3.5) < poolFalloff(2, r, 0.4), 'height softens the pool');
});

test('a lamp bakes a warm pool centred under itself', () => {
  const centreTile = CHUNK_TILES / 2;
  const pm = bakeLightMap([lamp(centreTile, centreTile)], 0, 0);
  assert.equal(pm.w, LIGHTMAP_SIZE);
  assert.ok(lightMapHasLight(pm));

  const mid = Math.floor(LIGHTMAP_SIZE / 2);
  const [colour] = pm.get(mid, mid);
  const r = (colour >> 16) & 255;
  const b = colour & 255;
  assert.ok(r > 80, `the pool is bright at its centre, got r=${r}`);
  assert.ok(r > b, 'and warm, like a flame');

  // brightness falls off toward the corner of the chunk
  const cornerLuma = pm.data[0] + pm.data[1] + pm.data[2];
  const centreLuma = pm.data[(mid * LIGHTMAP_SIZE + mid) * 4] + pm.data[(mid * LIGHTMAP_SIZE + mid) * 4 + 1] + pm.data[(mid * LIGHTMAP_SIZE + mid) * 4 + 2];
  assert.ok(cornerLuma < centreLuma, 'the corner is darker than the middle');
});

test('a chunk with no lights near it bakes nothing at all', () => {
  const far = bakeLightMap([lamp(500, 500)], 0, 0);
  assert.equal(lightMapHasLight(far), false, 'a lamp on the far side of the world must not light this chunk');
  assert.equal(lightMapHasLight(bakeLightMap([], 0, 0)), false);
});

test('a lamp across a chunk border still lights this chunk, so there is no seam', () => {
  // the lamp sits just outside chunk (1,0), one tile to the west of its border
  const pm = bakeLightMap([lamp(CHUNK_TILES - 1, 8, 6)], 1, 0);
  assert.ok(lightMapHasLight(pm), 'light crosses the border');
  const westEdge = pm.data[(8 * LIGHTMAP_SIZE + 0) * 4];
  const eastEdge = pm.data[(8 * LIGHTMAP_SIZE + (LIGHTMAP_SIZE - 1)) * 4];
  assert.ok(westEdge > eastEdge, 'brightest along the border nearest the lamp');
});

test('overlapping lamps add up but never overflow', () => {
  const c = CHUNK_TILES / 2;
  const many = [lamp(c, c, 8), lamp(c + 0.5, c, 8), lamp(c, c + 0.5, 8), lamp(c - 0.5, c, 8), lamp(c, c - 0.5, 8)];
  const pm = bakeLightMap(many, 0, 0);
  for (let i = 0; i < pm.data.length; i += 4) {
    assert.ok(pm.data[i] <= 255 && pm.data[i + 1] <= 255 && pm.data[i + 2] <= 255, 'channels stay in range');
  }
  const mid = Math.floor(LIGHTMAP_SIZE / 2);
  assert.equal(pm.data[(mid * LIGHTMAP_SIZE + mid) * 4], 255, 'five lamps on one spot clamp to full brightness');
});

test('a cool light bakes a cool pool', () => {
  const c = CHUNK_TILES / 2;
  const pm = bakeLightMap([{ ...lamp(c, c, 6, 0x69e6f2), y: 0.8 }], 0, 0);
  const mid = Math.floor(LIGHTMAP_SIZE / 2);
  const [colour] = pm.get(mid, mid);
  assert.ok((colour & 255) > ((colour >> 16) & 255), 'a crystal pools blue, not orange');
});
