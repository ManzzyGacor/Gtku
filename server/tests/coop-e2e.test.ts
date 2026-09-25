/**
 * Two game clients (`src/core/coop/client.ts`) against the real server over real WebSockets: the
 * whole co-op path, the way two phones would use it. Kept in server/tests because the `ws` client
 * lives in the server's dependencies.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import WebSocket from 'ws';
import { buildApp, hashPassword } from '../src/app';
import { loadConfig } from '../src/config';
import { memoryRepos, type Repos } from '../src/repo';
import type { RoomManager } from '../src/coop/rooms';
import { CoopClient, type SocketLike } from '../../src/core/coop/client';
import { BTN_ATTACK } from '../../shared/coop/protocol';

let app: Awaited<ReturnType<typeof buildApp>>;
let repos: Repos;
let url = '';
const sockets: WebSocket[] = [];

beforeEach(async () => {
  repos = memoryRepos();
  app = await buildApp({ config: loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: 'e'.repeat(48) }), repos, coopSeed: 11 });
  await app.listen({ host: '127.0.0.1', port: 0 });
  url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`;
});
afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  await app.close();
});

async function account(name: string, level = 6): Promise<string> {
  const u = await repos.users.create({ username: name, usernameLower: name, passwordHash: await hashPassword('sandi-panjang-1'), role: 'player', createdAt: new Date(), lastLogin: null });
  await repos.characters.insert({
    userId: u.id,
    slot: 0,
    saveVersion: 2,
    rev: 1,
    data: { v: 2, hero: { x: 1, y: 1, hp: 20 }, character: { level, exp: 0, coins: 0, inventory: { slots: [], equipped: {} }, elements: { unlocked: [], primary: null, secondary: null } } },
    level,
    updatedAt: new Date(),
    clientUpdatedAt: null,
    createdAt: new Date(),
  });
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: name, password: 'sandi-panjang-1' }, headers: { origin: 'https://game.varesa.mom', 'cf-connecting-ip': `10.0.0.${name.length}` } });
  return r.json().accessToken as string;
}

function client(token: string): CoopClient {
  return new CoopClient({
    url,
    makeSocket: (u) => {
      const ws = new WebSocket(u, { origin: 'https://game.varesa.mom' });
      sockets.push(ws);
      const s = ws as unknown as SocketLike;
      return s;
    },
    token: async () => token,
    now: () => performance.now() / 1000,
    later: (fn, ms) => void setTimeout(fn, ms),
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(15);
  }
}

/** Drive a client's frames for `ms`, as the game loop would. */
async function run(c: CoopClient, ms: number, x = 0, y = 0, aim = 0, buttons = 0): Promise<void> {
  const end = Date.now() + ms;
  let last = performance.now();
  while (Date.now() < end) {
    await wait(16);
    const now = performance.now();
    c.frame((now - last) / 1000, x, y, aim, buttons);
    last = now;
  }
}

test('two players: a room by code, moving together, prediction agrees with the server', async () => {
  const a = client(await account('andi'));
  const b = client(await account('budi'));
  a.go({ t: 'create' });
  await until(() => !!a.room);
  b.go({ t: 'join', code: a.room!.code });
  await until(() => (b.room?.players.length ?? 0) === 2 && (a.room?.players.length ?? 0) === 2);
  b.ready(true);
  await until(() => a.room!.players.every((p) => p.ready || p.host));
  a.start();
  await until(() => a.room?.phase === 'fight' && b.room?.phase === 'fight');

  // A walks right for a second; B keeps idle
  await Promise.all([run(a, 1000, 1, 0), run(b, 1000)]);
  await Promise.all([run(a, 400), run(b, 400)]);
  const srv = a.serverPosition!;
  const mine = a.myPosition;
  assert.ok(Math.hypot(mine.x - srv.x, mine.y - srv.y) < 12, `prediction ${JSON.stringify(mine)} vs server ${JSON.stringify(srv)}`);
  // B sees A where the server has A (interpolated, a little behind)
  const seen = b.draw().players.find((p) => !p.you)!;
  assert.ok(Math.hypot(seen.x - srv.x, seen.y - srv.y) < 16, `B draws A at ${seen.x},${seen.y}; server ${srv.x},${srv.y}`);
  assert.ok(srv.x > 40, 'A actually moved');
});

test('a dropped connection resumes into the same room', async () => {
  const a = client(await account('cici'));
  a.go({ t: 'create' });
  await until(() => !!a.room);
  const code = a.room!.code;
  // the phone loses its connection
  sockets[sockets.length - 1].terminate();
  await until(() => a.status === 'reconnecting');
  await until(() => a.status === 'online' && a.room?.players[0]?.connected === true, 5000);
  assert.equal(a.room!.code, code);
});

test('beating the boss: the server rolls the loot, writes it into the save, and sends it', async () => {
  const a = client(await account('dedi', 12));
  a.go({ t: 'create' });
  await until(() => !!a.room);
  a.start();
  await until(() => a.room?.phase === 'fight');
  await run(a, 200);
  // the test's shortcut to the end of the fight: the fight itself is played in tests/coopsim.test.ts
  const rooms = (app as unknown as { coopRooms: RoomManager }).coopRooms;
  const sim = rooms.rooms.get(a.room!.code)!.sim!;
  sim.boss.hp = 1;
  const me = [...sim.players.values()][0];
  me.x = sim.boss.x;
  me.y = sim.boss.y + 20;
  await run(a, 800, 0, 0, -90, BTN_ATTACK);
  await until(() => !!a.result);
  assert.equal(a.result!.won, true);
  assert.ok(a.result!.save && a.result!.save.rev === 2, 'the new save comes with the result');
  assert.equal(a.room?.phase, 'won');
});
