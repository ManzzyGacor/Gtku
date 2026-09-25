/**
 * The whole API over `app.inject()`: real routes, real validation, real argon2id, real JWTs and
 * real rate limits, on in-memory repositories (same semantics as the MongoDB ones, unique indexes
 * included). No database, no network, no secrets — the config is built from a fake env here.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, REFRESH_COOKIE } from '../src/app';
import { loadConfig, redact } from '../src/config';
import { memoryRepos, type Repos } from '../src/repo';

const ORIGIN = 'https://game.varesa.mom';
/*
 * A made-up URI with a made-up password, assembled at runtime so no credential-shaped string sits
 * in the repository (secret scanners, and the rule that nothing like one is ever committed).
 */
const FAKE_URI = ['mongodb+srv', '://', 'pengguna', ':', 'rahasia-sekali', '@', 'contoh.invalid/db'].join('');

let clock = Date.UTC(2026, 8, 25);
let app: FastifyInstance;
let repos: Repos;
let ipN = 0;

async function fresh(env: Record<string, string> = {}): Promise<void> {
  repos = memoryRepos();
  const config = loadConfig({ MONGODB_URI: FAKE_URI, JWT_SECRET: 'x'.repeat(48), ...env });
  app = await buildApp({ config, repos, now: () => clock });
}

beforeEach(async () => {
  clock = Date.UTC(2026, 8, 25);
  await fresh();
});

/** Each test speaks from its own address, so the rate limits of one do not bleed into the next. */
const ip = (): string => `203.0.113.${++ipN % 250}`;

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload: body as object, headers: { origin: ORIGIN, 'cf-connecting-ip': headers['cf-connecting-ip'] ?? ip(), ...headers } });
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }): string | undefined => res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;

// ───────────────────────── register ─────────────────────────

test('register: 201 with an access token and a locked-down refresh cookie; the password is only a hash', async () => {
  const res = await post('/auth/register', { username: 'Penjaga_1', password: 'sandi-panjang-1', email: 'saya@contoh.id' });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(typeof body.accessToken, 'string');
  assert.deepEqual(body.user, { username: 'Penjaga_1', role: 'player' });
  assert.ok(!res.body.includes('sandi-panjang-1') && !res.body.includes('argon2'), 'nothing secret in the reply');

  const c = res.cookies.find((x) => x.name === REFRESH_COOKIE)!;
  assert.ok(c.httpOnly && c.secure && c.sameSite === 'Strict' && c.path === '/auth', JSON.stringify(c));

  const stored = await repos.users.byLower('penjaga_1');
  assert.ok(stored!.passwordHash.startsWith('$argon2id$'), 'argon2id');
  assert.ok(!stored!.passwordHash.includes('sandi-panjang-1'));
  assert.equal(stored!.email, 'saya@contoh.id');
});

test('usernames are unique regardless of case, and availability can be checked first', async () => {
  const check = async (u: string) => (await app.inject({ method: 'GET', url: `/auth/check-username?username=${u}` })).json();
  assert.deepEqual(await check('Pemain'), { available: true });
  assert.equal((await post('/auth/register', { username: 'Pemain', password: 'sandi-panjang-1' })).statusCode, 201);
  assert.deepEqual(await check('pEMAIN'), { available: false, reason: 'username_taken' });
  const dup = await post('/auth/register', { username: 'PEMAIN', password: 'sandi-panjang-2' });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'username_taken');
  assert.deepEqual(await check('a b'), { available: false, reason: 'invalid_username' });
});

test('every input is validated', async () => {
  const bad = async (body: unknown, error: string) => {
    const r = await post('/auth/register', body);
    assert.equal(r.statusCode, 400, `${JSON.stringify(body)} → ${r.body}`);
    assert.equal(r.json().error, error);
  };
  await bad({ username: 'ab', password: 'sandi-panjang-1' }, 'invalid_username');
  await bad({ username: 'a'.repeat(17), password: 'sandi-panjang-1' }, 'invalid_username');
  await bad({ username: 'nama-strip', password: 'sandi-panjang-1' }, 'invalid_username');
  await bad({ username: 'nama', password: 'pendek' }, 'weak_password');
  await bad({ username: 'nama', password: 'sandi-panjang-1', email: 'bukan email' }, 'invalid_email');
  await bad({ username: 'nama', password: 'sandi-panjang-1', role: 'dev' }, 'invalid_input');
  await bad({ username: 'nama' }, 'invalid_input');
});

// ───────────────────────── login ─────────────────────────

test('login: right password in, wrong password and unknown names out with the same answer', async () => {
  await post('/auth/register', { username: 'Masuk', password: 'sandi-panjang-1' });
  const ok = await post('/auth/login', { username: 'masuk', password: 'sandi-panjang-1' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().user, { username: 'Masuk', role: 'player' });
  assert.ok(cookieOf(ok));
  assert.ok((await repos.users.byLower('masuk'))!.lastLogin);

  const wrong = await post('/auth/login', { username: 'masuk', password: 'salah-salah' });
  const nobody = await post('/auth/login', { username: 'tidakada', password: 'salah-salah' });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.json(), nobody.json(), 'no way to tell which names exist');
});

test('login is rate limited per account', async () => {
  await post('/auth/register', { username: 'Target', password: 'sandi-panjang-1' });
  const from = { 'cf-connecting-ip': '198.51.100.7' };
  const codes: number[] = [];
  // sequential on purpose: the limiter counts them in order
  // oxlint-disable-next-line no-await-in-loop
  for (let i = 0; i < 6; i++) codes.push((await post('/auth/login', { username: 'target', password: `salah-${i}-xx` }, from)).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
  const r = await post('/auth/login', { username: 'target', password: 'sandi-panjang-1' }, from);
  assert.equal(r.json().error, 'rate_limited', 'even the right password waits');
});

test('register is rate limited per address', async () => {
  const from = { 'cf-connecting-ip': '198.51.100.9' };
  const codes: number[] = [];
  // oxlint-disable-next-line no-await-in-loop
  for (let i = 0; i < 6; i++) codes.push((await post('/auth/register', { username: `akun_${i}`, password: 'sandi-panjang-1' }, from)).statusCode);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
});

// ───────────────────────── roles ─────────────────────────

// ───────────────────────── tokens ─────────────────────────

test('access tokens expire; the refresh cookie rotates; a reused refresh token ends the login', async () => {
  const reg = await post('/auth/register', { username: 'Sesi', password: 'sandi-panjang-1' });
  const access = reg.json().accessToken as string;
  clock += 16 * 60 * 1000;
  const expired = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${access}` } });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.json().error, 'token_expired');

  const first = cookieOf(reg)!;
  const r1 = await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${first}` });
  assert.equal(r1.statusCode, 200, r1.body);
  const second = cookieOf(r1)!;
  assert.notEqual(second, first, 'rotated');
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${r1.json().accessToken}` } })).statusCode, 200);

  // the old one again, after the two-tab grace window: someone copied it — both are now dead
  clock += 60 * 1000;
  assert.equal((await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${first}` })).statusCode, 401);
  assert.equal((await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${second}` })).statusCode, 401);
});

test('cookie endpoints refuse other origins, and logout ends the session', async () => {
  const reg = await post('/auth/register', { username: 'Keluar', password: 'sandi-panjang-1' });
  const c = cookieOf(reg)!;
  const evil = await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${c}`, origin: 'https://jahat.contoh' });
  assert.equal(evil.statusCode, 403);
  assert.equal((await post('/auth/logout', {}, { cookie: `${REFRESH_COOKIE}=${c}` })).statusCode, 204);
  assert.equal((await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${c}` })).statusCode, 401);
});

test('CORS answers only the game', async () => {
  const pre = (origin: string) => app.inject({ method: 'OPTIONS', url: '/auth/login', headers: { origin, 'access-control-request-method': 'POST' } });
  const good = await pre(ORIGIN);
  assert.equal(good.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(good.headers['access-control-allow-credentials'], 'true');
  const bad = await pre('https://jahat.contoh');
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});

// ───────────────────────── save ─────────────────────────

const save = (level: number, stage = 1) => ({ v: 2, hero: { x: 100, y: 120, hp: 10 }, quest: { stage, kills: 0 }, character: { level, exp: 0 } });

async function login(name: string) {
  const r = await post('/auth/register', { username: name, password: 'sandi-panjang-1' });
  return { authorization: `Bearer ${r.json().accessToken as string}` };
}

test('save sync: first write, next write, and a stale write gets 409 with the current copy', async () => {
  const auth = await login('Penyimpan');
  assert.equal((await app.inject({ method: 'GET', url: '/save', headers: auth })).statusCode, 204);

  const put = (body: unknown) => app.inject({ method: 'PUT', url: '/save', headers: { ...auth, 'cf-connecting-ip': ip() }, payload: body as object });
  const a = await put({ data: save(3), baseRev: 0, clientUpdatedAt: clock });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().rev, 1);
  clock += 1000;
  const b = await put({ data: save(4), baseRev: 1 });
  assert.equal(b.json().rev, 2);

  // another phone still thinks it is at rev 1
  const stale = await put({ data: save(2), baseRev: 1 });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.rev, 2);
  assert.equal(stale.json().current.data.character.level, 4);
  assert.ok(stale.json().current.updatedAt > 0, 'with the server time, for the client to show');

  const got = (await app.inject({ method: 'GET', url: '/save', headers: auth })).json();
  assert.deepEqual({ rev: got.rev, saveVersion: got.saveVersion, level: got.data.character.level }, { rev: 2, saveVersion: 2, level: 4 });
});

test('save validation: format version, size, shape — and nobody reads anybody else', async () => {
  const auth = await login('Validasi');
  const put = (data: unknown, baseRev = 0) => app.inject({ method: 'PUT', url: '/save', headers: { ...auth, 'cf-connecting-ip': ip() }, payload: { data, baseRev } });
  assert.equal((await put({ ...save(1), v: 9 })).statusCode, 422);
  assert.equal((await put({ v: 2, hero: { x: 'a', y: 1, hp: 1 } })).statusCode, 400);
  assert.equal((await put({ ...save(1), pad: 'x'.repeat(300 * 1024) })).statusCode, 413);
  assert.equal((await put(save(1))).statusCode, 200);

  const other = await login('Lain');
  assert.equal((await app.inject({ method: 'GET', url: '/save', headers: other })).statusCode, 204, "someone else's save is not visible");
  assert.equal((await app.inject({ method: 'GET', url: '/save' })).statusCode, 401);
});

// ───────────────────────── operations ─────────────────────────

test('health, and a server error never shows its internals', async () => {
  const h = await app.inject({ method: 'GET', url: '/health' });
  assert.deepEqual(h.json(), { ok: true, db: 'ok' });

  repos.users.byLower = async () => {
    throw new Error(`gagal menghubungi ${FAKE_URI}`);
  };
  const r = await post('/auth/login', { username: 'siapa', password: 'sandi-panjang-1' });
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.json(), { error: 'server_error' });
  assert.ok(!r.body.includes('rahasia-sekali') && !r.body.includes('mongodb'));
});

test('config errors name the variable, never a value; logs have connection strings removed', () => {
  assert.throws(() => loadConfig({ JWT_SECRET: 'x'.repeat(40) }), /MONGODB_URI/);
  assert.throws(() => loadConfig({ MONGODB_URI: FAKE_URI, JWT_SECRET: 'abc123' }), (e: Error) => /JWT_SECRET/.test(e.message) && !e.message.includes('abc123'));
  const second = ['mongodb', '://', 'a', ':', 'b', '@', 'c:27017'].join('');
  const line = redact(`MongoServerSelectionError: gagal ${FAKE_URI} dan ${second}`, [FAKE_URI]);
  assert.ok(!line.includes('rahasia-sekali') && !line.includes('a:b@'), line);
});
