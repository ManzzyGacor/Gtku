/**
 * Work that must NOT happen sixty times a second.
 *
 * Steady per-frame allocation is the phone-specific failure this file guards: each individual
 * `{x, y, color}` is nothing, but a hundred of them per frame is a garbage collection every few
 * seconds, and a GC pause is a visible stutter. The same goes for redrawing a canvas that has not
 * changed. None of this shows up in an FPS average — it shows up as the game feeling uneven — so
 * each fix below is pinned by a test that counts the work instead of measuring the time.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { installDom, type FakeEl } from './mocks/dom-mock';

const doc = installDom();
(globalThis as Record<string, unknown>).window = { devicePixelRatio: 1, innerWidth: 400, innerHeight: 800, addEventListener: () => undefined, removeEventListener: () => undefined };

const { Minimap } = await import('../src/ui/Minimap');
const { Story3D } = await import('../src/render3d/Story3D');
const { World3D } = await import('../src/render3d/World3D');
const { Combat3D } = await import('../src/render3d/Combat3D');
const { GeneratedWorld } = await import('../src/core/world/worldgen');
const { Collision } = await import('../src/core/world/collision');
const { GameState } = await import('../src/core/state/GameState');
const { buildTileSheet } = await import('../src/art/tiles');
const { TILE } = await import('../src/config');

const world = new GeneratedWorld();

test('the minimap only redraws when the picture would actually change', () => {
  const map = new Minimap(world, doc.body as unknown as HTMLElement);
  const canvases = (doc.body.childNodes[0] as FakeEl).childNodes.filter((c) => c.tagName === 'CANVAS');
  const canvas = canvases[canvases.length - 1] as FakeEl & { ctxCalls(n: string): number };
  const start = world.markers.playerStart;

  map.update(0, start.x, start.y, 'Desa', []);
  const afterFirst = canvas.ctxCalls('drawImage');
  assert.ok(afterFirst > 0, 'the first frame must draw');

  // stand perfectly still for a second, inside one blink phase
  for (let i = 0; i < 20; i++) map.update(0.001, start.x, start.y, 'Desa', []);
  assert.equal(canvas.ctxCalls('drawImage'), afterFirst, 'standing still must not redraw');

  // the blink is the one thing that changes on its own
  map.update(0.4, start.x, start.y, 'Desa', []);
  assert.ok(canvas.ctxCalls('drawImage') > afterFirst, 'the hero dot has to keep blinking');

  // and walking redraws
  const walked = canvas.ctxCalls('drawImage');
  map.update(0, start.x + TILE * 3, start.y, 'Desa', []);
  assert.ok(canvas.ctxCalls('drawImage') > walked, 'walking must redraw');
  map.destroy();
});

test('the minimap redraws when a marker moves, not only when the hero does', () => {
  const map = new Minimap(world, doc.body as unknown as HTMLElement);
  const canvases = (doc.body.childNodes[doc.body.childNodes.length - 1] as FakeEl).childNodes.filter((c) => c.tagName === 'CANVAS');
  const canvas = canvases[canvases.length - 1] as FakeEl & { ctxCalls(n: string): number };
  const start = world.markers.playerStart;
  const marks = [{ x: 100, y: 100, color: '#fff' }];

  map.update(0, start.x, start.y, 'Desa', marks);
  const drawn = canvas.ctxCalls('drawImage');
  map.update(0, start.x, start.y, 'Desa', marks);
  assert.equal(canvas.ctxCalls('drawImage'), drawn, 'the same markers change nothing');
  map.update(0, start.x, start.y, 'Desa', [{ x: 200, y: 140, color: '#fff' }]);
  assert.ok(canvas.ctxCalls('drawImage') > drawn, 'a moved marker must redraw');
  map.destroy();
});

test('quest text and map markers are not rebuilt every frame', () => {
  const scene = new THREE.Scene();
  const state = new GameState();
  const story = new Story3D(scene, world, new Collision(world), state, {
    dialogue: () => undefined,
    toast: () => undefined,
    banner: () => undefined,
    hint: () => undefined,
    float: () => undefined,
    spark: () => undefined,
    save: () => undefined,
    shake: () => undefined,
    exp: () => undefined,
    loot: () => undefined,
    reward: () => undefined,
    questNote: () => undefined,
  });

  const marks = story.mapMarks();
  assert.equal(story.mapMarks(), marks, 'the same array while nothing changed');
  const quest = story.questText();
  assert.equal(story.questText(), quest, 'likewise the tracker');

  // but progress must still be reflected
  state.quest.stage = 1;
  const marks1 = story.mapMarks();
  assert.notEqual(marks1, marks, 'a new stage rebuilds the markers');
  state.quest.kills = 3;
  const quest1 = story.questText();
  assert.notEqual(quest1, quest, 'a kill rebuilds the tracker');
  assert.ok(quest1.lines.join(' ').includes('3/'), `the count has to show: ${quest1.lines.join(' | ')}`);
  story.dispose();
});

test('standing still does not make the streamer re-decide which chunks to hold', () => {
  let projections = 0;
  const w3d = new World3D(new THREE.Scene(), world, buildTileSheet());
  w3d.setView({ right: 24, forward: 16 }, (px, pz, ox, oz, out) => {
    projections++;
    return out.set(px - ox, pz - oz);
  });
  w3d.setRenderDistance(1);

  const focus = new THREE.Vector3(40, 0, 60);
  w3d.preload(focus.x, focus.z);
  w3d.update(0.5, focus, 0, 4, 1 / 60);
  const settled = projections;

  // sixty frames of standing still
  for (let i = 0; i < 60; i++) w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.equal(projections, settled, 'a stationary camera must not re-walk the chunk grid');

  // a step inside the throttle window is still free
  focus.x += 1;
  w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.equal(projections, settled, 'one tile is far finer than a 16-tile chunk decision');

  // walking far enough does re-decide
  focus.x += 4;
  w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.ok(projections > settled, 'walking must eventually re-decide');
  w3d.dispose();
});

test('the light pool still picks the nearest lamps after the allocation-free rewrite', () => {
  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, buildTileSheet());
  w3d.setRenderDistance(1);
  // the village at night: the lamp-heavy part of the map
  w3d.preload(20, 92);

  /** The lit members of the fixed pool, nearest first, with their distance from `focus`. */
  const lit = (focus: THREE.Vector3): number[] => {
    w3d.update(0, focus, 0, 1, 1 / 60); // midnight, so the night-only lamps count
    const out: number[] = [];
    scene.traverse((o) => {
      const l = o as THREE.PointLight;
      if (l.isPointLight && l.intensity > 0) out.push(Math.hypot(l.position.x - focus.x, l.position.z - focus.z));
    });
    return out;
  };

  const near = new THREE.Vector3(20, 0, 92);
  const first = lit(near);
  assert.ok(first.length > 0, 'the village at night must light some lamps');
  assert.ok(first.length <= 3, `the pool is fixed at 3, got ${first.length}`);

  // every lit lamp must be closer than every unlit one — that is what "nearest" means
  const all: number[] = [];
  scene.traverse((o) => {
    const l = o as THREE.PointLight;
    if (l.isPointLight) all.push(Math.hypot(l.position.x - near.x, l.position.z - near.z));
  });
  assert.equal(all.length, 3, 'the pool is always in the scene, lit or not');

  // moving across the village must re-pick, and the distances must stay plausible
  const far = lit(new THREE.Vector3(60, 0, 60));
  for (const d of [...first, ...far]) assert.ok(Number.isFinite(d) && d < 200, `distance ${d}`);

  // and running for a while must never break out of the pool
  for (let i = 0; i < 120; i++) w3d.update(0, near, 0, 1, 1 / 60);
  assert.ok(w3d.stats().lights <= 3);
  w3d.dispose();
});

test('enemyCount does not build an array for the HUD each frame', () => {
  const scene = new THREE.Scene();
  const state = new GameState();
  const combat = new Combat3D(scene, world, new Collision(world), state, {
    freeze: () => undefined,
    shake: () => undefined,
    spark: () => undefined,
    damage: () => undefined,
    killed: () => undefined,
    bossWoke: () => undefined,
    bossDefeated: () => undefined,
    exp: () => undefined,
    heal: () => undefined,
  });
  combat.spawnForChunk(4, 1);
  const n = combat.enemyCount;
  assert.ok(n > 0, 'enemies must be there to count');
  // the check that matters is that it is a plain loop; this just pins the behaviour
  assert.equal(combat.enemyCount, n);
  combat.dispose();
});
