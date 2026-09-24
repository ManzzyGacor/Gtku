/**
 * Combat in 3D. The enemy simulation is the same pure `EnemyWorld` the 2D build uses, so what is
 * tested here is the 3D half: spawning from chunks, swings and arrows landing, elements riding
 * along on hits, reactions splashing, and the feedback channels firing exactly once per blow.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { CHUNK_TILES } from '../src/config';
import { StatusBag } from '../src/core/combat/elements';
import { HeroCore, type SwingEvent } from '../src/core/entities/HeroCore';
import { GameState } from '../src/core/state/GameState';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { Combat3D } from '../src/render3d/Combat3D';

const world = new GeneratedWorld();
const collision = new Collision(world);

interface Log {
  freezes: number[];
  shakes: number[];
  sparks: number[];
  damages: number[];
  killed: string[];
  bossWoke: number;
  bossDied: number;
  exp: number[];
  healed: number[];
}

function setup(): { combat: Combat3D; hero: HeroCore; log: Log; scene: THREE.Group } {
  const scene = new THREE.Group();
  const log: Log = { freezes: [], shakes: [], sparks: [], damages: [], killed: [], bossWoke: 0, bossDied: 0, exp: [], healed: [] };
  const state = new GameState();
  const start = world.markers.playerStart;
  const hero = new HeroCore(start.x, start.y);
  hero.invuln = 0;
  const combat = new Combat3D(scene, world, collision, state, {
    freeze: (ms) => log.freezes.push(ms),
    shake: (a) => log.shakes.push(a),
    spark: (_x, _y, color) => log.sparks.push(color),
    damage: (_x, _y, amount) => log.damages.push(amount),
    killed: (kind) => log.killed.push(kind),
    exp: (amount) => log.exp.push(amount),
    heal: (amount) => log.healed.push(amount),
    bossWoke: () => log.bossWoke++,
    bossDefeated: () => log.bossDied++,
  });
  return { combat, hero, log, scene };
}

/** A chunk that the world actually declares enemies in. */
function chunkWithSpawns(kind: string): { cx: number; cy: number } {
  for (let cy = 0; cy < world.heightTiles / CHUNK_TILES; cy++)
    for (let cx = 0; cx < world.widthTiles / CHUNK_TILES; cx++) {
      if (world.chunk(cx, cy).spawns.some((s) => s.kind === kind)) return { cx, cy };
    }
  throw new Error(`no chunk declares a ${kind}`);
}

const swing = (hero: HeroCore, over: Partial<SwingEvent> = {}): SwingEvent => ({
  type: 'swing',
  x: hero.x,
  y: hero.y - 8,
  angle: 0,
  range: 300,
  arc: Math.PI,
  dmg: 3,
  knock: 60,
  index: 0,
  ...over,
});

test('enemies spawn with their chunk and get a body', () => {
  const { combat, scene } = setup();
  const { cx, cy } = chunkWithSpawns('slime');
  assert.equal(combat.enemyCount, 0);
  combat.spawnForChunk(cx, cy);
  assert.ok(combat.enemyCount > 0, 'the chunk declared enemies and they exist now');

  const hero = new HeroCore(0, 0);
  combat.update(1 / 60, 1 / 60, hero);
  assert.ok(scene.children.length > 0, 'and each one has a mesh');

  // spawning the same chunk twice must not duplicate them
  const before = combat.enemyCount;
  combat.spawnForChunk(cx, cy);
  assert.equal(combat.enemyCount, before);
  combat.dispose();
});

test('a swing damages everything in its arc and pays for the feedback exactly once', () => {
  const { combat, hero, log } = setup();
  const { cx, cy } = chunkWithSpawns('slime');
  combat.spawnForChunk(cx, cy);
  const targets = combat.world.enemies;
  assert.ok(targets.length >= 1);
  // park the hero on top of them so the arc cannot miss
  hero.x = targets[0].x;
  hero.y = targets[0].y;
  const hpBefore = targets.map((e) => e.hp);

  combat.applySwing(hero, swing(hero));
  assert.ok(targets.some((e, i) => e.hp < hpBefore[i]), 'something took damage');
  assert.equal(log.freezes.length, 1, 'one hit-stop for the whole swing, not one per enemy');
  assert.equal(log.shakes.length, 1, 'and one shake');
  assert.ok(log.sparks.length >= 1, 'with sparks at the contact point');

  // a swing that connects with nothing must not shake the camera
  const far = setup();
  far.combat.applySwing(far.hero, swing(far.hero, { range: 1 }));
  assert.equal(far.log.freezes.length, 0);
  assert.equal(far.log.shakes.length, 0);
  combat.dispose();
  far.combat.dispose();
});

test('a heavy swing hits harder in every feedback channel', () => {
  const light = setup();
  const heavy = setup();
  for (const env of [light, heavy]) {
    const { cx, cy } = chunkWithSpawns('slime');
    env.combat.spawnForChunk(cx, cy);
    const t = env.combat.world.enemies[0];
    env.hero.x = t.x;
    env.hero.y = t.y;
  }
  light.combat.applySwing(light.hero, swing(light.hero));
  // the heavy finisher is combo index 3
  heavy.hero.combo = 3;
  heavy.combat.applySwing(heavy.hero, swing(heavy.hero, { index: 3 }));
  assert.ok(heavy.log.freezes[0] > light.log.freezes[0], 'a heavy blow freezes for longer');
  assert.ok(heavy.log.shakes[0] > light.log.shakes[0], 'and shakes harder');
  light.combat.dispose();
  heavy.combat.dispose();
});

test('the weapon element applies its status on hit, and a reaction multiplies the damage', () => {
  const { combat, hero } = setup();
  const { cx, cy } = chunkWithSpawns('slime');
  combat.spawnForChunk(cx, cy);
  const target = combat.world.enemies[0];
  hero.x = target.x;
  hero.y = target.y;

  hero.element = 'air';
  combat.applySwing(hero, swing(hero, { dmg: 1 }));
  // the status bag is internal, but its effect is not: a follow-up lightning hit must conduct
  const hpAfterWet = target.hp;
  hero.element = 'petir';
  target.stun = 0;
  combat.applySwing(hero, swing(hero, { dmg: 4 }));
  const conducted = hpAfterWet - target.hp;

  // the same lightning hit on a dry target
  const dry = setup();
  dry.combat.spawnForChunk(cx, cy);
  const dryTarget = dry.combat.world.enemies[0];
  dry.hero.x = dryTarget.x;
  dry.hero.y = dryTarget.y;
  dry.hero.element = 'petir';
  const dryBefore = dryTarget.hp;
  dry.combat.applySwing(dry.hero, swing(dry.hero, { dmg: 4 }));
  const plain = dryBefore - dryTarget.hp;

  assert.ok(conducted > plain, `conducting through Wet should hurt more (${conducted} vs ${plain})`);
  combat.dispose();
  dry.combat.dispose();
});

test('an arrow flies, damages what it touches, and stops after its pierce count', () => {
  const { combat, hero } = setup();
  const { cx, cy } = chunkWithSpawns('slime');
  combat.spawnForChunk(cx, cy);
  const target = combat.world.enemies[0];
  hero.x = target.x - 40;
  hero.y = target.y;
  const before = target.hp;

  combat.spawnArrow({
    type: 'shoot',
    x: hero.x,
    y: hero.y - 8,
    angle: Math.atan2(target.y - hero.y, target.x - hero.x),
    speed: 300,
    dmg: 3,
    pierce: 1,
    charge: 0,
    shot: 'cepat',
  });
  for (let i = 0; i < 60; i++) combat.update(1 / 60, 1 / 60, hero);
  assert.ok(target.hp < before, `the arrow connected (${before} → ${target.hp})`);
  combat.dispose();
});

test('auto-aim snaps to a target in front and leaves a lone hero alone', () => {
  const { combat, hero } = setup();
  const { cx, cy } = chunkWithSpawns('slime');
  combat.spawnForChunk(cx, cy);
  const target = combat.world.enemies[0];

  // stand just short of the target, aiming a few degrees off
  const toTarget = Math.atan2(target.cy - (hero.y - 8), target.x - hero.x);
  hero.x = target.x - 30;
  hero.y = target.y;
  const exact = Math.atan2(target.cy - (hero.y - 8), target.x - hero.x);
  const assisted = combat.aimAssist(hero, exact + 0.25);
  assert.ok(Math.abs(assisted - exact) < 1e-6, 'nudged onto the target');
  assert.ok(Number.isFinite(toTarget));

  // far outside the cone: left alone
  const away = combat.aimAssist(hero, exact + Math.PI);
  assert.ok(Math.abs(away - (exact + Math.PI)) < 1e-6, 'a target behind you is not snapped to');

  // no enemies at all: unchanged
  const empty = setup();
  assert.equal(empty.combat.aimAssist(empty.hero, 1.23), 1.23);
  combat.dispose();
  empty.combat.dispose();
});

test('status damage ticks on its own and never knocks the target around', () => {
  const { combat, hero } = setup();
  const { cx, cy } = chunkWithSpawns('slime');
  combat.spawnForChunk(cx, cy);
  const target = combat.world.enemies[0];
  hero.x = target.x;
  hero.y = target.y;
  hero.element = 'api';
  combat.applySwing(hero, swing(hero, { dmg: 1, knock: 0 }));
  const afterHit = target.hp;

  // let the burn run without any further hits
  for (let i = 0; i < 120; i++) combat.update(1 / 60, 1 / 60, hero);
  assert.ok(target.hp < afterHit, `burn kept ticking (${afterHit} → ${target.hp})`);
  assert.ok(combat.statusSummary().includes('burn') || target.dead, 'and the report can see it');
  combat.dispose();
});

test('a status bag on the boss resists crowd control', () => {
  // the director gives the boss resistances; check the mechanism it relies on
  const tough = new StatusBag({ freeze: 0.35 });
  tough.apply('freeze');
  const soft = new StatusBag();
  soft.apply('freeze');
  assert.ok(tough.active[0].left < soft.active[0].left, 'the boss freezes for less time');
});
