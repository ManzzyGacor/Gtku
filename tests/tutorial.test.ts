/**
 * "Bara Pertama": from a new game to the first element, on the real game.
 *
 * The request was to check the path from Game Baru to the first element *really* completes — so
 * this does not call the tutorial logic in isolation. It builds `Game3D`, plays the opening, walks
 * to the shrine, presses interact, swings at the dummy, and checks what the player would see at
 * every step: the tracker, the bag, the equipped core, the element on the hero, and the status on
 * the dummy.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { advanceTutorial, DUMMY_TILE, settleTutorial, tutorialLines, tutorialStep, TUTORIAL_SHRINE } from '../src/core/systems/tutorial';
import { GameState } from '../src/core/state/GameState';
import { input } from '../src/core/input';
import type { SwingEvent } from '../src/core/entities/HeroCore';

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

// ───────────────────────────── the pure rules ─────────────────────────────

test('the tutorial is two steps, in order, and only the village shrine starts it', () => {
  const s = new GameState();
  assert.equal(tutorialStep(s), 'pray');
  assert.equal(advanceTutorial(s, { type: 'pray', checkpoint: 'cp_forest' }).changed, false, 'the forest shrine is not the one');
  assert.equal(advanceTutorial(s, { type: 'element-hit', element: 'api', target: 'dummy' }).changed, false, 'no skipping step one');

  const first = advanceTutorial(s, { type: 'pray', checkpoint: TUTORIAL_SHRINE });
  assert.equal(first.grantCore, 'core_ember');
  assert.equal(tutorialStep(s), 'strike');

  assert.equal(advanceTutorial(s, { type: 'element-hit', element: undefined, target: 'dummy' }).changed, false, 'a plain hit is not the lesson');
  assert.equal(advanceTutorial(s, { type: 'element-hit', element: 'api', target: 'slime' }).changed, false, 'the dummy is the target');
  assert.equal(advanceTutorial(s, { type: 'element-hit', element: 'api', target: 'dummy' }).finished, true);
  assert.equal(tutorialStep(s), 'done');
  assert.equal(tutorialLines(s), null, 'and the tracker hands back to the main quest');

  // praying again afterwards grants nothing twice
  assert.equal(advanceTutorial(s, { type: 'pray', checkpoint: TUTORIAL_SHRINE }).changed, false);
});

test('an older save that already has an element skips the tutorial', () => {
  const s = new GameState();
  assert.equal(settleTutorial(s, false), false, 'nothing to settle without an element');
  assert.equal(tutorialStep(s), 'pray');
  assert.equal(settleTutorial(s, true), true);
  assert.equal(tutorialStep(s), 'done');
});

// ───────────────────────────── the real game ─────────────────────────────

test('new game → intro → pray → Inti Bara equipped → fire on the dummy → done', async () => {
  const game = await bootGame(env, { continue: false });

  // 1. the opening plays, and is skipped the way a player would
  assert.equal(game.playCutscene('intro', { auto: true }), true);
  game.cutscene.skip();
  game.tickCutscene(1 / 60);
  assert.equal(game.cutscene.active, false);

  // 2. the first objective on screen is the tutorial, not the elder
  const q0 = game.story.questText();
  assert.equal(q0.title, 'Bara Pertama');
  assert.ok(q0.lines[0].includes('Berdoa'), q0.lines.join(' | '));
  assert.equal(game.hero.element, undefined, 'no element before the tutorial');
  assert.equal(game.character.unlocked.length, 0);

  // 3. walk to the village shrine — it is two tiles from where a new game starts
  const shrine = game.world.markers.checkpoints.find((c) => c.id === TUTORIAL_SHRINE)!;
  const start = game.world.markers.playerStart;
  assert.ok(Math.hypot(shrine.x - start.x, shrine.y - start.y) < 16 * 4, 'the shrine is right beside the spawn');
  game.hero.reset(shrine.x + 16, shrine.y, game.hero.maxHp);
  game.story.update(1 / 60, 1 / 60, game.hero, 0, false);
  assert.equal(game.story.interactPrompt, 'Berdoa', 'the button says what it does');

  // 4. press interact
  input.enabled = true;
  input.press('interact');
  game.story.update(1 / 60, 1 / 60, game.hero, 0, false);

  assert.equal(game.character.inventory.equipped.lantern?.id, 'core_ember', 'Inti Bara is equipped, not left in the bag');
  assert.deepEqual(game.character.unlocked, ['api'], 'Api is learned');
  assert.equal(game.character.primary, 'api');
  assert.equal(game.hero.element, 'api', 'and — the part that was missing — the hero actually swings with it');
  assert.equal(game.state.flags.element_api, true, 'the "Elemen Api terbuka" notification fired');
  const q1 = game.story.questText();
  assert.ok(q1.lines[0].includes('boneka latihan'), q1.lines.join(' | '));

  // 5. the dummy is in the plaza, and one elemental swing finishes the tutorial
  const dummy = game.combat.world.enemies.find((e) => e.kind === 'dummy');
  assert.ok(dummy, 'the training dummy must exist without the developer menu');
  assert.equal(Math.floor(dummy.x / 16), DUMMY_TILE.tx);
  assert.equal(game.collision.boxBlocked(dummy.x, dummy.y, 5, 7), false, 'and stand somewhere reachable');

  game.hero.reset(dummy.x - 18, dummy.y, game.hero.maxHp);
  const swing: SwingEvent = { type: 'swing', x: game.hero.x, y: game.hero.y - 6, angle: 0, range: 40, arc: Math.PI / 2, dmg: 2, knock: 70, index: 0 };
  game.combat.applySwing(game.hero, swing);

  assert.equal(game.state.flags.tut_done, true, 'the tutorial is complete');
  const status = game.combat.dummyStatus()[0];
  assert.ok(status.statuses.includes('Terbakar'), `the dummy shows what it carries: "${status.statuses}"`);
  assert.ok(status.taken > 0);
  assert.equal(dummy.dead, false, 'and the dummy is still standing');

  // 6. the tracker hands over to the main quest
  const q2 = game.story.questText();
  assert.notEqual(q2.title, 'Bara Pertama');

  // 7. and all of it survives a save and reload
  game.saveNow(true);
  game.dispose();
  const again = await bootGame(env, { continue: true });
  assert.equal(again.character.inventory.equipped.lantern?.id, 'core_ember');
  assert.equal(again.hero.element, 'api', 'the element is still on the hero after a reload');
  assert.equal(again.state.flags.tut_done, true);
  again.dispose();
});

test('the dummy never dies and never feeds the quest or the loot', async () => {
  const game = await bootGame(env, { continue: false });
  const dummy = game.combat.world.enemies.find((e) => e.kind === 'dummy')!;
  const kills = game.state.quest.kills;
  const bag = game.character.inventory.used;
  for (let i = 0; i < 50; i++) dummy.hurt(9999, dummy.x - 10, dummy.y, 200, 1, { emit: (x) => game.combat.world.events.push(x) });
  assert.equal(dummy.dead, false);
  assert.equal(dummy.hp, dummy.maxHp);
  assert.ok(!game.combat.world.events.some((e) => e.type === 'died'), 'it must never emit a death');
  assert.equal(game.state.quest.kills, kills);
  assert.equal(game.character.inventory.used, bag);
  game.dispose();
});

test('primary goes on the weapon, secondary on the skill', async () => {
  const game = await bootGame(env, { continue: false });
  game.character.unlock('api');
  game.character.unlock('es');
  game.applySheet();
  assert.equal(game.hero.element, 'api', 'first learned is primary');
  assert.equal(game.hero.skillElement, 'es', 'second learned is secondary');

  // swapping hands swaps them, and the same element cannot be in both
  game.character.setElement('primary', 'es');
  game.applySheet();
  assert.equal(game.hero.element, 'es');
  assert.equal(game.hero.skillElement, 'api');
  assert.equal(game.character.setElement('secondary', 'petir'), false, 'an element not learned cannot be set');
  game.dispose();
});
