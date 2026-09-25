/**
 * Co-op from inside the game: the Mission Board in the village, the panel, two real games in one
 * room on the real server, the arena, and the loot arriving in the character's bag.
 *
 * Both games share this process's input hub, so they move alike — that is fine: what is checked is
 * that each sees the other, the boss, and the server's result. (Rendering needs a GPU; the GL stub
 * builds everything and draws nothing.)
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import WebSocket from 'ws';
import { buildApp, hashPassword } from '../src/app';
import { loadConfig } from '../src/config';
import { memoryRepos, type Repos } from '../src/repo';
import type { RoomManager } from '../src/coop/rooms';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from '../../tests/helpers/game';
import { walkEls } from '../../tests/mocks/dom-mock';
import type { SocketLike } from '../../src/core/coop/client';
import type { CoopAccess } from '../../src/render3d/Game3D';
import type { SaveData } from '../../src/core/state/GameState';

let env: GameHarness;
let app: Awaited<ReturnType<typeof buildApp>>;
let repos: Repos;
let url = '';
const sockets: WebSocket[] = [];

beforeEach(async () => {
  env = installGameEnv();
  (globalThis as Record<string, unknown>).performance ??= { now: () => Date.now() };
  repos = memoryRepos();
  app = await buildApp({ config: loadConfig({ MONGODB_URI: 'mongodb://tidak-dipakai', JWT_SECRET: 'g'.repeat(48) }), repos, coopSeed: 5 });
  await app.listen({ host: '127.0.0.1', port: 0 });
  url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`;
});
afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  await app.close();
  removeGameEnv();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(15);
  }
}

async function accessFor(name: string, saved: { data: SaveData; rev: number }[]): Promise<CoopAccess> {
  const u = await repos.users.create({ username: name, usernameLower: name, passwordHash: await hashPassword('sandi-panjang-1'), role: 'player', createdAt: new Date(), lastLogin: null });
  await repos.characters.insert({
    userId: u.id,
    slot: 0,
    saveVersion: 2,
    rev: 1,
    data: { v: 2, hero: { x: 1, y: 1, hp: 20 }, character: { level: 9, exp: 0, coins: 0, inventory: { slots: [], equipped: {} }, elements: { unlocked: [], primary: null, secondary: null } } },
    level: 9,
    updatedAt: new Date(),
    clientUpdatedAt: null,
    createdAt: new Date(),
  });
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: name, password: 'sandi-panjang-1' }, headers: { origin: 'https://game.varesa.mom', 'cf-connecting-ip': `10.1.0.${name.length}` } });
  const token = r.json().accessToken as string;
  return {
    url,
    token: async () => token,
    developer: false,
    onServerSave: (s) => void saved.push(s),
    flush: async () => undefined,
    makeSocket: (u2) => {
      const ws = new WebSocket(u2, { origin: 'https://game.varesa.mom' });
      sockets.push(ws);
      return ws as unknown as SocketLike;
    },
  };
}

/** The GL stub builds everything but cannot draw: the frame's last line is replaced. */
async function game(): Promise<Awaited<ReturnType<typeof bootGame>>> {
  const g = await bootGame(env, { continue: false });
  g.pixels.render = () => undefined;
  return g;
}

const drive = async (games: Awaited<ReturnType<typeof bootGame>>[], ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await wait(16);
    for (const g of games) g.step(1 / 60);
  }
};

test('the Mission Board stands in the plaza, and without a server account it says why', async () => {
  const g = await game();
  const board = g.story.missionBoardAt;
  const lantern = g.world.markers.lantern;
  assert.ok(Math.hypot(board.x - lantern.x, board.y - lantern.y) < 120, 'in the plaza');
  g.hero.x = board.x;
  g.hero.y = board.y + 12;
  g.step(1 / 60);
  assert.equal(g.story.interactPrompt, 'Papan Misi');
  g.openMissionBoard();
  const text = walkEls(env.doc.body).map((e) => e.textContent).join('\n');
  assert.match(text, /butuh akun server/);
  assert.equal(g.isPaused, true, 'the world waits while the board is open');
  g.coopPanel!.close();
  assert.equal(g.isPaused, false, 'closing the board gives the world back');
  g.dispose();
});

test('two games in one room: the arena, each other, the boss, and the loot in the bag', async () => {
  const savesA: { data: SaveData; rev: number }[] = [];
  const a = await game();
  const b = await game();
  a.coopAccess = await accessFor('adinda', savesA);
  b.coopAccess = await accessFor('bayu', []);

  a.openMissionBoard();
  a.coopConnect()!.go({ t: 'create' });
  await until(() => !!a.coopClient?.room);
  const code = a.coopClient!.room!.code;
  b.openMissionBoard();
  b.coopConnect()!.go({ t: 'join', code });
  await until(() => a.coopClient!.room!.players.length === 2);
  b.coopClient!.ready(true);
  await until(() => a.coopClient!.room!.players.every((p) => p.host || p.ready));
  a.coopClient!.start();
  await until(() => !!a.arena && !!b.arena);
  await drive([a, b], 600);

  const view = a.coopClient!.draw();
  assert.equal(view.players.length, 2, 'A sees both players');
  assert.ok(view.boss && view.boss[3] > 0, 'and the boss');

  // the test's shortcut to the end of the fight (the fight is played in tests/coopsim.test.ts)
  const rooms = (app as unknown as { coopRooms: RoomManager }).coopRooms;
  const sim = rooms.rooms.get(code)!.sim!;
  sim.boss.hp = 1;
  const me = sim.players.get(a.coopClient!.room!.you)!;
  me.x = sim.boss.x;
  me.y = sim.boss.y + 20;
  me.aim = -Math.PI / 2;
  sim.setInput(me.id, { x: 0, y: 0, a: -90, b: 1, s: 1_000_000 });
  await until(() => !!a.coopClient!.result, 3000);
  await drive([a, b], 100);

  const loot = a.coopClient!.result!.items[0];
  assert.ok(a.character.inventory.slots.some((s) => s?.id === loot.id), 'the loot is in the bag');
  assert.equal(savesA.length, 1, 'and handed on as the new server save');
  a.coopPanel!.close();
  assert.equal(a.arena, null);
  assert.equal(a.isPaused, false);
  a.dispose();
  b.dispose();
});
