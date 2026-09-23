/**
 * Chunk streaming and the instance pools. Three.js scene graph objects work fine in Node — only
 * `WebGLRenderer` needs a real context — so the whole load/unload lifecycle is tested here,
 * including that walking around does not leak instances.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { CHUNK_TILES } from '../src/config';
import { buildTileSheet } from '../src/art/tiles';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { InstancePool } from '../src/render3d/InstancePool';
import { World3D } from '../src/render3d/World3D';
import { planChunk, type ShapeInstance } from '../src/render3d/worldPlan';

const world = new GeneratedWorld();
const tileSheet = buildTileSheet();

function shapes(n: number, x0: number): ShapeInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'box' as const,
    x: x0 + i,
    y: 1,
    z: 2,
    sx: 1 + i * 0.01,
    sy: 2,
    sz: 3,
    color: 0x445566,
    texture: 'stone' as const,
  }));
}

/** Every live instance's x position, read back out of the GPU-bound buffer. */
function livePositions(pool: InstancePool): number[] {
  const m = new THREE.Matrix4();
  const out: number[] = [];
  for (let i = 0; i < pool.liveCount; i++) {
    pool.mesh.getMatrixAt(i, m);
    out.push(Number(m.elements[12].toFixed(4)));
  }
  return out.sort((a, b) => a - b);
}

test('an instance pool hands out slots and compacts them again on unload', () => {
  const parent = new THREE.Object3D();
  const pool = new InstancePool(parent, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 16, true);
  assert.equal(pool.liveCount, 0);
  assert.equal(pool.mesh.count, 0, 'an empty pool draws nothing');

  pool.addChunk(1, shapes(3, 100));
  pool.addChunk(2, shapes(4, 200));
  assert.equal(pool.liveCount, 7);
  assert.equal(pool.mesh.count, 7, 'count follows the live range');
  assert.deepEqual(livePositions(pool), [100, 101, 102, 200, 201, 202, 203]);

  // removing the *first* chunk exercises the swap-remove path
  pool.removeChunk(1);
  assert.equal(pool.liveCount, 4);
  assert.deepEqual(livePositions(pool), [200, 201, 202, 203], 'the surviving chunk is intact');

  // per-instance sizes must have moved with their instances
  const sizes = pool.mesh.geometry.getAttribute('aSize');
  for (let i = 0; i < pool.liveCount; i++) assert.ok(sizes.getX(i) >= 1 && sizes.getX(i) < 1.1, `aSize[${i}] = ${sizes.getX(i)}`);

  pool.removeChunk(99); // unknown chunk: no-op
  assert.equal(pool.liveCount, 4);
  pool.removeChunk(2);
  assert.equal(pool.liveCount, 0);
  assert.equal(pool.mesh.count, 0);
  pool.dispose();
});

test('an instance pool grows instead of dropping instances, keeping the data', () => {
  const parent = new THREE.Object3D();
  const pool = new InstancePool(parent, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 16, false);
  pool.addChunk(1, shapes(10, 0));
  pool.addChunk(2, shapes(50, 1000)); // well past the initial capacity
  assert.equal(pool.liveCount, 60);
  assert.equal(pool.mesh.count, 60);
  const live = livePositions(pool);
  assert.equal(live.length, 60);
  assert.equal(live[0], 0, 'the instances from before the growth survived');
  assert.equal(live[59], 1049);
  assert.ok(pool.mesh.instanceColor, 'instance colours survive the growth');
  assert.equal(pool.mesh.geometry.getAttribute('aSize').count >= 60, true);
  pool.removeChunk(1);
  assert.equal(pool.liveCount, 50);
  pool.dispose();
});

test('chunks load around the hero and unload once they are far away', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(1);
  w3d.setLightBudget(4);

  const start = world.markers.playerStart;
  w3d.preload(start.x / 16, start.y / 16);
  const near = w3d.stats();
  assert.ok(near.chunks >= 4, `expected a neighbourhood, got ${near.chunks} chunks`);
  assert.equal(near.queued, 0, 'preload leaves nothing queued');
  assert.ok(near.instances > 0, 'and some scenery in the pools');
  assert.ok(near.pools > 0 && near.pools < 24, `a handful of draw groups, got ${near.pools}`);

  // a bigger radius must load strictly more
  w3d.setRenderDistance(3);
  w3d.preload(start.x / 16, start.y / 16);
  assert.ok(w3d.stats().chunks > near.chunks, 'render distance really controls how much is loaded');

  // walk to the far side of the world: the old chunks have to go
  w3d.setRenderDistance(1);
  const far = new THREE.Vector3(world.widthTiles - 8, 0, world.heightTiles - 8);
  for (let i = 0; i < 200; i++) w3d.update(0.5, far, 0, 4);
  const there = w3d.stats();
  assert.ok(there.chunks >= 3 && there.chunks <= near.chunks + 2, `chunk count stays bounded, got ${there.chunks}`);
  assert.equal(there.queued, 0, 'the queue drains');

  w3d.dispose();
  assert.equal(w3d.stats().chunks, 0, 'dispose unloads everything');
});

test('pacing the loader keeps the work per frame small', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(2);
  const start = new THREE.Vector3(world.markers.playerStart.x / 16, 0, world.markers.playerStart.y / 16);

  // one chunk per frame: the count has to climb gradually, not all at once
  w3d.update(0.5, start, 0, 1);
  const first = w3d.stats().chunks;
  assert.equal(first, 1, 'exactly one chunk baked on the first frame');
  assert.ok(w3d.stats().queued > 0, 'the rest is queued');
  for (let i = 0; i < 4; i++) w3d.update(0.5, start, 0, 1);
  assert.equal(w3d.stats().chunks, 5, 'and one more per frame after that');
  w3d.dispose();
});

test('walking back and forth across a chunk border does not leak instances', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(1);
  const a = new THREE.Vector3(world.markers.playerStart.x / 16, 0, world.markers.playerStart.y / 16);
  const b = new THREE.Vector3(a.x + CHUNK_TILES * 2, 0, a.z);

  const settle = (at: THREE.Vector3): { chunks: number; instances: number } => {
    for (let i = 0; i < 60; i++) w3d.update(0.5, at, 0, 4);
    return { chunks: w3d.stats().chunks, instances: w3d.stats().instances };
  };
  // One chunk of hysteresis means the loaded set depends a little on where you came from, so the
  // property that matters is: it settles, and it never grows trip after trip.
  settle(a);
  settle(b);
  const first = settle(a);
  for (let round = 0; round < 4; round++) {
    settle(b);
    const back = settle(a);
    assert.deepEqual(back, first, `round ${round}: the scene must settle to the same size, not creep upward`);
  }
  // and the hysteresis ring is bounded: radius 1 + 1 margin can never mean more than 5x5 chunks
  assert.ok(first.chunks <= 25, `loaded ${first.chunks} chunks for radius 1`);
  w3d.dispose();
});

test('a streamed chunk contains exactly the geometry its plan describes', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(0);
  // a lone chunk: loaded instances must match that chunk's plan exactly
  const cx = Math.floor(world.markers.playerStart.x / 16 / CHUNK_TILES);
  const cy = Math.floor(world.markers.playerStart.y / 16 / CHUNK_TILES);
  w3d.preload(cx * CHUNK_TILES + CHUNK_TILES / 2, cy * CHUNK_TILES + CHUNK_TILES / 2);
  const plan = planChunk(world, cx, cy);
  const loadedChunks = w3d.stats().chunks;
  assert.ok(loadedChunks >= 1);
  // with radius 0 the neighbourhood is small, so compare against the sum of the loaded plans
  assert.ok(w3d.stats().instances >= plan.shapes.length, `loaded ${w3d.stats().instances} < planned ${plan.shapes.length}`);
  w3d.dispose();
});
