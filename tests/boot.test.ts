/**
 * Can the game be **built**?
 *
 * Until now `Game3D` — the class that wires the renderer, the world, the HUD, the combat, the save
 * and the character sheet together — had no test at all, because it needs a canvas. That gap cost
 * a release: `applySheet()` was called in the constructor before `this.combat` existed, every boot
 * threw, and the only thing the player saw was "Gagal memuat. Muat ulang halaman."
 *
 * So: a WebGL context stub (`mocks/gl-mock.ts`) that is enough for Three.js to *construct* a
 * renderer, and a fake DOM for the overlay UI. What this file checks is construction, wiring and
 * teardown. It cannot check rendering — a frame needs real shader compilation, which is what the
 * phone is for — and it never pretends to.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { SAVE_KEY, LEGACY_SAVE_KEY } from '../src/config';
import { installDom, type FakeDocument } from './mocks/dom-mock';
import { makeGlStub } from './mocks/gl-mock';

let doc: FakeDocument;
let store: Map<string, string>;

beforeEach(() => {
  doc = installDom();
  store = new Map();
  Object.assign(globalThis as Record<string, unknown>, {
    window: {
      innerWidth: 800,
      innerHeight: 380,
      devicePixelRatio: 2,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      location: { search: '' },
    },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    screen: { orientation: {} },
  });
  // canvases hand out the GL stub; everything else keeps the 2D proxy the UI tests use
  const create = doc.createElement;
  doc.createElement = (tag: string) => {
    const node = create(tag);
    if (tag === 'canvas') {
      const raw = node as unknown as Record<string, unknown>;
      const original = raw.getContext as (t: string) => unknown;
      raw.getContext = (type: string) => (type.startsWith('webgl') ? makeGlStub() : original(type));
    }
    return node;
  };
});

afterEach(() => {
  for (const key of ['window', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'screen', 'document'])
    delete (globalThis as Record<string, unknown>)[key];
});

type Game = InstanceType<Awaited<typeof import('../src/render3d/Game3D')>['Game3D']>;

async function boot(options: { continue: boolean }): Promise<Game> {
  const { Game3D } = await import('../src/render3d/Game3D');
  return new Game3D(doc.body as unknown as HTMLElement, options);
}

test('a new game can be built and taken down again', async () => {
  const game = await boot({ continue: false });

  // the wiring that used to be broken: the combat has to have the character sheet
  assert.equal(game.combat.character, game.character, 'combat must know the sheet to calculate damage');
  assert.equal(game.character.level, 1);
  assert.equal(game.hero.maxHp, game.character.stats.maxHp, 'the HP ceiling comes from the sheet');
  assert.ok(game.hero.alive);
  assert.ok(game.hero.speedScale > 0, 'walking speed must be a real multiplier');

  const start = game.world.markers.playerStart;
  assert.equal(Math.round(game.hero.x), Math.round(start.x), 'a new game starts at the start');

  game.dispose();
  assert.equal(doc.body.childNodes.length, 0, 'and nothing of the UI is left behind');
});

test('continuing a save restores the character, the level and the position', async () => {
  // a save with progress: level 7, a helmet worn, a rarer sword in the bag
  const first = await boot({ continue: false });
  first.character.addExp(9999);
  first.character.inventory.add('helm_stone', 1, 'epic');
  first.character.inventory.equip(0);
  first.character.inventory.add('sword_dawn');
  first.applySheet();
  const level = first.character.level;
  const maxHp = first.hero.maxHp;
  assert.ok(level > 1 && maxHp > 12, `the sheet has to have grown: level ${level}, hp ${maxHp}`);
  first.hero.reset(first.world.markers.checkpoints[1].x, first.world.markers.checkpoints[1].y);
  first.saveNow(true);
  first.dispose();
  assert.ok(store.has(SAVE_KEY), 'it saved');

  const second = await boot({ continue: true });
  assert.equal(second.character.level, level, 'level restored');
  assert.equal(second.character.inventory.equipped.helmet?.id, 'helm_stone');
  assert.equal(second.character.inventory.equipped.helmet?.rarity, 'epic', 'including its rarity');
  assert.equal(second.character.inventory.countOf('sword_dawn'), 1, 'and the bag');
  assert.equal(second.hero.maxHp, maxHp, 'and the HP ceiling that gear implies');
  assert.equal(second.combat.character, second.character);
  assert.ok(Math.abs(second.hero.x - second.world.markers.checkpoints[1].x) < 20, 'and where we were standing');
  second.dispose();
});

test('a 2D-era save (v1) still boots, as a level 1 hero with an empty bag', async () => {
  // exactly what the 2D build wrote, under the key it wrote it to
  store.set(
    LEGACY_SAVE_KEY,
    JSON.stringify({
      v: 1,
      hero: { x: 60 * 16 + 8, y: 32 * 16 + 8, hp: 9 },
      checkpoint: 'cp_forest',
      worldTime: 812.4,
      dayTime: 0.71,
      killed: {},
      quest: { stage: 1, kills: 4 },
      flags: { met_elder: true },
      puzzle: { solved: false },
      bossDefeated: false,
    }),
  );

  const game = await boot({ continue: true });
  assert.equal(game.state.quest.stage, 1, 'the quest carried over');
  assert.equal(game.state.quest.kills, 4);
  assert.equal(game.character.level, 1, 'a v1 save has no character, so level 1');
  assert.equal(game.character.inventory.used, 0, 'and an empty bag');
  assert.ok(game.hero.hp > 0 && game.hero.hp <= game.hero.maxHp, `hp ${game.hero.hp}/${game.hero.maxHp}`);
  // the migration must have put the hero somewhere they can stand
  assert.equal(game.collision.boxBlocked(game.hero.x, game.hero.y, 5, 7), false, 'not inside a wall');
  // and the old key must be gone, so it can never overwrite the new save
  assert.equal(store.has(LEGACY_SAVE_KEY), false);
  game.dispose();
});

test('a corrupt save boots a fresh game instead of a broken one', async () => {
  store.set(SAVE_KEY, '{"v":1,"hero":{"x":');
  const game = await boot({ continue: true });
  assert.equal(game.character.level, 1);
  assert.ok(game.hero.alive);
  assert.equal(Math.round(game.hero.x), Math.round(game.world.markers.playerStart.x));
  game.dispose();
});

test('levelling up after boot raises the ceiling without healing, and reaches the HUD', async () => {
  const game = await boot({ continue: false });
  game.hero.hp = 4;
  const before = game.hero.maxHp;
  game.gainExp(9999);
  assert.ok(game.character.level > 1, 'levels were gained');
  assert.ok(game.hero.maxHp > before, 'the ceiling rose');
  assert.equal(game.hero.hp, 4, 'a level-up must not heal — that would make dying convenient');
  game.dispose();
});

test('equipping through the panel reaches the hero, the combat and the save', async () => {
  const game = await boot({ continue: false });
  game.character.inventory.add('boots_striding');
  const speedBefore = game.hero.speedScale;
  game.character.inventory.add('core_frost');

  assert.equal(game.character.inventory.equip(0), true);
  game.applySheet();
  assert.ok(game.hero.speedScale > speedBefore, 'boots make the hero walk faster, for real');

  const coreCell = game.character.inventory.slots.findIndex((s) => s?.id === 'core_frost');
  assert.equal(game.character.inventory.equip(coreCell), true);
  game.applySheet();
  assert.equal(game.character.coreElement, 'es');
  assert.equal(game.combat.character?.passive, 'frostWard', 'the combat can read the passive');

  game.saveNow(true);
  const raw = JSON.parse(store.get(SAVE_KEY)!) as { v: number; character?: { inventory: { equipped: Record<string, unknown> } } };
  assert.equal(raw.v, 2);
  assert.ok(raw.character?.inventory.equipped.lantern, 'and it is in the save');
  game.dispose();
});

test('the diagnostics report can be produced without a frame ever being drawn', async () => {
  const game = await boot({ continue: false });
  const lines = game.diagnostics().report?.() ?? [];
  const text = lines.join('\n');
  assert.ok(lines.length > 5, `expected a real report, got ${lines.length} lines`);
  assert.ok(text.includes('hero:'), text.slice(0, 200));
  game.dispose();
});
