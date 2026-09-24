/**
 * Interaction: the thing that was completely broken on the phone.
 *
 * The cause was not in this logic at all — there was no interact *button* in the touch controls, so
 * `E` worked on a keyboard and a phone could never fire the action while the prompt sat there
 * telling the player it would. The button is tested in `touchcontrols.test.ts`; this file covers
 * the half that decides *what* is interactable, what the prompt says, and how close you have to be.
 *
 * Every NPC, sign, chest and shrine in the real generated world is walked up to and pressed.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { TILE, WORLD_CHUNKS_H, WORLD_CHUNKS_W } from '../src/config';
import { nearestInteractable, type Interactable } from '../src/core/systems/interactables';
import { Collision } from '../src/core/world/collision';
import { GameState } from '../src/core/state/GameState';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { HeroCore } from '../src/core/entities/HeroCore';
import { Story3D } from '../src/render3d/Story3D';
import { input } from '../src/core/input';
import type { DialogueSpec } from '../src/ui/Dialogue';

const world = new GeneratedWorld();

interface Env {
  story: Story3D;
  hero: HeroCore;
  state: GameState;
  dialogues: DialogueSpec[];
  hints: (string | null)[];
  loot: string[];
  saves: number;
}

function makeEnv(state = new GameState()): Env {
  const scene = new THREE.Group();
  const collision = new Collision(world);
  const start = world.markers.playerStart;
  const hero = new HeroCore(start.x, start.y);
  const env: Env = {
    hero,
    state,
    dialogues: [],
    hints: [],
    loot: [],
    saves: 0,
    story: null as unknown as Story3D,
  };
  env.story = new Story3D(scene, world, collision, state, {
    dialogue: (spec) => env.dialogues.push(spec),
    toast: () => undefined,
    banner: () => undefined,
    hint: (h) => env.hints.push(h),
    float: () => undefined,
    spark: () => undefined,
    save: () => {
      env.saves++;
    },
    shake: () => undefined,
    exp: () => undefined,
    loot: (kind) => env.loot.push(kind),
    reward: () => undefined,
    questNote: () => undefined,
  });
  return env;
}

/** One frame with the hero standing at (x, y). */
function frameAt(env: Env, x: number, y: number): void {
  env.hero.reset(x, y, env.hero.maxHp);
  env.hero.invuln = 0;
  env.story.update(1 / 60, 1 / 60, env.hero, 0, false);
}

/** Stand next to something and press interact, the way a player does. */
function interactAt(env: Env, x: number, y: number): void {
  frameAt(env, x, y);
  input.enabled = true;
  input.press('interact');
  env.story.update(1 / 60, 1 / 60, env.hero, 0, false);
}

/** Everything the story registered, read through the same function the game uses. */
function promptAt(env: Env, x: number, y: number): string | null {
  frameAt(env, x, y);
  return env.story.interactPrompt;
}

/** All props of a type, across every chunk. */
function props(type: string): { x: number; y: number; text?: string }[] {
  const out: { x: number; y: number; text?: string }[] = [];
  for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
    for (let cx = 0; cx < WORLD_CHUNKS_W; cx++)
      for (const p of world.chunk(cx, cy).props) if (p.type === type) out.push(p);
  return out;
}

function npcs(): { id: string; x: number; y: number; name: string }[] {
  const out: { id: string; x: number; y: number; name: string }[] = [];
  for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
    for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) out.push(...world.chunk(cx, cy).npcs);
  return out;
}

test('the world has something of every interactable kind to find', () => {
  assert.ok(npcs().length >= 4, `villagers to talk to, got ${npcs().length}`);
  assert.ok(props('sign').filter((p) => p.text).length >= 6, 'signs to read');
  assert.ok(props('chest').length >= 5, 'chests to open');
  assert.equal(world.markers.checkpoints.length, 3, 'shrines to pray at');
});

test('every villager can be talked to, from a phone-sized distance', () => {
  const env = makeEnv();
  for (const npc of npcs()) {
    // stand a tile and a half away, roughly where a thumb would park you
    assert.equal(promptAt(env, npc.x + TILE * 1.5, npc.y + 6), 'Bicara', `${npc.id} gives no prompt`);
    env.dialogues.length = 0;
    interactAt(env, npc.x + TILE * 1.5, npc.y + 6);
    assert.equal(env.dialogues.length, 1, `${npc.id} did not open a dialogue`);
    assert.equal(env.dialogues[0].name, npc.name);
    assert.ok(env.dialogues[0].lines.length > 0, `${npc.id} said nothing`);
  }
  env.story.dispose();
});

test('every sign can be read, and reading one shows its own text', () => {
  const env = makeEnv();
  const signs = props('sign').filter((p) => p.text);
  for (const sign of signs) {
    assert.equal(promptAt(env, sign.x + TILE, sign.y), 'Baca', `sign at ${sign.x},${sign.y}`);
    env.dialogues.length = 0;
    interactAt(env, sign.x + TILE, sign.y);
    assert.equal(env.dialogues.length, 1, 'a sign must open a dialogue');
    assert.equal(env.dialogues[0].name, 'Papan');
    assert.equal(env.dialogues[0].lines[0], sign.text, 'and show the text on that particular sign');
  }
  env.story.dispose();
});

test('every chest can be opened once, and says so when it is empty', () => {
  const env = makeEnv();
  const chests = props('chest');
  for (const chest of chests) {
    assert.equal(promptAt(env, chest.x + TILE, chest.y), 'Buka', `chest at ${chest.x},${chest.y}`);
    env.loot.length = 0;
    interactAt(env, chest.x + TILE, chest.y);
    assert.deepEqual(env.loot, ['chest'], 'opening a chest rolls the chest table');

    // and it stays empty, including the prompt
    assert.equal(promptAt(env, chest.x + TILE, chest.y), 'Kosong');
    env.loot.length = 0;
    env.dialogues.length = 0;
    interactAt(env, chest.x + TILE, chest.y);
    assert.deepEqual(env.loot, [], 'an emptied chest gives nothing');
    assert.equal(env.dialogues.length, 1, 'but it still answers, rather than doing nothing at all');
  }
  env.story.dispose();
});

test('an emptied chest stays empty across a save and reload', () => {
  const first = makeEnv();
  const chest = props('chest')[0];
  interactAt(first, chest.x + TILE, chest.y);
  const saved = JSON.parse(JSON.stringify(first.state.toJSON({ x: 0, y: 0, hp: 5 })));
  first.story.dispose();

  const state = new GameState();
  state.load(saved);
  const second = makeEnv(state);
  assert.equal(promptAt(second, chest.x + TILE, chest.y), 'Kosong', 'the flag lives in the save');
  second.story.dispose();
});

test('every shrine offers Berdoa, heals, saves and becomes the checkpoint', () => {
  const env = makeEnv();
  let healed = 0;
  env.story.onRest = () => healed++;
  for (const cp of world.markers.checkpoints) {
    assert.equal(promptAt(env, cp.x + TILE, cp.y), 'Berdoa', `shrine ${cp.id}`);
    const before = env.saves;
    interactAt(env, cp.x + TILE, cp.y);
    assert.equal(env.state.checkpoint, cp.id, 'praying sets the checkpoint');
    assert.ok(env.saves > before, 'and saves');
  }
  assert.equal(healed, world.markers.checkpoints.length, 'and heals every time');
  env.story.dispose();
});

test('the prompt disappears when you walk away, and while a dialogue is open', () => {
  const env = makeEnv();
  const npc = npcs()[0];
  assert.equal(promptAt(env, npc.x + TILE, npc.y), 'Bicara');
  assert.equal(promptAt(env, npc.x + TILE * 12, npc.y), null, 'twelve tiles away is not "near"');

  // a dialogue already open must not offer another interaction underneath it
  env.hero.reset(npc.x + TILE, npc.y, env.hero.maxHp);
  env.story.update(1 / 60, 1 / 60, env.hero, 0, true);
  assert.equal(env.story.interactPrompt, null);
  env.story.dispose();
});

test('a dead hero cannot interact', () => {
  const env = makeEnv();
  const npc = npcs()[0];
  env.hero.reset(npc.x + TILE, npc.y, env.hero.maxHp);
  env.hero.invuln = 0;
  env.hero.takeDamage(999, npc.x, npc.y);
  assert.equal(env.hero.alive, false);
  env.dialogues.length = 0;
  input.press('interact');
  env.story.update(1 / 60, 1 / 60, env.hero, 0, false);
  assert.equal(env.story.interactPrompt, null);
  assert.equal(env.dialogues.length, 0);
  env.story.dispose();
});

test('the nearest thing wins when two are in range', () => {
  const near: Interactable = { id: 'near', x: 100, y: 100, range: 40, label: () => 'Dekat', interact: () => undefined };
  const far: Interactable = { id: 'far', x: 130, y: 100, range: 40, label: () => 'Jauh', interact: () => undefined };
  assert.equal(nearestInteractable([far, near], 100, 100)?.id, 'near');
  assert.equal(nearestInteractable([near, far], 128, 100)?.id, 'far');
  // out of range is out of range, however close the other one is
  assert.equal(nearestInteractable([near], 100 + 41, 100), null);
  // a label of null means "not available right now"
  const hidden: Interactable = { id: 'hidden', x: 100, y: 100, range: 40, label: () => null, interact: () => undefined };
  assert.equal(nearestInteractable([hidden], 100, 100), null);
});

test('interaction ranges are generous enough to hit with a thumb', () => {
  const env = makeEnv();
  // Two tiles is about where a player stops when they *think* they are next to something.
  const npc = npcs()[0];
  assert.equal(promptAt(env, npc.x + TILE * 2.5, npc.y), 'Bicara', 'a villager at 2.5 tiles');
  const sign = props('sign').find((p) => p.text)!;
  assert.equal(promptAt(env, sign.x + TILE * 2, sign.y), 'Baca', 'a sign at 2 tiles');
  const cp = world.markers.checkpoints[0];
  assert.equal(promptAt(env, cp.x, cp.y + TILE * 2), 'Berdoa', 'a shrine at 2 tiles');
  env.story.dispose();
});
