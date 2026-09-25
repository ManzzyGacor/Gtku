/**
 * Developer mode: decided by the server, carried out by the server.
 *
 * Checked here, on the real game and the real server app (in memory):
 *  • there is no way in without login — no `?debug=1`, no taps, no skip button, no build flag;
 *  • a player gets nothing (no panel, no badge, no tuning rows), a developer gets all of it;
 *  • every panel action goes through `POST /dev/action`: grants come back as the server's save and
 *    the game adopts it; a player's token is refused; offline does nothing.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { buildDevActions, type DevServer } from '../src/render3d/DevTools';
import { makeDevServer } from '../src/cloud';
import { RemoteAuth, type HttpFetch } from '../src/core/account/remote';
import { buildApp, hashPassword } from '../server/src/app';
import { loadConfig } from '../server/src/config';
import { memoryRepos, type Repos } from '../server/src/repo';
import type { SaveData } from '../src/core/state/GameState';

// ───────────────────────── no doors without login ─────────────────────────

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('the game has no debug entry that works without login', () => {
  const offenders: string[] = [];
  for (const file of [...sources('src'), 'index.html']) {
    // code only: the comments that explain these doors are gone may name them
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [what, re] of [
      ['?debug=1', /debug=1|['"]debug['"]\s*\)|get\(['"]debug['"]\)/],
      ['tap-to-unlock', /TapUnlock|onDevUnlock/],
      ['skip login', /devSkip|LEWATI LOGIN/],
      ['build-flag gate', /VITE_DEV_TOOLS/],
      ['role from the name on the client', /devName|===\s*['"]manzzy['"]/],
    ] as const)
      if (re.test(src)) offenders.push(`${file}: ${what}`);
  }
  assert.deepEqual(offenders, []);
});

// ───────────────────────── the real game + the real server ─────────────────────────

let env: GameHarness;
let repos: Repos;
let app: Awaited<ReturnType<typeof buildApp>>;
let online = true;

beforeEach(async () => {
  env = installGameEnv();
  online = true;
  repos = memoryRepos();
  app = await buildApp({ config: loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: 'm'.repeat(48) }), repos });
});
afterEach(() => removeGameEnv());

const BASE = 'https://api.varesa.mom';
function fetchFor(): HttpFetch {
  const jar = new Map<string, string>();
  return async (url, init) => {
    if (!online) throw new TypeError('Failed to fetch');
    const path = url.slice(BASE.length);
    const headers: Record<string, string> = { ...init.headers, origin: 'https://game.varesa.mom', 'cf-connecting-ip': '192.0.2.50' };
    if (path.startsWith('/auth') && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: init.method as 'GET', url: path, headers, ...(init.body !== undefined ? { payload: init.body } : {}) });
    for (const c of res.cookies) jar.set(c.name, c.value);
    return { ok: res.statusCode < 300, status: res.statusCode, json: async () => res.json() };
  };
}

async function logIn(name: string, role: 'dev' | 'player'): Promise<RemoteAuth> {
  if (role === 'dev') {
    await repos.users.create({ username: name, usernameLower: name, passwordHash: await hashPassword('sandi-panjang-1'), role, createdAt: new Date(), lastLogin: null });
  }
  const store = new Map<string, string>();
  const auth = new RemoteAuth({ base: BASE, fetch: fetchFor(), now: () => Date.now(), read: (k) => store.get(k) ?? null, write: (k, v) => (store.set(k, v), true), remove: (k) => void store.delete(k) });
  const r = role === 'dev' ? await auth.login(name, 'sandi-panjang-1') : await auth.register(name, 'sandi-panjang-1');
  assert.ok(r.ok, JSON.stringify(r));
  return auth;
}

type Game = Awaited<ReturnType<typeof bootGame>>;
async function panelFor(role: 'dev' | 'player', name = role === 'dev' ? 'manzzy' : 'biasa') {
  const game = await bootGame(env, { continue: false });
  const auth = await logIn(name, role);
  const saves: { data: SaveData; rev: number }[] = [];
  const server: DevServer = makeDevServer(auth, (s) => void saves.push(s));
  let reloads = 0;
  const actions = buildDevActions(game, server, () => void reloads++);
  return { game, actions, saves, reloads: () => reloads };
}

const bagHas = (game: Game, id: string): boolean => game.character.inventory.slots.some((s) => s?.id === id);

test("grants are made by the server: the item arrives in the game from the server's save", async () => {
  const { game, actions, saves } = await panelFor('dev');
  const msg = await actions.giveItem('sword_dawn', 'mythic', 1);
  assert.match(msg, /masuk tas/);
  assert.ok(bagHas(game, 'sword_dawn'), 'the game adopted the server save');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].data.devSave, true, 'marked as a developer save by the server');

  await actions.setLevel(20);
  assert.equal(game.character.level, 20);
  await actions.unlockAllElements();
  assert.equal(game.character.unlocked.length, 4);
  const atk = game.character.stats.atk;
  await actions.setStats({ atk: 250 });
  assert.equal(game.character.stats.atk, atk + 250, 'developer stats reach the sheet');
  await actions.giveCoins(1000);
  assert.equal(game.character.coins, 1000);
  game.dispose();
});

test("a player's token is refused by the server, and nothing changes in the game", async () => {
  const { game, actions } = await panelFor('player');
  const msg = await actions.giveItem('sword_dawn', 'mythic', 1);
  assert.equal(msg, 'Hanya untuk akun pengembang.');
  assert.equal(bagHas(game, 'sword_dawn'), false);
  assert.equal(await actions.setGodMode(true), 'Hanya untuk akun pengembang.');
  assert.equal(game.hero.invincible, false, 'not even a session tool runs');
  game.dispose();
});

test('session tools run only after the server said yes; offline nothing happens', async () => {
  const { game, actions } = await panelFor('dev');
  assert.match(await actions.setGodMode(true), /Kebal: nyala/);
  assert.equal(game.hero.invincible, true);
  assert.match(await actions.teleport('cp_forest'), /Pindah/);
  assert.match(await actions.setTime('malam'), /malam/);
  assert.match(await actions.spawn('slime'), /dimunculkan/);
  assert.match(await actions.startEvent('badai'), /dimulai/);

  online = false;
  assert.equal(await actions.setGodMode(false), 'Server tidak bisa dihubungi.');
  assert.equal(game.hero.invincible, true, 'unchanged while the server cannot be asked');
  assert.equal(await actions.giveKit(), 'Server tidak bisa dihubungi.');
  game.dispose();
});

test('reset save goes through the server and reloads', async () => {
  const { game, actions, reloads } = await panelFor('dev');
  await actions.giveAllCores();
  await actions.resetSave();
  assert.equal(reloads(), 1);
  const id = (await repos.users.byLower('manzzy'))!.id;
  assert.equal(await repos.characters.get(id, 0), null, 'gone on the server');
  game.dispose();
});

test('a player sees no panel, no badge and no tuning rows; a developer sees all three', async () => {
  const { startWorld } = await import('../src/render3d/boot3d');
  const { DebugUi } = await import('../src/ui/DebugUi');
  const settle = () => new Promise((r) => setTimeout(r, 80));
  const find = (cls: string) => {
    const out: { style: Record<string, string>; textContent: string }[] = [];
    const walk = (n: { classes?: Set<string>; childNodes: unknown[] }) => {
      if (n.classes?.has(cls)) out.push(n as never);
      for (const c of n.childNodes) walk(c as typeof n);
    };
    walk(env.doc.body as never);
    return out;
  };
  const tuningShown = () => find('lm-set-row').filter((r) => r.textContent.includes('Setelan Combat') && r.style.display !== 'none').length;

  const debug = new DebugUi(env.doc.body as unknown as HTMLElement);
  const player = startWorld(env.doc.body as unknown as HTMLElement, debug, false, {});
  await settle();
  assert.equal(find('lm-devbtn').length, 0, 'no DEV button');
  assert.equal(find('lm-hud-dev').filter((b) => b.style.display !== 'none').length, 0, 'no badge');
  assert.equal(tuningShown(), 0, 'no combat tuning in Settings');
  player.dispose();

  const auth = await logIn('manzzy', 'dev');
  const debug2 = new DebugUi(env.doc.body as unknown as HTMLElement);
  const dev = startWorld(env.doc.body as unknown as HTMLElement, debug2, false, { devServer: makeDevServer(auth, () => undefined) });
  await settle();
  assert.equal(find('lm-devbtn').length, 1, 'the DEV button');
  assert.ok(find('lm-hud-dev').some((b) => b.style.display === 'block'), 'the DEV badge on the HUD');
  assert.ok(tuningShown() >= 1, 'combat tuning for the developer');
  dev.dispose();
});
