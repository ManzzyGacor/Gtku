/**
 * Local accounts (`core/account/local.ts`) and per-account saves (`core/save.ts`).
 *
 * The user's rules for accounts, verbatim in spirit: do not promise security that is not there, and
 * **never store a password in plaintext**. The second one is checked literally below — the stored
 * bytes are searched for the password.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { webcrypto } from 'node:crypto';

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { LocalAuth, ACCOUNTS_KEY, SESSION_KEY, PBKDF2_ITERATIONS } = await import('../src/core/account/local');
const { saveGame, setSaveScope, clearSave } = await import('../src/core/save');
const { SAVE_KEY } = await import('../src/config');

let clock = 1_000_000;
const make = () =>
  new LocalAuth({
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
    random: (b) => webcrypto.getRandomValues(b),
    now: () => clock,
    read: (k) => store.get(k) ?? null,
    write: (k, v) => (store.set(k, v), true),
    remove: (k) => void store.delete(k),
    // the real count is slow on purpose; the maths is the same at 1 000
    iterations: 1000,
  });

beforeEach(() => {
  store.clear();
  setSaveScope(null);
});

test('register, then log in; the password is nowhere in storage', async () => {
  const auth = make();
  const pw = 'lentera-malam-42';
  const r = await auth.register('Pemain_Satu', pw);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ok && r.session.id, 'pemain_satu', 'names are case-insensitive');
  const everything = [...store.values()].join('\n');
  assert.ok(!everything.includes(pw), 'no plaintext password');
  assert.ok(!everything.includes(Buffer.from(pw).toString('base64')), 'nor a trivially encoded one');
  const acc = JSON.parse(store.get(ACCOUNTS_KEY)!).pemain_satu;
  assert.equal(typeof acc.salt, 'string');
  assert.equal(Buffer.from(acc.hash, 'base64').length, 32, 'a 256-bit PBKDF2 hash');

  await auth.logout();
  assert.equal(auth.current(), null);
  assert.equal((await auth.login('pemain_satu', 'salah-sandi')).ok, false);
  const ok = await auth.login('PEMAIN_SATU', pw);
  assert.ok(ok.ok);
  assert.equal(auth.current()?.name, 'pemain_satu', 'the session is remembered');
});

test('two accounts with the same password get different hashes (salted)', async () => {
  const auth = make();
  await auth.register('anu', 'sandi-sama-123');
  await auth.register('ani', 'sandi-sama-123');
  const all = JSON.parse(store.get(ACCOUNTS_KEY)!);
  assert.notEqual(all.anu.hash, all.ani.hash);
});

test('the rules: name shape, password length, no duplicates', async () => {
  const auth = make();
  assert.equal((await auth.register('ab', 'panjang-sekali')).ok, false);
  assert.equal((await auth.register('nama spasi', 'panjang-sekali')).ok, false);
  const weak = await auth.register('pendek', '1234567');
  assert.ok(!weak.ok && weak.error === 'sandi-lemah');
  await auth.register('dipakai', 'panjang-sekali');
  const dup = await auth.register('DIPAKAI', 'lain-lagi-sekali');
  assert.ok(!dup.ok && dup.error === 'nama-dipakai');
});

test('repeated wrong passwords back off, and a right one resets it', async () => {
  const auth = make();
  await auth.register('target', 'benar-sekali-1');
  // sequential on purpose: each failure has to be counted before the next attempt
  // oxlint-disable-next-line no-await-in-loop
  for (let i = 0; i < 5; i++) await auth.login('target', 'x');
  const locked = await auth.login('target', 'benar-sekali-1');
  assert.ok(!locked.ok && locked.error === 'terkunci', 'even the right password waits');
  clock += 6000;
  assert.ok((await auth.login('target', 'benar-sekali-1')).ok);
});

test('a session for an account that no longer exists is not a session', async () => {
  const auth = make();
  await auth.register('hilang', 'panjang-sekali');
  store.delete(ACCOUNTS_KEY);
  assert.equal(auth.current(), null);
  assert.ok(store.has(SESSION_KEY));
});

test('each account has its own save, and the first one adopts the progress already on the phone', () => {
  // progress from before accounts existed
  saveGame({ v: 3, marker: 'lama' } as never);
  assert.ok(store.has(SAVE_KEY));

  setSaveScope('pertama');
  assert.ok(store.has(`${SAVE_KEY}@pertama`), 'moved under the first account');
  assert.equal(store.has(SAVE_KEY), false);

  setSaveScope('kedua');
  assert.equal(store.has(`${SAVE_KEY}@kedua`), false, 'the second account starts fresh');
  saveGame({ v: 3, marker: 'kedua' } as never);
  setSaveScope('pertama');
  assert.ok(JSON.parse(store.get(`${SAVE_KEY}@pertama`)!).marker === 'lama', 'untouched by the other');
  clearSave();
  assert.equal(store.has(`${SAVE_KEY}@pertama`), false);
  assert.ok(store.has(`${SAVE_KEY}@kedua`), 'clearing one account leaves the other');
});

test('the production iteration count is a real one', () => {
  assert.ok(PBKDF2_ITERATIONS >= 300_000);
});
