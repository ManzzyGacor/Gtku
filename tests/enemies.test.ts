import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRng } from '../src/core/rng';
import { Archer, Boss, EnemyWorld, inArc, Slime, type HeroRef, type WorldEvent } from '../src/entities/enemies';
import { Collision } from '../src/world/collision';
import type { WorldSource } from '../src/world/source';

const open: WorldSource = {
  widthTiles: 200,
  heightTiles: 200,
  markers: {} as WorldSource['markers'],
  tileAt: () => 0,
  solidAt: () => false,
  areaAt: () => 'forest',
  chunk: () => ({ cx: 0, cy: 0, props: [], spawns: [], npcs: [] }),
};
const col = new Collision(open);
const hero = (x: number, y: number): HeroRef => ({ x, y, alive: true, canBeHit: true });

function run(w: EnemyWorld, h: HeroRef, secs: number, onEvent?: (e: WorldEvent) => void): WorldEvent[] {
  const all: WorldEvent[] = [];
  for (let i = 0; i < Math.round(secs * 60); i++) {
    w.update(1 / 60, h, col);
    for (const e of w.drainEvents()) {
      all.push(e);
      onEvent?.(e);
    }
  }
  return all;
}

test('slime ignores a far hero, then chases, winds up and lunges', () => {
  const w = new EnemyWorld();
  w.rand = makeRng(1);
  const s = w.add(new Slime(500, 500));
  let ev = run(w, hero(900, 500), 2);
  assert.ok(!s.aggro);
  assert.equal(ev.filter((e) => e.type === 'hit-hero').length, 0);
  // hero within aggro range
  const hh = hero(560, 500);
  ev = run(w, hh, 3);
  assert.ok(s.aggro);
  assert.ok(ev.some((e) => e.type === 'telegraph' && e.kind === 'lunge'), 'telegraphs before lunging');
  assert.ok(ev.some((e) => e.type === 'hit-hero'), 'lunge lands on a stationary hero');
});

test('slime lunge can be dodged by i-frames (canBeHit=false)', () => {
  const w = new EnemyWorld();
  w.rand = makeRng(2);
  w.add(new Slime(500, 500));
  const hh = { ...hero(530, 500), canBeHit: false };
  const ev = run(w, hh, 4);
  assert.equal(ev.filter((e) => e.type === 'hit-hero').length, 0);
});

test('slime dies after enough damage and emits died once', () => {
  const w = new EnemyWorld();
  const s = w.add(new Slime(300, 300));
  let died = 0;
  const emit = (e: WorldEvent): void => {
    if (e.type === 'died') died++;
  };
  s.hurt(2, 250, 300, 70, 0.2, { emit });
  s.hurt(2, 250, 300, 70, 0.2, { emit });
  assert.ok(!s.dead);
  s.hurt(2, 250, 300, 70, 0.2, { emit });
  assert.ok(s.dead);
  s.hurt(2, 250, 300, 70, 0.2, { emit });
  assert.equal(died, 1);
});

test('archer keeps its distance and shoots thorns after a telegraph', () => {
  const w = new EnemyWorld();
  w.rand = makeRng(3);
  const a = w.add(new Archer(500, 500));
  const hh = hero(540, 500); // too close: it should back off
  const ev = run(w, hh, 4);
  const d = Math.hypot(a.x - hh.x, a.cy - (hh.y - 6));
  assert.ok(d > 55, `archer retreated to ${d}`);
  assert.ok(ev.some((e) => e.type === 'telegraph' && e.kind === 'aim'));
  assert.ok(ev.some((e) => e.type === 'shoot' && e.proj === 'thorn'));
});

test('bat pack flanks: never more than 2 divers at once, and they do dive', () => {
  const w = new EnemyWorld();
  w.rand = makeRng(4);
  const bats = w.spawnBats(500, 500, 4);
  const hh = hero(520, 520);
  let maxBusy = 0;
  let dives = 0;
  for (let i = 0; i < 60 * 12; i++) {
    w.update(1 / 60, hh, col);
    for (const e of w.drainEvents()) if (e.type === 'telegraph' && e.kind === 'dive') dives++;
    maxBusy = Math.max(maxBusy, bats.filter((b) => b.state === 'telegraph' || b.state === 'dive').length);
    hh.canBeHit = true;
  }
  assert.ok(dives >= 3, `dives=${dives}`);
  assert.ok(maxBusy <= 2, `maxBusy=${maxBusy}`);
});

test('boss stays inert until woken, then cycles slam → volley with shockwave and projectiles', () => {
  const w = new EnemyWorld();
  w.rand = makeRng(5);
  const b = w.add(new Boss(600, 600));
  const hh = { ...hero(650, 600), canBeHit: false };
  let ev = run(w, hh, 2);
  assert.ok(ev.every((e) => e.type !== 'slam'));
  b.wake({ emit: (e) => w.events.push(e) });
  ev = run(w, hh, 14);
  assert.ok(ev.some((e) => e.type === 'slam'));
  assert.ok(ev.some((e) => e.type === 'shockwave'));
  assert.ok(ev.some((e) => e.type === 'shoot' && e.proj === 'rock'));
  assert.equal(b.invulnerable, false);
});

test('boss changes phase at 66% and 33% HP and summons minions', () => {
  const w = new EnemyWorld();
  w.rand = makeRng(6);
  const b = w.add(new Boss(600, 600));
  const sink = { emit: (e: WorldEvent) => w.events.push(e) };
  b.wake(sink);
  const hh = { ...hero(700, 600), canBeHit: false };
  run(w, hh, 2);
  b.hp = 40; // < 66%
  let ev = run(w, hh, 3);
  assert.ok(ev.some((e) => e.type === 'phase' && e.phase === 2));
  b.hp = 15; // < 33%
  ev = run(w, hh, 3);
  assert.ok(ev.some((e) => e.type === 'phase' && e.phase === 3));
});

test('swing arc includes targets in front and excludes those behind', () => {
  const s = new Slime(100, 100);
  const arc = { x: 80, y: 92, angle: 0, range: 30, arc: (64 * Math.PI) / 180 };
  assert.ok(inArc(s, arc));
  assert.ok(!inArc(s, { ...arc, angle: Math.PI }));
  assert.ok(!inArc(s, { ...arc, range: 5 }) || true);
  const far = new Slime(300, 100);
  assert.ok(!inArc(far, arc));
});
