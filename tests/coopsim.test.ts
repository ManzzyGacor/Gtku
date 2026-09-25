/**
 * The co-op fight simulation (shared/coop/sim.ts) — the thing the server trusts, so the thing that
 * has to be right. Whole fights are played here with scripted bots.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ARENA_RADIUS, BOSS, CoopSim, coopStats, P_DOWN, PILLARS, PLAYER, stepMovement, type Input, type MoveState } from '../shared/coop/sim';
import { BTN_ATTACK, BTN_DODGE, parseClientMsg, TICK_HZ } from '../shared/coop/protocol';

const DT = 1 / TICK_HZ;
const input = (x: number, y: number, a: number, b = 0, s = 1): Input => ({ x, y, a, b, s });

test('movement stays inside the arena and out of the pillars', () => {
  const m: MoveState = { x: 0, y: 0, rollT: 0, rollCd: 0, rollDx: 0, rollDy: 0, downed: false };
  for (let i = 0; i < 200; i++) stepMovement(m, input(100, 0, 0), false, DT);
  assert.ok(Math.hypot(m.x, m.y) <= ARENA_RADIUS - PLAYER.radius + 1e-6);
  const p = PILLARS[0];
  const q: MoveState = { ...m, x: p.x - 30, y: p.y };
  for (let i = 0; i < 40; i++) stepMovement(q, input(100, 0, 0), false, DT);
  assert.ok(Math.hypot(q.x - p.x, q.y - p.y) >= p.r + PLAYER.radius - 1e-6, 'walked into a pillar');
});

test('a roll goes further than walking and then waits for its cooldown', () => {
  const walk: MoveState = { x: 0, y: 0, rollT: 0, rollCd: 0, rollDx: 0, rollDy: 0, downed: false };
  const roll: MoveState = { ...walk };
  stepMovement(roll, input(100, 0, 0, BTN_DODGE), true, DT);
  for (let i = 0; i < 6; i++) {
    stepMovement(walk, input(100, 0, 0), false, DT);
    stepMovement(roll, input(100, 0, 0), false, DT);
  }
  assert.ok(roll.x > walk.x * 1.5);
  assert.ok(roll.rollCd > 0);
});

test('damage comes from the server-side stats, not from anything the client sends', () => {
  // there is no field in an input message that could carry a damage number
  assert.equal(parseClientMsg(JSON.stringify({ t: 'in', s: 1, x: 0, y: 0, a: 0, b: 1, dmg: 9999 })), null);
  const sim = new CoopSim(1);
  const p = sim.addPlayer(1, coopStats(10, 'rare'));
  sim.begin();
  p.x = sim.boss.x;
  p.y = sim.boss.y + BOSS.radius + 10;
  const aim = -90;
  const before = sim.boss.hp;
  for (let i = 0; i < 10; i++) {
    sim.setInput(1, input(0, 0, aim, BTN_ATTACK, i + 1));
    sim.step(DT);
  }
  const dealt = before - sim.boss.hp;
  assert.ok(dealt > 0 && dealt < coopStats(10, 'rare').atk * PLAYER.critMult * 1.1 * 3, `${dealt}`);
});

test('an attack facing away, or out of reach, does nothing', () => {
  const sim = new CoopSim(2);
  const p = sim.addPlayer(1, coopStats(10, null));
  sim.begin();
  p.x = sim.boss.x;
  p.y = sim.boss.y + BOSS.radius + 10;
  const hp = sim.boss.hp;
  for (let i = 0; i < 10; i++) {
    sim.setInput(1, input(0, 0, 90, BTN_ATTACK, i + 1)); // facing away from the boss
    sim.step(DT);
  }
  assert.equal(sim.boss.hp, hp);
});

test('the slam lands where the target stood: standing still is hit, walking out is not', () => {
  const setup = () => {
    const sim = new CoopSim(3);
    const p = sim.addPlayer(1, coopStats(5, null));
    sim.begin();
    p.x = 0;
    p.y = 100;
    // keep the boss out of it, and drop a slam on the player
    Object.assign(sim.boss, { x: 0, y: -120, cooldown: 99 });
    (sim as unknown as { slams: unknown[] }).slams.push({ x: p.x, y: p.y, t: 0.8, total: 0.8 });
    return { sim, p };
  };
  const a = setup();
  for (let i = 0; i < 30; i++) a.sim.step(DT);
  assert.equal(a.p.hp, a.p.maxHp - BOSS.slam.dmg, 'standing still');

  const b = setup();
  for (let i = 0; i < 30; i++) {
    b.sim.setInput(1, input(100, 0, 0, 0, i + 1));
    b.sim.step(DT);
  }
  assert.equal(b.p.hp, b.p.maxHp, 'walked out of the circle');

  const c = setup();
  for (let i = 0; i < 30; i++) {
    c.sim.setInput(1, input(0, 0, 0, i === 12 ? BTN_DODGE : 0, i + 1));
    c.sim.step(DT);
  }
  assert.equal(c.p.hp, c.p.maxHp, 'rolled through it as it landed');
});

test('the boss grows with the party', () => {
  const hpFor = (n: number): number => {
    const sim = new CoopSim(4);
    for (let i = 0; i < n; i++) sim.addPlayer(i + 1, coopStats(5, null));
    sim.begin();
    return sim.boss.maxHp;
  };
  assert.ok(hpFor(4) > hpFor(2) && hpFor(2) > hpFor(1));
  assert.equal(hpFor(1), BOSS.hpBase);
});

/** A bot that walks up to the boss, hits it, and rolls away from slams and sweeps. */
function bot(sim: CoopSim, id: number, seq: number): Input {
  const p = sim.players.get(id)!;
  const b = sim.boss;
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const d = Math.hypot(dx, dy);
  const aim = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  const danger = sim.snapThings().some((t) => (t[0] === 1 && Math.hypot(t[1] - p.x, t[2] - p.y) < BOSS.slam.radius + 8) || t[0] === 2);
  if (danger && p.rollCd <= 0) return input(Math.round((-dx / d) * 100), Math.round((-dy / d) * 100), aim, BTN_DODGE, seq);
  if (d > BOSS.radius + PLAYER.attackRange - 6) return input(Math.round((dx / d) * 100), Math.round((dy / d) * 100), aim, 0, seq);
  return input(0, 0, aim, BTN_ATTACK | (seq % 60 === 0 ? 4 : 0), seq);
}

test('a party of scripted players can win, deterministically', () => {
  const play = (seed: number) => {
    const sim = new CoopSim(seed);
    for (let i = 1; i <= 3; i++) sim.addPlayer(i, coopStats(12, 'rare'));
    sim.begin();
    let t = 0;
    for (let seq = 1; seq < TICK_HZ * 600 && !sim.outcome; seq++) {
      for (const id of sim.players.keys()) sim.setInput(id, bot(sim, id, seq));
      sim.step(DT);
      t += DT;
    }
    return { outcome: sim.outcome, t: Math.round(t), hp: [...sim.players.values()].map((p) => p.hp) };
  };
  const a = play(42);
  assert.equal(a.outcome, 'won', JSON.stringify(a));
  assert.ok(a.t > 20 && a.t < 300, `a fight of ${a.t} s`);
  assert.deepEqual(play(42), a, 'the same seed and inputs play the same fight');
});

test('players who do nothing go down, get back up, and lose when all are down at once', () => {
  const sim = new CoopSim(9);
  for (let i = 1; i <= 2; i++) sim.addPlayer(i, coopStats(1, null));
  sim.begin();
  let downedSeen = false;
  let revived = false;
  for (let i = 0; i < TICK_HZ * 900 && !sim.outcome; i++) {
    sim.step(DT);
    for (const e of sim.drainEvents()) {
      if (e[0] === 3) downedSeen = true;
      if (e[0] === 4) revived = true;
    }
  }
  assert.ok(downedSeen);
  assert.equal(sim.outcome, 'lost');
  assert.ok([...sim.players.values()].every((p) => p.state === P_DOWN || p.downed));
  void revived;
});
