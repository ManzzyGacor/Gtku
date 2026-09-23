/**
 * Integration smoke test: runs the *real* GameScene + UIScene against a mocked Phaser for thousands of frames and drives
 * a full playthrough (walk, fight, talk, puzzle, boss, save/load, death). It cannot check pixels, but it catches
 * exceptions, broken wiring and object leaks — the things that would otherwise only show up on a phone.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
// Type-only: erased at runtime, so it cannot disturb the global setup order below.
import type { FakeEl } from './mocks/dom-mock';

// ---- browser globals ----
const store = new Map<string, string>();
const g = globalThis as any;
g.window = { addEventListener() {}, innerWidth: 900, innerHeight: 412, devicePixelRatio: 2 };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
g.location = { search: '' };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
g.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };

const mock = await import('./mocks/phaser-mock');
const dom = await import('./mocks/dom-mock');
const doc = dom.installDom();

const { buildAllSheets } = await import('../src/art');
const { registerSheet, registerFont } = await import('../src/render2d/register');
const { input } = await import('../src/core/input');
const { GameScene } = await import('../src/render2d/scenes/GameScene');
const { UIScene } = await import('../src/render2d/scenes/UIScene');
const { TILE } = await import('../src/config');
const { KILLS_NEEDED } = await import('../src/core/state/GameState');

const boot = new mock.Scene('Boot');
const sheets = buildAllSheets();
for (const s of sheets) registerSheet(boot as never, s);
registerFont(boot as never, sheets.find((s) => s.key === 'font')!);

let clock = 0;
const DT = 1000 / 60;

function makeGame(cont = false) {
  input.reset();
  input.enabled = true;
  mock.launched.clear();
  const game = new GameScene();
  mock.sceneInstances.set('Game', game);
  game.init({ continue: cont });
  game.create();
  const ui = new UIScene();
  mock.sceneInstances.set('UI', ui);
  ui.create();
  return { game, ui };
}

function run(env: { game: InstanceType<typeof GameScene>; ui: InstanceType<typeof UIScene> }, frames: number, each?: (i: number) => void): void {
  for (let i = 0; i < frames; i++) {
    each?.(i);
    clock += DT;
    env.game.update(clock, DT);
    env.ui.update(clock, DT);
  }
}

function teleport(env: ReturnType<typeof makeGame>, x: number, y: number): void {
  env.game.hero.reset(x, y);
  env.game.hero.invuln = 0;
  env.game.rig.snap(x, y);
  env.game.chunks.preload(env.game.rig.view, 1);
}

const env = makeGame();
const { game, ui } = env;

test('boots and idles without errors', () => {
  run(env, 240);
  assert.ok(game.chunks.loaded.size > 0);
  assert.ok(mock.live.count > 50, `live objects ${mock.live.count}`);
});

test('the hero walks east along the road', () => {
  const x0 = game.hero.x;
  input.stick.x = 1;
  run(env, 60 * 4);
  input.stick.x = 0;
  assert.ok(game.hero.x > x0 + 100, `moved ${game.hero.x - x0}`);
});

test('talking to the elder opens dialogue, advances it and starts the quest', () => {
  const wulan = game.world.chunk(1, 2).npcs.find((n) => n.id === 'wulan') ?? game.world.chunk(1, 2).npcs[0];
  assert.ok(wulan, 'elder exists in chunk data');
  teleport(env, wulan.x + 14, wulan.y + 6);
  run(env, 30);
  input.press('interact');
  run(env, 3);
  assert.equal(ui.dialogOpen, true, 'dialogue opened');
  for (let i = 0; i < 60 && ui.dialogOpen; i++) {
    run(env, 90);
    input.press('interact');
    run(env, 2);
  }
  assert.equal(ui.dialogOpen, false, 'dialogue closed');
  assert.equal(game.state.quest.stage, 1);
});

test('the hero can defeat a slime (aim assist + combo) and counts toward the quest', () => {
  game.director.resetAll(game.chunks.loaded.values());
  const spawn = game.world.chunk(3, 1).spawns.find((s) => s.kind === 'slime') ?? game.world.chunk(3, 1).spawns[0];
  assert.ok(spawn);
  teleport(env, spawn.x - 34, spawn.y);
  run(env, 5);
  const slimes = game.director.world.enemies.filter((e) => e.kind === 'slime');
  assert.ok(slimes.length > 0, 'a slime spawned with the chunk');
  const target = slimes.sort((a, b) => Math.hypot(a.x - game.hero.x, a.y - game.hero.y) - Math.hypot(b.x - game.hero.x, b.y - game.hero.y))[0];
  run(env, 60 * 10, (i) => {
    if (i % 14 === 0) input.press('attack');
    if (!target.dead) {
      game.hero.invuln = 1; // focus on the hit logic here
      input.stick.x = Math.sign(target.x - game.hero.x) * (Math.abs(target.x - game.hero.x) > 18 ? 1 : 0);
      input.stick.y = Math.sign(target.y - game.hero.y) * (Math.abs(target.y - game.hero.y) > 8 ? 1 : 0);
    } else input.stick.x = input.stick.y = 0;
  });
  input.stick.x = input.stick.y = 0;
  assert.ok(target.dead, `slime hp ${target.hp}`);
  assert.equal(game.state.quest.kills >= 1, true);
});

test('all enemy kinds run their AI against the hero without throwing (god mode)', () => {
  game.director.resetAll(game.chunks.loaded.values());
  const arch = game.world.chunk(4, 1).spawns.find((s) => s.kind === 'archer') ?? game.world.chunk(4, 1).spawns[0];
  teleport(env, arch.x - 60, arch.y);
  run(env, 60 * 12, (i) => {
    game.hero.invuln = 0.5;
    if (i % 90 === 0) input.press('skill');
  });
  const cave = game.world.chunk(6, 1).spawns.find((s) => s.kind === 'bats') ?? game.world.chunk(6, 1).spawns[0];
  teleport(env, cave.x, cave.y + 40);
  run(env, 60 * 12, (i) => {
    game.hero.invuln = 0.5;
    if (i % 20 === 0) input.press('attack');
    if (i % 200 === 0) input.press('dodge');
  });
  assert.ok(true);
});

test('the push-rock puzzle is solvable through real hero input and opens the gate', () => {
  const p = game.world.markers.puzzle;
  const rx = p.rock.tx * TILE + 8;
  const ry = p.rock.ty * TILE + 8;
  teleport(env, rx - 15, ry + 4);
  game.director.resetAll(game.chunks.loaded.values());
  // push east until the rock reaches the plate's column
  run(env, 60 * 12, () => {
    game.hero.invuln = 1;
    input.stick.x = game.puzzle.logic.rock.tx < p.plate.tx ? 1 : 0;
    input.stick.y = 0;
  });
  input.stick.x = 0;
  assert.equal(game.puzzle.logic.rock.tx, p.plate.tx, 'rock pushed east');
  // walk around to the north side and push south
  const rk = game.puzzle.logic.rock;
  teleport(env, rk.tx * TILE + 8, rk.ty * TILE - 5);
  game.director.resetAll(game.chunks.loaded.values());
  run(env, 60 * 12, () => {
    game.hero.invuln = 1;
    input.stick.y = game.puzzle.logic.rock.ty < p.plate.ty ? 1 : 0;
    input.stick.x = 0;
  });
  input.stick.y = 0;
  assert.ok(game.puzzle.logic.solved, `rock at ${JSON.stringify(game.puzzle.logic.rock)}`);
  assert.equal(game.state.puzzleSolved, true);
  assert.equal(game.collision.solidTile(p.gate.tx, p.gate.ty), false, 'gate is open');
});

test('boss fight: wakes, closes the door, changes phases, dies, quest advances, door reopens', () => {
  game.director.resetAll(game.chunks.loaded.values());
  const arena = game.world.markers.boss.arena;
  teleport(env, (arena.x0 + 6) * TILE, 40 * TILE);
  let woke = false;
  let doorClosedSeen = false;
  const door = game.world.markers.boss.door;
  const boss = () => game.director.bossRef!;
  run(env, 60 * 90, (i) => {
    game.hero.invuln = 1;
    game.hero.hp = game.hero.maxHp;
    const b = game.director.bossRef;
    if (b && b.awake) woke = true;
    if (game.collision.solidTile(door.tx, door.ty)) doorClosedSeen = true;
    if (b && b.awake && !b.invulnerable && !b.dead && i % 70 === 0) game.director.applyBlast(b.x, b.cy, 120, 7, 0, 0);
    if (i % 25 === 0) input.press('attack');
  });
  assert.ok(woke, 'boss woke');
  assert.ok(doorClosedSeen, 'arena door closed during the fight');
  assert.ok(boss() === null || boss().dead || game.state.bossDefeated, 'boss defeated');
  assert.equal(game.state.bossDefeated, true);
  assert.ok(game.state.quest.stage >= 3, `quest stage ${game.state.quest.stage}`);
  assert.equal(game.collision.solidTile(door.tx, door.ty), false, 'door reopened');
});

test('returning the crystal to the elder completes the quest and lights the lantern', () => {
  const wulan = game.world.chunk(1, 2).npcs.find((n) => n.id === 'wulan')!;
  teleport(env, wulan.x + 14, wulan.y + 6);
  run(env, 30);
  input.press('interact');
  run(env, 3);
  for (let i = 0; i < 60 && ui.dialogOpen; i++) {
    run(env, 90);
    input.press('interact');
    run(env, 2);
  }
  assert.equal(game.state.quest.stage, 4);
  assert.equal(!!game.state.flags.lanternLit, true);
  assert.equal(game.chunks.lanternLit, true);
});

test('save/load round trip restores quest, puzzle and boss state', () => {
  game.saveNow(true);
  const raw = store.get('lentera-malam/save/v1');
  assert.ok(raw, 'save exists');
  const env2 = makeGame(true);
  run(env2, 60);
  assert.equal(env2.game.state.quest.stage, 4);
  assert.equal(env2.game.state.puzzleSolved, true);
  assert.equal(env2.game.state.bossDefeated, true);
  assert.equal(env2.game.collision.solidTile(game.world.markers.puzzle.gate.tx, game.world.markers.puzzle.gate.ty), false);
  assert.equal(env2.game.director.bossRef, null, 'boss does not respawn after defeat');
});

test('dying respawns at the last checkpoint with full HP', () => {
  const e = makeGame();
  run(e, 30);
  e.game.hero.invuln = 0;
  e.game.hero.takeDamage(999, e.game.hero.x - 5, e.game.hero.y);
  run(e, 60 * 3);
  assert.ok(e.game.hero.alive, 'hero alive again');
  assert.equal(e.game.hero.hp, e.game.hero.maxHp);
});

test('roaming does not leak game objects (chunks stream in and out)', () => {
  const e = makeGame();
  run(e, 120);
  const spots: [number, number][] = [[10, 10], [60, 40], [100, 40], [20, 60], [70, 20], [30, 30], [110, 22], [15, 40]];
  const counts: number[] = [];
  for (let round = 0; round < 3; round++)
    for (const [tx, ty] of spots) {
      teleport(e, tx * TILE + 8, ty * TILE + 8);
      run(e, 90);
      counts.push(mock.live.count);
    }
  const first = counts.slice(0, spots.length).reduce((a, b) => a + b, 0) / spots.length;
  const last = counts.slice(-spots.length).reduce((a, b) => a + b, 0) / spots.length;
  assert.ok(last < first * 1.35 + 200, `live objects grew from ${first} to ${last}`);
  assert.ok(KILLS_NEEDED === 6);
});

test('title screen builds and animates (with and without a save)', async () => {
  const { TitleScene } = await import('../src/render2d/scenes/TitleScene');
  for (const withSave of [true, false]) {
    if (!withSave) store.clear();
    const t = new TitleScene();
    t.create();
    for (let i = 0; i < 30; i++) t.update(i * DT, DT);
  }
  assert.ok(true);
});

// ───────────────────────── debug overlay (Fase 0 §6) ─────────────────────────

/** The row in the settings menu whose label is `label`, as [row, buttons…]. */
function settingsRow(label: string): { row: FakeEl; buttons: FakeEl[]; value: string } {
  const span = dom.walkEls(doc.body).find((e) => e.tagName === 'SPAN' && e.textContent === label);
  assert.ok(span, `no settings row labelled "${label}"`);
  const row = span.parentNode?.parentNode;
  assert.ok(row && row.classes.has('lm-row'), `"${label}" is not inside a row`);
  const buttons = row.childNodes.filter((c) => c.tagName === 'BUTTON');
  const value = row.childNodes.find((c) => c.classes.has('lm-val'))?.textContent ?? buttons[0]?.textContent ?? '';
  return { row, buttons, value };
}

test('the settings menu opens from the gear, pauses the game and closes again', async () => {
  const { debugUi } = await import('../src/ui/DebugUi');
  const panel = debugUi.current;
  assert.ok(panel, 'GameScene attached the debug overlay');

  const gear = dom.walkEls(doc.body).find((e) => e.className === 'lm-gear');
  assert.ok(gear, 'gear button exists');
  gear.tap();
  assert.equal(panel.settingsOpen, true, 'menu opened');
  assert.equal(gear.style.display, 'none', 'gear hides behind the menu');

  // while the menu is up the simulation must hold still
  teleport(env, game.world.markers.playerStart.x, game.world.markers.playerStart.y);
  const x0 = game.hero.x;
  input.stick.x = 1;
  run(env, 60);
  input.stick.x = 0;
  assert.equal(game.hero.x, x0, 'hero did not move while paused');

  const close = dom.findByText(dom.walkEls(doc.body).find((e) => e.classes.has('lm-top'))!, 'Tutup');
  assert.ok(close, 'close button exists');
  close.tap();
  assert.equal(panel.settingsOpen, false);
  assert.equal(gear.style.display, 'block');

  input.stick.x = 1;
  run(env, 60);
  input.stick.x = 0;
  assert.ok(game.hero.x > x0 + 10, `hero moves again after closing (moved ${game.hero.x - x0})`);
});

test('the menu rows really drive the settings and the graphics preset', async () => {
  const { settings } = await import('../src/core/settings');
  const before = { preset: settings.get('preset'), auto: settings.get('presetAuto'), fps: settings.get('fpsCounter'), stick: settings.get('stickScale') };

  const fpsRow = settingsRow('Penghitung FPS');
  assert.equal(fpsRow.buttons.length, 1);
  fpsRow.buttons[0].tap();
  assert.equal(settings.get('fpsCounter'), !before.fps, 'toggle flipped the stored setting');
  assert.equal(settingsRow('Penghitung FPS').value, settings.get('fpsCounter') ? 'Nyala' : 'Mati', 'label follows the value');

  // AUTO → first concrete level; the game applies it without throwing
  assert.equal(settingsRow('Preset').value, 'AUTO');
  const presetRow = settingsRow('Preset');
  presetRow.buttons[1].tap(); // "▸"
  assert.equal(settings.get('presetAuto'), false, 'picking a level leaves AUTO');
  assert.equal(settings.get('preset'), 'vlow');
  assert.equal(settingsRow('Preset').value, 'Sangat Rendah');
  run(env, 30);

  const stickRow = settingsRow('Ukuran joystick');
  const [minus, plus] = stickRow.buttons;
  plus.tap();
  assert.ok(settings.get('stickScale') > before.stick, 'joystick grew');
  minus.tap();
  minus.tap();
  assert.ok(settings.get('stickScale') < before.stick, 'and shrank again');
  run(env, 30);

  settings.set('preset', before.preset);
  settings.set('presetAuto', before.auto);
  settings.set('fpsCounter', before.fps);
  settings.set('stickScale', before.stick);
});

test('"Salin laporan" produces a report with the live numbers in it', async () => {
  const { debugUi } = await import('../src/ui/DebugUi');
  const { recordError } = await import('../src/core/errors');
  recordError('contoh error dari tes', 'smoke');
  run(env, 120); // give the FPS meter some history

  settingsRow('Salin laporan').buttons[0].tap();
  for (let i = 0; i < 5; i++) await Promise.resolve();

  const dump = dom.walkEls(doc.body).find((e) => e.classes.has('lm-dump'));
  assert.ok(dump, 'the report is shown so it can be copied by hand if the clipboard refuses');
  for (const needle of ['Lentera Malam — laporan tes', 'renderer: phaser2d', 'objek aktif:', 'smoke: contoh error dari tes']) {
    assert.ok(dump.textContent.includes(needle), `report is missing "${needle}"`);
  }
  assert.ok(debugUi.current);
});
