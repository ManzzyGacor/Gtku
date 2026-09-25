/**
 * The Download Manager and the "Data Dunia Diperlukan" prompt, on the fake DOM.
 *
 * Both only draw what `DataSource` says, so the tests drive a scripted source and check that every
 * state the plan names is visible: status per area, MB done of MB total, the download / delete /
 * retry buttons, the storage line, and the persistence request.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';
import type { DataAreaView, DataSource } from '../src/ui/DownloadManager';

const doc = installDom();
const { DownloadManager, DataRequired } = await import('../src/ui/DownloadManager');

const MB = 1024 * 1024;

function fakeSource(start: DataAreaView[]): DataSource & { areasNow: DataAreaView[]; calls: string[]; persisted: boolean | null; emit(): void } {
  const listeners = new Set<() => void>();
  const src = {
    available: true,
    areasNow: start,
    calls: [] as string[],
    persisted: false as boolean | null,
    manifestError: () => null,
    areas: async () => structuredClone(src.areasNow),
    download: async (id: string) => {
      src.calls.push(`download:${id}`);
    },
    remove: async (id: string) => {
      src.calls.push(`remove:${id}`);
    },
    storage: async () => ({ usage: 12 * MB, quota: 900 * MB, persisted: src.persisted }),
    requestPersist: async () => {
      src.calls.push('persist');
      src.persisted = true;
      return true;
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit: () => {
      for (const fn of listeners) fn();
    },
  };
  return src;
}

const text = (root: FakeEl): string => walkEls(root).map((e) => e.textContent ?? '').join(' ');
const button = (root: FakeEl, label: string): FakeEl => {
  const b = walkEls(root).find((e) => e.tagName === 'BUTTON' && e.textContent === label);
  assert.ok(b, `no "${label}" button in: ${walkEls(root).filter((e) => e.tagName === 'BUTTON').map((e) => e.textContent).join(' | ')}`);
  return b;
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const AREAS: DataAreaView[] = [
  { id: 'village', name: 'Ravenhollow', status: 'terpasang', bytes: 0.43 * MB, done: 0.43 * MB, core: true },
  { id: 'forest', name: 'Hutan Noctis', status: 'belum', bytes: 0.53 * MB, done: 0, core: false },
  { id: 'cave', name: 'Gua Lumen', status: 'gagal', bytes: 0.18 * MB, done: 0.05 * MB, core: false, error: 'Koneksi terputus di tengah unduhan.' },
];

test('the manager lists every area with its status, size and the right button', async () => {
  const parent = doc.createElement('div');
  const src = fakeSource(structuredClone(AREAS));
  const dm = new DownloadManager(src, parent as unknown as HTMLElement);
  dm.show();
  await tick();
  const shown = text(parent);
  for (const name of ['Ravenhollow', 'Hutan Noctis', 'Gua Lumen']) assert.ok(shown.includes(name), `${name} listed`);
  assert.ok(shown.includes('Terpasang') && shown.includes('Belum diunduh') && shown.includes('Gagal'));
  assert.ok(shown.includes('data inti'), 'the core area says it downloads by itself');
  assert.ok(shown.includes('dari'), 'progress is shown as "x dari y"');
  assert.ok(shown.includes('Koneksi terputus'), 'and a failure says why');

  button(parent, 'UNDUH').tap();
  button(parent, 'COBA LAGI').tap();
  button(parent, 'HAPUS').tap();
  await tick();
  assert.deepEqual(src.calls, ['download:forest', 'download:cave', 'remove:village']);
  dm.destroy();
});

test('the storage line and the persistence request use the real estimate', async () => {
  const parent = doc.createElement('div');
  const src = fakeSource(structuredClone(AREAS));
  const dm = new DownloadManager(src, parent as unknown as HTMLElement);
  dm.show();
  await tick();
  assert.ok(text(parent).includes('terpakai'), 'usage and quota are shown');
  assert.ok(text(parent).includes('sisa'), 'and what is left');
  button(parent, 'MINTA IZIN').tap();
  await tick();
  await tick();
  assert.ok(src.calls.includes('persist'));
  assert.ok(text(parent).includes('diizinkan'), 'and the answer is shown');
  dm.destroy();
});

test('progress updates live while a download runs', async () => {
  const parent = doc.createElement('div');
  const src = fakeSource(structuredClone(AREAS));
  const dm = new DownloadManager(src, parent as unknown as HTMLElement);
  dm.show();
  await tick();
  src.areasNow[1] = { ...src.areasNow[1], status: 'mengunduh', done: 0.26 * MB };
  src.emit();
  await tick();
  assert.ok(text(parent).includes('Mengunduh'), 'the status changes');
  assert.ok(text(parent).includes('266 KB'), `and the bytes move: ${text(parent).slice(0, 400)}`);
  dm.destroy();
});

test('the prompt names the area and its size, downloads in place, and closes when installed', async () => {
  const parent = doc.createElement('div');
  const src = fakeSource(structuredClone(AREAS));
  const dr = new DataRequired(src, parent as unknown as HTMLElement);
  let closed = 0;
  dr.onClose = () => closed++;
  await dr.show('forest');
  assert.equal(dr.isOpen, true);
  const shown = text(parent);
  assert.ok(shown.includes('DATA DUNIA DIPERLUKAN'));
  assert.ok(shown.includes('Hutan Noctis'));
  assert.ok(shown.includes('KB') || shown.includes('MB'), 'the size is stated before anything is downloaded');

  button(parent, 'UNDUH').tap();
  await tick();
  assert.deepEqual(src.calls, ['download:forest']);

  src.areasNow[1] = { ...src.areasNow[1], status: 'mengunduh', done: 0.3 * MB };
  src.emit();
  await tick();
  assert.ok(text(parent).includes('Mengunduh'), 'progress in the prompt itself');
  assert.ok(text(parent).includes('LANJUT DI LATAR'), 'and it can be left to finish in the background');

  src.areasNow[1] = { ...src.areasNow[1], status: 'terpasang', done: 0.53 * MB };
  src.emit();
  await tick();
  assert.equal(dr.isOpen, false, 'it gets out of the way the moment the data is in');
  assert.equal(closed, 1);
  dr.destroy();
});

test('a browser that cannot store data says so, and says the game still works', async () => {
  const parent = doc.createElement('div');
  const src = { ...fakeSource([]), available: false };
  const dm = new DownloadManager(src, parent as unknown as HTMLElement);
  dm.show();
  await tick();
  assert.ok(text(parent).includes('tetap bisa dimainkan'));
  dm.destroy();
});
