/**
 * Two weapons and the quick swap (docs/OVERHAUL.md §4 "Senjata").
 * Pedang and Busur are implemented in full; the rest exist as data only, and this file holds that
 * line — nothing may half-equip an unimplemented weapon.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { HeroCore, type HeroEvent, type HeroInput, type ShootEvent } from '../src/core/entities/HeroCore';
import { BOW_SHOTS, fullChargeTime, IMPLEMENTED_WEAPONS, shotForCharge, WEAPONS } from '../src/core/combat/weapons';
import { Collision } from '../src/core/world/collision';
import { GeneratedWorld } from '../src/core/world/worldgen';

const world = new GeneratedWorld();
const collision = new Collision(world);
const IDLE: HeroInput = { mx: 0, my: 0, attack: false, dodge: false, skill: false };

function hero(): HeroCore {
  const start = world.markers.playerStart;
  const h = new HeroCore(start.x, start.y);
  h.invuln = 0;
  return h;
}

function run(h: HeroCore, frames: number, inp: Partial<HeroInput> = {}): HeroEvent[] {
  const out: HeroEvent[] = [];
  for (let i = 0; i < frames; i++) {
    h.update(1 / 60, { ...IDLE, ...inp }, collision, 1);
    out.push(...h.events.splice(0));
  }
  return out;
}

const shots = (evs: HeroEvent[]): ShootEvent[] => evs.filter((e): e is ShootEvent => e.type === 'shoot');

test('exactly the two weapons in the plan are implemented; the rest are data only', () => {
  assert.deepEqual([...IMPLEMENTED_WEAPONS].sort(), ['busur', 'pedang']);
  for (const [id, def] of Object.entries(WEAPONS)) {
    assert.equal(def.id, id);
    assert.ok(def.name.length > 0);
    assert.ok(def.swapTime > 0 && def.swapTime < 0.5, `${id} swap must feel quick`);
    if (def.kind === 'ranged' && def.implemented) assert.ok(def.shots?.length, `${id} needs shots`);
  }
  assert.equal(WEAPONS.pedang.kind, 'melee');
  assert.equal(WEAPONS.busur.kind, 'ranged');
});

test('the hero carries two slots and swaps between them quickly', () => {
  const h = hero();
  assert.deepEqual(h.loadout, ['pedang', 'busur']);
  assert.equal(h.weapon, 'pedang');
  assert.equal(h.isRanged, false);

  assert.equal(h.swapWeapon(), true);
  assert.equal(h.state, 'swap');
  assert.equal(h.weapon, 'busur');
  assert.equal(h.isRanged, true);

  // the swap is short, and you keep walking through it
  const x0 = h.x;
  run(h, Math.ceil(WEAPONS.busur.swapTime * 60) + 2, { mx: 1, my: 0 });
  assert.equal(h.state, 'free');
  assert.ok(h.x > x0, 'the hero keeps moving while swapping');
  assert.equal(h.swapWeapon(), true);
  assert.equal(h.weapon, 'pedang');
});

test('a swap cannot interrupt the active frames of a swing, but may interrupt recovery', () => {
  const h = hero();
  run(h, 1, { attack: true });
  assert.equal(h.state, 'attack');
  assert.equal(h.swapWeapon(), false, 'not mid-swing');

  // once the blade has passed, the swap goes through
  run(h, Math.ceil((h.attackDef.windup + h.attackDef.active) * 60) + 1);
  if (h.state === 'attack') {
    assert.equal(h.swapWeapon(), true, 'recovery may be interrupted');
    assert.equal(h.weapon, 'busur');
  }

  // and never during a dodge
  const g = hero();
  run(g, 1, { dodge: true });
  assert.equal(g.state, 'roll');
  assert.equal(g.swapWeapon(), false);
});

test('a tapped bow fires the quick shot straight away', () => {
  const h = hero();
  h.swapWeapon();
  run(h, 12);
  const evs = run(h, 20, { attack: true });
  const fired = shots(evs);
  assert.equal(fired.length >= 1, true, 'the tap produced an arrow');
  assert.equal(fired[0].shot, 'cepat');
  assert.equal(fired[0].pierce, BOW_SHOTS[0].pierce);
  assert.ok(fired[0].speed > 100, 'arrows actually travel');
  assert.ok(fired[0].charge < 0.3, 'a tap is not a charged shot');
});

test('holding the bow charges it, and releasing fires the stronger shot', () => {
  const h = hero();
  h.swapWeapon();
  run(h, 12);

  // hold to full charge
  run(h, Math.ceil(fullChargeTime() * 60) + 4, { attackHeld: true });
  assert.ok(h.charge > 0.95, `charge reached ${h.charge.toFixed(2)}`);
  assert.equal(h.state, 'free', 'drawing does not fire by itself');

  // release
  const evs = run(h, 20);
  const fired = shots(evs);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].shot, 'tembus', 'a full draw gives the piercing shot');
  assert.ok(fired[0].dmg > BOW_SHOTS[0].dmg, 'and it hits harder');
  assert.ok(fired[0].pierce > BOW_SHOTS[0].pierce, 'and goes through more enemies');
  assert.equal(h.charge, 0, 'the string is released');
});

test('the shot table maps charge to shot without gaps', () => {
  assert.equal(shotForCharge(0).id, 'cepat');
  assert.equal(shotForCharge(0.3).id, 'cepat');
  assert.equal(shotForCharge(0.6).id, 'terisi');
  assert.equal(shotForCharge(1).id, 'tembus');
  // monotonic: more charge never gives a weaker shot
  let prev = 0;
  for (let c = 0; c <= 1.0001; c += 0.05) {
    const s = shotForCharge(c);
    assert.ok(s.dmg >= prev, `charge ${c.toFixed(2)} gave weaker damage`);
    prev = s.dmg;
  }
  for (const s of BOW_SHOTS) {
    assert.ok(s.draw > 0 && s.recover > 0 && s.dmg > 0 && s.speed > 0 && s.pierce >= 1);
  }
});

test('a dodge cancels a bow shot, and the aim can still be steered while drawing', () => {
  const h = hero();
  h.swapWeapon();
  run(h, 12);
  h.aim = 0;
  run(h, 1, { attack: true });
  assert.equal(h.state, 'shoot');
  run(h, 1, { mx: 0, my: 1 });
  assert.notEqual(h.aim, 0, 'the draw can be steered');

  const g = hero();
  g.swapWeapon();
  run(g, 12);
  run(g, 1, { attack: true });
  run(g, 1, { dodge: true });
  assert.equal(g.state, 'roll', 'a dodge bails out of a shot');
});

test('auto-aim steers an arrow at the nearest target', () => {
  const h = hero();
  h.swapWeapon();
  run(h, 12);
  // pretend there is an enemy up and to the right
  h.aimAssist = () => Math.PI / 4;
  h.aim = 0;
  const evs = run(h, 20, { attack: true });
  const fired = shots(evs);
  assert.equal(fired.length >= 1, true);
  assert.ok(Math.abs(fired[0].angle - Math.PI / 4) < 1e-6, 'the arrow leaves on the assisted angle');
});
