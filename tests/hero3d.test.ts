/**
 * Fase 2: the player in 3D. Everything except the GPU is exercised here — the control path
 * (stick → camera rotation → HeroCore → the same collision grid the 2D build uses) and the
 * procedural body's poses. Three.js maths and objects run fine in Node; only `WebGLRenderer` does not.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { HeroCore, HERO_STATS, type HeroInput } from '../src/core/entities/HeroCore';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { HeroMesh3D, HERO_HEIGHT } from '../src/render3d/HeroMesh3D';
import { IsoCamera } from '../src/render3d/IsoCamera';
import { u } from '../src/render3d/worldPlan';

const world = new GeneratedWorld();
const collision = new Collision(world);

function makeHero(): { hero: HeroCore; camera: IsoCamera } {
  const start = world.markers.playerStart;
  const hero = new HeroCore(start.x, start.y);
  const camera = new IsoCamera();
  camera.setViewport(480, 270);
  camera.snap(u(hero.x), u(hero.y));
  return { hero, camera };
}

/** One frame of exactly what `Game3D.step` does for movement. */
function stepHero(hero: HeroCore, camera: IsoCamera, stick: { x: number; y: number }, dt = 1 / 60, press: Partial<HeroInput> = {}): void {
  const dir = camera.stickToWorld(stick.x, stick.y);
  const inp: HeroInput = { mx: dir.x, my: dir.y, attack: false, dodge: false, skill: false, ...press };
  hero.update(dt, inp, collision, collision.speedAt(hero.x, hero.y));
  hero.events.length = 0;
  camera.follow(u(hero.x), u(hero.y), dt);
}

test('pushing the stick up walks the hero away from the camera', () => {
  const { hero, camera } = makeHero();
  const x0 = hero.x;
  const y0 = hero.y;
  for (let i = 0; i < 90; i++) stepHero(hero, camera, { x: 0, y: -1 });
  assert.ok(hero.x < x0 - 4, `should head west-ish, moved ${(hero.x - x0).toFixed(1)}`);
  assert.ok(hero.y < y0 - 4, `and north-ish, moved ${(hero.y - y0).toFixed(1)}`);
  assert.ok(Math.hypot(hero.x - x0, hero.y - y0) > 40, 'covers real ground in 1.5 s');
});

test('every stick direction moves the hero, and the camera keeps up', () => {
  for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const { hero, camera } = makeHero();
    const from = { x: hero.x, y: hero.y };
    for (let i = 0; i < 60; i++) stepHero(hero, camera, { x: sx, y: sy });
    const moved = Math.hypot(hero.x - from.x, hero.y - from.y);
    assert.ok(moved > 10, `stick (${sx},${sy}) only moved ${moved.toFixed(1)} px`);
    const gap = Math.hypot(camera.target.x - u(hero.x), camera.target.z - u(hero.y));
    assert.ok(gap < 1.5, `camera fell ${gap.toFixed(2)} units behind`);
  }
});

test('the hero never ends up inside a solid tile (same collision grid as the 2D build)', () => {
  const { hero, camera } = makeHero();
  // sweep the stick around so the hero grinds along walls, fences and houses
  for (let i = 0; i < 60 * 25; i++) {
    const a = (i / 60) * 0.9;
    stepHero(hero, camera, { x: Math.cos(a), y: Math.sin(a) });
    assert.ok(Number.isFinite(hero.x) && Number.isFinite(hero.y), 'position stayed finite');
    if (collision.solidTile(Math.floor(hero.x / 16), Math.floor(hero.y / 16))) {
      throw new Error(`hero entered a solid tile at ${hero.x.toFixed(1)},${hero.y.toFixed(1)} on frame ${i}`);
    }
  }
});

test('the dodge button produces a real roll through HeroCore', () => {
  const { hero, camera } = makeHero();
  for (let i = 0; i < 30; i++) stepHero(hero, camera, { x: 0, y: -1 });
  stepHero(hero, camera, { x: 0, y: -1 }, 1 / 60, { dodge: true });
  assert.equal(hero.state, 'roll');
  const rollStart = { x: hero.x, y: hero.y };
  for (let i = 0; i < 40; i++) stepHero(hero, camera, { x: 0, y: -1 });
  assert.notEqual(hero.state, 'roll', 'the roll ends on its own');
  assert.ok(Math.hypot(hero.x - rollStart.x, hero.y - rollStart.y) > 20, 'the roll covered distance');
});

test('the hero body follows the core: position, facing and a distinct pose per state', () => {
  const parent = new THREE.Group();
  const mesh = new HeroMesh3D(parent);
  const { hero } = makeHero();
  assert.ok(HERO_HEIGHT > 1 && HERO_HEIGHT < 2, 'roughly the height of the 2D sprite');
  assert.ok(parent.children.includes(mesh.root));

  mesh.update(0, 0, hero, 0);
  assert.equal(mesh.root.position.x, u(hero.x));
  assert.equal(mesh.root.position.z, u(hero.y));
  assert.equal(mesh.root.position.y, 0, 'feet on the ground');

  // facing follows the aim after a few frames of easing
  hero.aim = 0;
  for (let i = 0; i < 40; i++) mesh.update(1 / 60, 1 / 60, hero, i / 60);
  const yawRight = mesh.root.rotation.y;
  hero.aim = Math.PI;
  for (let i = 0; i < 40; i++) mesh.update(1 / 60, 1 / 60, hero, i / 60);
  assert.ok(Math.abs(mesh.root.rotation.y - yawRight) > 1, 'the body turned around');

  // the lantern is lit while alive and goes out on death
  assert.ok(mesh.lantern.intensity > 0);

  const snapshots = new Map<string, string>();
  for (const state of ['free', 'attack', 'roll', 'hurt', 'cast', 'dead'] as const) {
    hero.state = state;
    // far enough into the state that `attackPhase` reports the active swing
    hero.stateT = 0.12;
    hero.vx = state === 'free' ? HERO_STATS.speed : 0;
    hero.vy = 0;
    for (let i = 0; i < 10; i++) mesh.update(1 / 60, 1 / 60, hero, i / 60);
    const pose = mesh.root.children
      .flatMap((c) => c.children.map((g) => `${g.rotation.x.toFixed(3)},${g.rotation.z.toFixed(3)},${g.position.y.toFixed(3)}`))
      .join('|');
    snapshots.set(state, pose);
  }
  assert.equal(new Set(snapshots.values()).size, snapshots.size, `each state needs its own pose:\n${[...snapshots].map(([k, v]) => `${k}: ${v}`).join('\n')}`);

  hero.state = 'dead'; // `alive` is derived from the state
  assert.equal(hero.alive, false);
  mesh.update(1 / 60, 1 / 60, hero, 1);
  assert.equal(mesh.lantern.intensity, 0, 'the lamp goes out with the hero');

  mesh.dispose();
  assert.equal(parent.children.includes(mesh.root), false, 'dispose detaches the body');
});
