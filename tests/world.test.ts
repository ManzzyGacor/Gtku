import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TILE, WORLD_CHUNKS_H, WORLD_CHUNKS_W } from '../src/config';
import { GeneratedWorld } from '../src/core/world/worldgen';
import type { WorldSource } from '../src/core/world/source';
import type { PropPlacement } from '../src/core/world/props';

const world = new GeneratedWorld();

function reachable(w: WorldSource, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(w.widthTiles * w.heightTiles);
  const q: number[] = [sy * w.widthTiles + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % w.widthTiles;
    const y = Math.floor(i / w.widthTiles);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.widthTiles || ny >= w.heightTiles) continue;
      const j = ny * w.widthTiles + nx;
      if (seen[j] || w.solidAt(nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

const tileOf = (v: number): number => Math.floor(v / TILE);

test('world is deterministic', () => {
  const b = new GeneratedWorld();
  for (let i = 0; i < 200; i++) {
    const x = (i * 37) % world.widthTiles;
    const y = (i * 53) % world.heightTiles;
    assert.equal(world.tileAt(x, y), b.tileAt(x, y));
    assert.equal(world.solidAt(x, y), b.solidAt(x, y));
  }
  assert.equal(world.chunk(3, 2).props.length, b.chunk(3, 2).props.length);
});

test('player start, NPCs, checkpoints, spawns and boss are reachable (gates open)', () => {
  const m = world.markers;
  const seen = reachable(world, tileOf(m.playerStart.x), tileOf(m.playerStart.y));
  const ok = (x: number, y: number): boolean => seen[tileOf(y) * world.widthTiles + tileOf(x)] === 1;
  const bad: string[] = [];
  for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
    for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) {
      const c = world.chunk(cx, cy);
      for (const s of c.spawns) if (!ok(s.x, s.y)) bad.push(`spawn ${s.id}`);
      for (const n of c.npcs) if (!ok(n.x, n.y)) bad.push(`npc ${n.id}`);
    }
  for (const cp of m.checkpoints) if (!ok(cp.x, cp.y)) bad.push(`checkpoint ${cp.id}`);
  if (!ok(m.boss.spawn.x, m.boss.spawn.y)) bad.push('boss');
  const plate = m.puzzle.plate;
  if (!ok(plate.tx * TILE + 8, plate.ty * TILE + 8)) bad.push('plate');
  assert.deepEqual(bad, []);
});

test('puzzle rock start and plate are inside the puzzle room, gate seals the corridor', () => {
  const { puzzle, boss } = world.markers;
  const inRoom = (tx: number, ty: number): boolean =>
    tx >= puzzle.room.x0 && tx <= puzzle.room.x1 && ty >= puzzle.room.y0 && ty <= puzzle.room.y1;
  assert.ok(inRoom(puzzle.rock.tx, puzzle.rock.ty));
  assert.ok(inRoom(puzzle.plate.tx, puzzle.plate.ty));
  assert.ok(!world.solidAt(puzzle.rock.tx, puzzle.rock.ty));
  // the gate column must be walls above/below and open on the gate tiles
  for (const door of [puzzle.gate, boss.door]) {
    assert.ok(world.solidAt(door.tx, door.ty - 1));
    assert.ok(world.solidAt(door.tx, door.ty + door.h));
    for (let i = 0; i < door.h; i++) assert.ok(!world.solidAt(door.tx, door.ty + i));
  }
});

test('the boss arena cannot be reached except through both doors (block gate column → unreachable)', () => {
  const { puzzle, playerStart } = { puzzle: world.markers.puzzle, playerStart: world.markers.playerStart };
  const sx = tileOf(playerStart.x);
  const sy = tileOf(playerStart.y);
  const blocked = new Set<number>();
  for (let i = 0; i < puzzle.gate.h; i++) blocked.add((puzzle.gate.ty + i) * world.widthTiles + puzzle.gate.tx);
  const w2: WorldSource = { ...world, widthTiles: world.widthTiles, heightTiles: world.heightTiles, markers: world.markers,
    tileAt: (x, y) => world.tileAt(x, y), areaAt: (x, y) => world.areaAt(x, y), chunk: (x, y) => world.chunk(x, y),
    solidAt: (x, y) => world.solidAt(x, y) || blocked.has(y * world.widthTiles + x) };
  const seen = reachable(w2, sx, sy);
  const b = world.markers.boss.spawn;
  assert.equal(seen[tileOf(b.y) * world.widthTiles + tileOf(b.x)], 0);
});

test('the world is the size Batch 2 grew it to, with all three areas', () => {
  assert.equal(world.widthTiles, 256);
  assert.equal(world.heightTiles, 128);
  assert.equal(world.areaAt(10, 64), 'village');
  assert.equal(world.areaAt(140, 64), 'forest');
  assert.equal(world.areaAt(240, 64), 'cave');
  // each area has to be big enough to be worth exploring
  const widths = { village: 0, forest: 0, cave: 0 };
  for (let x = 0; x < world.widthTiles; x++) widths[world.areaAt(x, 64)]++;
  for (const [id, w] of Object.entries(widths)) assert.ok(w >= 60, `${id} is only ${w} tiles wide`);
});

test('the landmarks worth exploring exist and are spread out', () => {
  const props: PropPlacement[] = [];
  for (let cy = 0; cy < WORLD_CHUNKS_H; cy++) for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) props.push(...world.chunk(cx, cy).props);
  const count = (type: string): number => props.filter((p) => p.type === type).length;

  assert.ok(count('chest') >= 5, `expected hidden chests to find, got ${count('chest')}`);
  assert.equal(count('great_lantern'), 1);
  assert.ok(count('shrine') >= 2, 'a forest altar and a cave altar');
  assert.ok(count('house_a') + count('house_b') + count('house_c') >= 7, 'a village plus outskirts');
  assert.ok(count('haystack') >= 3, 'the farm and the mill');
  assert.ok(count('pillar') >= 8, 'arena pillars plus the ruins');
  assert.ok(count('lamp') >= 8, 'street lamps to light the way at night');
  assert.ok(props.filter((p) => p.text).length >= 6, 'signs to read');

  // the chests must not all be huddled in one corner
  const chests = props.filter((p) => p.type === 'chest');
  const xs = chests.map((c) => c.x / TILE);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 120, 'chests should be spread across the world');
});

test('every chunk returns data and props belong to their chunk', () => {
  let total = 0;
  for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
    for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) {
      const c = world.chunk(cx, cy);
      total += c.props.length;
      for (const p of c.props) {
        assert.equal(Math.floor(p.x / TILE / 16), cx);
        assert.equal(Math.floor((p.y - 1) / TILE / 16), cy);
      }
    }
  assert.ok(total > 2000, `a world this size should be full of scenery, got ${total}`);
});
