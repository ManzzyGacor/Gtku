import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TILE } from '../src/config';
import { Collision } from '../src/world/collision';
import type { WorldSource } from '../src/world/source';

/** 10x10 world, wall column at x=5. */
const fake: WorldSource = {
  widthTiles: 10,
  heightTiles: 10,
  markers: {} as WorldSource['markers'],
  tileAt: () => 0,
  solidAt: (x, y) => x < 0 || y < 0 || x >= 10 || y >= 10 || x === 5,
  areaAt: () => 'village',
  chunk: () => ({ cx: 0, cy: 0, props: [], spawns: [], npcs: [] }),
};

test('moving into a wall stops at its edge', () => {
  const c = new Collision(fake);
  const r = c.move(4 * TILE + 8, 3 * TILE + 8, 5, 6, 30, 0);
  assert.ok(r.hitX);
  assert.ok(r.x + 5 <= 5 * TILE + 0.01);
  assert.ok(r.x + 5 > 5 * TILE - 0.1);
});

test('fast movement does not tunnel through a 1-tile wall', () => {
  const c = new Collision(fake);
  const r = c.move(4 * TILE + 8, 3 * TILE + 8, 5, 6, 40, 0);
  assert.ok(r.x < 5 * TILE);
});

test('sliding along a wall keeps the free axis', () => {
  const c = new Collision(fake);
  const r = c.move(5 * TILE - 6, 3 * TILE + 8, 5, 6, 4, 10);
  assert.ok(r.hitX);
  assert.ok(r.y > 3 * TILE + 8 + 9);
});

test('dynamic blockers behave like walls until removed', () => {
  const c = new Collision(fake);
  c.addBlocker(2, 3);
  assert.ok(c.solidTile(2, 3));
  const r = c.move(1 * TILE + 8, 3 * TILE + 8, 5, 6, 20, 0);
  assert.ok(r.hitX && r.x < 2 * TILE);
  c.removeBlocker(2, 3);
  assert.ok(!c.solidTile(2, 3));
});

test('line of sight is blocked by walls', () => {
  const c = new Collision(fake);
  assert.equal(c.lineClear(2 * TILE, 3 * TILE, 8 * TILE, 3 * TILE), false);
  assert.equal(c.lineClear(1 * TILE, 3 * TILE, 4 * TILE, 3 * TILE), true);
});
