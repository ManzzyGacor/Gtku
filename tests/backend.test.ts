/**
 * The server adapters (`core/account/remote.ts`, `core/sync/saveSync.ts`) against an in-memory fake
 * of the API documented in docs/BACKEND.md. The fake is the contract: if the document and this file
 * disagree, one of them is wrong.
 *
 * The session is a cookie the fake keeps in its own jar — like a browser keeps an HttpOnly cookie —
 * and the tests check that the client never stores it, or anything else secret.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { RemoteAuth, REMOTE_SESSION_KEY, type HttpFetch } from '../src/core/account/remote';
import { progressScore, RemoteSaveStore, resolveConflict, SaveSync } from '../src/core/sync/saveSync';

interface FakeServer {
  fetch: HttpFetch;
  /** Another device: its own cookie jar against the same server. */
  device(): HttpFetch;
  online: boolean;
  saves: Map<string, { data: unknown; rev: number; updatedAt: number }>;
}

function fakeServer(): FakeServer {
  const users = new Map<string, { password: string }>();
  const sessions = new Map<string, string>();
  const saves = new Map<string, { data: unknown; rev: number; updatedAt: number }>();
  let n = 0;
  const server = { online: true, saves } as FakeServer;
  const reply = (status: number, body?: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => (body === undefined ? null : body) });
  const device = (): HttpFetch => {
    const jar = { cookie: '' };
    return async (url, init) => {
      if (!server.online) throw new TypeError('Failed to fetch');
      assert.equal(init.credentials, 'include', 'every request carries the cookie');
      const path = url.replace(/^https:\/\/api\.test/, '');
      const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const user = sessions.get(jar.cookie);
      if (path === '/v1/auth/register' && init.method === 'POST') {
        const name = String(body.username);
        if (users.has(name)) return reply(409, { error: 'username_taken' });
        if (String(body.password).length < 8) return reply(400, { error: 'weak_password' });
        users.set(name, { password: String(body.password) });
        jar.cookie = `sid${++n}`;
        sessions.set(jar.cookie, name);
        return reply(201, { user: { id: name, name } });
      }
      if (path === '/v1/auth/login' && init.method === 'POST') {
        const u = users.get(String(body.username));
        if (!u || u.password !== body.password) return reply(401, { error: 'invalid_credentials' });
        jar.cookie = `sid${++n}`;
        sessions.set(jar.cookie, String(body.username));
        return reply(200, { user: { id: body.username, name: body.username } });
      }
      if (path === '/v1/auth/logout') {
        sessions.delete(jar.cookie);
        return reply(204);
      }
      if (path === '/v1/save') {
        if (!user) return reply(401, { error: 'unauthorized' });
        const cur = saves.get(user);
        if (init.method === 'GET') return cur ? reply(200, cur) : reply(204);
        if (init.method === 'PUT') {
          if ((cur?.rev ?? 0) !== body.baseRev) return reply(409, { error: 'conflict', current: cur });
          const next = { data: body.data, rev: (cur?.rev ?? 0) + 1, updatedAt: Date.now() };
          saves.set(user, next);
          return reply(200, { rev: next.rev });
        }
      }
      return reply(404, { error: 'not_found' });
    };
  };
  server.fetch = device();
  server.device = device;
  return server;
}

function auth(fetch: HttpFetch, store = new Map<string, string>()) {
  return {
    store,
    auth: new RemoteAuth({
      base: 'https://api.test',
      fetch,
      now: () => 1,
      read: (k) => store.get(k) ?? null,
      write: (k, v) => (store.set(k, v), true),
      remove: (k) => void store.delete(k),
    }),
  };
}

const save = (stage: number, level: number, worldTime = 0) => ({ v: 2, quest: { stage, kills: 0 }, character: { level, exp: 0 }, worldTime });

test('register and login over the API; the client stores who, never a secret', async () => {
  const s = fakeServer();
  const { auth: a, store } = auth(s.fetch);
  const r = await a.register('Penjaga', 'sandi-panjang-1', 'saya@contoh.id');
  assert.ok(r.ok && r.session.kind === 'remote');
  const stored = JSON.parse(store.get(REMOTE_SESSION_KEY)!);
  assert.deepEqual(Object.keys(stored).sort(), ['id', 'kind', 'name', 'since']);
  const everything = [...store.values()].join('\n');
  assert.ok(!everything.includes('sandi-panjang-1') && !/sid\d/.test(everything), 'no password, no session id in storage');

  const dup = await a.register('penjaga', 'sandi-panjang-2');
  assert.ok(!dup.ok && dup.error === 'nama-dipakai', 'server errors become Indonesian messages');
  const bad = await a.login('penjaga', 'salah-salah');
  assert.ok(!bad.ok && bad.error === 'salah');
  await a.logout();
  assert.equal(a.current(), null);
  assert.ok((await a.login('penjaga', 'sandi-panjang-1')).ok);
});

test('offline is reported as offline, not as a wrong password', async () => {
  const s = fakeServer();
  s.online = false;
  const { auth: a } = auth(s.fetch);
  const r = await a.login('siapa', 'sandi-panjang-1');
  assert.ok(!r.ok && r.error === 'jaringan');
});

test('saves go up with revisions, and a push waits for its interval', async () => {
  const s = fakeServer();
  await auth(s.fetch).auth.register('satu', 'sandi-panjang-1');
  const sync = new SaveSync(new RemoteSaveStore('https://api.test', s.fetch), { backup: () => undefined, remoteWon: () => undefined, loggedOut: () => undefined });
  sync.queue(save(1, 3));
  await sync.tick(100);
  assert.equal(sync.rev, 1);
  sync.queue(save(1, 4));
  await sync.tick(105);
  assert.equal(sync.rev, 1, 'not yet: pushes are spaced out');
  await sync.tick(125);
  assert.equal(sync.rev, 2);
  assert.equal((s.saves.get('satu')!.data as ReturnType<typeof save>).character.level, 4);
});

test('offline pushes are kept and sent later; nothing is lost', async () => {
  const s = fakeServer();
  await auth(s.fetch).auth.register('dua', 'sandi-panjang-1');
  const sync = new SaveSync(new RemoteSaveStore('https://api.test', s.fetch), { backup: () => undefined, remoteWon: () => undefined, loggedOut: () => undefined });
  s.online = false;
  sync.queue(save(1, 2));
  await sync.tick(0, true);
  assert.equal(sync.offlineCount, 1);
  assert.ok(sync.hasPending);
  s.online = true;
  await sync.tick(100, true);
  assert.equal(sync.hasPending, false);
  assert.equal(s.saves.get('dua')!.rev, 1);
});

test('two phones: the one further along wins, and the other copy is kept as a backup', async () => {
  const s = fakeServer();
  const phoneA = s.fetch;
  const phoneB = s.device();
  await auth(phoneA).auth.register('tiga', 'sandi-panjang-1');
  await auth(phoneB).auth.login('tiga', 'sandi-panjang-1');
  const backups: unknown[] = [];
  let remoteWon = 0;
  const hooks = { backup: (d: unknown) => void backups.push(d), remoteWon: () => void remoteWon++, loggedOut: () => undefined };
  const a = new SaveSync(new RemoteSaveStore('https://api.test', phoneA), hooks);
  const b = new SaveSync(new RemoteSaveStore('https://api.test', phoneB), hooks);

  a.queue(save(2, 8));
  await a.tick(0, true); // rev 1 on the server
  // phone B has older progress and has never synced: its push conflicts, and it loses
  b.queue(save(1, 3));
  await b.tick(0, true);
  assert.equal(remoteWon, 1, 'B is told the server copy is further along');
  assert.equal(b.paused, true, 'and stops pushing until it reloads');
  assert.equal((s.saves.get('tiga')!.data as ReturnType<typeof save>).quest.stage, 2, "A's progress is untouched");
  assert.equal((backups[0] as ReturnType<typeof save>).character.level, 3, "B's copy is kept");

  // phone A later plays offline on an old revision while the server moved on: it is further along, so it wins
  s.saves.set('tiga', { data: save(2, 9), rev: 5, updatedAt: 0 });
  a.queue(save(3, 12));
  await a.tick(10, true);
  assert.equal(a.rev, 5, 'adopts the server revision…');
  await a.tick(11, true);
  assert.equal((s.saves.get('tiga')!.data as ReturnType<typeof save>).quest.stage, 3, '…and writes over it');
});

test('logging in on a new phone brings the server save down; a fresh account takes the phone save up', async () => {
  const s = fakeServer();
  await auth(s.fetch).auth.register('empat', 'sandi-panjang-1');
  const hooks = { backup: () => undefined, remoteWon: () => undefined, loggedOut: () => undefined };
  const first = new SaveSync(new RemoteSaveStore('https://api.test', s.fetch), hooks);
  assert.equal(await first.reconcile(save(1, 5)), null, 'nothing on the server yet: keep the local one');
  assert.ok(first.hasPending, 'and it is queued to go up');
  await first.tick(0, true);

  const other = s.device();
  await auth(other).auth.login('empat', 'sandi-panjang-1');
  const second = new SaveSync(new RemoteSaveStore('https://api.test', other), hooks);
  const got = (await second.reconcile(null)) as ReturnType<typeof save>;
  assert.equal(got.character.level, 5, 'the new phone starts from the server copy');
});

test('an expired session asks for a login instead of failing silently', async () => {
  const s = fakeServer();
  let out = 0;
  const sync = new SaveSync(new RemoteSaveStore('https://api.test', s.device()), { backup: () => undefined, remoteWon: () => undefined, loggedOut: () => void out++ });
  sync.queue(save(1, 1));
  await sync.tick(0, true);
  assert.equal(out, 1);
  assert.ok(sync.hasPending, 'the save is still waiting');
});

test('progress beats recency: the boss beats everything, then quest stage, then level', () => {
  assert.ok(progressScore({ ...save(4, 5), bossDefeated: true }) > progressScore(save(3, 30)));
  assert.ok(progressScore(save(2, 1)) > progressScore(save(1, 30)));
  assert.ok(progressScore(save(1, 6)) > progressScore(save(1, 5, 99999)));
  assert.equal(resolveConflict(save(1, 5), { data: save(1, 5), rev: 3, updatedAt: 0 }).winner, 'remote', 'a tie goes to the server');
});
