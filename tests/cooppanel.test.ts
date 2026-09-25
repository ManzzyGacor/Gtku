/** The Mission Board panel (ui/CoopPanel.ts), on the fake DOM, against a scripted room. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';
import type { CoopView } from '../src/ui/CoopPanel';
import type { ClientMsg } from '../shared/coop/protocol';

const doc = installDom();
const { CoopPanel } = await import('../src/ui/CoopPanel');

function setup(dev = false, unavailable: string | null = null) {
  const sent: ClientMsg[] = [];
  const calls: string[] = [];
  const view: CoopView & { sent: ClientMsg[] } = {
    status: 'idle',
    room: null,
    lastError: null,
    result: null,
    sent,
    go: (m) => void sent.push(m),
    ready: (on) => void calls.push(`ready:${on}`),
    start: () => void calls.push('start'),
    leave: () => void calls.push('leave'),
  };
  const parent = doc.createElement('div');
  let closed = 0;
  const panel = new CoopPanel(view, { unavailable: () => unavailable, developer: () => dev, itemName: (id) => `Nama ${id}`, onClose: () => void closed++ }, parent as unknown as HTMLElement);
  panel.show();
  const btn = (label: string): FakeEl | undefined => walkEls(parent).find((e) => e.tagName === 'BUTTON' && e.textContent === label);
  const text = () => walkEls(parent).map((e) => e.textContent).join('\n');
  return { view, panel, btn, text, calls, closed: () => closed };
}

test('the menu: a private room, joining by code, public rooms — but not for a developer', () => {
  const s = setup();
  s.btn('BUAT ROOM PRIVAT')!.tap();
  assert.deepEqual(s.view.sent.at(-1), { t: 'create' });
  s.btn('CARI ROOM PUBLIK')!.tap();
  assert.deepEqual(s.view.sent.at(-1), { t: 'quick' });

  const d = setup(true);
  assert.equal(d.btn('CARI ROOM PUBLIK'), undefined);
  assert.match(d.text(), /hanya bisa bermain di room privat/);
});

test('without a server account the board says why and offers nothing else', () => {
  const s = setup(false, 'Co-op butuh akun server.');
  assert.match(s.text(), /butuh akun server/);
  assert.equal(s.btn('BUAT ROOM PRIVAT'), undefined);
});

test('the lobby: the code, who is ready, and start only when everyone is', () => {
  const s = setup();
  s.view.room = {
    code: 'ABCDE',
    public: false,
    phase: 'lobby',
    you: 1,
    players: [
      { id: 1, name: 'andi', level: 5, ready: false, connected: true, host: true },
      { id: 2, name: 'budi', level: 7, ready: false, connected: true, host: false },
    ],
  };
  s.panel.render();
  assert.match(s.text(), /ABCDE/);
  assert.equal(s.btn('MULAI')!.disabled, true);
  s.view.room.players[1].ready = true;
  s.panel.render();
  assert.equal(s.btn('MULAI')!.disabled, false);
  s.btn('MULAI')!.tap();
  assert.deepEqual(s.calls, ['start']);
});

test('during the fight the panel steps aside; the result comes back with the loot', () => {
  const s = setup();
  s.view.room = { code: 'ABCDE', public: false, phase: 'fight', you: 1, players: [] };
  s.panel.render();
  s.view.result = { won: true, exp: 150, coins: 120, items: [{ id: 'sword_dawn', rarity: 'epic', count: 1 }], save: { data: {}, rev: 3 } };
  s.panel.render();
  assert.match(s.text(), /MENANG/);
  assert.match(s.text(), /Nama sword_dawn/);
  s.btn('KEMBALI KE DESA')!.tap();
  assert.equal(s.closed(), 1);
});
