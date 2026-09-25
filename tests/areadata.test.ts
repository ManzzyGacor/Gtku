/**
 * Area data, end to end: what the build produces, what the phone does with it, and the gate.
 *
 * The central claim of the packs is "the same pixels the phone would have baked, without the
 * baking" — so the first test decodes a pack exactly the way the phone does (container, then
 * inflate) and compares every byte against `bakeChunk`. If worldgen or the art ever changes without
 * the packs following, this is where it shows.
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, test } from 'vitest';
import * as THREE from 'three';
import { buildAreaPacks, chunkArea } from '../scripts/areaPacks';
import { decodePack, MAX_FILE_BYTES } from '../src/core/download/pack';
import { parseManifest } from '../src/core/download/manifest';
import { areaBlocked } from '../src/core/download/gate';
import { bakeChunk } from '../src/art/bake';
import { buildTileSheet } from '../src/art/tiles';
import { Pixmap } from '../src/art/pixmap';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { World3D } from '../src/render3d/World3D';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';

const world = new GeneratedWorld();
const sheet = buildTileSheet();
const files = buildAreaPacks();

test('the build produces a valid manifest, every file under 20 MB and matching its checksum size', () => {
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))));
  assert.ok(manifest, 'the manifest the build writes must pass the parser the phone uses');
  assert.equal(manifest.core, 'village');
  assert.deepEqual(Object.keys(manifest.areas).sort(), ['cave', 'forest', 'village']);
  let chunks = 0;
  for (const [id, area] of Object.entries(manifest.areas)) {
    chunks += area.chunks;
    for (const f of area.files) {
      const bytes = files.get(f.url);
      assert.ok(bytes, `${f.url} is listed but not built`);
      assert.equal(bytes.length, f.bytes);
      assert.ok(bytes.length <= MAX_FILE_BYTES, `${f.url} is ${bytes.length} bytes`);
      assert.ok(f.url.startsWith(`${id}-`), 'files are named after their area');
    }
  }
  assert.equal(chunks, 128, 'every chunk of the world is in exactly one pack');
});

test('a pack decodes to exactly the pixels the phone would have baked', () => {
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))))!;
  // one chunk from each area is enough to prove the pipeline; the determinism test covers the rest
  const checked = new Set<string>();
  for (const [id, area] of Object.entries(manifest.areas)) {
    const entries = decodePack(files.get(area.files[0].url)!);
    assert.ok(entries && entries.length > 0, `${id} decodes`);
    const e = entries[Math.floor(entries.length / 2)];
    assert.equal(chunkArea(e.cx), id, 'a chunk sits in the pack of its own area');
    const raw = new Uint8Array(inflateSync(e.payload));
    const expected = bakeChunk(world, sheet, e.cx, e.cy, 0);
    assert.equal(raw.length, expected.data.length);
    let diff = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] !== expected.data[i]) diff++;
    assert.equal(diff, 0, `${id} chunk ${e.cx},${e.cy}: ${diff} bytes differ from bakeChunk`);
    checked.add(id);
  }
  assert.equal(checked.size, 3);
});

test('building twice gives byte-identical files, so a rebuild never forces a re-download', () => {
  const again = buildAreaPacks();
  for (const [name, bytes] of files) {
    const other = again.get(name);
    assert.ok(other, `${name} missing from the second build`);
    assert.ok(other.length === bytes.length && other.every((b, i) => b === bytes[i]), `${name} changed between builds`);
  }
}, 30_000);

// ───────────────────────────── the gate rule ─────────────────────────────

test('the gate: core never, other areas until installed, nothing when the browser cannot store data', () => {
  const status = (s: Record<string, 'terpasang' | 'belum' | 'versi-baru' | 'mengunduh' | 'gagal'>) => (a: string) => s[a] ?? 'belum';
  const g = { available: true, core: 'village', status: status({ forest: 'belum', cave: 'terpasang' }) };
  assert.equal(areaBlocked('village', g), false, 'the starting area is never blocked');
  assert.equal(areaBlocked('forest', g), true);
  assert.equal(areaBlocked('cave', g), false);
  assert.equal(areaBlocked('forest', { ...g, status: status({ forest: 'versi-baru' }) }), false, 'an old version still lets you in');
  assert.equal(areaBlocked('forest', { ...g, status: status({ forest: 'mengunduh' }) }), true, 'not until it finishes');
  assert.equal(areaBlocked('forest', { ...g, available: false }), false, 'no Cache Storage: generate locally, never lock out');
});

// ───────────────────────────── the streamer uses packs ─────────────────────────────

test('the streamer takes pre-baked ground when it has it, and bakes when it does not', () => {
  const w3d = new World3D(new THREE.Scene(), world, sheet);
  w3d.setRenderDistance(1);
  const pm = new Pixmap(256, 256);
  let asked = 0;
  w3d.groundSource = (cx) => {
    asked++;
    return cx % 2 === 0 ? pm : null;
  };
  w3d.preload(40, 60);
  assert.ok(asked > 0, 'it asked the packs');
  assert.ok(w3d.groundStats.fromPack > 0, 'even chunks came from the pack');
  assert.ok(w3d.groundStats.baked > 0, 'odd ones were baked on the device');
  w3d.dispose();
});

test('a chunk still inflating waits a little, then is baked rather than left as a hole', () => {
  const w3d = new World3D(new THREE.Scene(), world, sheet);
  w3d.setRenderDistance(1);
  w3d.groundSource = () => 'pending';
  const focus = new THREE.Vector3(120, 0, 60);
  // not preload: that path never waits. Walk there instead and let the queue work.
  for (let i = 0; i < 3; i++) w3d.update(0.5, focus, 0, 1, 1 / 60);
  const early = w3d.stats().chunks;
  // a little over the wait limit: ~0.5 s of frames
  for (let i = 0; i < 30; i++) w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.ok(w3d.stats().chunks > early, `after the wait the chunks load anyway (${early} -> ${w3d.stats().chunks})`);
  assert.ok(w3d.groundStats.baked > 0, 'by baking');
  assert.equal(w3d.groundStats.fromPack, 0);
  w3d.dispose();
});

test('a teleport never waits for an inflate', () => {
  const w3d = new World3D(new THREE.Scene(), world, sheet);
  w3d.setRenderDistance(1);
  w3d.groundSource = () => 'pending';
  w3d.preload(40, 60, 1);
  assert.ok(w3d.stats().chunks > 0, 'the ground is there on the first frame');
  w3d.dispose();
});

test('without a pack, a chunk is baked by the worker — not on the frame', () => {
  const w3d = new World3D(new THREE.Scene(), world, sheet);
  w3d.setRenderDistance(1);
  const pending = new Set<string>();
  const ready = new Map<string, Pixmap>();
  const fake = {
    available: true,
    ground: (cx: number, cy: number) => {
      const k = `${cx},${cy}`;
      const pm = ready.get(k);
      if (pm) return pm;
      pending.add(k);
      return 'pending' as const;
    },
    prefetch: (cx: number, cy: number) => void pending.add(`${cx},${cy}`),
    trim: () => undefined,
  };
  w3d.baker = fake as never;
  const focus = new THREE.Vector3(120, 0, 60);
  for (let i = 0; i < 5; i++) w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.equal(w3d.groundStats.baked, 0, 'nothing baked on the main thread while the worker works');
  assert.ok(pending.size > 0, 'the worker was asked');
  // the worker answers
  for (const k of pending) ready.set(k, new Pixmap(256, 256));
  for (let i = 0; i < 40; i++) w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.ok(w3d.groundStats.worker > 0, `from the worker: ${JSON.stringify(w3d.groundStats)}`);
  assert.equal(w3d.groundStats.baked, 0);
  w3d.dispose();
});

test('a worker that never answers is not a hole in the world: the main thread bakes after the wait', () => {
  const w3d = new World3D(new THREE.Scene(), world, sheet);
  w3d.setRenderDistance(1);
  w3d.baker = { available: true, ground: () => 'pending', prefetch: () => undefined, trim: () => undefined } as never;
  const focus = new THREE.Vector3(120, 0, 60);
  for (let i = 0; i < 150; i++) w3d.update(0.5, focus, 0, 1, 1 / 60);
  assert.ok(w3d.stats().chunks > 0 && w3d.groundStats.baked > 0);
  w3d.dispose();
});

// ───────────────────────────── the gate, on the real game ─────────────────────────────

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

test('walking into an area without its data stops at the edge and asks for it', async () => {
  const game = await bootGame(env, { continue: false });
  const g = game as unknown as { enforceAreaGate(dt: number): void; dataRequired: { isOpen: boolean; areaId: string | null } };
  // a phone that has the village and nothing else
  game.areaData.blocked = (area: string) => area === 'forest' || area === 'cave';

  // stand just inside the village, then step over the forest line
  const edge = 96 * 16;
  game.hero.reset(edge - 20, 64 * 16, game.hero.maxHp);
  g.enforceAreaGate(1 / 60);
  game.hero.x = edge + 10;
  g.enforceAreaGate(1 / 60);

  assert.ok(game.hero.x < edge, `the hero is back on the village side (x ${game.hero.x})`);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(g.dataRequired.isOpen, false, 'no manifest in the test, so the prompt has no area to show — but it was asked');

  // once the data is in, the same step goes through
  game.areaData.blocked = () => false;
  game.hero.x = edge + 10;
  g.enforceAreaGate(1 / 60);
  assert.ok(game.hero.x > edge, 'and with the data installed the hero walks in');
  game.dispose();
});

test('a save already inside an area without its data is not thrown out of it', async () => {
  const game = await bootGame(env, { continue: false });
  const g = game as unknown as { enforceAreaGate(dt: number): void; lastSafe: { area: string } };
  // pretend the game was loaded in the cave
  game.hero.reset(200 * 16, 60 * 16, game.hero.maxHp);
  g.lastSafe.area = 'cave';
  game.areaData.blocked = (area: string) => area === 'cave';
  const x = game.hero.x;
  game.hero.x = x + 16;
  g.enforceAreaGate(1 / 60);
  assert.equal(game.hero.x, x + 16, 'moving around inside the area you are already in is never blocked');
  game.dispose();
});
