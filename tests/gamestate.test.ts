/**
 * GameState serialisation. This is the contract the save file is built on, so it gets its own test:
 * `saveVersion 2` with a migration from v1 is on the roadmap (docs/OVERHAUL.md §4) and must not
 * silently break old saves.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { GameState, KILLS_NEEDED, RESPAWN_SECONDS, type SaveData } from '../src/core/state/GameState';

const HERO = { x: 123.7, y: 456.2, hp: 8 };

test('a fresh state starts the quest at stage 0 in the village', () => {
  const s = new GameState();
  assert.equal(s.quest.stage, 0);
  assert.equal(s.quest.kills, 0);
  assert.equal(s.checkpoint, 'cp_village');
  assert.equal(s.puzzleSolved, false);
  assert.equal(s.bossDefeated, false);
  assert.ok(s.dayTime > 0 && s.dayTime < 1);
});

test('toJSON rounds the hero position and deep-copies the mutable bags', () => {
  const s = new GameState();
  s.flags.lanternLit = true;
  s.markKilled('slime_3');
  const d = s.toJSON(HERO);
  assert.equal(d.v, 2, 'Batch 4 raised the save version');
  assert.deepEqual(d.hero, { x: 124, y: 456, hp: 8 });
  // mutating the state afterwards must not reach into the snapshot
  s.flags.lanternLit = false;
  s.quest.stage = 4;
  delete s.killed.slime_3;
  assert.equal(d.flags.lanternLit, true);
  assert.equal(d.quest.stage, 0);
  assert.equal(d.killed.slime_3, 0);
});

test('save → load is a round trip', () => {
  const a = new GameState();
  a.worldTime = 987.5;
  a.dayTime = 0.71;
  a.quest = { stage: 3, kills: KILLS_NEEDED };
  a.flags.lanternLit = true;
  a.puzzleSolved = true;
  a.bossDefeated = true;
  a.checkpoint = 'cp_cave';
  a.markKilled('bats_1');

  const b = new GameState();
  b.load(JSON.parse(JSON.stringify(a.toJSON(HERO))) as SaveData);
  assert.equal(b.worldTime, 987.5);
  assert.equal(b.dayTime, 0.71);
  assert.deepEqual(b.quest, { stage: 3, kills: KILLS_NEEDED });
  assert.equal(b.flags.lanternLit, true);
  assert.equal(b.puzzleSolved, true);
  assert.equal(b.bossDefeated, true);
  assert.equal(b.checkpoint, 'cp_cave');
  assert.equal(b.isDead('bats_1'), true);
});

test('load tolerates a save that is missing fields (older or hand-edited file)', () => {
  const s = new GameState();
  s.load({ v: 1, hero: { x: 0, y: 0, hp: 1 } } as unknown as SaveData);
  assert.equal(s.worldTime, 0);
  assert.equal(s.dayTime, 0.33);
  assert.deepEqual(s.quest, { stage: 0, kills: 0 });
  assert.deepEqual(s.killed, {});
  assert.equal(s.puzzleSolved, false);
  assert.equal(s.checkpoint, 'cp_village');
});

test('killed enemies come back after the respawn timer; the boss never does', () => {
  const s = new GameState();
  s.worldTime = 100;
  s.markKilled('slime_1');
  assert.equal(s.isDead('slime_1'), true);
  s.worldTime = 100 + RESPAWN_SECONDS - 1;
  assert.equal(s.isDead('slime_1'), true);
  s.worldTime = 100 + RESPAWN_SECONDS + 1;
  assert.equal(s.isDead('slime_1'), false, 'respawned');
  assert.equal(s.isDead('never_touched'), false);

  assert.equal(s.isDead('boss'), false);
  s.bossDefeated = true;
  assert.equal(s.isDead('boss'), true, 'the boss stays dead regardless of the timer');
});
