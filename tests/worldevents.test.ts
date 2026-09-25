/**
 * World events: the data, the director that decides when, and each event running in the real game.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import {
  FIRST_ROLL_AFTER,
  ROLL_EVERY,
  WORLD_EVENT_IDS,
  WORLD_EVENTS,
  WorldEventDirector,
  type EventContext,
} from '../src/core/systems/worldEvents';
import { itemDef } from '../src/core/items/items';
import { WEATHER } from '../src/core/systems/weather';
import { makeRng } from '../src/core/rng';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';

const NIGHT: EventContext = { night: true, questStage: 2, busy: false };
const DAY: EventContext = { night: false, questStage: 2, busy: false };

test('every event is valid data: real items, real weather, real elements', () => {
  assert.ok(WORLD_EVENT_IDS.length >= 4);
  for (const id of WORLD_EVENT_IDS) {
    const d = WORLD_EVENTS[id];
    assert.equal(d.id, id);
    assert.ok(d.duration > 0 && d.cooldown > 0 && d.weight > 0, id);
    assert.ok(d.intro && d.outro && d.name, id);
    const fx = d.effects;
    if (fx.weather) assert.ok(fx.weather in WEATHER, `${id}: weather ${fx.weather}`);
    for (const o of fx.merchant?.offers ?? []) assert.ok(itemDef(o.item), `${id}: sells ${o.item}, which does not exist`);
    if (fx.element) assert.ok(fx.element.pool.length > 0 && fx.element.mult > 1);
  }
  // the four the plan names
  for (const id of ['invasi', 'badai', 'kabut', 'pedagang'] as const) assert.ok(WORLD_EVENTS[id]);
});

test('the director waits, never overlaps, respects day/night and cooldowns', () => {
  const d = new WorldEventDirector(makeRng(7));
  // busy (tutorial, cutscene, boss): nothing, however long
  for (let t = 0; t < 3000; t++) assert.equal(d.update(1, { ...NIGHT, busy: true }), null);
  assert.equal(d.active, null);

  const d2 = new WorldEventDirector(makeRng(7));
  let firstAt = -1;
  const seen = new Set<string>();
  let concurrent = 0;
  for (let t = 1; t < 20000; t++) {
    const night = Math.floor(t / 400) % 2 === 1;
    const c = d2.update(1, night ? NIGHT : DAY);
    if (c?.type === 'start') {
      if (firstAt < 0) firstAt = t;
      seen.add(c.def.id);
      if (c.def.night === true) assert.ok(night, `${c.def.id} started by day`);
      if (c.def.night === false) assert.ok(!night, `${c.def.id} started at night`);
      concurrent++;
      assert.equal(concurrent, 1, 'never two at once');
    }
    if (c?.type === 'end') concurrent--;
  }
  assert.ok(firstAt >= FIRST_ROLL_AFTER, `not in the first minutes (${firstAt}s)`);
  assert.equal(seen.size, WORLD_EVENT_IDS.length, `all of them happen eventually: ${[...seen].join(', ')}`);
});

test('an event ends on its own, goes on cooldown, and a night event ends at dawn', () => {
  const d = new WorldEventDirector(makeRng(1));
  d.start('badai');
  let end = null;
  for (let t = 0; t < 1000 && !end; t++) end = d.update(1, DAY);
  assert.ok(end && end.type === 'end' && !end.cleared);
  assert.ok((d.state.cooldowns.badai ?? 0) > 0);

  d.start('purnama');
  const dawn = d.update(1, DAY);
  assert.ok(dawn?.type === 'end', 'the full moon does not outlast the night');
});

test('an invasion is won by defeating every invader, and not before', () => {
  const d = new WorldEventDirector(makeRng(1));
  d.start('invasi');
  const total = d.active!.total!;
  for (let i = 0; i < total - 1; i++) assert.equal(d.noteInvaderDown(), null);
  const won = d.noteInvaderDown();
  assert.ok(won?.type === 'end' && won.cleared);
});

test('the merchant: stock, coins, and nothing after they leave', () => {
  const d = new WorldEventDirector(makeRng(1));
  d.start('pedagang');
  const offer = WORLD_EVENTS.pedagang.effects.merchant!.offers[0];
  assert.deepEqual(d.buy(0, offer.price - 1), { ok: false, reason: 'koin' });
  for (let i = 0; i < offer.stock; i++) assert.ok(d.buy(0, 9999).ok);
  assert.deepEqual(d.buy(0, 9999), { ok: false, reason: 'habis' });
  d.end(false);
  assert.deepEqual(d.buy(1, 9999), { ok: false, reason: 'tidak-ada' });
});

test('the state saves, and a broken save is repaired instead of trusted', () => {
  const d = new WorldEventDirector(makeRng(1));
  d.start('invasi');
  d.noteInvaderDown();
  const back = new WorldEventDirector(makeRng(2));
  back.load(JSON.parse(JSON.stringify(d.toJSON())));
  assert.equal(back.active?.id, 'invasi');
  assert.equal(back.active?.defeated, 1);

  back.load({ active: { id: 'meteor', left: 5 }, next: 'x', cooldowns: { badai: -4, invasi: 1e9 } });
  assert.equal(back.active, null, 'an unknown event is dropped');
  assert.equal(back.state.next, FIRST_ROLL_AFTER);
  assert.equal(back.state.cooldowns.badai, undefined);
  assert.ok(back.state.cooldowns.invasi! <= 3600);
  back.load({ active: { id: 'badai', left: 1e9, element: 'racun' } });
  // read through a function: the assertion above narrowed the property to null for the compiler
  const running = (): typeof back.state.active => back.state.active;
  assert.ok(running()!.left <= WORLD_EVENTS.badai.duration);
  assert.ok(WORLD_EVENTS.badai.effects.element!.pool.includes(running()!.element!), 'an impossible element is replaced');
  assert.ok(ROLL_EVERY > 0);
});

// ───────────────────────── in the game ─────────────────────────

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

type G = Awaited<ReturnType<typeof bootGame>>;
const invaders = (game: G) => game.combat.world.enemies.filter((e) => e.spawnId.startsWith('event_') && !e.dead);

test('an invasion in the game: invaders appear, defeating them all pays out and ends it', async () => {
  const game = await bootGame(env, { continue: false });
  const coins = game.character.coins;
  game.devEvent('invasi');
  const list = invaders(game);
  assert.ok(list.length >= WORLD_EVENTS.invasi.effects.invasion!.count, `${list.length} invaders`);
  for (const e of list) {
    e.hurt(9999, e.x, e.y, 0, 0, { emit: (x) => game.combat.world.events.push(x) });
    game.combat.update(1 / 60, 1 / 60, game.hero);
  }
  for (let i = 0; i < 30; i++) game.combat.update(1 / 60, 1 / 60, game.hero);
  assert.equal(game.events.active, null, 'won');
  assert.ok(game.character.coins >= coins + WORLD_EVENTS.invasi.effects.invasion!.reward.coins, 'paid');
  assert.ok(!Object.keys(game.state.killed).some((k) => k.startsWith('event_')), 'invaders stay out of the respawn table');
  game.dispose();
});

test('the elemental storm changes the weather and puts it back', async () => {
  const game = await bootGame(env, { continue: false });
  const before = game.currentWeather;
  game.devEvent('badai');
  assert.equal(game.currentWeather, 'badai');
  assert.ok(game.events.active?.element);
  game.devEvent(null);
  assert.equal(game.currentWeather, before);
  game.dispose();
});

test('the merchant stands in the plaza, sells for coins, and leaves', async () => {
  const game = await bootGame(env, { continue: false });
  game.devEvent('pedagang');
  assert.ok((game.story as unknown as { merchantHere: boolean }).merchantHere);
  const buy = (game as unknown as { buyFromMerchant(i: number): string }).buyFromMerchant.bind(game);
  assert.match(buy(0), /tidak cukup/);
  game.character.addCoins(500);
  const before = game.character.coins;
  assert.match(buy(0), /masuk tas/);
  assert.equal(game.character.coins, before - WORLD_EVENTS.pedagang.effects.merchant!.offers[0].price);
  assert.ok(game.character.inventory.slots.some((s) => s?.id === WORLD_EVENTS.pedagang.effects.merchant!.offers[0].item));
  game.devEvent(null);
  assert.equal((game.story as unknown as { merchantHere: boolean }).merchantHere, false);
  game.dispose();
});

test('the full moon multiplies EXP; the fog hides the minimap', async () => {
  const game = await bootGame(env, { continue: false });
  const exp0 = game.character.exp + game.character.level * 1e6;
  game.gainExp(10);
  const plain = game.character.exp + game.character.level * 1e6 - exp0;
  game.devEvent('purnama');
  const exp1 = game.character.exp + game.character.level * 1e6;
  game.gainExp(10);
  const moon = game.character.exp + game.character.level * 1e6 - exp1;
  assert.equal(plain, 10);
  assert.equal(moon, 15);

  game.devEvent('kabut');
  const map = (game as unknown as { minimap: { box: { style: { display: string } } } }).minimap.box;
  assert.equal(map.style.display, 'none');
  game.devEvent(null);
  assert.equal(map.style.display, 'block');
  game.dispose();
});

test('a running event survives a save and a reload', async () => {
  const game = await bootGame(env, { continue: false });
  game.devEvent('pedagang');
  game.saveNow(true);
  game.dispose();
  const again = await bootGame(env, { continue: true });
  assert.equal(again.events.active?.id, 'pedagang');
  assert.ok((again.story as unknown as { merchantHere: boolean }).merchantHere, 'the merchant is back in the plaza');
  again.dispose();
});
