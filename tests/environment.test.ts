/**
 * The living environment: fireflies, drifting fog, the water mask and the wind's effect on
 * streamed chunks. The shaders themselves can only be judged on the phone, so what is tested here
 * is everything that feeds them — placement, masks, budgets and visibility rules.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { CHUNK_TILES } from '../src/config';
import { bakeWaterMask, chunkHasWater } from '../src/art/bake';
import { buildFogNoise } from '../src/art/greybox';
import { buildTileSheet } from '../src/art/tiles';
import { isWater } from '../src/core/world/tiles';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { Environment, fireflySeed } from '../src/render3d/Environment';
import { World3D } from '../src/render3d/World3D';
import { VEGETATION } from '../src/render3d/worldPlan';

const world = new GeneratedWorld();
const tileSheet = buildTileSheet();

test('fireflies are spread around the player, not clumped, and each has its own rhythm', () => {
  const seeds = Array.from({ length: 64 }, (_, i) => fireflySeed(i));
  const xs = seeds.map((s) => s.x);
  const zs = seeds.map((s) => s.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 30, 'spread along x');
  assert.ok(Math.max(...zs) - Math.min(...zs) > 30, 'spread along z');
  for (const s of seeds) {
    assert.ok(s.y > 0.4 && s.y < 3, `flying at a believable height, got ${s.y}`);
    for (const v of [s.x, s.y, s.z, s.sx, s.sy, s.sz]) assert.ok(Number.isFinite(v));
  }
  // both halves of the box are used
  assert.ok(xs.filter((x) => x < 0).length > 15 && xs.filter((x) => x > 0).length > 15, 'not all on one side');
  // phases must differ, or every firefly would blink in unison
  assert.ok(new Set(seeds.map((s) => s.sz.toFixed(4))).size > 50, 'blink phases are distinct');
  assert.deepEqual(fireflySeed(5), fireflySeed(5), 'deterministic');
});

test('fireflies come out at night and never underground; fog thickens where it should', () => {
  const scene = new THREE.Scene();
  const env = new Environment(scene);
  const focus = new THREE.Vector3(40, 0, 40);
  const haze = new THREE.Color(0x223344);

  /** @returns [firefliesVisible, fogVisible] */
  const state = (night: number, cave: number, forest: number): [boolean, boolean] => {
    env.update(1 / 60, focus, night, cave, forest, haze);
    const flies = scene.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh)!;
    const fog = scene.children.find((c) => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh)!;
    return [flies.visible, fog.visible];
  };

  assert.deepEqual(state(0, 0, 0), [false, false], 'high noon in the village: nothing');
  assert.equal(state(1, 0, 0)[0], true, 'deep night outdoors: fireflies');
  assert.equal(state(1, 1, 0)[0], false, 'deep night underground: no fireflies');
  assert.equal(state(0, 1, 0)[1], true, 'the cave is always misty');
  assert.equal(state(1, 0, 1)[1], true, 'the forest at night is misty');

  env.setBudget(0);
  assert.deepEqual(state(1, 1, 1), [false, false], 'the bottom graphics preset switches both off');
  env.dispose();
  assert.equal(scene.children.length, 0, 'dispose cleans up');
});

test('the fog noise tiles smoothly in the alpha channel', () => {
  const pm = buildFogNoise(32);
  assert.equal(pm.w, 32);
  assert.equal(pm.h, 32);
  let min = 255;
  let max = 0;
  for (let i = 3; i < pm.data.length; i += 4) {
    min = Math.min(min, pm.data[i]);
    max = Math.max(max, pm.data[i]);
  }
  assert.ok(max > 200 && min < 60, `needs real contrast, got ${min}..${max}`);
  // it has to wrap: the last column must be close to the first
  for (let y = 0; y < 32; y++) {
    const a = pm.alphaAt(0, y);
    const b = pm.alphaAt(31, y);
    assert.ok(Math.abs(a - b) < 110, `seam at row ${y}: ${a} vs ${b}`);
  }
});

test('the water mask marks exactly the water tiles, and only water chunks get one', () => {
  // find a chunk with water (the village pond / the river) and one without
  let wet: [number, number] | null = null;
  let dry: [number, number] | null = null;
  for (let cy = 0; cy < world.heightTiles / CHUNK_TILES && (!wet || !dry); cy++)
    for (let cx = 0; cx < world.widthTiles / CHUNK_TILES && (!wet || !dry); cx++) {
      if (chunkHasWater(world, cx, cy)) wet ??= [cx, cy];
      else dry ??= [cx, cy];
    }
  assert.ok(wet, 'the world has water');
  assert.ok(dry, 'and dry land');

  const mask = bakeWaterMask(world, wet[0], wet[1]);
  assert.equal(mask.w, CHUNK_TILES, 'one texel per tile is all the resolution needed');
  let marked = 0;
  for (let ty = 0; ty < CHUNK_TILES; ty++)
    for (let tx = 0; tx < CHUNK_TILES; tx++) {
      const tile = world.tileAt(wet[0] * CHUNK_TILES + tx, wet[1] * CHUNK_TILES + ty);
      const opaque = mask.alphaAt(tx, ty) > 0;
      assert.equal(opaque, isWater(tile), `tile ${tx},${ty} mask/water mismatch`);
      if (opaque) marked++;
    }
  assert.ok(marked > 0);
  assert.equal(bakeWaterMask(world, dry[0], dry[1]).w, 0, 'a dry chunk produces no mask at all');
});

test('streamed chunks with water get a ripple overlay that the preset can switch off', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(2);
  // the village pond area
  w3d.preload(18, 92);
  const withWater = w3d.stats().water;
  assert.ok(withWater > 0, 'the pond chunk has a water surface');
  assert.ok(w3d.stats().draws > w3d.stats().chunks, 'and it costs a draw');

  w3d.setWater(false);
  assert.equal(w3d.stats().water, 0, 'the bottom preset drops the overlay');
  w3d.setWater(true);
  assert.equal(w3d.stats().water, withWater);

  // the shared time uniform has to advance, or the ripples would stand still
  const before = w3d.waterUniforms.uTime.value;
  for (let i = 0; i < 10; i++) w3d.update(0.5, new THREE.Vector3(18, 0, 92), 0, 1, 1 / 60);
  assert.ok(w3d.waterUniforms.uTime.value > before, 'water time advances');
  w3d.dispose();
});

test('only the leafy textures are marked as vegetation that bends in the wind', () => {
  assert.ok(VEGETATION.has('leaf'), 'foliage sways');
  assert.equal(VEGETATION.has('stone'), false, 'walls do not');
  assert.equal(VEGETATION.has('roof'), false, 'nor do roofs');
});

test('the sun rises in the east, peaks at noon, and hands over to the moon at night', async () => {
  const { sunDirection, timeLabel } = await import('../src/core/systems/daynight');

  // t = 0.25 and 0.75 are the horizon itself, so sample just inside the day
  const dawn = sunDirection(0.3);
  const noon = sunDirection(0.5);
  const dusk = sunDirection(0.7);
  const midnight = sunDirection(0);

  assert.ok(dawn.up && noon.up && dusk.up, 'the sun is up from dawn to dusk');
  assert.equal(midnight.up, false, 'and down at midnight');
  assert.equal(sunDirection(0.25).up, false, 'exactly on the horizon does not count as up');
  assert.ok(dawn.x > 0.6, `dawn light comes from the east, got x=${dawn.x.toFixed(2)}`);
  assert.ok(dusk.x < -0.6, `dusk light comes from the west, got x=${dusk.x.toFixed(2)}`);
  assert.ok(noon.y > dawn.y && noon.y > dusk.y, 'highest at noon');
  assert.ok(midnight.y > 0.5, 'the moon hangs high instead of skimming the horizon');

  for (let i = 0; i <= 64; i++) {
    const d = sunDirection(i / 64);
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-6, 'always a unit vector');
    assert.ok(d.y > 0, 'never points up from below the ground');
  }
  assert.deepEqual(sunDirection(0), sunDirection(1), 'the day loops');
  assert.match(timeLabel(0.5), /^\d\d:00$/);
});

test('house windows light up after dark and go dark again by day', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(2);
  // the village plaza, where the houses are
  w3d.preload(34, 64);
  const focus = new THREE.Vector3(34, 0, 64);

  w3d.update(0.5, focus, 0, 0); // noon
  assert.equal(w3d.stats().windows, 0, 'nobody lights a lamp at noon');

  w3d.update(0, focus, 0, 0); // midnight
  const lit = w3d.stats().windows;
  assert.ok(lit > 0, 'the village glows at night');

  w3d.update(0.5, focus, 0, 0);
  assert.equal(w3d.stats().windows, 0, 'and goes dark again');

  // underground counts as dark, so a cave chunk would light its windows too — there are none there
  w3d.update(0.5, focus, 1, 0);
  assert.equal(w3d.stats().windows, lit, 'the cave is dark, so village windows behind you stay lit');
  w3d.dispose();
});
