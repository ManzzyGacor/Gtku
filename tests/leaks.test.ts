/**
 * GPU resource leaks.
 *
 * On a phone this is the failure that ends a session: geometries, materials and textures live in
 * GPU memory and are only freed when something calls `dispose()`. Walking around streams chunks in
 * and out continuously, so one missed `dispose()` per chunk is a few hundred kilobytes lost per
 * chunk, forever, until the tab is killed. It is also invisible on a desktop with 8 GB of VRAM,
 * which is exactly why it needs a test rather than a look.
 *
 * The trick that makes this testable without a GPU: every Three.js resource dispatches a `dispose`
 * event, so `track()` below patches the three prototypes to record which objects were disposed.
 * Then we stream chunks in, note every resource reachable from the scene, stream them out, and
 * insist that everything which left the scene graph was disposed on the way out.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import * as THREE from 'three';
import { buildTileSheet } from '../src/art/tiles';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { World3D } from '../src/render3d/World3D';
import { Environment } from '../src/render3d/Environment';
import { Combat3D } from '../src/render3d/Combat3D';
import { Collision } from '../src/core/world/collision';
import { GameState } from '../src/core/state/GameState';
import { HeroMesh3D } from '../src/render3d/HeroMesh3D';

const world = new GeneratedWorld();
const tileSheet = buildTileSheet();

type Disposable = { dispose: () => void };

/** Patch the prototypes so every dispose() is recorded, and hand back a restore function. */
function track(): { disposed: Set<object>; restore: () => void } {
  const disposed = new Set<object>();
  const protos: { proto: Disposable; original: () => void }[] = [];
  for (const ctor of [THREE.BufferGeometry, THREE.Material, THREE.Texture]) {
    const proto = ctor.prototype as unknown as Disposable;
    const original = proto.dispose;
    protos.push({ proto, original });
    proto.dispose = function patched(this: object): void {
      disposed.add(this);
      original.call(this);
    };
  }
  return {
    disposed,
    restore: () => {
      for (const { proto, original } of protos) proto.dispose = original;
    },
  };
}

let tracker: { disposed: Set<object>; restore: () => void } | null = null;
afterEach(() => {
  tracker?.restore();
  tracker = null;
});

/** Every geometry, material and texture reachable from a subtree. */
function resourcesOf(root: THREE.Object3D, includePools = true): Set<object> {
  const out = new Set<object>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    // The instance pools are permanent on purpose: they outlive any single chunk and are freed by
    // World3D.dispose (which the next test checks). A pool that has grown also leaves its original
    // geometry out of the scene graph while still owning it, so counting them here would report a
    // leak that is not one.
    if (!includePools && (o as THREE.InstancedMesh).isInstancedMesh) return;
    if (m.geometry) out.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      out.add(mat);
      // textures hang off the material's slots
      for (const value of Object.values(mat as unknown as Record<string, unknown>))
        if (value instanceof THREE.Texture) out.add(value);
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      if (uniforms)
        for (const u of Object.values(uniforms)) if (u.value instanceof THREE.Texture) out.add(u.value);
    }
  });
  return out;
}

test('streaming chunks out disposes every geometry, material and texture they brought in', () => {
  tracker = track();
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(1);

  // load the village (has water, lamps, houses — the chunk kinds with the most resources)
  w3d.preload(20, 92);
  const loadedChunks = w3d.stats().chunks;
  assert.ok(loadedChunks > 0, 'chunks must actually load');
  const before = resourcesOf(scene, false);
  assert.ok(before.size > 5, `the loaded world should hold real resources, got ${before.size}`);

  // walk to the far side of the map: everything loaded above must be unloaded
  w3d.preload(240, 40);
  const after = resourcesOf(scene, false);
  const leaked: string[] = [];
  for (const r of before) {
    if (after.has(r)) continue; // still in use (shared textures, pooled materials)
    if (!tracker.disposed.has(r)) leaked.push((r as { type?: string }).type ?? r.constructor.name);
  }
  assert.deepEqual(leaked, [], `these left the scene without being disposed: ${leaked.join(', ')}`);
  w3d.dispose();
});

test('World3D.dispose leaves nothing behind: scene empty, every resource freed', () => {
  tracker = track();
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(1);
  w3d.preload(20, 92);
  const held = resourcesOf(scene);
  w3d.dispose();

  assert.equal(scene.children.length, 0, 'the scene must be empty again');
  const leaked = [...held].filter((r) => !tracker!.disposed.has(r));
  assert.deepEqual(leaked.map((r) => (r as { type?: string }).type ?? r.constructor.name), [], 'all resources freed');
});

test('walking in circles for a long time does not grow the scene graph', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(1);
  const focus = new THREE.Vector3();

  const sample = (): { children: number; chunks: number; instances: number } => ({
    children: scene.children.length,
    chunks: w3d.stats().chunks,
    instances: w3d.stats().instances,
  });

  // one lap to warm every pool up
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    w3d.preload(40 + Math.cos(a) * 30, 60 + Math.sin(a) * 20);
  }
  const baseline = sample();

  for (let lap = 0; lap < 4; lap++)
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      focus.set(40 + Math.cos(a) * 30, 0, 60 + Math.sin(a) * 20);
      w3d.preload(focus.x, focus.z);
      w3d.update(0.4, focus, 0.5, 1, 1 / 60);
    }
  const end = sample();

  // the pools themselves persist by design; what must not grow is their number
  assert.equal(end.children, baseline.children, 'scene children must be stable across laps');
  assert.ok(end.chunks <= baseline.chunks + 1, `chunks ${baseline.chunks} -> ${end.chunks}`);
  assert.ok(end.instances <= baseline.instances * 1.2 + 8, `instances ${baseline.instances} -> ${end.instances}`);
  w3d.dispose();
  assert.equal(scene.children.length, 0);
});

test('killed enemies give their meshes back instead of piling up', () => {
  const scene = new THREE.Scene();
  const state = new GameState();
  const collision = new Collision(world);
  const combat = new Combat3D(scene, world, collision, state, {
    freeze: () => undefined,
    shake: () => undefined,
    spark: () => undefined,
    damage: () => undefined,
    killed: () => undefined,
    bossWoke: () => undefined,
    bossDefeated: () => undefined,
  });

  // chunks that actually hold spawn points (the forest band)
  const chunks: [number, number][] = [[4, 1], [7, 1], [10, 1], [6, 2], [9, 2], [12, 2], [6, 3], [10, 3]];
  for (const [cx, cy] of chunks) combat.spawnForChunk(cx, cy);
  const withEnemies = scene.children.length;
  assert.ok(combat.enemyCount > 0, 'enemies must spawn');

  // unload and reload the same chunks many times over
  for (let round = 0; round < 12; round++) {
    for (const [cx, cy] of chunks) combat.despawnForChunk(cx, cy);
    assert.equal(combat.enemyCount, 0, `round ${round}: unloading must remove every enemy`);
    for (const [cx, cy] of chunks) combat.spawnForChunk(cx, cy);
    assert.equal(scene.children.length, withEnemies, `round ${round}: scene must not grow`);
  }
  combat.dispose();
  assert.equal(scene.children.length, 0, 'dispose clears the scene');
});

test('the environment and the hero clean up after themselves', () => {
  tracker = track();
  const scene = new THREE.Scene();
  const env = new Environment(scene);
  const hero = new HeroMesh3D(scene);
  const held = resourcesOf(scene);
  env.dispose();
  hero.dispose();
  assert.equal(scene.children.length, 0, 'both must detach everything they added');
  const leaked = [...held].filter((r) => !tracker!.disposed.has(r));
  assert.deepEqual(leaked.map((r) => (r as { type?: string }).type ?? r.constructor.name), [], 'all freed');
});
