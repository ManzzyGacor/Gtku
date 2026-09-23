import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameState, KILLS_NEEDED, RESPAWN_SECONDS } from '../src/core/state/GameState';
import { advanceQuest, dialogueFor, trackerLines } from '../src/core/systems/quest';

test('quest progresses stage by stage and lights the lantern at the end', () => {
  const s = new GameState();
  assert.equal(advanceQuest(s, { type: 'kill', kind: 'slime' }).changed, false, 'kills before starting do not count');
  assert.equal(advanceQuest(s, { type: 'talk-elder' }).changed, true);
  assert.equal(s.quest.stage, 1);
  for (let i = 0; i < KILLS_NEEDED; i++) advanceQuest(s, { type: 'kill', kind: i % 2 ? 'archer' : 'slime' });
  assert.equal(s.quest.stage, 2);
  assert.equal(advanceQuest(s, { type: 'kill', kind: 'slime' }).changed, false);
  assert.equal(advanceQuest(s, { type: 'boss-defeated' }).changed, true);
  assert.equal(s.quest.stage, 3);
  const r = advanceQuest(s, { type: 'return-crystal' });
  assert.ok(r.lightLantern);
  assert.equal(s.quest.stage, 4);
  assert.ok(s.flags.lanternLit);
  assert.equal(advanceQuest(s, { type: 'return-crystal' }).changed, false);
});

test('bats do not count toward the hunt', () => {
  const s = new GameState();
  advanceQuest(s, { type: 'talk-elder' });
  advanceQuest(s, { type: 'kill', kind: 'bat' });
  assert.equal(s.quest.kills, 0);
});

test('killing the boss early (skipping the hunt) still advances the story', () => {
  const s = new GameState();
  advanceQuest(s, { type: 'talk-elder' });
  advanceQuest(s, { type: 'boss-defeated' });
  assert.equal(s.quest.stage, 3);
});

test('tracker and dialogue reflect the stage', () => {
  const s = new GameState();
  assert.ok(trackerLines(s)[0].includes('Wulan'));
  assert.equal(dialogueFor('wulan', s).onDone?.type, 'talk-elder');
  advanceQuest(s, { type: 'talk-elder' });
  advanceQuest(s, { type: 'kill', kind: 'slime' });
  assert.ok(trackerLines(s).join(' ').includes('1/6'));
  assert.ok(dialogueFor('wulan', s).lines[0].includes('1 dari 6'));
});

test('kills respawn after RESPAWN_SECONDS but the boss never does', () => {
  const s = new GameState();
  s.markKilled('slime_f1');
  assert.ok(s.isDead('slime_f1'));
  s.worldTime += RESPAWN_SECONDS + 1;
  assert.ok(!s.isDead('slime_f1'));
  s.bossDefeated = true;
  s.worldTime += 99999;
  assert.ok(s.isDead('boss'));
});

test('save round trip keeps quest, flags and kills', () => {
  const s = new GameState();
  advanceQuest(s, { type: 'talk-elder' });
  s.markKilled('a');
  s.puzzleSolved = true;
  const data = s.toJSON({ x: 10.4, y: 20.6, hp: 7 });
  const t = new GameState();
  t.load(JSON.parse(JSON.stringify(data)));
  assert.equal(t.quest.stage, 1);
  assert.ok(t.killed.a !== undefined);
  assert.ok(t.puzzleSolved);
  assert.equal(data.hero.x, 10);
});
