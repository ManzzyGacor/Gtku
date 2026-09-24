/**
 * Saves written by the 2D build must still load.
 *
 * The 2D build stored its save under `lentera-kelam/save/v1` (the game was called Lentera Kelam)
 * in the same `v: 1` shape we still write. The payloads below are the real thing: field for field
 * what `GameState.toJSON` wrote at commit 20b1c2d, with coordinates from *that* world — 128x80
 * tiles, village plaza at tile (20, 40), forest altar at (60, 32), cave altar at (97, 36). Batch 2
 * grew the world to 256x128 and moved every area, so those tiles mean something completely
 * different now, which is exactly what the migration has to survive.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { LEGACY_SAVE_KEY, SAVE_KEY, TILE } from '../src/config';
import { clearSave, loadGame, saveGame } from '../src/core/save';
import { migrateSave, sanitizeSave } from '../src/core/saveMigrate';
import { GameState } from '../src/core/state/GameState';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { Collision } from '../src/core/world/collision';
import { HeroCore } from '../src/core/entities/HeroCore';

const world = new GeneratedWorld();
const px = (t: number): number => t * TILE + TILE / 2;

/** A 2D save from mid-quest: elder talked to, four of six kills, resting at the forest altar. */
const SAVE_2D_MIDQUEST = {
  v: 1 as const,
  hero: { x: px(60), y: px(32), hp: 9 },
  checkpoint: 'cp_forest',
  worldTime: 812.4,
  dayTime: 0.71,
  killed: { slime_b1: 640.2, archer_b2: 790.1 },
  quest: { stage: 1, kills: 4 },
  flags: { met_elder: true, read_sign_gate: true },
  puzzle: { solved: false },
  bossDefeated: false,
};

/** A finished 2D save: puzzle solved, boss dead, quest handed in, standing in the cave. */
const SAVE_2D_DONE = {
  v: 1 as const,
  hero: { x: px(97), y: px(36), hp: 12 },
  checkpoint: 'cp_cave',
  worldTime: 2401.9,
  dayTime: 0.12,
  killed: { slime_c1: 2100.5 },
  quest: { stage: 4, kills: 6 },
  flags: { met_elder: true, lantern_lit: true },
  puzzle: { solved: true },
  bossDefeated: true,
};

// a fresh localStorage for every test
let store: Record<string, string> = {};
beforeEach(() => {
  store = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('a 2D save under the old key is adopted under the new one', () => {
  store[LEGACY_SAVE_KEY] = JSON.stringify(SAVE_2D_MIDQUEST);
  const loaded = loadGame();
  assert.ok(loaded, 'the 2D save must load');
  assert.equal(loaded.quest.stage, 1);
  assert.equal(loaded.quest.kills, 4);
  assert.equal(loaded.checkpoint, 'cp_forest');
  // adopted once, then the old key is gone so it can never overwrite newer progress
  assert.ok(SAVE_KEY in store, 'must be rewritten under the new key');
  assert.ok(!(LEGACY_SAVE_KEY in store), 'the old key must be consumed');
  // and a second load still works, now from the new key
  assert.equal(loadGame()?.quest.kills, 4);
});

test('a newer save always wins over a leftover 2D save', () => {
  store[LEGACY_SAVE_KEY] = JSON.stringify(SAVE_2D_MIDQUEST);
  store[SAVE_KEY] = JSON.stringify(SAVE_2D_DONE);
  assert.equal(loadGame()?.quest.stage, 4);
});

test('migration lands a 2D hero on a tile they can stand on', () => {
  for (const raw of [SAVE_2D_MIDQUEST, SAVE_2D_DONE]) {
    const m = migrateSave(raw, world, 12);
    assert.ok(m, 'must migrate');
    const tx = Math.floor(m.save.hero.x / TILE);
    const ty = Math.floor(m.save.hero.y / TILE);
    assert.ok(tx >= 0 && tx < world.widthTiles, `x ${tx} in bounds`);
    assert.ok(ty >= 0 && ty < world.heightTiles, `y ${ty} in bounds`);
    assert.ok(!world.solidAt(tx, ty), `tile (${tx}, ${ty}) must be walkable`);
  }
});

test('migration keeps every bit of progress, and the checkpoint still exists', () => {
  const m = migrateSave(SAVE_2D_DONE, world, 12);
  assert.ok(m);
  const state = new GameState();
  state.load(m.save);
  assert.equal(state.quest.stage, 4);
  assert.equal(state.quest.kills, 6);
  assert.equal(state.puzzleSolved, true);
  assert.equal(state.bossDefeated, true);
  assert.equal(state.flags.lantern_lit, true);
  assert.equal(state.dayTime, 0.12);
  assert.equal(state.killed.slime_c1, 2100.5);
  assert.ok(world.markers.checkpoints.some((c) => c.id === state.checkpoint), 'checkpoint must resolve');
  // a dead boss stays dead after loading
  assert.equal(state.isDead('boss'), true);
});

test('a migrated hero can actually walk (no wall, no stuck)', () => {
  const m = migrateSave(SAVE_2D_MIDQUEST, world, 12);
  assert.ok(m);
  const collision = new Collision(world);
  const hero = new HeroCore(m.save.hero.x, m.save.hero.y);
  hero.reset(m.save.hero.x, m.save.hero.y, m.save.hero.hp);
  const start = { x: hero.x, y: hero.y };
  let moved = 0;
  // try all four directions for half a second each; at least one must get somewhere
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    hero.reset(start.x, start.y, 12);
    for (let i = 0; i < 30; i++)
      hero.update(1 / 60, { mx: dx, my: dy, attack: false, dodge: false, skill: false, attackHeld: false }, collision, 1);
    moved = Math.max(moved, Math.hypot(hero.x - start.x, hero.y - start.y));
  }
  assert.ok(moved > TILE, `hero should be able to walk more than a tile, got ${moved.toFixed(1)}`);
});

test('a checkpoint id that no longer exists falls back instead of breaking respawn', () => {
  const m = migrateSave({ ...SAVE_2D_MIDQUEST, checkpoint: 'cp_ruins_deleted' }, world, 12);
  assert.ok(m);
  assert.equal(m.save.checkpoint, world.markers.checkpoints[0].id);
  assert.ok(m.notes.some((n) => n.includes('cp_ruins_deleted')), 'the change must be reported');
});

test('a hero saved inside a wall is moved to the nearest free tile', () => {
  // find a solid tile with open ground nearby
  let wall: { tx: number; ty: number } | null = null;
  for (let ty = 2; ty < world.heightTiles - 2 && !wall; ty++)
    for (let tx = 2; tx < world.widthTiles - 2; tx++)
      if (world.solidAt(tx, ty) && !world.solidAt(tx + 1, ty)) {
        wall = { tx, ty };
        break;
      }
  assert.ok(wall, 'the world should have walls');
  const m = migrateSave({ ...SAVE_2D_MIDQUEST, hero: { x: px(wall.tx), y: px(wall.ty), hp: 5 } }, world, 12);
  assert.ok(m);
  assert.ok(!world.solidAt(Math.floor(m.save.hero.x / TILE), Math.floor(m.save.hero.y / TILE)));
  assert.ok(m.notes.some((n) => n.includes('tertutup')), `expected a relocation note, got ${JSON.stringify(m.notes)}`);
  assert.equal(m.save.hero.hp, 5, 'hp must not be touched by a relocation');
});

test('a hero saved outside the world is pulled back in', () => {
  for (const pos of [{ x: -9000, y: 40 }, { x: 999999, y: 999999 }, { x: 0, y: -1 }]) {
    const m = migrateSave({ ...SAVE_2D_MIDQUEST, hero: { ...pos, hp: 3 } }, world, 12);
    assert.ok(m, `must still migrate ${JSON.stringify(pos)}`);
    const tx = Math.floor(m.save.hero.x / TILE);
    const ty = Math.floor(m.save.hero.y / TILE);
    assert.ok(tx >= 0 && tx < world.widthTiles && ty >= 0 && ty < world.heightTiles, `${tx},${ty} in bounds`);
    assert.ok(!world.solidAt(tx, ty));
  }
});

test('round-trip: what the 3D build writes, the 3D build reads back identically', () => {
  const state = new GameState();
  state.load(SAVE_2D_DONE as unknown as Parameters<GameState['load']>[0]);
  state.worldTime = 99;
  assert.ok(saveGame(state.toJSON({ x: 1234, y: 567, hp: 7 })));
  const back = loadGame();
  assert.ok(back);
  assert.equal(back.hero.hp, 7);
  assert.equal(back.hero.x, 1234);
  assert.equal(back.worldTime, 99);
  assert.equal(back.bossDefeated, true);
  clearSave();
  assert.equal(loadGame(), null);
});

test('a corrupt save is refused rather than crashing the boot', () => {
  const bad = [
    '', 'null', '{', '[]', '"a string"',
    // a file from a *newer* build: refused rather than half-read, because loading fields we do not
    // understand would silently drop them and then save over the original
    '{"v":3,"hero":{"x":1,"y":1,"hp":5}}',
    '{"v":1}', '{"v":1,"hero":null}', '{"v":2,"hero":null}',
    '{"v":1,"hero":{"x":"20","y":40}}', '{"v":2,"hero":{"x":null,"y":null,"hp":5}}',
  ];
  for (const raw of bad) {
    store[SAVE_KEY] = raw;
    assert.equal(loadGame(), null, `must refuse ${raw}`);
  }
});

test('NaN and Infinity never reach the game state', () => {
  assert.equal(sanitizeSave({ v: 1, hero: { x: NaN, y: 0, hp: 5 } }), null);
  assert.equal(sanitizeSave({ v: 1, hero: { x: 0, y: Infinity, hp: 5 } }), null);

  const s = sanitizeSave({
    v: 1,
    hero: { x: 100, y: 100, hp: Infinity },
    worldTime: NaN,
    dayTime: Infinity,
    quest: { stage: NaN, kills: -5 },
    killed: { a: NaN, b: 5, c: 'x' },
    flags: { ok: true, weird: 1 },
    puzzle: 'yes',
    bossDefeated: 1,
  }, 12);
  assert.ok(s);
  const all = [s.hero.x, s.hero.y, s.hero.hp, s.worldTime, s.dayTime, s.quest.stage, s.quest.kills, ...Object.values(s.killed)];
  for (const v of all) assert.ok(Number.isFinite(v), `${v} must be finite`);
  assert.equal(s.hero.hp, 12, 'hp is clamped to maxHp');
  assert.equal(s.quest.kills, 0, 'negative kills are clamped');
  assert.equal(s.quest.stage, 0);
  assert.deepEqual(Object.keys(s.killed), ['b'], 'non-numeric kill timestamps are dropped');
  assert.deepEqual(s.flags, { ok: true }, 'only real booleans survive');
  assert.equal(s.puzzle.solved, false);
  assert.equal(s.bossDefeated, false, 'truthy-but-not-true is not true');
  assert.ok(s.dayTime >= 0 && s.dayTime < 1, 'dayTime is wrapped into a day');
});

test('an out-of-range quest stage cannot break the quest chain', () => {
  for (const [stage, want] of [[-3, 0], [99, 4], [2.7, 3]] as const) {
    const s = sanitizeSave({ v: 1, hero: { x: 100, y: 100, hp: 5 }, quest: { stage, kills: 0 } });
    assert.equal(s?.quest.stage, want, `stage ${stage}`);
  }
});

test('storage that throws (private window, blocked cookies) is survivable', () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
  assert.equal(loadGame(), null);
  assert.equal(saveGame(new GameState().toJSON({ x: 0, y: 0, hp: 1 })), false);
  clearSave();
});
