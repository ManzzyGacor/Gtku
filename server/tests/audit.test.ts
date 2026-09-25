/**
 * The security and bug audit of server/ (docs/PROGRESS.md "Audit backend"). Each test here is a
 * finding: it failed against the code as it was, and passes after the fix. The file is kept so none
 * of them can come back.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp, REFRESH_COOKIE, SlidingLimiter } from '../src/app';
import { loadConfig } from '../src/config';
import { memoryRepos, type Repos } from '../src/repo';
import { connectMongo } from '../src/repo.mongo';

const ORIGIN = 'https://game.varesa.mom';
const SECRET = 'q'.repeat(48);
let clock = Date.UTC(2026, 8, 26);
let app: Awaited<ReturnType<typeof buildApp>>;
let repos: Repos;
let n = 0;

beforeEach(async () => {
  clock = Date.UTC(2026, 8, 26);
  repos = memoryRepos();
  app = await buildApp({ config: loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: SECRET }), repos, now: () => clock });
});

const ip = (): string => `198.18.0.${++n % 250}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: body as object, headers: { origin: ORIGIN, 'cf-connecting-ip': ip(), ...headers } });
const cookieOf = (res: { cookies: { name: string; value: string }[] }): string => res.cookies.find((c) => c.name === REFRESH_COOKIE)!.value;

async function account(name = `akun${++n}`) {
  const r = await post('/auth/register', { username: name, password: 'sandi-panjang-1' });
  assert.equal(r.statusCode, 201, r.body);
  return { token: r.json().accessToken as string, cookie: cookieOf(r), name };
}

test('a body that is not JSON is a 4xx, not a 500', async () => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: 'username=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN } });
  assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${r.statusCode} ${r.body}`);
  const broken = await app.inject({ method: 'POST', url: '/auth/login', payload: '{"username":', headers: { 'content-type': 'application/json', origin: ORIGIN } });
  assert.equal(broken.statusCode, 400);
  assert.deepEqual(broken.json(), { error: 'invalid_input' });
});

test('an absurd clientUpdatedAt is refused, not stored as an invalid date', async () => {
  const { token } = await account();
  const r = await app.inject({
    method: 'PUT',
    url: '/save',
    headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': ip() },
    payload: { data: { v: 2, hero: { x: 1, y: 1, hp: 1 } }, baseRev: 0, clientUpdatedAt: 1e20 },
  });
  assert.equal(r.statusCode, 400, r.body);
});

test('two tabs refreshing with the same cookie at once do not log the player out', async () => {
  const { cookie } = await account();
  const refresh = () => post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${cookie}` });
  const [a, b] = await Promise.all([refresh(), refresh()]);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(b.statusCode, 200, `the second tab: ${b.body}`);
  // and the login is still alive afterwards
  const again = await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${cookieOf(b)}` });
  assert.equal(again.statusCode, 200);
});

test('reusing a rotated token long after the rotation still ends the login (theft)', async () => {
  const { cookie } = await account();
  const first = await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${cookie}` });
  clock += 5 * 60 * 1000;
  assert.equal((await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${cookie}` })).statusCode, 401);
  assert.equal((await post('/auth/refresh', {}, { cookie: `${REFRESH_COOKIE}=${cookieOf(first)}` })).statusCode, 401);
});

test('after logout the access token no longer opens anything', async () => {
  const { token, cookie } = await account();
  const me = () => app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal((await me()).statusCode, 200);
  await post('/auth/logout', {}, { cookie: `${REFRESH_COOKIE}=${cookie}` });
  assert.equal((await me()).statusCode, 401, 'a logged-out session is not "a valid token" for 15 more minutes');
});

test('forged tokens are refused: wrong secret, alg none, unknown user', async () => {
  const { token } = await account();
  const me = (t: string) => app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${t}` } });
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const wrong = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('x'.repeat(48)));
  assert.equal((await me(wrong)).statusCode, 401);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${token.split('.')[1]}.`;
  assert.equal((await me(none)).statusCode, 401);
  const ghost = await new SignJWT({ ...payload, sub: 'tidak-ada' }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(SECRET));
  assert.equal((await me(ghost)).statusCode, 401);
  const bare = await Promise.all(['/save', '/auth/me'].map((url) => app.inject({ method: 'GET', url })));
  for (const r of bare) assert.equal(r.statusCode, 401, 'no token, no entry');
  assert.equal((await app.inject({ method: 'PUT', url: '/save', payload: { data: {}, baseRev: 0 } })).statusCode, 401);
});

test('concurrent writes of the same revision: exactly one wins', async () => {
  const { token } = await account();
  const put = (level: number) =>
    app.inject({ method: 'PUT', url: '/save', headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': ip() }, payload: { data: { v: 2, hero: { x: 1, y: 1, hp: 1 }, character: { level } }, baseRev: 0 } });
  const codes = (await Promise.all([put(1), put(2), put(3)])).map((r) => r.statusCode).sort();
  assert.deepEqual(codes, [200, 409, 409]);
});

test('unknown routes answer in the same shape as every other error', async () => {
  const r = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(r.statusCode, 404);
  assert.deepEqual(r.json(), { error: 'not_found' });
});

test('answers carrying tokens or saves are never cached', async () => {
  const r = await post('/auth/register', { username: 'cache_uji', password: 'sandi-panjang-1' });
  assert.match(String(r.headers['cache-control']), /no-store/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('the per-account login limiter cannot be used to fill memory', () => {
  const lim = new SlidingLimiter(5, 60_000);
  for (let i = 0; i < 120_000; i++) lim.allow(`ip|nama${i}`, 1000);
  assert.ok(lim.size <= 60_000, `${lim.size} keys held`);
});

test('/health is rate limited (it touches the database)', async () => {
  const codes: number[] = [];
  // oxlint-disable-next-line no-await-in-loop
  for (let i = 0; i < 70; i++) codes.push((await app.inject({ method: 'GET', url: '/health', headers: { 'cf-connecting-ip': '198.19.0.1' } })).statusCode);
  assert.ok(codes.includes(429));
});

test('a Mongo connection is closed when setup fails after connecting', async () => {
  let closed = false;
  const fake = {
    connect: async () => undefined,
    close: async () => void (closed = true),
    db: () => ({
      collection: () => ({
        createIndex: async () => {
          throw new Error('index gagal');
        },
      }),
    }),
  };
  await assert.rejects(connectMongo('mongodb://tidak-dipakai', 'x', () => fake as never));
  assert.equal(closed, true);
});
