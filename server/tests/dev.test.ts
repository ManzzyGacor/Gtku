/**
 * Developer mode, enforced by the server (docs/BACKEND.md "Mode Pengembang"):
 * protected names, the dev endpoint, grants applied server-side, and the save rules that stop a
 * player from giving themselves items by editing the save in the browser.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import argon2 from 'argon2';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { memoryRepos, type Repos } from '../src/repo';
import { PROTECTED_USERNAMES } from '../../shared/api';
import { PROGRESS_LIMITS } from '../../shared/saveRules';

const ORIGIN = 'https://game.varesa.mom';
let clock = Date.UTC(2026, 8, 27);
let app: Awaited<ReturnType<typeof buildApp>>;
let repos: Repos;
let n = 0;

beforeEach(async () => {
  clock = Date.UTC(2026, 8, 27);
  repos = memoryRepos();
  app = await buildApp({ config: loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: 'd'.repeat(48) }), repos, now: () => clock });
});

const ip = (): string => `100.64.0.${++n % 250}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: body as object, headers: { origin: ORIGIN, 'cf-connecting-ip': ip(), ...headers } });

async function player(name = `pemain${++n}`) {
  const r = await post('/auth/register', { username: name, password: 'sandi-panjang-1' });
  assert.equal(r.statusCode, 201, r.body);
  const auth = { authorization: `Bearer ${r.json().accessToken as string}` };
  /** A fresh token, as the game gets after its access token expires. */
  const relogin = async (): Promise<void> => {
    const l = await post('/auth/login', { username: name, password: 'sandi-panjang-1' });
    auth.authorization = `Bearer ${l.json().accessToken as string}`;
  };
  return Object.assign(auth, { relogin });
}

/** The developer account, made the way the VPS script makes it: straight into the database. */
async function developer() {
  await repos.users.create({
    username: 'manzzy',
    usernameLower: 'manzzy',
    passwordHash: await argon2.hash('sandi-pengembang-1', { type: argon2.argon2id }),
    role: 'dev',
    createdAt: new Date(clock),
    lastLogin: null,
  });
  const r = await post('/auth/login', { username: 'manzzy', password: 'sandi-pengembang-1' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().user.role, 'dev');
  return { authorization: `Bearer ${r.json().accessToken as string}` };
}

const save = (character: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  v: 2,
  hero: { x: 10, y: 10, hp: 12 },
  character: { level: 1, exp: 0, coins: 0, inventory: { slots: [], equipped: {} }, elements: { unlocked: [], primary: null, secondary: null }, ...character },
  ...extra,
});
const put = (auth: { authorization: string }, data: unknown, baseRev: number) =>
  app.inject({ method: 'PUT', url: '/save', headers: { authorization: auth.authorization, 'cf-connecting-ip': ip() }, payload: { data: data as object, baseRev } });
const dev = (auth: { authorization?: string }, action: unknown, s?: unknown) =>
  app.inject({ method: 'POST', url: '/dev/action', headers: { ...(auth.authorization ? { authorization: auth.authorization } : {}), 'cf-connecting-ip': ip() }, payload: { action: action as object, ...(s ? { save: s as object } : {}) } });

// ───────────────────────── protected names ─────────────────────────

test('protected names cannot be registered, in any case, and the name check says so', async () => {
  for (const name of PROTECTED_USERNAMES) {
    for (const variant of [name, name.toUpperCase()]) {
      const r = await post('/auth/register', { username: variant, password: 'sandi-panjang-1' });
      // "gm" is also too short to be a name at all; either way it is refused
      const why = name.length < 3 ? 'invalid_username' : 'username_reserved';
      assert.equal(r.json().error, why, `${variant}: ${r.body}`);
      assert.ok(r.statusCode === 403 || r.statusCode === 400);
    }
    const c = await app.inject({ method: 'GET', url: `/auth/check-username?username=${name}` });
    assert.equal(c.json().available, false);
  }
  assert.ok(PROTECTED_USERNAMES.includes('manzzy'));
});

test('once the developer account exists, registering its name is refused like any taken name', async () => {
  await developer();
  const r = await post('/auth/register', { username: 'Manzzy', password: 'sandi-lain-12345' });
  assert.equal(r.statusCode, 403);
  const me = await repos.users.byLower('manzzy');
  assert.equal(me!.role, 'dev', 'and the real account is untouched');
});

test('a registered account is always a player, whatever it sends', async () => {
  const r = await post('/auth/register', { username: 'mau_jadi_dev', password: 'sandi-panjang-1', role: 'dev' });
  assert.equal(r.statusCode, 400, 'an extra "role" field is refused outright');
  const ok = await post('/auth/register', { username: 'mau_jadi_dev', password: 'sandi-panjang-1' });
  assert.equal(ok.json().user.role, 'player');
});

// ───────────────────────── the developer endpoint ─────────────────────────

test('the developer endpoint: no token 401, a player 403, the developer through', async () => {
  assert.equal((await dev({}, { type: 'heal' })).statusCode, 401);
  const p = await player();
  const refused = await dev(p, { type: 'give_all_cores' });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error, 'forbidden');
  const d = await developer();
  const ok = await dev(d, { type: 'teleport', to: 'cp_forest' });
  assert.deepEqual(ok.json(), { ok: true });
});

test('grants are applied by the server to the save, which comes back marked as a developer save', async () => {
  const d = await developer();
  const r = await dev(d, { type: 'give_item', item: 'sword_dawn', rarity: 'mythic', count: 1 }, save());
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.save.data.devSave, true);
  assert.equal(body.save.data.character.inventory.slots[0].id, 'sword_dawn');
  assert.equal(body.save.rev, 1);

  const lvl = await dev(d, { type: 'add_exp', amount: 100_000 }, body.save.data);
  assert.equal(lvl.json().save.data.character.level, 30);
  const el = await dev(d, { type: 'unlock_elements' }, lvl.json().save.data);
  assert.deepEqual(el.json().save.data.character.elements.unlocked.sort(), ['air', 'api', 'es', 'petir']);
  const st = await dev(d, { type: 'set_stats', stats: { atk: 500, crit: 50 } }, el.json().save.data);
  assert.deepEqual(st.json().save.data.character.devStats, { atk: 500, crit: 50 });
  const stored = await repos.characters.get((await repos.users.byLower('manzzy'))!.id, 0);
  assert.equal(stored!.dev, true, 'the database knows it is a developer save');
  assert.equal(stored!.rev, 4);

  const gone = await dev(d, { type: 'reset_save' });
  assert.equal(gone.json().save, null);
  assert.equal(await repos.characters.get((await repos.users.byLower('manzzy'))!.id, 0), null);
});

test('developer actions are validated strictly', async () => {
  const d = await developer();
  for (const bad of [
    { type: 'give_item', item: 'pedang_dewa', rarity: 'mythic', count: 1 },
    { type: 'give_item', item: 'sword_dawn', rarity: 'ilahi', count: 1 },
    { type: 'give_item', item: 'sword_dawn', rarity: 'rare', count: 1000 },
    { type: 'set_level', level: 99 },
    { type: 'set_coins', amount: -1 },
    { type: 'set_stats', stats: { terbang: 1 } },
    { type: 'teleport', to: '../../etc' },
    { type: 'heal', extra: true },
    { type: 'jadi_admin' },
  ]) {
    const r = await dev(d, bad);
    assert.equal(r.statusCode, 400, `${JSON.stringify(bad)} → ${r.body}`);
  }
});

// ───────────────────────── a player editing their save ─────────────────────────

test('a player cannot give themselves items, elements, coins or developer fields by editing the save', async () => {
  const p = await player();
  assert.equal((await put(p, save({ level: 5, coins: 300 }), 0)).statusCode, 200, 'an honest first save');
  const rejected = async (data: unknown, reason: string) => {
    const r = await put(p, data, 1);
    assert.equal(r.statusCode, 422, `${reason}: ${r.body}`);
    assert.equal(r.json().error, 'save_rejected');
    assert.equal(r.json().reason, reason);
  };
  await rejected(save({ level: 5 }, { devSave: true }), 'dev_only');
  await rejected(save({ level: 5, devStats: { atk: 999 } }), 'dev_only');
  await rejected(save({ level: 5, inventory: { slots: [{ id: 'pedang_dewa', count: 1, rarity: 'mythic' }], equipped: {} } }), 'unknown_item');
  await rejected(save({ level: 5, inventory: { slots: [{ id: 'sword_dawn', count: 5, rarity: 'rare' }], equipped: {} } }), 'bad_count');
  await rejected(save({ level: 5, inventory: { slots: [], equipped: { helmet: { id: 'sword_dawn', count: 1, rarity: 'rare' } } } }), 'bad_equip');
  await rejected(save({ level: 5, elements: { unlocked: ['petir'], primary: 'petir', secondary: null } }), 'element_without_core');
  await rejected(save({ level: 5, exp: 999_999 }), 'bad_exp');
  await rejected(save({ level: 30 }), 'too_fast');
  await rejected(save({ level: 5, coins: 999_999 }), 'too_fast');
  const hoard = Array.from({ length: 5 }, () => ({ id: 'sword_dawn', count: 1, rarity: 'legendary' }));
  await rejected(save({ level: 5, inventory: { slots: hoard, equipped: {} } }), 'too_fast');
});

test('honest play passes: a core teaches its element, and long offline play still syncs', async () => {
  const p = await player();
  assert.equal((await put(p, save({ level: 3 }), 0)).statusCode, 200);
  const core = { slots: [], equipped: { lantern: { id: 'core_ember', count: 1, rarity: 'rare' } } };
  assert.equal((await put(p, save({ level: 3, inventory: core, elements: { unlocked: ['api'], primary: 'api', secondary: null } }), 1)).statusCode, 200);
  // two hours offline: ten levels and thousands of coins later
  clock += 2 * 60 * 60 * 1000;
  await p.relogin();
  const later = save({ level: 13, coins: 20_000, inventory: core, elements: { unlocked: ['api'], primary: 'api', secondary: null } });
  assert.equal((await put(p, later, 2)).statusCode, 200);
  assert.ok(PROGRESS_LIMITS.levelsPerWrite >= 1);
});

test('a first upload of existing progress is checked for integrity, not speed', async () => {
  const p = await player();
  const r = await put(p, save({ level: 20, coins: 50_000 }), 0);
  assert.equal(r.statusCode, 200, r.body);
});

test("a developer's saves are marked by the server, whatever the client sent", async () => {
  const d = await developer();
  const r = await put(d, save({ level: 30, devStats: { atk: 100 } }), 0);
  assert.equal(r.statusCode, 200, r.body);
  const got = (await app.inject({ method: 'GET', url: '/save', headers: d })).json();
  assert.equal(got.data.devSave, true);
});
