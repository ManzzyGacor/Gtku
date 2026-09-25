/**
 * Area data: the pack format, the manifest, and the downloader.
 *
 * The downloader is tested against the failures a phone on mobile data actually has — a connection
 * that dies partway, bytes that arrive corrupted, a server error, a new version released while the
 * old one is installed — with fakes for fetch and Cache Storage, so each failure happens exactly
 * where the test says rather than whenever the network feels like it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { decodePack, encodePack, MAX_FILE_BYTES, splitEntries, type PackEntry } from '../src/core/download/pack';
import { areaStatus, formatBytes, parseManifest, type DataManifest } from '../src/core/download/manifest';
import { cachedBytes, deleteArea, downloadArea, DownloadError, type DataCache, type DownloadDeps, type DownloadProgress, type FetchResult } from '../src/core/download/downloader';

// ───────────────────────────── pack ─────────────────────────────

const entry = (cx: number, cy: number, size: number, fill = cx + cy): PackEntry => ({ cx, cy, payload: new Uint8Array(size).fill(fill & 255) });

test('a pack round-trips its entries exactly', () => {
  const entries = [entry(0, 0, 10), entry(5, 7, 300), entry(15, 7, 1)];
  const back = decodePack(encodePack(entries));
  assert.ok(back);
  assert.equal(back.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(back[i].cx, entries[i].cx);
    assert.equal(back[i].cy, entries[i].cy);
    assert.deepEqual([...back[i].payload], [...entries[i].payload]);
  }
});

test('a truncated, foreign or padded pack is refused, never half-read', () => {
  const good = encodePack([entry(1, 1, 50), entry(2, 2, 50)]);
  assert.equal(decodePack(good.subarray(0, good.length - 10)), null, 'cut off mid-entry');
  assert.equal(decodePack(good.subarray(0, 5)), null, 'cut off in the header');
  const wrongMagic = good.slice();
  wrongMagic[0] = 0x58;
  assert.equal(decodePack(wrongMagic), null, 'not a pack');
  const future = good.slice();
  future[4] = 9;
  assert.equal(decodePack(future), null, 'a format this build does not know');
  const padded = new Uint8Array(good.length + 4);
  padded.set(good);
  assert.equal(decodePack(padded), null, 'trailing bytes mean the header is lying');
  assert.equal(decodePack(new Uint8Array(0)), null);
});

test('no file exceeds the 20 MB limit: big areas are split, in order', () => {
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
  const entries = Array.from({ length: 10 }, (_, i) => entry(i, 0, 1000));
  const files = splitEntries(entries, 3500);
  assert.ok(files.length > 1, 'split into several files');
  for (const f of files) assert.ok(encodePack(f, 3500).length <= 3500);
  assert.deepEqual(files.flat().map((e) => e.cx), entries.map((e) => e.cx), 'nothing lost or reordered');
  assert.throws(() => encodePack(entries, 3500), /exceeds/);
  assert.throws(() => splitEntries([entry(0, 0, 5000)], 3500), /alone exceeds/);
});

// ───────────────────────────── manifest ─────────────────────────────

const hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function makeManifest(files: Record<string, Uint8Array[]>, versions: Record<string, string> = {}): DataManifest {
  const areas: DataManifest['areas'] = {};
  for (const [area, list] of Object.entries(files)) {
    const v = versions[area] ?? 'v1';
    const df = list.map((b, i) => ({ url: `${area}-${v}-${i}.bin`, bytes: b.length, sha256: hex(b) }));
    areas[area] = { version: v, bytes: df.reduce((n, f) => n + f.bytes, 0), files: df, chunks: list.length };
  }
  return { format: 1, core: Object.keys(files)[0], areas };
}

test('a malformed manifest is refused instead of trusted', () => {
  const ok = { format: 1, core: 'village', areas: { village: { version: 'a', chunks: 1, files: [{ url: 'village-a-0.bin', bytes: 10, sha256: 'a'.repeat(64) }] } } };
  assert.ok(parseManifest(ok));
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest({ ...ok, format: 2 }), null, 'a newer format');
  assert.equal(parseManifest({ ...ok, core: 'nowhere' }), null, 'the core area has to exist');
  const withUrl = (url: string): unknown => ({ ...ok, areas: { village: { ...ok.areas.village, files: [{ ...ok.areas.village.files[0], url }] } } });
  assert.equal(parseManifest(withUrl('https://evil.example/x.bin')), null, 'no absolute URLs');
  assert.equal(parseManifest(withUrl('../../etc.bin')), null, 'no climbing out of the data folder');
  assert.equal(parseManifest(withUrl('village-a-0.exe')), null);
  const badHash = { ...ok, areas: { village: { ...ok.areas.village, files: [{ ...ok.areas.village.files[0], sha256: 'xyz' }] } } };
  assert.equal(parseManifest(badHash), null, 'a checksum that is not a checksum');
});

test('area status follows the installed marker', () => {
  const m = makeManifest({ village: [new Uint8Array([1])] }, { village: 'v2' });
  assert.equal(areaStatus(m, {}, 'village'), 'belum');
  assert.equal(areaStatus(m, { village: 'v2' }, 'village'), 'terpasang');
  assert.equal(areaStatus(m, { village: 'v1' }, 'village'), 'versi-baru');
});

test('sizes read like a person wrote them', () => {
  assert.equal(formatBytes(560000), '547 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5,00 MB');
  assert.equal(formatBytes(-1), '-');
});

// ───────────────────────────── downloader ─────────────────────────────

class MemCache implements DataCache {
  readonly store = new Map<string, Uint8Array>();
  async has(url: string): Promise<boolean> {
    return this.store.has(url);
  }
  async put(url: string, bytes: Uint8Array): Promise<void> {
    this.store.set(url, bytes.slice());
  }
  async get(url: string): Promise<Uint8Array | null> {
    return this.store.get(url) ?? null;
  }
  async delete(url: string): Promise<void> {
    this.store.delete(url);
  }
  async keys(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

interface Server {
  files: Map<string, Uint8Array>;
  /** Break the connection after this many bytes, for the named file. */
  dieAfter: Map<string, number>;
  /** Flip a byte in transit. */
  corrupt: Set<string>;
  status: Map<string, number>;
  fetched: string[];
}

function makeDeps(server: Server): DownloadDeps & { cache: MemCache; markers: Record<string, string> } {
  const cache = new MemCache();
  const markers: Record<string, string> = {};
  return {
    cache,
    markers,
    sha256: async (b) => hex(b),
    installed: {
      get: () => ({ ...markers }),
      set: (area, v) => {
        if (v === null) delete markers[area];
        else markers[area] = v;
      },
    },
    fetch: async (url): Promise<FetchResult> => {
      const name = url.replace(/^.*\//, '');
      server.fetched.push(name);
      const status = server.status.get(name) ?? 200;
      const data = server.files.get(name);
      if (!data || status !== 200) return { ok: false, status: status === 200 ? 404 : status, body: null };
      let bytes = data;
      if (server.corrupt.has(name)) {
        bytes = data.slice();
        bytes[bytes.length >> 1] ^= 0xff;
      }
      const limit = server.dieAfter.get(name);
      let sent = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (limit !== undefined && sent >= limit) throw new Error('connection reset');
              if (sent >= bytes.length) return { done: true };
              const size = Math.min(1000, bytes.length - sent, limit !== undefined ? limit - sent : Infinity);
              const value = bytes.subarray(sent, sent + size);
              sent += size;
              return { done: false, value };
            },
          }),
        },
      };
    },
  };
}

function serverFor(m: DataManifest, contents: Record<string, Uint8Array[]>): Server {
  const files = new Map<string, Uint8Array>();
  for (const [area, list] of Object.entries(contents)) m.areas[area].files.forEach((f, i) => files.set(f.url, list[i]));
  return { files, dieAfter: new Map(), corrupt: new Set(), status: new Map(), fetched: [] };
}

const blob = (n: number, seed: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

test('a clean download installs the area and reports MB progress along the way', async () => {
  const contents = { forest: [blob(4000, 1), blob(2500, 2)] };
  const m = makeManifest(contents);
  const deps = makeDeps(serverFor(m, contents));
  const seen: DownloadProgress[] = [];
  await downloadArea(m, 'forest', deps, '/data/', (p) => seen.push(p));

  assert.equal(deps.markers.forest, 'v1', 'installed');
  assert.equal(deps.cache.store.size, 2);
  const last = seen.at(-1)!;
  assert.equal(last.state, 'selesai');
  assert.equal(last.done, last.total);
  // progress only ever moves forward
  const dones = seen.map((p) => p.done);
  for (let i = 1; i < dones.length; i++) assert.ok(dones[i] >= dones[i - 1], `progress went backwards at ${i}`);
  assert.ok(seen.some((p) => p.done > 0 && p.done < p.total), 'with real intermediate values, not just 0 and 100%');
});

test('a connection that dies at 40% writes nothing, and a retry resumes from the missing file', async () => {
  const contents = { forest: [blob(3000, 1), blob(5000, 2)] };
  const m = makeManifest(contents);
  const server = serverFor(m, contents);
  const deps = makeDeps(server);
  const second = m.areas.forest.files[1].url;
  server.dieAfter.set(second, 2000);

  await assert.rejects(downloadArea(m, 'forest', deps, '/data/'), (e: unknown) => e instanceof DownloadError && e.kind === 'jaringan');
  assert.equal(deps.markers.forest, undefined, 'an interrupted area is NOT installed');
  assert.equal(await deps.cache.has(second), false, 'the half-downloaded file was never written');
  assert.equal(await deps.cache.has(m.areas.forest.files[0].url), true, 'the finished one was kept');
  assert.equal(await cachedBytes(m, 'forest', deps.cache), 3000, 'so the manager can show 3000 of 8000 already here');

  // the connection comes back
  server.dieAfter.clear();
  server.fetched.length = 0;
  await downloadArea(m, 'forest', deps, '/data/');
  assert.deepEqual(server.fetched, [second], 'only the missing file is fetched again');
  assert.equal(deps.markers.forest, 'v1');
});

test('bytes corrupted in transit are rejected before they reach the cache', async () => {
  const contents = { cave: [blob(2000, 3)] };
  const m = makeManifest(contents);
  const server = serverFor(m, contents);
  server.corrupt.add(m.areas.cave.files[0].url);
  const deps = makeDeps(server);
  await assert.rejects(downloadArea(m, 'cave', deps, '/data/'), (e: unknown) => e instanceof DownloadError && e.kind === 'rusak');
  assert.equal(deps.cache.store.size, 0);
  assert.equal(deps.markers.cave, undefined);
});

test('a server error and a short body are both reported, not swallowed', async () => {
  const contents = { cave: [blob(2000, 3)] };
  const m = makeManifest(contents);
  const server = serverFor(m, contents);
  server.status.set(m.areas.cave.files[0].url, 503);
  const deps = makeDeps(server);
  const seen: DownloadProgress[] = [];
  await assert.rejects(downloadArea(m, 'cave', deps, '/data/', (p) => seen.push(p)), (e: unknown) => e instanceof DownloadError && e.kind === 'server');
  assert.equal(seen.at(-1)?.state, 'gagal');
  assert.ok(seen.at(-1)?.error?.includes('503'), 'the reason reaches the UI');

  // a server that sends fewer bytes than promised
  const short = { cave: [blob(2000, 3)] };
  const m2 = makeManifest(short);
  const s2 = serverFor(m2, short);
  s2.files.set(m2.areas.cave.files[0].url, blob(1500, 3));
  await assert.rejects(downloadArea(m2, 'cave', makeDeps(s2), '/data/'), (e: unknown) => e instanceof DownloadError && e.kind === 'terpotong');
});

test('an installed area is not downloaded again', async () => {
  const contents = { village: [blob(1000, 4)] };
  const m = makeManifest(contents);
  const server = serverFor(m, contents);
  const deps = makeDeps(server);
  await downloadArea(m, 'village', deps, '/data/');
  server.fetched.length = 0;
  await downloadArea(m, 'village', deps, '/data/');
  assert.deepEqual(server.fetched, [], 'the cache answered');
});

test('a new version replaces the old one only after it is complete', async () => {
  const v1 = { forest: [blob(1000, 5)] };
  const m1 = makeManifest(v1, { forest: 'v1' });
  const deps = makeDeps(serverFor(m1, v1));
  await downloadArea(m1, 'forest', deps, '/data/');
  const oldUrl = m1.areas.forest.files[0].url;

  // version 2 is released, but the first attempt fails
  const v2 = { forest: [blob(1200, 6)] };
  const m2 = makeManifest(v2, { forest: 'v2' });
  assert.equal(areaStatus(m2, deps.markers, 'forest'), 'versi-baru');
  const server2 = serverFor(m2, v2);
  server2.dieAfter.set(m2.areas.forest.files[0].url, 100);
  const deps2 = { ...makeDeps(server2), cache: deps.cache, markers: deps.markers, installed: deps.installed };
  await assert.rejects(downloadArea(m2, 'forest', deps2, '/data/'));
  assert.equal(await deps.cache.has(oldUrl), true, 'the old version survives a failed update');
  assert.equal(deps.markers.forest, 'v1', 'and is still the installed one');

  server2.dieAfter.clear();
  await downloadArea(m2, 'forest', deps2, '/data/');
  assert.equal(deps.markers.forest, 'v2');
  assert.equal(await deps.cache.has(oldUrl), false, 'the old files are cleaned up after the update lands');
});

test('deleting an area removes its files and its marker, and nothing else', async () => {
  const contents = { village: [blob(900, 7)], forest: [blob(800, 8)] };
  const m = makeManifest(contents);
  const deps = makeDeps(serverFor(m, contents));
  await downloadArea(m, 'village', deps, '/data/');
  await downloadArea(m, 'forest', deps, '/data/');
  const removed = await deleteArea('forest', deps);
  assert.equal(removed, 1);
  assert.equal(deps.markers.forest, undefined);
  assert.equal(deps.markers.village, 'v1', 'the other area is untouched');
  assert.equal(await deps.cache.has(m.areas.village.files[0].url), true);
});
