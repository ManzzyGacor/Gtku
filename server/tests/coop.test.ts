/**
 * Co-op rooms (server/src/coop): the rules with fake connections and a fake clock, then the real
 * WebSocket door over a real port.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import WebSocket from 'ws';
import { RoomManager, type Conn } from '../src/coop/rooms';
import { memoryRepos, type Repos, type UserDoc } from '../src/repo';
import { buildApp, hashPassword } from '../src/app';
import { loadConfig } from '../src/config';
import { EMPTY_ROOM_GRACE, RECONNECT_GRACE, TICK_HZ, type ServerMsg } from '../../shared/coop/protocol';

let clock = 0;
let repos: Repos;
let rooms: RoomManager;
let n = 0;

beforeEach(() => {
  clock = 1_000_000;
  repos = memoryRepos();
  rooms = new RoomManager({ repos, now: () => clock, seed: 7 });
});

function user(name: string, role: 'player' | 'dev' = 'player'): UserDoc {
  return { id: `u${++n}`, username: name, usernameLower: name.toLowerCase(), passwordHash: '', role, createdAt: new Date(0), lastLogin: null };
}

function conn(): Conn & { got: ServerMsg[]; closed: boolean; last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined } {
  const got: ServerMsg[] = [];
  const c = {
    got,
    closed: false,
    send: (m: ServerMsg) => void got.push(m),
    close: () => void (c.closed = true),
    last: <T extends ServerMsg['t']>(t: T) => [...got].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined,
  };
  return c;
}

async function lobby(names: string[]) {
  const people = names.map((name) => {
    const c = conn();
    const s = rooms.connect(c, user(name));
    return { c, s };
  });
  await rooms.handle(people[0].s, { t: 'create' });
  const code = people[0].c.last('room')!.code;
  for (const p of people.slice(1)) await rooms.handle(p.s, { t: 'join', code });
  return { people, code };
}

const tick = async (seconds: number) => {
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    clock += 1000 / TICK_HZ;
    await rooms.tick();
  }
};

test('a private room: create, join by code, everyone sees everyone', async () => {
  const { people, code } = await lobby(['satu', 'dua', 'tiga']);
  assert.match(code, /^[A-Z2-9]{5}$/);
  const view = people[2].c.last('room')!;
  assert.deepEqual(view.players.map((p) => p.name), ['satu', 'dua', 'tiga']);
  assert.equal(view.players[0].host, true);
  assert.equal(view.public, false);
});

test('room rules: full at four, no joining a fight, only the host starts, everyone ready first', async () => {
  const { people, code } = await lobby(['a1', 'a2', 'a3', 'a4']);
  const fifth = conn();
  await rooms.handle(rooms.connect(fifth, user('a5')), { t: 'join', code });
  assert.equal(fifth.last('err')!.code, 'room_full');

  await rooms.handle(people[1].s, { t: 'start' });
  assert.equal(people[1].c.last('err')!.code, 'not_host');
  await rooms.handle(people[0].s, { t: 'start' });
  assert.equal(people[0].c.last('err')!.code, 'not_ready');
  for (const p of people.slice(1)) await rooms.handle(p.s, { t: 'ready', on: true });
  await rooms.handle(people[0].s, { t: 'start' });
  assert.equal(people[0].c.last('room')!.phase, 'fight');

  await rooms.handle(people[3].s, { t: 'leave' });
  const late = conn();
  await rooms.handle(rooms.connect(late, user('telat')), { t: 'join', code });
  assert.equal(late.last('err')!.code, 'room_started');
  const nope = conn();
  await rooms.handle(rooms.connect(nope, user('salah')), { t: 'join', code: 'ZZZZZ' });
  assert.equal(nope.last('err')!.code, 'room_not_found');
});

test('a developer account plays only in private rooms', async () => {
  const devConn = conn();
  const dev = rooms.connect(devConn, user('manzzy', 'dev'));
  await rooms.handle(dev, { t: 'quick' });
  assert.equal(devConn.last('err')!.code, 'dev_private_only');

  const p = conn();
  await rooms.handle(rooms.connect(p, user('publik')), { t: 'quick' });
  const pub = p.last('room')!;
  assert.equal(pub.public, true);
  await rooms.handle(dev, { t: 'join', code: pub.code });
  assert.equal(devConn.last('err')!.code, 'dev_private_only');

  await rooms.handle(dev, { t: 'create' });
  assert.equal(devConn.last('room')!.public, false, 'a private room of their own is fine');
});

test('quick match fills a public room before making another', async () => {
  const a = conn();
  const b = conn();
  await rooms.handle(rooms.connect(a, user('q1')), { t: 'quick' });
  await rooms.handle(rooms.connect(b, user('q2')), { t: 'quick' });
  assert.equal(a.last('room')!.code, b.last('room')!.code);
});

test('a dropped player can come back with the room token within the grace time, not after', async () => {
  const { people, code } = await lobby(['tetap', 'putus']);
  const token = people[1].c.last('room')!.rtoken;
  rooms.disconnect(people[1].s);
  assert.equal(people[0].c.last('room')!.players[1].connected, false);

  await tick(RECONNECT_GRACE / 2);
  const back = conn();
  const s2 = rooms.connect(back, people[1].s.user);
  await rooms.handle(s2, { t: 'resume', code, rtoken: token });
  assert.equal(back.last('room')!.players[1].connected, true, 'back in');

  rooms.disconnect(s2);
  await tick(RECONNECT_GRACE + 1);
  const late = conn();
  await rooms.handle(rooms.connect(late, people[1].s.user), { t: 'resume', code, rtoken: token });
  assert.equal(late.last('err')!.code, 'resume_failed');
  assert.equal(people[0].c.last('room')!.players.length, 1, 'their place is gone');
});

test('another player cannot take over a place with someone else’s token', async () => {
  const { people, code } = await lobby(['pemilik', 'lain']);
  const token = people[0].c.last('room')!.rtoken;
  const thief = conn();
  await rooms.handle(rooms.connect(thief, user('pencuri')), { t: 'resume', code, rtoken: token });
  assert.equal(thief.last('err')!.code, 'resume_failed');
});

test('an empty room closes after its grace time', async () => {
  const { people, code } = await lobby(['sendiri']);
  rooms.disconnect(people[0].s);
  await tick(EMPTY_ROOM_GRACE / 2);
  assert.ok(rooms.rooms.has(code));
  await tick(EMPTY_ROOM_GRACE);
  assert.equal(rooms.rooms.has(code), false);
});

test('a fight: snapshots with the input acknowledged, and loot written into the save by the server', async () => {
  const { people, code } = await lobby(['pejuang', 'teman']);
  // both have a save on the server; loot goes into it
  for (const p of people)
    await repos.characters.insert({
      userId: p.s.user.id,
      slot: 0,
      saveVersion: 2,
      rev: 3,
      data: { v: 2, hero: { x: 1, y: 1, hp: 10 }, character: { level: 8, exp: 0, coins: 10, inventory: { slots: [], equipped: {} }, elements: { unlocked: [], primary: null, secondary: null } } },
      level: 8,
      updatedAt: new Date(clock),
      clientUpdatedAt: null,
      createdAt: new Date(clock),
    });
  await rooms.handle(people[1].s, { t: 'ready', on: true });
  await rooms.handle(people[0].s, { t: 'start' });
  await rooms.handle(people[0].s, { t: 'in', s: 5, x: 50, y: 0, a: 0, b: 0 });
  await tick(0.5);
  const snap = people[0].c.last('snap')!;
  assert.equal(snap.ack, 5, 'the input the server applied');
  assert.equal(snap.p.length, 2);
  assert.ok(snap.b && snap.b[3] > 0);
  // bytes per snapshot, for the data budget
  assert.ok(JSON.stringify(snap).length < 900, `${JSON.stringify(snap).length} bytes`);

  // finish the boss off (the test's shortcut; the fight itself is covered in tests/coopsim.test.ts)
  const room = rooms.rooms.get(code)!;
  room.sim!.boss.hp = 1;
  const p = room.sim!.players.get(people[0].s.pid)!;
  p.x = room.sim!.boss.x;
  p.y = room.sim!.boss.y + 20;
  await rooms.handle(people[0].s, { t: 'in', s: 6, x: 0, y: 0, a: -90, b: 1 });
  await tick(1);
  const result = people[0].c.last('result')!;
  assert.equal(result.won, true);
  assert.equal(result.items.length, 2);
  const saved = await repos.characters.get(people[0].s.user.id, 0);
  assert.equal(saved!.rev, 4, 'the server wrote the loot into the save');
  const slots = (saved!.data as { character: { inventory: { slots: { id: string }[] } } }).character.inventory.slots;
  assert.ok(slots.some((s) => s?.id === result.items[0].id));
  assert.deepEqual(result.save?.rev, 4, 'and handed the new save to the game');
});

// ───────────────────────── the real socket ─────────────────────────

test('the WebSocket door: origin, auth, a room, bad and flooding messages', async () => {
  const r = memoryRepos();
  const app = await buildApp({ config: loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: 'w'.repeat(48) }), repos: r });
  await r.users.create({ username: 'soket', usernameLower: 'soket', passwordHash: await hashPassword('sandi-panjang-1'), role: 'player', createdAt: new Date(), lastLogin: null });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'soket', password: 'sandi-panjang-1' }, headers: { origin: 'https://game.varesa.mom' } });
  const token = login.json().accessToken as string;
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const url = `ws://127.0.0.1:${port}/ws`;
  try {
    // wrong origin: refused at the upgrade
    const refused = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { origin: 'https://jahat.contoh' });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
    });
    assert.equal(refused, 403);

    const open = () =>
      new Promise<{ ws: WebSocket; msgs: ServerMsg[]; closed: Promise<number> }>((resolve) => {
        const ws = new WebSocket(url, { origin: 'https://game.varesa.mom' });
        const msgs: ServerMsg[] = [];
        const closed = new Promise<number>((done) => ws.on('close', (code) => done(code)));
        ws.on('message', (d) => msgs.push(JSON.parse(String(d)) as ServerMsg));
        ws.on('open', () => resolve({ ws, msgs, closed }));
      });
    const until = async (msgs: ServerMsg[], t: string) => {
      for (let i = 0; i < 100 && !msgs.some((m) => m.t === t); i++) await new Promise((r2) => setTimeout(r2, 20));
      return msgs.find((m) => m.t === t);
    };

    // a bad token
    const bad = await open();
    bad.ws.send(JSON.stringify({ t: 'auth', token: 'palsu', v: 1 }));
    assert.equal(await bad.closed, 4001);

    // the real thing
    const good = await open();
    good.ws.send(JSON.stringify({ t: 'auth', token, v: 1 }));
    assert.ok(await until(good.msgs, 'hello'));
    good.ws.send(JSON.stringify({ t: 'create' }));
    const room = (await until(good.msgs, 'room')) as Extract<ServerMsg, { t: 'room' }>;
    assert.match(room.code, /^[A-Z2-9]{5}$/);
    good.ws.send(JSON.stringify({ t: 'in', s: 1, x: 0, y: 0, a: 0, b: 0, dmg: 999 }));
    assert.ok(await until(good.msgs, 'err'), 'a message with an extra field is refused');
    // a flood is cut off
    for (let i = 0; i < 80; i++) good.ws.send(JSON.stringify({ t: 'ping', c: i }));
    assert.equal(await good.closed, 4008);
  } finally {
    await app.close();
  }
});
