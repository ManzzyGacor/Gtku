/**
 * The title flow: "Sentuh untuk memulai" → Masuk/Daftar → menu. An account is required; there is
 * no guest option; the register form says, before the player picks a password, that the account
 * lives on this device only; and the developer skip exists only when the build hands it over.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = { innerWidth: 2318, innerHeight: 759, devicePixelRatio: 2.75, addEventListener() {}, removeEventListener() {} };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
let doc = installDom();

const { TitleScreen } = await import('../src/ui/TitleScreen');
const { LocalAuth } = await import('../src/core/account/local');
const { saveScope, saveGame, setSaveScope } = await import('../src/core/save');

const auth = () =>
  new LocalAuth({
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
    random: (b) => webcrypto.getRandomValues(b),
    now: () => Date.now(),
    read: (k) => store.get(k) ?? null,
    write: (k, v) => (store.set(k, v), true),
    remove: (k) => void store.delete(k),
    iterations: 1000,
  });

beforeEach(() => {
  store.clear();
  doc = installDom();
  setSaveScope(null);
});

const texts = (): string => walkEls(doc.body).map((e) => e.textContent).join('\n');
const button = (label: string): FakeEl | undefined => walkEls(doc.body).find((e) => e.tagName === 'BUTTON' && e.textContent === label);
const inputs = (): FakeEl[] => walkEls(doc.body).filter((e) => e.tagName === 'INPUT' && e.getAttribute('autocomplete') !== 'off');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const root = (): FakeEl => walkEls(doc.body).find((e) => e.classes.has('lm-title'))!;

test('the first tap is the start: it fires the gesture hook, then asks for an account', () => {
  let started = 0;
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: auth(), started: () => started++ });
  assert.equal(t.currentStage, 'gate');
  assert.equal(button('MAIN BARU'), undefined, 'no menu before the account');
  root().tap();
  assert.equal(started, 1);
  assert.equal(t.currentStage, 'auth');
  root().tap();
  assert.equal(started, 1, 'only the first tap');
});

test('there is no guest option anywhere', async () => {
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: auth() });
  t.start();
  const all = [texts()];
  button('Belum punya akun? DAFTAR')!.tap();
  all.push(texts());
  assert.ok(!/tamu/i.test(all.join('\n')), 'nothing offers to play as a guest');
});

test('registering warns first, then logs in and files the save under the account', async () => {
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: auth() });
  t.start();
  button('Belum punya akun? DAFTAR')!.tap();
  const warn = walkEls(doc.body).find((e) => e.classes.has('lm-title-warn'));
  assert.ok(warn && /PERANGKAT INI/.test(warn.textContent) && /hilang/.test(warn.textContent), 'the device-only warning is on the form');

  const [user, pass, again] = inputs();
  assert.equal(pass.getAttribute('type'), 'password');
  user.value = 'Penjaga';
  pass.value = 'sandi-panjang-1';
  again.value = 'beda';
  button('DAFTAR')!.tap();
  await settle();
  assert.match(texts(), /tidak sama/, 'mismatched passwords are caught');

  pass.value = 'sandi-panjang-1';
  again.value = 'sandi-panjang-1';
  button('DAFTAR')!.tap();
  await settle();
  assert.equal(t.currentStage, 'menu');
  assert.match(texts(), /penjaga/);
  assert.equal(saveScope(), 'penjaga');
  assert.ok(button('MAIN BARU'));
  assert.equal(button('LANJUTKAN'), undefined, 'a new account has no save yet');
});

test('a wrong password stays on the form with a message; a remembered session skips it', async () => {
  const a = auth();
  await a.register('lama', 'sandi-panjang-1');
  await a.logout();
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: a });
  t.start();
  const [user, pass] = inputs();
  user.value = 'lama';
  pass.value = 'salah-salah';
  button('MASUK')!.tap();
  await settle();
  assert.equal(t.currentStage, 'auth');
  assert.match(texts(), /salah/);
  assert.equal(pass.value, '', 'the wrong password is cleared');

  // log in for real, then a new title (a reload) goes straight to the menu
  pass.value = 'sandi-panjang-1';
  button('MASUK')!.tap();
  await settle();
  assert.equal(t.currentStage, 'menu');
  setSaveScope('lama');
  saveGame({ v: 2, hero: { x: 100, y: 100, hp: 10 } } as never);
  doc = installDom();
  const again = new TitleScreen(doc.body as unknown as HTMLElement, { auth: a });
  again.start();
  assert.equal(again.currentStage, 'menu', 'remembered');
  assert.ok(button('LANJUTKAN'), "and it finds that account's save");
});

test('logging out goes back to the form and unscopes the save', async () => {
  const a = auth();
  await a.register('keluar', 'sandi-panjang-1');
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: a });
  t.start();
  button('AKUN')!.tap();
  button('KELUAR AKUN')!.tap();
  await settle();
  assert.equal(t.currentStage, 'auth');
  assert.equal(saveScope(), '');
  assert.equal(a.current(), null);
});

test('there is no way past the login', () => {
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: auth() });
  t.start();
  assert.equal(t.currentStage, 'auth');
  assert.ok(!walkEls(doc.body).some((e) => e.classes.has('dev')), 'no skip button');
  assert.ok(!/LEWATI/.test(texts()));
});

test('a browser that cannot keep an account safely is told why, not given a weak one', () => {
  const t = new TitleScreen(doc.body as unknown as HTMLElement, { auth: null });
  t.start();
  assert.equal(t.currentStage, 'auth');
  assert.match(texts(), /HTTPS/);
  assert.equal(inputs().length, 0, 'no password field at all');
});
