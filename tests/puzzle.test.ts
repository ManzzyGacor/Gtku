import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TILE } from '../src/config';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { Collision } from '../src/core/world/collision';
import { pushIntent, RockPuzzle } from '../src/core/systems/puzzleLogic';

const world = new GeneratedWorld();
const col = new Collision(world);
const { puzzle } = world.markers;
const mk = (): RockPuzzle => new RockPuzzle(puzzle.rock, puzzle.plate, (tx, ty) => !col.solidTile(tx, ty));

test('the rock can be pushed east then south onto the plate (level is solvable)', () => {
  const p = mk();
  assert.equal(p.rock.tx, puzzle.rock.tx);
  while (p.rock.tx < puzzle.plate.tx) assert.ok(p.push(1, 0), `blocked at ${p.rock.tx},${p.rock.ty}`);
  while (p.rock.ty < puzzle.plate.ty) assert.ok(p.push(0, 1), `blocked at ${p.rock.tx},${p.rock.ty}`);
  assert.ok(p.solved);
  assert.ok(!p.push(1, 0), 'locked once solved');
});

test('the rock cannot enter walls', () => {
  const p = mk();
  for (let i = 0; i < 20; i++) p.push(0, -1);
  assert.ok(!col.solidTile(p.rock.tx, p.rock.ty));
  assert.ok(!p.canPush(0, -1) || !col.solidTile(p.rock.tx, p.rock.ty - 1));
});

test('reset returns an unsolved rock to its start', () => {
  const p = mk();
  p.push(1, 0);
  p.push(1, 0);
  p.reset();
  assert.deepEqual(p.rock, puzzle.rock);
});

test('push intent needs contact and a matching stick direction', () => {
  const rock = { tx: 10, ty: 10 };
  const rx = 10 * TILE + 8;
  const ry = 10 * TILE + 8;
  // hero standing left of the rock, pushing right
  assert.deepEqual(pushIntent({ x: rx - 13, y: ry + 3 }, 1, 0, rock), { dx: 1, dy: 0 });
  // wrong direction or too far
  assert.equal(pushIntent({ x: rx - 13, y: ry + 3 }, -1, 0, rock), null);
  assert.equal(pushIntent({ x: rx - 40, y: ry + 3 }, 1, 0, rock), null);
  // hero above the rock pushing down
  assert.deepEqual(pushIntent({ x: rx, y: ry - 8 }, 0, 1, rock), { dx: 0, dy: 1 });
  assert.equal(pushIntent({ x: rx, y: ry - 8 }, 0, 0, rock), null);
});

test('the push must be held before the rock moves', () => {
  const p = mk();
  const intent = { dx: 1, dy: 0 };
  assert.equal(p.update(0.1, intent), null); // registers the push
  assert.equal(p.update(0.15, intent), null);
  assert.deepEqual(p.update(0.2, intent), intent);
  assert.equal(p.rock.tx, puzzle.rock.tx + 1);
  // releasing resets the timer
  p.update(0.2, intent);
  p.update(0.1, null);
  assert.equal(p.update(0.15, intent), null);
});
