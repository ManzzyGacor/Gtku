/**
 * The states nobody plays on purpose.
 *
 * Every case here was reached by poking at the pure logic until something absurd came out, and
 * each one is a way for a session to break in a way the player cannot undo: a hero who is neither
 * alive nor dead, a "heal" that kills, an enemy walking through the terrain. They are cheap to
 * guard and impossible to notice in normal play, which is exactly why they are tested.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TILE } from '../src/config';
import { HeroCore } from '../src/core/entities/HeroCore';
import { EnemyWorld, Slime } from '../src/core/entities/enemies';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';

const world = new GeneratedWorld();
const collision = new Collision(world);
const start = world.markers.playerStart;
const idle = { mx: 0, my: 0, attack: false, dodge: false, skill: false };

const fresh = (): HeroCore => new HeroCore(start.x, start.y);

test('a non-finite dt cannot break the hero for the rest of the session', () => {
  const hero = fresh();
  for (const dt of [NaN, Infinity, -Infinity, -1, 0]) {
    hero.update(dt, { ...idle, mx: 1 }, collision, 1);
    assert.ok(Number.isFinite(hero.x) && Number.isFinite(hero.y), `position after dt=${dt}`);
    assert.ok(Number.isFinite(hero.vx) && Number.isFinite(hero.vy), `velocity after dt=${dt}`);
  }
  // and normal movement still works afterwards — this is the part that used to be lost forever,
  // because a NaN velocity makes Collision.move compute NaN sub-steps and take none of them
  const x0 = hero.x;
  for (let i = 0; i < 60; i++) hero.update(1 / 60, { ...idle, mx: 1 }, collision, 1);
  assert.ok(hero.x - x0 > TILE, `the hero must still be able to walk, moved ${(hero.x - x0).toFixed(1)}px`);
});

test('a non-finite ground speed multiplier is ignored, not propagated', () => {
  const hero = fresh();
  for (const mult of [NaN, Infinity, 0, -2]) {
    hero.update(1 / 60, { ...idle, mx: 1 }, collision, mult);
    assert.ok(Number.isFinite(hero.x) && Number.isFinite(hero.vx), `speedMult=${mult}`);
  }
});

test('NaN and negative damage never heal the hero or push HP past its maximum', () => {
  const hero = fresh();
  hero.invuln = 0;
  assert.equal(hero.takeDamage(-50, start.x + 10, start.y), true, 'the hit still lands');
  assert.equal(hero.hp, hero.maxHp, 'negative damage must not add HP');

  hero.invuln = 0;
  hero.takeDamage(NaN, start.x + 10, start.y);
  assert.ok(Number.isFinite(hero.hp), 'HP must stay a number');
  assert.equal(hero.hp, hero.maxHp);

  hero.invuln = 0;
  hero.takeDamage(3, NaN, NaN);
  assert.ok(Number.isFinite(hero.vx) && Number.isFinite(hero.vy), 'a NaN attacker position must not poison the knockback');
  assert.equal(hero.hp, hero.maxHp - 3);
});

test('heal only heals', () => {
  const hero = fresh();
  hero.hp = 5;
  hero.heal(-3);
  assert.equal(hero.hp, 5, 'a negative heal must not hurt');
  hero.heal(NaN);
  assert.equal(hero.hp, 5);
  hero.heal(999);
  assert.equal(hero.hp, hero.maxHp, 'and it cannot overfill');
});

test('at 0 HP the hero dies exactly once and stops acting', () => {
  const hero = fresh();
  hero.invuln = 0;
  assert.equal(hero.takeDamage(999, start.x + 10, start.y), true);
  assert.equal(hero.hp, 0);
  assert.equal(hero.state, 'dead');
  assert.deepEqual(hero.events.map((e) => e.type), ['dead'], 'one death event');

  hero.events.length = 0;
  assert.equal(hero.takeDamage(5, start.x, start.y), false, 'a corpse cannot be hit again');
  assert.equal(hero.hp, 0, 'and HP never goes below zero');
  // a length check, not deepEqual: node's assert narrows the array to never[] for the rest of the
  // test, and the next assertion needs to read event types
  assert.equal(hero.events.length, 0, 'no second death event');

  // mashing every button for five seconds must not revive or move them into a wall
  const at = { x: hero.x, y: hero.y };
  for (let i = 0; i < 300; i++)
    hero.update(1 / 60, { mx: 1, my: 1, attack: true, attackHeld: true, dodge: true, skill: true }, collision, 1);
  assert.equal(hero.state, 'dead');
  assert.equal(hero.hp, 0);
  assert.ok(Math.hypot(hero.x - at.x, hero.y - at.y) < TILE, 'a dead hero does not walk off');
  assert.equal(hero.events.filter((e) => e.type === 'swing').length, 0, 'and does not swing');
});

test('respawn brings the hero back whole', () => {
  const hero = fresh();
  hero.invuln = 0;
  hero.takeDamage(999, start.x + 10, start.y);
  hero.reset(start.x, start.y);
  assert.equal(hero.hp, hero.maxHp);
  assert.equal(hero.state, 'free');
  assert.ok(hero.alive);
  let moved = 0;
  for (let i = 0; i < 60; i++) {
    hero.update(1 / 60, { ...idle, mx: 1 }, collision, 1);
    moved = Math.abs(hero.x - start.x);
  }
  assert.ok(moved > 1, 'and can move again');
});

test('an enemy caught inside a wall walks out instead of drifting through the terrain', () => {
  // The doors in this game add real collision at runtime, so this is the state an archer ends up
  // in when the boss arena seals with it standing in the doorway.
  let wall: { tx: number; ty: number } | null = null;
  for (let ty = 2; ty < world.heightTiles - 2 && !wall; ty++)
    for (let tx = 2; tx < world.widthTiles - 2; tx++)
      if (world.solidAt(tx, ty) && !world.solidAt(tx + 1, ty)) {
        wall = { tx, ty };
        break;
      }
  assert.ok(wall, 'the world must have walls');

  const enemies = new EnemyWorld();
  enemies.rand = () => 0.5;
  const slime = enemies.add(new Slime(wall.tx * TILE + TILE / 2, wall.ty * TILE + TILE - 1));
  const hero = new HeroCore(wall.tx * TILE + 100, wall.ty * TILE);
  const from = { x: slime.x, y: slime.y };

  for (let i = 0; i < 600; i++) enemies.update(1 / 60, hero, collision);

  assert.ok(Number.isFinite(slime.x) && Number.isFinite(slime.y), 'position stays a number');
  assert.equal(collision.boxBlocked(slime.x, slime.y, slime.hw, slime.h), false, 'it must end up in free space');
  const travelled = Math.hypot(slime.x - from.x, slime.y - from.y);
  assert.ok(travelled < TILE * 4, `it should step out, not tour the map: travelled ${travelled.toFixed(0)}px`);
});

test('a dynamic blocker dropped on an enemy (a closing door) does not let it escape through walls', () => {
  const enemies = new EnemyWorld();
  enemies.rand = () => 0.5;
  const open = world.markers.boss.door;
  const slime = enemies.add(new Slime(open.tx * TILE + TILE / 2, open.ty * TILE + TILE - 1));
  const hero = new HeroCore(slime.x + 200, slime.y);
  const col = new Collision(world);
  for (let i = 0; i < open.h; i++) col.addBlocker(open.tx, open.ty + i);

  for (let i = 0; i < 600; i++) enemies.update(1 / 60, hero, col);
  assert.equal(col.boxBlocked(slime.x, slime.y, slime.hw, slime.h), false, 'the door pushes it clear');
  assert.ok(Math.abs(slime.x - (open.tx * TILE + 8)) < TILE * 4, 'and it stays near the door');
});

test('an enemy walled in on every side stands still rather than tunnelling', () => {
  const enemies = new EnemyWorld();
  enemies.rand = () => 0.5;
  const col = new Collision(world);
  // find open ground, then brick it in
  let spot: { tx: number; ty: number } | null = null;
  for (let ty = 3; ty < 40 && !spot; ty++)
    for (let tx = 3; tx < 60; tx++) if (!world.solidAt(tx, ty)) { spot = { tx, ty }; break; }
  assert.ok(spot);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) col.addBlocker(spot.tx + dx, spot.ty + dy);

  const slime = enemies.add(new Slime(spot.tx * TILE + TILE / 2, spot.ty * TILE + TILE - 1));
  const hero = new HeroCore(slime.x + 300, slime.y);
  for (let i = 0; i < 300; i++) enemies.update(1 / 60, hero, col);
  assert.ok(Number.isFinite(slime.x) && Number.isFinite(slime.y));
  assert.ok(Math.hypot(slime.x - (spot.tx * TILE + TILE / 2), slime.y - (spot.ty * TILE + TILE - 1)) < TILE, 'it stays put');
});

test('enemy HP is as guarded as the hero\'s', () => {
  const enemies = new EnemyWorld();
  const slime = enemies.add(new Slime(start.x + 40, start.y));
  const ctx = { emit: () => undefined };
  const full = slime.hp;

  slime.hurt(-100, start.x, start.y, 0, 0, ctx);
  assert.ok(slime.hp <= full, 'negative damage must not heal it');
  slime.hurt(NaN, start.x, start.y, 0, 0, ctx);
  assert.ok(Number.isFinite(slime.hp), 'an enemy with NaN HP would never die');
  slime.hurt(1, NaN, NaN, 200, 0, ctx);
  assert.ok(Number.isFinite(slime.x) && Number.isFinite(slime.y), 'NaN knockback source must not move it to nowhere');

  slime.hurt(9999, start.x, start.y, 0, 0, ctx);
  assert.ok(slime.dead, 'and it still dies when it should');
  assert.equal(slime.hurt(5, start.x, start.y, 0, 0, ctx), false, 'a dead enemy takes no more hits');
});
