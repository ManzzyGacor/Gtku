/**
 * A full headless playthrough of the 3D build.
 *
 * This replaces the 2D smoke test. It drives the *real* `Story3D`, `Puzzle3D`, `Combat3D`,
 * `HeroCore` and `GameState` against a plain `THREE.Group` — no renderer, no Phaser mock — and
 * walks the whole quest: talk to the elder, hunt six monsters, push the rock onto the plate,
 * fight the boss, bring the crystal back, and watch the Great Lantern light. Then it dies and
 * respawns, and checks the save survives a round trip.
 *
 * It cannot see pixels, but it catches exactly what a phone would otherwise catch first: broken
 * wiring between the quest, the world and the combat.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { TILE } from '../src/config';
import { KILLS_NEEDED, GameState } from '../src/core/state/GameState';
import { HeroCore, type HeroInput } from '../src/core/entities/HeroCore';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { Combat3D } from '../src/render3d/Combat3D';
import { Puzzle3D } from '../src/render3d/Puzzle3D';
import { Story3D } from '../src/render3d/Story3D';
import { Character } from '../src/core/stats/character';
import { HERO_BASE } from '../src/core/stats/stats';
import { rollDrops } from '../src/core/items/drops';
import type { QuestReward } from '../src/core/systems/quest';
import type { DialogueSpec } from '../src/ui/Dialogue';
import { input } from '../src/core/input';

// storage for the save round trip
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const world = new GeneratedWorld();

interface Env {
  scene: THREE.Group;
  state: GameState;
  hero: HeroCore;
  collision: Collision;
  combat: Combat3D;
  story: Story3D;
  puzzle: Puzzle3D;
  dialogues: DialogueSpec[];
  toasts: string[];
  banners: string[];
  hints: (string | null)[];
  saves: number;
  /** Batch 4: the character sheet the combat reads its numbers from. */
  character: Character;
  /** Loot tables that were rolled (chests, kills). */
  loot: string[];
  /** Quest stage rewards handed over. */
  rewards: QuestReward[];
}

function makeEnv(state = new GameState()): Env {
  const scene = new THREE.Group();
  const collision = new Collision(world);
  const start = world.markers.playerStart;
  const hero = new HeroCore(start.x, start.y);
  hero.invuln = 0;
  const env = {
    scene,
    state,
    hero,
    collision,
    dialogues: [] as DialogueSpec[],
    toasts: [] as string[],
    banners: [] as string[],
    hints: [] as (string | null)[],
    saves: 0,
    character: new Character(),
    loot: [] as string[],
    rewards: [] as QuestReward[],
  } as Env;

  env.puzzle = new Puzzle3D(scene, world.markers, collision, state.puzzleSolved);
  env.puzzle.onSolved = () => {
    state.puzzleSolved = true;
  };
  env.combat = new Combat3D(scene, world, collision, state, {
    freeze: () => undefined,
    shake: () => undefined,
    spark: () => undefined,
    damage: () => undefined,
    killed: (kind) => {
      env.story.questEvent({ type: 'kill', kind });
      // the same thing Game3D does on a kill: roll the loot table into the bag
      env.loot.push(kind);
      for (const drop of rollDrops(kind, Math.random, 1)) env.character.inventory.add(drop.id, drop.count, drop.rarity);
    },
    exp: (amount) => env.character.addExp(amount),
    heal: (amount) => env.hero.heal(amount),
    bossWoke: () => env.puzzle.closeBossDoor(),
    bossDefeated: () => {
      env.puzzle.openBossDoor();
      state.bossDefeated = true;
      env.story.questEvent({ type: 'boss-defeated' });
    },
  });
  // the same wiring Game3D does: every hit goes through the stat pipeline
  env.combat.character = env.character;
  env.story = new Story3D(scene, world, collision, state, {
    dialogue: (spec) => env.dialogues.push(spec),
    exp: (amount) => env.character.addExp(amount),
    loot: (kind) => env.loot.push(kind),
    // the same thing Game3D does: the reward's items go in the bag and its EXP to the character
    reward: (reward) => {
      for (const entry of reward.items ?? []) env.character.inventory.add(entry.id, entry.count ?? 1);
      if (reward.exp) env.character.addExp(reward.exp);
      env.rewards.push(reward);
    },
    toast: (t) => env.toasts.push(t),
    banner: (t) => env.banners.push(t),
    hint: (t) => env.hints.push(t),
    float: () => undefined,
    spark: () => undefined,
    save: () => env.saves++,
    shake: () => undefined,
  });
  env.story.onRest = () => hero.heal(hero.maxHp);
  hero.aimAssist = (a) => env.combat.aimAssist(hero, a);
  return env;
}

const IDLE: HeroInput = { mx: 0, my: 0, attack: false, dodge: false, skill: false };

/** One frame of everything, in the same order `Game3D.step` runs them. */
function frame(env: Env, inp: Partial<HeroInput> = {}): void {
  const i = { ...IDLE, ...inp };
  env.hero.update(1 / 60, i, env.collision, env.collision.speedAt(env.hero.x, env.hero.y));
  for (const ev of env.hero.events.splice(0)) {
    if (ev.type === 'swing') env.combat.applySwing(env.hero, ev);
    else if (ev.type === 'shoot') env.combat.spawnArrow(ev);
    else if (ev.type === 'blast') env.combat.applyBlast(ev.x, ev.y, ev.radius, ev.dmg, ev.knock, ev.stun, env.hero);
  }
  env.combat.update(1 / 60, 1 / 60, env.hero);
  env.puzzle.update(1 / 60, 1 / 60, env.hero, i.mx, i.my);
  env.story.update(1 / 60, 1 / 60, env.hero, 0, false);
}

function run(env: Env, frames: number, inp: Partial<HeroInput> = {}, each?: (i: number) => Partial<HeroInput> | void): void {
  for (let n = 0; n < frames; n++) frame(env, { ...inp, ...each?.(n) });
}

function teleport(env: Env, x: number, y: number): void {
  env.hero.reset(x, y);
  env.hero.invuln = 0;
}

/** Walk up to an interactable and press the button. */
function interactAt(env: Env, x: number, y: number): void {
  teleport(env, x, y);
  run(env, 4);
  input.press('interact');
  input.release('interact');
  run(env, 2);
}

const npcOf = (id: string): { x: number; y: number; name: string } => {
  for (let cy = 0; cy < world.heightTiles / 16; cy++)
    for (let cx = 0; cx < world.widthTiles / 16; cx++) {
      const hit = world.chunk(cx, cy).npcs.find((n) => n.id === id);
      if (hit) return hit;
    }
  throw new Error(`no npc ${id}`);
};

test('the whole quest can be played from start to finish', () => {
  const env = makeEnv();
  input.enabled = true;

  // ── stage 0 → 1: talk to the elder ──
  const wulan = npcOf('wulan');
  interactAt(env, wulan.x + 18, wulan.y + 8);
  assert.equal(env.dialogues.length, 1, 'the elder said something');
  assert.equal(env.dialogues[0].name, 'Tetua Wulan');
  assert.ok(env.dialogues[0].lines.length > 0);
  // the dialogue's own callback is what advances the quest
  env.dialogues[0].onDone?.();
  assert.equal(env.state.quest.stage, 1, 'the hunt has begun');
  assert.ok(env.toasts.some((t) => t.includes('Quest baru')));
  // Batch 4: the elder does not send you out empty-handed
  assert.equal(env.character.inventory.countOf('sword_village'), 1, 'the village sword was handed over');
  assert.equal(env.character.inventory.countOf('potion_small'), 2);
  assert.ok(env.character.exp > 0 || env.character.level > 1, 'and the stage paid EXP');

  // ── stage 1 → 2: six forest monsters ──
  for (let cy = 0; cy < world.heightTiles / 16; cy++)
    for (let cx = 0; cx < world.widthTiles / 16; cx++) env.combat.spawnForChunk(cx, cy);
  const prey = env.combat.world.enemies.filter((e) => e.kind === 'slime' || e.kind === 'archer');
  assert.ok(prey.length >= KILLS_NEEDED, `the world has enough prey (${prey.length})`);
  for (const e of prey.slice(0, KILLS_NEEDED)) {
    e.hurt(999, e.x + 1, e.y, 0, 0, { emit: (x) => env.combat.world.events.push(x) });
    frame(env);
  }
  assert.equal(env.state.quest.kills, KILLS_NEEDED);
  assert.equal(env.state.quest.stage, 2, 'the elder wants us in the cave now');
  // six kills plus a stage reward has to be worth at least one level
  assert.ok(env.character.level > 1, `killing six monsters should level the hero, still ${env.character.level}`);
  const atkAfterLevels = env.character.stats.atk;
  assert.ok(atkAfterLevels > HERO_BASE.atk, 'and the level shows up in ATK');

  // ── the puzzle: push the rock east, then south, onto the plate ──
  const p = world.markers.puzzle;
  assert.equal(env.puzzle.logic.solved, false);
  // stand just west of the rock's centre and lean into it, the way a player would
  teleport(env, p.rock.tx * TILE + 8 - 15, p.rock.ty * TILE + 8 + 4);
  run(env, 60 * 14, {}, () => {
    env.hero.invuln = 1; // a wandering slime must not interrupt the puzzle
    return { mx: env.puzzle.logic.rock.tx < p.plate.tx ? 1 : 0, my: 0 };
  });
  assert.equal(env.puzzle.logic.rock.tx, p.plate.tx, 'rock pushed east');
  const rk = env.puzzle.logic.rock;
  teleport(env, rk.tx * TILE + 8, rk.ty * TILE - 5);
  run(env, 60 * 14, {}, () => {
    env.hero.invuln = 1;
    return { mx: 0, my: env.puzzle.logic.rock.ty < p.plate.ty ? 1 : 0 };
  });
  assert.equal(env.puzzle.logic.solved, true, `rock at ${JSON.stringify(env.puzzle.logic.rock)}`);
  assert.equal(env.state.puzzleSolved, true);
  assert.equal(env.collision.solidTile(p.gate.tx, p.gate.ty), false, 'the gate is open');

  // ── the boss ──
  const boss = env.combat.bossRef;
  assert.ok(boss, 'the boss exists');
  const arena = world.markers.boss.arena;
  teleport(env, (arena.x0 + 6) * TILE, Math.round((arena.y0 + arena.y1) / 2) * TILE);
  run(env, 240, {}, () => {
    env.hero.hp = env.hero.maxHp;
    return {};
  });
  assert.equal(boss.awake, true, 'walking in woke it');
  assert.equal(env.collision.solidTile(world.markers.boss.door.tx, world.markers.boss.door.ty), true, 'the arena door slammed');

  boss.invulnerable = false;
  boss.hurt(9999, boss.x + 1, boss.y, 0, 0, { emit: (x) => env.combat.world.events.push(x) });
  frame(env);
  assert.equal(env.state.bossDefeated, true);
  assert.equal(env.state.quest.stage, 3, 'time to take the crystal back');
  assert.equal(env.collision.solidTile(world.markers.boss.door.tx, world.markers.boss.door.ty), false, 'and the door reopened');

  // ── stage 3 → 4: back to the elder, and the lantern lights ──
  env.dialogues.length = 0;
  interactAt(env, wulan.x + 18, wulan.y + 8);
  assert.equal(env.dialogues.length, 1);
  env.dialogues[0].onDone?.();
  assert.equal(env.state.quest.stage, 4, 'quest complete');
  assert.equal(env.state.flags.lanternLit, true, 'the Great Lantern burns again');
  assert.ok(env.banners.some((b) => b.includes('Lentera Agung')));

  // ── Batch 4: the run has to have left the hero measurably stronger ──
  assert.equal(env.rewards.length, 4, 'every stage paid out');
  assert.ok(env.character.level >= 4, `four stages and a boss should be several levels, got ${env.character.level}`);
  assert.equal(env.loot.includes('boss'), true, 'the boss dropped its table');
  assert.equal(env.character.inventory.countOf('core_ember'), 1, 'including the Lantern Core');
  assert.equal(env.character.inventory.countOf('armor_woven'), 1, "and the elder's vest at the end");

  // and that gear can be worn, which is what "stronger" actually means
  const before = env.character.stats.atk;
  const coreCell = env.character.inventory.slots.findIndex((sl) => sl?.id === 'core_ember');
  assert.ok(coreCell >= 0);
  assert.equal(env.character.inventory.equip(coreCell), true);
  env.character.refresh();
  assert.equal(env.character.coreElement, 'api');
  assert.equal(env.character.passive, 'emberGuard');
  assert.ok(env.character.stats.mastery > 0, 'the core adds elemental mastery');
  assert.ok(env.character.stats.atk >= before, 'and never makes the hero weaker');

  env.story.dispose();
  env.puzzle.dispose();
  env.combat.dispose();
});

test('resting at a shrine heals, remembers the checkpoint and saves', () => {
  const env = makeEnv();
  input.enabled = true;
  const cp = world.markers.checkpoints[1];
  env.hero.hp = 3;
  interactAt(env, cp.x, cp.y + 10);
  assert.equal(env.hero.hp, env.hero.maxHp, 'fully healed');
  assert.equal(env.state.checkpoint, cp.id);
  assert.ok(env.saves > 0, 'and it saved');
  assert.ok(env.toasts.some((t) => t.includes(cp.name)));
  env.story.dispose();
  env.puzzle.dispose();
  env.combat.dispose();
});

test('signs can be read, and the interact hint appears only when something is in range', () => {
  const env = makeEnv();
  input.enabled = true;
  // stand in the middle of nowhere
  teleport(env, 60 * TILE, 118 * TILE);
  run(env, 4);
  assert.equal(env.hints[env.hints.length - 1], null, 'nothing to interact with out here');

  const wulan = npcOf('wulan');
  teleport(env, wulan.x + 18, wulan.y + 8);
  run(env, 4);
  assert.equal(env.hints[env.hints.length - 1], 'Bicara', 'the prompt appears next to the elder');

  // a readable sign somewhere in the world
  let sign: { x: number; y: number; text?: string } | null = null;
  for (let cy = 0; cy < world.heightTiles / 16 && !sign; cy++)
    for (let cx = 0; cx < world.widthTiles / 16 && !sign; cx++) {
      sign = world.chunk(cx, cy).props.find((pr) => pr.type === 'sign' && pr.text) ?? null;
    }
  assert.ok(sign, 'the world has signs');
  env.dialogues.length = 0;
  interactAt(env, sign.x, sign.y + 8);
  assert.equal(env.dialogues.length, 1);
  assert.equal(env.dialogues[0].name, 'Papan');
  env.story.dispose();
  env.puzzle.dispose();
  env.combat.dispose();
});

test('a finished game round-trips through the save and restores the world', () => {
  const finished = new GameState();
  finished.quest = { stage: 4, kills: KILLS_NEEDED };
  finished.puzzleSolved = true;
  finished.bossDefeated = true;
  finished.flags.lanternLit = true;
  finished.checkpoint = 'cp_cave';

  const json = JSON.parse(JSON.stringify(finished.toJSON({ x: 1234, y: 567, hp: 7 })));
  const restored = new GameState();
  restored.load(json);

  const env = makeEnv(restored);
  // a solved puzzle must come back solved, with the gate already down
  assert.equal(env.puzzle.logic.solved, true);
  assert.equal(env.collision.solidTile(world.markers.puzzle.gate.tx, world.markers.puzzle.gate.ty), false);
  // and a defeated boss must not come back
  for (let cy = 0; cy < world.heightTiles / 16; cy++)
    for (let cx = 0; cx < world.widthTiles / 16; cx++) env.combat.spawnForChunk(cx, cy);
  assert.equal(env.combat.bossRef, null, 'the boss stays dead');
  env.story.dispose();
  env.puzzle.dispose();
  env.combat.dispose();
});

test('an unsolved rock returns to its start when the hero leaves the room', () => {
  const env = makeEnv();
  const p = world.markers.puzzle;
  teleport(env, p.rock.tx * TILE - 6, p.rock.ty * TILE + 10);
  run(env, 180, { mx: 1, my: 0 });
  assert.notDeepEqual(env.puzzle.logic.rock, p.rock, 'the rock moved');
  env.puzzle.reset();
  assert.deepEqual(env.puzzle.logic.rock, { tx: p.rock.tx, ty: p.rock.ty }, 'and reset puts it back');
  assert.equal(env.collision.solidTile(p.rock.tx, p.rock.ty), true, 'blocking its start tile again');
  env.story.dispose();
  env.puzzle.dispose();
  env.combat.dispose();
});

test('roaming with combat running does not leak meshes into the scene', () => {
  const env = makeEnv();
  const spots: [number, number][] = [[20, 64], [110, 40], [200, 64], [60, 100], [20, 64]];
  const counts: number[] = [];
  for (let round = 0; round < 3; round++)
    for (const [tx, ty] of spots) {
      teleport(env, tx * TILE, ty * TILE);
      // stream the neighbourhood in and out the way the renderer would
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) env.combat.spawnForChunk(Math.floor(tx / 16) + ox, Math.floor(ty / 16) + oy);
      run(env, 30);
      counts.push(env.scene.children.length);
    }
  const first = counts.slice(0, spots.length).reduce((a, b) => a + b, 0) / spots.length;
  const last = counts.slice(-spots.length).reduce((a, b) => a + b, 0) / spots.length;
  assert.ok(last < first * 1.4 + 40, `scene grew from ${first.toFixed(0)} to ${last.toFixed(0)} objects`);
  env.story.dispose();
  env.puzzle.dispose();
  env.combat.dispose();
});
