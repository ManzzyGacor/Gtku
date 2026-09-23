/** Storage helpers + the one-time migration from the pre-rename ("Lentera Kelam") keys. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map<string, string>();
let blocked = false;
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => {
    if (blocked) throw new Error('SecurityError');
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (blocked) throw new Error('QuotaExceededError');
    store.set(k, v);
  },
  removeItem: (k: string) => {
    if (blocked) throw new Error('SecurityError');
    store.delete(k);
  },
};

const { readRaw, writeRaw, removeRaw } = await import('../src/core/storage');
const { SAVE_KEY, LEGACY_SAVE_KEY, SETTINGS_KEY, LEGACY_SETTINGS_KEY } = await import('../src/config');
const { saveGame, loadGame, hasSave, clearSave } = await import('../src/core/save');

test('the new keys carry the game name', () => {
  assert.equal(SAVE_KEY, 'lentera-malam/save/v1');
  assert.equal(SETTINGS_KEY, 'lentera-malam/settings/v1');
  assert.equal(LEGACY_SAVE_KEY, 'lentera-kelam/save/v1');
  assert.equal(LEGACY_SETTINGS_KEY, 'lentera-kelam/settings/v1');
});

test('a value under the legacy key is adopted once and the old key is dropped', () => {
  store.clear();
  store.set('old', 'halo');
  assert.equal(readRaw('new', 'old'), 'halo');
  assert.equal(store.get('new'), 'halo', 'copied to the new key');
  assert.equal(store.has('old'), false, 'old key removed');
  assert.equal(readRaw('new', 'old'), 'halo', 'second read comes from the new key');
});

test('the new key always wins over the legacy one', () => {
  store.clear();
  store.set('new', 'baru');
  store.set('old', 'lama');
  assert.equal(readRaw('new', 'old'), 'baru');
  assert.equal(store.get('old'), 'lama', 'untouched while the new key exists');
});

test('a save written under the old name still loads after the rename', () => {
  store.clear();
  const data = { v: 1, hero: { x: 100, y: 200, hp: 9 }, quest: { stage: 2, kills: 3 } };
  store.set(LEGACY_SAVE_KEY, JSON.stringify(data));
  assert.equal(hasSave(), true);
  const loaded = loadGame();
  assert.equal(loaded?.hero.x, 100);
  assert.equal(loaded?.hero.hp, 9);
  assert.equal(store.has(LEGACY_SAVE_KEY), false, 'migrated away from the legacy key');
  assert.ok(store.has(SAVE_KEY));
  clearSave();
  assert.equal(loadGame(), null);
});

test('a corrupt or wrong-version save is ignored instead of crashing', () => {
  store.clear();
  store.set(SAVE_KEY, '{not json');
  assert.equal(loadGame(), null);
  store.set(SAVE_KEY, '{"v":99,"hero":{"x":1,"y":2,"hp":3}}');
  assert.equal(loadGame(), null);
});

test('blocked storage degrades quietly (private window)', () => {
  store.clear();
  blocked = true;
  assert.equal(readRaw('new', 'old'), null);
  assert.equal(writeRaw('new', 'x'), false);
  removeRaw('new', 'old');
  assert.equal(loadGame(), null);
  assert.equal(saveGame({ v: 1, hero: { x: 0, y: 0, hp: 1 } } as never), false);
  blocked = false;
});
