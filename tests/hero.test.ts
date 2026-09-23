import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Collision } from '../src/core/world/collision';
import type { WorldSource } from '../src/core/world/source';
import { ATTACKS, HeroCore, type HeroInput, HERO_STATS } from '../src/core/entities/HeroCore';

const open: WorldSource = {
  widthTiles: 100,
  heightTiles: 100,
  markers: {} as WorldSource['markers'],
  tileAt: () => 0,
  solidAt: () => false,
  areaAt: () => 'village',
  chunk: () => ({ cx: 0, cy: 0, props: [], spawns: [], npcs: [] }),
};
const col = new Collision(open);
const idle: HeroInput = { mx: 0, my: 0, attack: false, dodge: false, skill: false };
const run = (h: HeroCore, secs: number, inp: Partial<HeroInput> = {}): void => {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) h.update(1 / 60, { ...idle, ...inp }, col);
};
const drain = (h: HeroCore) => h.events.splice(0);

test('moves at roughly base speed', () => {
  const h = new HeroCore(200, 200);
  run(h, 1, { mx: 1 });
  assert.ok(h.x > 200 + HERO_STATS.speed * 0.8 && h.x < 200 + HERO_STATS.speed * 1.05, `x=${h.x}`);
});

test('diagonal movement is not faster than straight', () => {
  const h = new HeroCore(200, 200);
  const l = Math.SQRT1_2;
  run(h, 1, { mx: l, my: l });
  const dist = Math.hypot(h.x - 200, h.y - 200);
  assert.ok(dist < HERO_STATS.speed * 1.05);
});

test('attack fires exactly one swing event per attack', () => {
  const h = new HeroCore(200, 200);
  h.update(1 / 60, { ...idle, attack: true }, col);
  run(h, 0.6);
  const swings = drain(h).filter((e) => e.type === 'swing');
  assert.equal(swings.length, 1);
  assert.equal(h.state, 'free');
});

test('pressing attack during recovery chains into a 3-hit combo, then resets', () => {
  const h = new HeroCore(200, 200);
  h.update(1 / 60, { ...idle, attack: true }, col);
  const hits: number[] = [];
  for (let step = 0; step < 2; step++) {
    // wait until the swing frame has happened, then press again
    for (let i = 0; i < 60 && h.attackPhase !== 2; i++) h.update(1 / 60, idle, col);
    h.update(1 / 60, { ...idle, attack: true }, col);
  }
  run(h, 1);
  for (const e of drain(h)) if (e.type === 'swing') hits.push(e.index);
  assert.deepEqual(hits, [0, 1, 2]);
  // third hit has the largest damage
  assert.ok(ATTACKS[2].dmg >= 2 * ATTACKS[0].dmg);
  // after the combo ends, next attack restarts at 0
  h.update(1 / 60, { ...idle, attack: true }, col);
  assert.equal(h.combo, 0);
});

test('dodge roll grants invulnerability and has a cooldown', () => {
  const h = new HeroCore(200, 200);
  h.update(1 / 60, { ...idle, mx: 1, dodge: true }, col);
  assert.equal(h.state, 'roll');
  run(h, 0.1);
  assert.equal(h.takeDamage(1, 0, 0), false);
  assert.equal(h.hp, h.maxHp);
  run(h, 0.5);
  assert.equal(h.state, 'free');
  // cooldown: a second immediate roll is refused
  h.update(1 / 60, { ...idle, dodge: true }, col);
  assert.notEqual(h.state, 'roll');
  run(h, 0.5);
  h.update(1 / 60, { ...idle, dodge: true }, col);
  assert.equal(h.state, 'roll');
});

test('taking damage applies knockback, i-frames and can kill', () => {
  const h = new HeroCore(200, 200);
  assert.ok(h.takeDamage(3, 180, 200));
  assert.ok(h.vx > 0);
  assert.equal(h.hp, h.maxHp - 3);
  assert.equal(h.takeDamage(3, 180, 200), false); // i-frames
  run(h, 1.2);
  h.takeDamage(99, 180, 200);
  assert.equal(h.state, 'dead');
  assert.ok(drain(h).some((e) => e.type === 'dead'));
});

test('skill fires a blast once and goes on cooldown', () => {
  const h = new HeroCore(200, 200);
  h.update(1 / 60, { ...idle, skill: true }, col);
  run(h, 0.6);
  const blasts = drain(h).filter((e) => e.type === 'blast');
  assert.equal(blasts.length, 1);
  assert.ok(!h.skillReady);
  run(h, HERO_STATS.skillCooldown + 0.1);
  assert.ok(h.skillReady);
});

test('sprite direction mapping', () => {
  assert.deepEqual(HeroCore.dirOf(Math.PI / 2), { dir: 'd', flip: false });
  assert.deepEqual(HeroCore.dirOf(-Math.PI / 2), { dir: 'u', flip: false });
  assert.deepEqual(HeroCore.dirOf(Math.PI), { dir: 's', flip: true });
  assert.deepEqual(HeroCore.dirOf(0), { dir: 's', flip: false });
});
