/**
 * Mode Pengembang.
 *
 * Three things matter and all three are checked: the doors open (five taps, `?debug=1`), every
 * button does what it says **on the real game**, and the whole thing is absent from a release
 * build — not hidden, absent, which is verified by actually building one.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { debugRequested, devToolsBuild, TapUnlock } from '../src/core/devtools';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { buildDevActions } from '../src/render3d/DevTools';
import type { SwingEvent } from '../src/core/entities/HeroCore';

// ───────────────────────────── the doors ─────────────────────────────

test('five quick taps unlock, slow taps do not', () => {
  const lock = new TapUnlock(5, 1.5);
  assert.equal(lock.tap(0), false);
  assert.equal(lock.tap(0.4), false);
  assert.equal(lock.remaining, 3, 'it can say how many are left');
  assert.equal(lock.tap(0.8), false);
  assert.equal(lock.tap(1.2), false);
  assert.equal(lock.tap(1.6), true, 'the fifth quick tap opens it');

  // five taps spread over a minute of fiddling with settings must not
  const slow = new TapUnlock(5, 1.5);
  for (let i = 0; i < 10; i++) assert.equal(slow.tap(i * 3), false, `tap ${i} at ${i * 3}s`);
});

test('?debug=1 asks for it, and nothing else does', () => {
  assert.equal(debugRequested('?debug=1'), true);
  assert.equal(debugRequested('?fps=1&debug=on'), true);
  assert.equal(debugRequested('?debug=0'), false);
  assert.equal(debugRequested(''), false);
  assert.equal(debugRequested('?debugger=1'), false);
});

test('only a development or explicit staging build offers it', () => {
  assert.equal(devToolsBuild({ DEV: true }), true);
  assert.equal(devToolsBuild({ DEV: false }), false, 'a release build never does');
  assert.equal(devToolsBuild({ DEV: false, VITE_DEV_TOOLS: '1' }), true, 'unless a staging build asks for it');
  assert.equal(devToolsBuild({ DEV: false, VITE_DEV_TOOLS: 'yes' }), false);
});

test('a release build contains no developer menu at all', async () => {
  /*
   * Built for real, in memory. The first version of this gate compiled the menu out of the *code
   * path* but still emitted its two chunks into dist/ — never loaded, but downloadable. The only
   * way to know that cannot happen again is to look at what the build actually produces.
   */
  const { build } = await import('vite');
  // Vitest runs with NODE_ENV=test, and Vite decides `import.meta.env.DEV` from NODE_ENV — so an
  // unforced build here would be a development build and prove nothing. Force what `vite build`
  // does from the command line.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let out: Awaited<ReturnType<typeof build>>;
  try {
    out = await build({ mode: 'production', logLevel: 'silent', build: { write: false, minify: false } });
  } finally {
    process.env.NODE_ENV = previous;
  }
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []));
  const names = outputs.map((o) => o.fileName);
  assert.ok(names.some((n) => n.includes('boot3d')), `the build ran (${names.length} files)`);
  assert.ok(!names.some((n) => /DevMenu|DevTools/.test(n)), `developer chunks in a release build: ${names.join(', ')}`);
  for (const o of outputs) {
    if (o.type !== 'chunk') continue;
    assert.ok(!o.code.includes('MODE PENGEMBANG'), `${o.fileName} carries the developer menu`);
    assert.ok(!o.code.includes('lm-devbtn'), `${o.fileName} carries the DEV button`);
  }
}, 60_000);

// ───────────────────────────── every button, on the real game ─────────────────────────────

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

test('items, cores, a full kit and coins land in the real bag', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);

  const itemCount = dev.items().length;
  assert.ok(itemCount >= 15, `every item is offered, got ${itemCount}`);
  dev.giveItem('helm_stone', 'mythic', 1);
  const helm = game.character.inventory.slots.find((s) => s?.id === 'helm_stone');
  assert.equal(helm?.rarity, 'mythic', 'at the chosen rarity');

  dev.giveAllCores();
  for (const id of ['core_ember', 'core_tide', 'core_frost', 'core_storm'])
    assert.equal(game.character.inventory.countOf(id), 1, `${id} given`);

  const before = game.character.inventory.used;
  dev.giveKit();
  assert.ok(game.character.inventory.used - before >= 6, 'a piece for every slot');

  dev.giveCoins(1000);
  assert.equal(game.character.coins, 1000);
  game.dispose();
});

test('all four elements unlock, and primary/secondary reach the hero', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);
  dev.unlockAllElements();
  assert.deepEqual(dev.elements().filter((e) => e.unlocked).map((e) => e.id).sort(), ['air', 'api', 'es', 'petir']);
  dev.setElement('primary', 'petir');
  dev.setElement('secondary', 'air');
  assert.equal(game.hero.element, 'petir');
  assert.equal(game.hero.skillElement, 'air');
  game.dispose();
});

test('level and EXP go through the real sheet', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);
  const hp1 = game.hero.maxHp;
  dev.setLevel(30);
  assert.equal(game.character.level, 30);
  assert.ok(game.hero.maxHp > hp1, 'the level reached the hero');
  assert.equal(game.hero.hp, game.hero.maxHp, 'and it heals, so the new ceiling can be tested');
  dev.setLevel(Number.NaN);
  assert.equal(game.character.level, 30, 'nonsense is ignored');
  dev.setLevel(1);
  dev.addExp(5000);
  assert.ok(game.character.level > 1);
  game.dispose();
});

test('spawned monsters exist, and their deaths stay out of the quest and the save', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);
  const n0 = game.combat.world.enemies.length;
  dev.spawn('slime');
  dev.spawn('archer');
  dev.spawn('bat');
  dev.spawn('dummy');
  assert.ok(game.combat.world.enemies.length - n0 >= 6, 'slime + archer + 3 bats + dummy');

  const kills = game.state.quest.kills;
  const killed = Object.keys(game.state.killed).length;
  const coins = game.character.coins;
  for (const e of game.combat.world.enemies) {
    if (e.spawnId.startsWith('dev_') && e.kind !== 'dummy') e.hurt(9999, e.x, e.y, 0, 0, { emit: (x) => game.combat.world.events.push(x) });
  }
  game.combat.update(1 / 60, 1 / 60, game.hero);
  assert.equal(game.state.quest.kills, kills, 'the quest counter is untouched');
  assert.equal(Object.keys(game.state.killed).length, killed, 'nothing is remembered as dead');
  assert.ok(game.character.coins > coins, 'but coins do drop');

  dev.spawn('boss');
  assert.equal(game.story.questText().title.length > 0, true);
  assert.ok(dev.clearSpawns().length > 0);
  assert.ok(!game.combat.world.enemies.some((e) => e.spawnId.startsWith('dev_')), 'clear removes them all');
  game.dispose();
});

test('every teleport lands somewhere the hero can stand', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);
  const targets = dev.teleports();
  assert.ok(targets.length >= 12, `areas, landmarks and every chest, got ${targets.length}`);
  for (const t of targets) {
    dev.teleport(t.id);
    const tx = Math.floor(game.hero.x / 16);
    const ty = Math.floor(game.hero.y / 16);
    assert.equal(game.world.solidAt(tx, ty), false, `${t.label} put the hero inside something`);
  }
  game.dispose();
});

test('time, weather, god mode, heal and the resets', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);

  dev.setTime('malam');
  assert.ok(Math.abs(game.timeOfDay - 0.95) < 1e-9);
  dev.setTime('siang');
  assert.ok(Math.abs(game.timeOfDay - 0.5) < 1e-9);

  for (const w of dev.weathers()) {
    dev.setWeather(w.id);
    assert.equal(dev.weather(), w.id);
  }
  dev.setWeather('cerah');

  dev.setGodMode(true);
  game.hero.invuln = 0;
  const hp = game.hero.hp;
  game.hero.takeDamage(99, game.hero.x + 10, game.hero.y);
  assert.equal(game.hero.hp, hp, 'kebal means no HP lost');
  dev.setGodMode(false);
  game.hero.invuln = 0;
  game.hero.takeDamage(3, game.hero.x + 10, game.hero.y);
  assert.ok(game.hero.hp < hp, 'and switching it off really switches it off');
  dev.heal();
  assert.equal(game.hero.hp, game.hero.maxHp);

  game.state.markSeen('intro');
  dev.resetCutscenes();
  assert.deepEqual(game.state.cutscenesSeen, []);

  let reloaded = false;
  const withReload = buildDevActions(game, () => {
    reloaded = true;
  });
  game.saveNow(true);
  assert.ok(env.store.size > 0);
  withReload.resetSave();
  assert.equal(reloaded, true, 'resetting the save reloads');
  assert.ok(![...env.store.keys()].some((k) => k.includes('/save/')), 'and the save is gone');
  game.dispose();
});

test('a reaction on the dummy is written to the log as "Es + Api"-style text', async () => {
  const game = await bootGame(env, { continue: false });
  const dev = buildDevActions(game, () => undefined);
  const lines: string[] = [];
  game.onReactionLog = (line) => lines.push(line);
  dev.unlockAllElements();

  const dummy = game.combat.world.enemies.find((e) => e.kind === 'dummy')!;
  game.hero.reset(dummy.x - 18, dummy.y, game.hero.maxHp);
  const swing = (): SwingEvent => ({ type: 'swing', x: game.hero.x, y: game.hero.y - 6, angle: 0, range: 40, arc: Math.PI / 2, dmg: 2, knock: 70, index: 0 });

  // freeze it with ice, then hit it with fire: that is Lebur
  dev.setElement('primary', 'es');
  game.combat.applySwing(game.hero, swing());
  assert.ok(game.combat.dummyStatus()[0].statuses.includes('Membeku'), `the dummy shows it is frozen: "${game.combat.dummyStatus()[0].statuses}"`);
  dev.setElement('primary', 'api');
  game.combat.applySwing(game.hero, swing());

  assert.equal(lines.length, 1, `one reaction logged, got ${JSON.stringify(lines)}`);
  assert.equal(lines[0], 'Api + Es → Lebur');
  game.dispose();
});
