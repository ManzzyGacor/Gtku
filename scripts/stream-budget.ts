/**
 * How many chunks each graphics preset streams on the reported test device, and what that costs.
 * Run: npx tsx scripts/stream-budget.ts [cssW] [cssH] [dpr]
 */
import * as THREE from 'three';
import { CHUNK_TILES } from '../src/config';
import { buildTileSheet } from '../src/art/tiles';
import { PRESET_IDS, settings } from '../src/core/settings';
import { profileOf } from '../src/core/graphics';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { IsoCamera } from '../src/render3d/IsoCamera';
import { World3D } from '../src/render3d/World3D';

const cssW = Number(process.argv[2] ?? 828);
const cssH = Number(process.argv[3] ?? 271);
const dpr = Number(process.argv[4] ?? 2.8);

const world = new GeneratedWorld();
const tileSheet = buildTileSheet();
const start = world.markers.playerStart;
console.log(`layar ${cssW}x${cssH} css, dpr ${dpr} (= ${Math.round(cssW * dpr)}x${Math.round(cssH * dpr)} px perangkat)`);
console.log('preset          grid pixel  skala radius  chunk  tekstur  instance  draw');

for (const id of PRESET_IDS) {
  settings.set('presetAuto', false);
  settings.set('preset', id);
  settings.reset(['camPitch', 'camZoom']);
  const p = profileOf(id);
  const deviceW = Math.round(cssW * dpr);
  const deviceH = Math.round(cssH * dpr);
  const pixelH = Math.min(p.pixelHeight, deviceH);
  const pixelW = Math.round(pixelH * (deviceW / deviceH));
  const cam = new IsoCamera();
  cam.setAspect(pixelW / pixelH);
  const radius = Math.min(6, Math.ceil(cam.viewRadius / CHUNK_TILES) + p.chunkMargin);

  const scene = new THREE.Scene();
  const w3d = new World3D(scene, world, tileSheet);
  w3d.setRenderDistance(radius);
  const focus = new THREE.Vector3(start.x / 16, 0, start.y / 16);
  // settle: walk a little so the hysteresis ring fills the way it would in play
  w3d.preload(focus.x, focus.z);
  for (let i = 0; i < 400; i++) w3d.update(0.5, focus, 0, 8, 1 / 60);
  const s = w3d.stats();
  const mb = (s.chunks * 256 * 256 * 4) / 1e6;
  console.log(
    `${p.name.padEnd(14)} ${`${pixelW}x${pixelH}`.padEnd(11)} ${(deviceH / pixelH).toFixed(2).padEnd(5)} ` +
      `${String(radius).padEnd(7)} ${String(s.chunks).padEnd(6)} ${`${mb.toFixed(1)} MB`.padEnd(8)} ${String(s.instances).padEnd(9)} ${s.draws}`,
  );
  w3d.dispose();
  cam.dispose();
}
