/**
 * The game's account and save adapters against the **real server app** (`server/src/app.ts`) on
 * in-memory storage. No mock of the API: `fetch` is `app.inject()` plus a cookie jar per "phone",
 * behaving like a browser does with an HttpOnly cookie scoped to /auth.
 *
 * Covered, as asked: register, login, duplicate usernames, save sync (including two phones and
 * offline) — plus that the client never stores a token and never hangs when the server is gone.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { buildApp } from '../server/src/app';
import { loadConfig } from '../server/src/config';
import { memoryRepos } from '../server/src/repo';
import { RemoteAuth, REMOTE_SESSION_KEY, UNREACHABLE, type HttpFetch } from '../src/core/account/remote';
import { progressScore, RemoteSaveStore, resolveConflict, SaveSync } from '../src/core/sync/saveSync';
import { connectCloud, type CloudDeps } from '../src/cloud';

const BASE = 'https://api.varesa.mom';
let app: Awaited<ReturnType<typeof buildApp>>;
let online = true;
let ipN = 0;

beforeEach(async () => {
  online = true;
  const config = loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: 'k'.repeat(48) });
  app = await buildApp({ config, repos: memoryRepos() });
});

/** One phone: its own cookie jar and address. */
function phone(): { fetch: HttpFetch; jar: Map<string, string> } {
  const jar = new Map<string, string>();
  const ip = `192.0.2.${++ipN}`;
  const fetch: HttpFetch = async (url, init) => {
    if (!online) throw new TypeError('Failed to fetch');
    assert.equal(init.credentials, 'include');
    const path = url.slice(BASE.length);
    const headers: Record<string, string> = { ...init.headers, origin: 'https://game.varesa.mom', 'cf-connecting-ip': ip };
    // like the browser: the cookie is scoped to /auth, and JavaScript never sees it
    if (path.startsWith('/auth') && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: init.method as 'GET', url: path, headers, ...(init.body !== undefined ? { payload: init.body } : {}) });
    for (const c of res.cookies) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) jar.delete(c.name);
      else jar.set(c.name, c.value);
    }
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => res.json() };
  };
  return { fetch, jar };
}

function client(p = phone(), store = new Map<string, string>()) {
  const auth = new RemoteAuth({
    base: BASE,
    fetch: p.fetch,
    now: () => Date.now(),
    read: (k) => store.get(k) ?? null,
    write: (k, v) => (store.set(k, v), true),
    remove: (k) => void store.delete(k),
    timeoutMs: 2000,
  });
  return { auth, store, phone: p };
}

const save = (stage: number, level: number) => ({ v: 2, hero: { x: 100, y: 100, hp: 10 }, quest: { stage, kills: 0 }, character: { level, exp: 0 } });
const hooks = () => ({ backups: [] as unknown[], remoteWon: 0, loggedOut: 0 });
const syncOf = (auth: RemoteAuth, h = hooks()) =>
  new SaveSync(new RemoteSaveStore(auth), { backup: (d) => void h.backups.push(d), remoteWon: () => void h.remoteWon++, loggedOut: () => void h.loggedOut++ });

// ───────────────────────── accounts ─────────────────────────

test('register over the API: logged in, and storage holds who — never a token or a password', async () => {
  const { auth, store, phone: p } = client();
  const r = await auth.register('Penjaga_1', 'sandi-panjang-1');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ok && r.session.role, 'player');
  const everything = [...store.values()].join('\n');
  assert.ok(!everything.includes('sandi-panjang-1'), 'no password');
  assert.ok(!/eyJ|token/i.test(everything), 'no access token in storage');
  assert.ok(p.jar.has('lm_refresh'), 'the refresh token is a cookie the page cannot read');
  assert.deepEqual(Object.keys(JSON.parse(store.get(REMOTE_SESSION_KEY)!)).sort(), ['id', 'name', 'role', 'since']);
  const me = await auth.me();
  assert.deepEqual(me, { username: 'Penjaga_1', role: 'player' });
});

test('login: right password in, wrong password out with an Indonesian message', async () => {
  const first = client();
  await first.auth.register('Masuk', 'sandi-panjang-1');
  const { auth } = client();
  const bad = await auth.login('masuk', 'salah-salah');
  assert.ok(!bad.ok && bad.error === 'salah' && /salah/.test(bad.message));
  const ok = await auth.login('MASUK', 'sandi-panjang-1');
  assert.ok(ok.ok && ok.session.name === 'Masuk');
});

test('duplicate usernames are refused, whatever the case, and the name check says so first', async () => {
  await client().auth.register('Pemain', 'sandi-panjang-1');
  const { auth } = client();
  assert.deepEqual(await auth.checkUsername('pEMAIN'), { available: false, message: 'Nama akun itu sudah dipakai. Pilih nama lain.' });
  assert.equal((await auth.checkUsername('Pemain_Baru')).available, true);
  const dup = await auth.register('PEMAIN', 'sandi-panjang-2');
  assert.ok(!dup.ok && dup.error === 'nama-dipakai');
});

test('the developer role comes from the server only', async () => {
  const { auth, store } = client();
  const r = await auth.register('biasa', 'sandi-panjang-1');
  assert.ok(r.ok && r.session.role === 'player');
  // editing storage does not make anyone a developer: the server's answer does
  store.set(REMOTE_SESSION_KEY, JSON.stringify({ id: 'biasa', name: 'biasa', role: 'dev', since: 0 }));
  assert.deepEqual(await auth.me(), { username: 'biasa', role: 'player' });
  assert.equal(JSON.parse(store.get(REMOTE_SESSION_KEY)!).role, 'player', 'and the cache is corrected');
});

test('a server that cannot be reached says so, instead of "wrong password" or a spinner', async () => {
  online = false;
  const { auth } = client();
  const r = await auth.login('siapa', 'sandi-panjang-1');
  assert.ok(!r.ok && r.error === 'jaringan' && r.message === UNREACHABLE);

  // and a server that accepts the connection but never answers is cut off by the timeout
  const hanging = new RemoteAuth({ base: BASE, fetch: (_u, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))), now: () => 0, read: () => null, write: () => true, remove: () => undefined, timeoutMs: 50 });
  const t0 = Date.now();
  const late = await hanging.login('siapa', 'sandi-panjang-1');
  assert.ok(!late.ok && late.error === 'jaringan');
  assert.ok(Date.now() - t0 < 1000, 'bounded');
});

// ───────────────────────── save sync ─────────────────────────

test('save sync: saves go up with revisions and come down on another phone', async () => {
  const a = client();
  await a.auth.register('Satu', 'sandi-panjang-1');
  const sync = syncOf(a.auth);
  assert.equal(await sync.reconcile(save(1, 3)), null, 'nothing on the server yet: the phone save stays');
  await sync.tick(0, true);
  assert.equal(sync.rev, 1);
  sync.queue(save(1, 4));
  await sync.tick(100, true);
  assert.equal(sync.rev, 2);

  const b = client();
  await b.auth.login('satu', 'sandi-panjang-1');
  const got = (await syncOf(b.auth).reconcile(null)) as ReturnType<typeof save>;
  assert.equal(got.character.level, 4, 'a new phone starts from the server copy');
});

test('two phones: the save further along wins, and the other copy is kept as a backup', async () => {
  const a = client();
  await a.auth.register('Dua', 'sandi-panjang-1');
  const b = client();
  await b.auth.login('dua', 'sandi-panjang-1');
  const ha = hooks();
  const hb = hooks();
  const sa = syncOf(a.auth, ha);
  const sb = syncOf(b.auth, hb);

  sa.queue(save(2, 8));
  await sa.tick(0, true);
  // phone B, older progress, never synced: conflict, and it loses
  sb.queue(save(1, 3));
  await sb.tick(0, true);
  assert.equal(hb.remoteWon, 1);
  assert.equal(sb.paused, true, 'B stops pushing until it reloads the newer save');
  assert.equal((hb.backups[0] as ReturnType<typeof save>).character.level, 3, "B's copy is kept");

  // phone A plays on further while B's server copy is stale for A: A wins and writes over it
  sa.queue(save(3, 10));
  await sa.tick(10, true);
  const c = client();
  await c.auth.login('dua', 'sandi-panjang-1');
  const now = (await syncOf(c.auth).reconcile(null)) as ReturnType<typeof save>;
  assert.equal(now.quest.stage, 3);
});

test('offline: saves wait on the phone and go up when the connection is back', async () => {
  const a = client();
  await a.auth.register('Tiga', 'sandi-panjang-1');
  const sync = syncOf(a.auth);
  online = false;
  sync.queue(save(1, 2));
  await sync.tick(0, true);
  assert.equal(sync.offlineCount, 1);
  assert.ok(sync.hasPending);
  online = true;
  await sync.tick(100, true);
  assert.equal(sync.hasPending, false);
  assert.equal(sync.rev, 1);
});

test('an expired access token is refreshed through the cookie without the player noticing', async () => {
  const a = client();
  await a.auth.register('Empat', 'sandi-panjang-1');
  // throw away the in-memory access token, as a page reload would
  (a.auth as unknown as { access: unknown }).access = null;
  const sync = syncOf(a.auth);
  sync.queue(save(1, 1));
  await sync.tick(0, true);
  assert.equal(sync.rev, 1, 'refreshed and pushed');
});

// ───────────────────────── connecting after login ─────────────────────────

function cloudDeps(local: unknown = null) {
  const log = { notices: [] as string[], adopted: null as unknown, mirrored: false };
  const deps: CloudDeps = {
    loadLocal: () => local as never,
    adopt: (d) => void (log.adopted = d),
    mirror: (fn) => void (log.mirrored = fn !== null),
    backup: () => undefined,
    notice: (t) => void log.notices.push(t),
    every: () => () => undefined,
    onOnline: () => undefined,
    onHide: () => undefined,
    now: () => Date.now(),
  };
  return { deps, log };
}

test('after login: the role and the newer save come from the server; offline plays on from the phone', async () => {
  const a = client();
  const reg = await a.auth.register('Lima', 'sandi-panjang-1');
  assert.ok(reg.ok);
  const s = syncOf(a.auth);
  s.queue(save(2, 7));
  await s.tick(0, true);

  const b = client();
  const login = await b.auth.login('lima', 'sandi-panjang-1');
  assert.ok(login.ok);
  const { deps, log } = cloudDeps(save(1, 2));
  const res = await connectCloud(b.auth, login.session, deps);
  assert.equal(res.role, 'player');
  assert.equal((log.adopted as ReturnType<typeof save>).character.level, 7, "the server's further-along save is adopted");
  assert.ok(log.mirrored, 'and every local save is mirrored from now on');

  online = false;
  const off = cloudDeps(save(1, 2));
  const res2 = await connectCloud(b.auth, login.session, off.deps, 500);
  assert.equal(res2.offline, true);
  assert.equal(res2.role, null, 'no developer mode on a role nobody confirmed');
  assert.match(off.log.notices[0], /tidak bisa dihubungi/);
});

test('a session the server has ended sends the player back to the login form', async () => {
  const a = client();
  const reg = await a.auth.register('Enam', 'sandi-panjang-1');
  assert.ok(reg.ok);
  // logged out elsewhere: this phone's cookie is revoked, and it has no access token
  a.phone.jar.set('lm_refresh', 'dicabut');
  (a.auth as unknown as { access: unknown }).access = null;
  const { deps } = cloudDeps();
  const res = await connectCloud(a.auth, reg.session, deps);
  assert.match(res.relogin ?? '', /masuk lagi/);
});

test('the conflict rule: progress first, time only breaks a tie', () => {
  assert.ok(progressScore({ ...save(4, 5), bossDefeated: true }) > progressScore(save(3, 30)));
  assert.ok(progressScore(save(2, 1)) > progressScore(save(1, 30)));
  assert.equal(resolveConflict(save(1, 5), { data: save(1, 5), rev: 3, updatedAt: 1000 }, 2000).winner, 'local', 'same progress, later write');
  assert.equal(resolveConflict(save(1, 5), { data: save(1, 5), rev: 3, updatedAt: 3000 }, 2000).winner, 'remote');
  assert.equal(resolveConflict(save(1, 4), { data: save(1, 5), rev: 3, updatedAt: 0 }, 9e12).winner, 'remote', 'a clock cannot beat progress');
});

test('a save the server refuses is reported once and not retried forever', async () => {
  const a = client();
  await a.auth.register('Curang', 'sandi-panjang-1');
  const said: string[] = [];
  const sync = new SaveSync(new RemoteSaveStore(a.auth), { backup: () => undefined, remoteWon: () => undefined, loggedOut: () => undefined, rejected: (r) => void said.push(r) });
  const edited = { ...save(1, 3), character: { level: 3, exp: 0, inventory: { slots: [{ id: 'pedang_dewa', count: 1, rarity: 'mythic' }], equipped: {} } } };
  sync.queue(edited);
  await sync.tick(0, true);
  sync.queue(edited);
  await sync.tick(100, true);
  assert.deepEqual(said, ['unknown_item'], 'told once');
  assert.equal(sync.rejectedCount, 2);
  assert.equal(sync.hasPending, false, 'not queued again and again');
});
