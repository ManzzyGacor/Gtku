/**
 * The 3D pieces that can be checked without a GPU: the world→shapes plan, the pixel-buffer maths
 * and the isometric camera. Three.js core (vectors, cameras) runs fine in Node; only
 * `WebGLRenderer` needs a real context, and that is what the phone is for.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { TILE, WORLD_TILES_H } from '../src/config';
import { planDisplay } from '../src/core/display';
import { FOREST_X0 } from '../src/core/world/areas';
import { PROPS } from '../src/core/world/props';
import { T } from '../src/core/world/tiles';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { IsoCamera, ISO_YAW_DEG, PITCH_MAX, PITCH_MIN, ZOOM_MAX, ZOOM_MIN } from '../src/render3d/IsoCamera';
import { DEFAULTS, settings } from '../src/core/settings';
import { buildGreyboxTextures } from '../src/art/greybox';
import { countKinds, groupShapes, planArea, u, UNITS_PER_PX, WALL_HEIGHT } from '../src/render3d/worldPlan';
import { pixmapTexture } from '../src/render3d/textures';
import { Pixmap } from '../src/art/pixmap';

const world = new GeneratedWorld();
const VILLAGE = { x0: 0, y0: 0, x1: FOREST_X0, y1: WORLD_TILES_H };
const plan = planArea(world, VILLAGE);

test('one tile is one world unit, so every number in src/core stays valid', () => {
  assert.equal(UNITS_PER_PX, 1 / TILE);
  assert.equal(u(TILE), 1, 'one tile of pixels = one unit');
  assert.equal(u(0), 0);
  assert.equal(u(TILE * 48), 48);
});

test('the village plan covers every chunk in the area and produces real geometry', () => {
  const wantChunks = (FOREST_X0 / 16) * (WORLD_TILES_H / 16);
  assert.equal(plan.chunks.length, wantChunks, `expected ${wantChunks} chunks`);
  assert.deepEqual(plan.rect, VILLAGE);
  assert.ok(plan.shapes.length > 100, `village should have plenty of scenery, got ${plan.shapes.length}`);

  const kinds = countKinds(plan);
  assert.equal(kinds.box + kinds.prism, plan.shapes.length);
  assert.ok(kinds.box > 0 && kinds.prism > 0, 'houses and tree crowns need both shapes');
});

test('every shape is finite, has a positive size and sits inside the area', () => {
  for (const s of plan.shapes) {
    for (const v of [s.x, s.y, s.z, s.sx, s.sy, s.sz]) assert.ok(Number.isFinite(v), `non-finite value in ${s.texture} shape`);
    assert.ok(s.sx > 0 && s.sy > 0 && s.sz > 0, `zero-sized ${s.texture} shape`);
    assert.ok(s.y > 0, 'shapes are centred above the ground, not sunk into it');
    // a few units of slack for roofs that overhang the last tile
    assert.ok(s.x >= -4 && s.x <= VILLAGE.x1 + 4, `x out of area: ${s.x}`);
    assert.ok(s.z >= -4 && s.z <= VILLAGE.y1 + 4, `z out of area: ${s.z}`);
  }
});

test('wall tiles become blocks of the documented height, and only wall tiles do', () => {
  let walls = 0;
  for (let ty = VILLAGE.y0; ty < VILLAGE.y1; ty++)
    for (let tx = VILLAGE.x0; tx < VILLAGE.x1; tx++) if (world.tileAt(tx, ty) === T.WALL) walls++;
  const blocks = plan.shapes.filter((s) => s.sy === WALL_HEIGHT && s.sx === 1 && s.sz === 1);
  assert.equal(blocks.length, walls, 'one block per wall tile');
  for (const b of blocks) {
    assert.equal(world.tileAt(Math.floor(b.x), Math.floor(b.z)), T.WALL);
    assert.equal(b.y, WALL_HEIGHT / 2, 'centred so the block rests on the ground');
  }
  assert.deepEqual(planArea(world, VILLAGE, { walls: false }).shapes.filter((s) => s.sy === WALL_HEIGHT && s.sx === 1).length, 0);
});

test('prop lights carry over from the 2D lightmap with converted units', () => {
  assert.ok(plan.lights.length > 0, 'the village has lamps');
  const lamp = PROPS.lamp.light!;
  const match = plan.lights.find((l) => l.color === lamp.color);
  assert.ok(match, 'the street lamp light is in the plan');
  assert.equal(match.radius, u(lamp.radius), 'radius converted to world units');
  assert.equal(match.intensity, lamp.strength);
  assert.equal(match.nightOnly, true);
  for (const l of plan.lights) assert.ok(l.radius > 0 && Number.isFinite(l.y));
});

test('the greybox textures are all 16x16 and fully opaque', () => {
  const tex = buildGreyboxTextures();
  const names = Object.keys(tex);
  assert.ok(names.length >= 8, `expected the full set, got ${names.join(', ')}`);
  for (const [name, pm] of Object.entries(tex)) {
    assert.equal(pm.w, 16, `${name} width`);
    assert.equal(pm.h, 16, `${name} height`);
    for (let i = 3; i < pm.data.length; i += 4) {
      if (pm.data[i] !== 255) throw new Error(`${name} has a transparent pixel; greybox surfaces must be solid`);
    }
  }
});

test('the pixel buffer keeps whole-number zoom at the requested grid height', () => {
  for (const targetH of [270, 324, 360]) {
    const p = planDisplay(2340, 1080, 1, targetH);
    assert.equal(p.zoom, Math.round(1080 / targetH), `zoom for ${targetH}`);
    assert.ok(Number.isInteger(p.zoom) && p.zoom >= 1);
    assert.ok(p.height * p.zoom <= 1080, 'buffer never exceeds the screen');
    assert.ok(Math.abs(p.height - targetH) <= targetH / 2);
  }
  // a taller pixel grid means a smaller integer zoom, i.e. more pixels on screen
  const a = planDisplay(1600, 720, 2, 270);
  const b = planDisplay(1600, 720, 2, 360);
  assert.ok(b.height > a.height, `${b.height} should be more rows than ${a.height}`);
});

test('the camera is orthographic, its frustum matches the pixel buffer, and zoom means closer', () => {
  settings.reset(['camPitch', 'camZoom']);
  const cam = new IsoCamera();
  cam.setViewport(480, 270);
  assert.equal(cam.camera.isOrthographicCamera, true);
  const wide = cam.camera.right - cam.camera.left;
  assert.ok(Math.abs(wide - 480 / TILE / DEFAULTS.camZoom) < 1e-6, `frustum ${wide}`);

  settings.set('camZoom', 1);
  cam.setViewport(480, 270);
  assert.equal(cam.camera.right - cam.camera.left, 480 / TILE, 'at zoom 1 one tile covers TILE pixels');
  assert.equal(cam.camera.top - cam.camera.bottom, 270 / TILE);

  settings.set('camZoom', 2);
  cam.setViewport(480, 270);
  assert.ok(cam.camera.right - cam.camera.left < 480 / TILE, 'more zoom shows less world = closer to the hero');

  settings.set('camZoom', 99);
  assert.equal(cam.zoom, ZOOM_MAX, 'clamped to the settings range');
  settings.set('camZoom', 0);
  assert.equal(cam.zoom, ZOOM_MIN);
  settings.reset(['camZoom']);
  cam.dispose();
});

test('the camera tilt follows the setting and stays a 3/4 view', () => {
  settings.reset(['camPitch', 'camZoom']);
  assert.ok(DEFAULTS.camPitch >= 35 && DEFAULTS.camPitch <= 45, `default tilt ${DEFAULTS.camPitch}° should be a side-on 3/4 view`);
  const cam = new IsoCamera();
  cam.setViewport(480, 270);

  /** Elevation of the camera above the ground, measured from where it actually ended up. */
  const elevation = (): number => {
    cam.snap(40, 40);
    const p = cam.camera.position.clone().sub(cam.target);
    return (Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180) / Math.PI;
  };
  assert.ok(Math.abs(elevation() - DEFAULTS.camPitch) < 0.01, `elevation ${elevation()} should equal the setting`);

  settings.set('camPitch', 25);
  assert.ok(Math.abs(elevation() - 25) < 0.01, 'a lower setting really lowers the camera');
  settings.set('camPitch', 50);
  assert.ok(Math.abs(elevation() - 50) < 0.01);
  settings.set('camPitch', 999);
  assert.equal(cam.pitch, PITCH_MAX, 'clamped');
  settings.set('camPitch', -5);
  assert.equal(cam.pitch, PITCH_MIN);

  settings.reset(['camPitch']);
  assert.equal(cam.pitch, DEFAULTS.camPitch, 'reset puts the default back');

  cam.snap(20, 30);
  assert.equal(cam.target.x, 20);
  assert.equal(cam.target.z, 30);
  assert.ok(cam.target.y > 0, 'aims a little above the ground so the hero sits centred');
  assert.ok(cam.camera.position.y > 10, 'camera still looks down from above');
  assert.ok(cam.camera.position.x > cam.target.x && cam.camera.position.z > cam.target.z);

  cam.follow(120, 30, 1 / 60);
  assert.ok(cam.target.x > 20 && cam.target.x < 120, 'follow eases instead of snapping');

  // a flatter camera sees further along the ground, which the chunk streamer needs to know
  settings.set('camPitch', PITCH_MAX);
  const steep = cam.viewRadius;
  settings.set('camPitch', PITCH_MIN);
  assert.ok(cam.viewRadius > steep, `flat ${cam.viewRadius} should see further than steep ${steep}`);
  settings.reset(['camPitch']);
  cam.dispose();
});

test('stick input is rotated into the world, so "up" walks away from the camera', () => {
  const cam = new IsoCamera();
  cam.snap(0, 0);
  const up = cam.stickToWorld(0, -1);
  assert.ok(Math.abs(up.length() - 1) < 1e-6, 'rotation preserves magnitude');
  // away from the camera = opposite the camera's ground offset
  assert.ok(up.x < 0 && up.y < 0, `up should head away from the camera, got ${up.x},${up.y}`);
  const right = cam.stickToWorld(1, 0);
  assert.ok(Math.abs(up.x * right.x + up.y * right.y) < 1e-6, 'up and right stay perpendicular');
  assert.equal(ISO_YAW_DEG, 45, 'the diamond angle is fixed');
  const none = cam.stickToWorld(0, 0);
  assert.equal(none.length(), 0);
});

test('shapes group into one instanced draw per (shape, texture, lit) combination', () => {
  const groups = groupShapes(plan.shapes);
  assert.ok(groups.length > 1 && groups.length < 24, `expected a handful of draw groups, got ${groups.length}`);
  assert.equal(groups.reduce((n, g) => n + g.shapes.length, 0), plan.shapes.length, 'no shape is lost or duplicated');
  const keys = groups.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  for (const g of groups) {
    assert.ok(g.shapes.length > 0);
    for (const s of g.shapes) {
      assert.equal(s.kind, g.kind);
      assert.equal(s.texture, g.texture);
      assert.equal(!!s.emissive, g.emissive);
    }
  }
  assert.ok(groups.some((g) => g.emissive), 'lantern glass is drawn unlit');
});

test('ground textures upload with their rows flipped, so north stays north', () => {
  // top row red, bottom row blue
  const pm = new Pixmap(2, 2);
  pm.set(0, 0, 0xff0000).set(1, 0, 0xff0000).set(0, 1, 0x0000ff).set(1, 1, 0x0000ff);
  const plain = pixmapTexture(pm);
  const flipped = pixmapTexture(pm, { flipRows: true });
  const bytes = (t: ReturnType<typeof pixmapTexture>): Uint8Array => t.image.data as Uint8Array;
  assert.equal(bytes(plain)[0], 255, 'unflipped keeps red first');
  assert.equal(bytes(flipped)[0], 0, 'flipped starts with the blue row');
  assert.equal(bytes(flipped)[2], 255);
  assert.equal(bytes(flipped).length, bytes(plain).length);
  // the source pixmap must not be modified
  assert.equal(pm.colorAt(0, 0), 0xff0000);
});

test('the hero cutout only touches things between the camera and the hero', async () => {
  const { coverAmount, isCutOut, ditherThreshold, FADE_RADIUS, FADE_BIAS } = await import('../src/render3d/occlusion');
  const hero = { x: 0, y: 0, z: -70 }; // view space: camera looks down -Z

  assert.equal(coverAmount(hero, hero), 0, 'level with the hero is not "in front of" them');
  assert.equal(coverAmount({ x: 0, y: 0, z: -70 + FADE_BIAS }, hero), 0, 'nor is the bias band');
  assert.equal(coverAmount({ x: 0, y: 0, z: -69 }, hero), 1, 'a metre in front of the hero, dead centre');
  assert.equal(coverAmount({ x: 0, y: 0, z: -80 }, hero), 0, 'behind the hero: never cut');

  // outside the ellipse nothing happens, inside it rises smoothly toward the centre
  assert.equal(coverAmount({ x: FADE_RADIUS.x, y: 0, z: -69 }, hero), 0, 'exactly on the edge');
  assert.equal(coverAmount({ x: 9, y: 0, z: -69 }, hero), 0, 'far to the side');
  const near = coverAmount({ x: 0.3, y: 0.2, z: -69 }, hero);
  const mid = coverAmount({ x: 0.9, y: 0.5, z: -69 }, hero);
  assert.ok(near > mid && mid > 0, `cover should fall off outward (${near} > ${mid} > 0)`);

  // the dither spreads across the 4x4 cell, so a partly covered object dissolves instead of popping
  const thresholds = new Set<number>();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) thresholds.add(ditherThreshold(x, y));
  assert.ok(thresholds.size >= 8, `dither needs several levels, got ${thresholds.size}`);
  for (const t of thresholds) assert.ok(t > 0 && t < 1);
  assert.equal(ditherThreshold(4, 8), ditherThreshold(0, 0), 'the pattern tiles');
  assert.equal(ditherThreshold(-4, -8), ditherThreshold(0, 0), 'and handles negative coordinates');

  // at half cover roughly half the pixels of a cell survive
  let cut = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (isCutOut({ x: 0.85, y: 0, z: -69 }, hero, x, y)) cut++;
  assert.ok(cut > 2 && cut < 14, `partial cover should dissolve, not pop (${cut}/16 pixels cut)`);
  assert.equal([...Array(16).keys()].filter((i) => isCutOut({ x: 0, y: 0, z: -69 }, hero, i % 4, Math.floor(i / 4))).length, 16, 'full cover removes the whole cell');
});

test('a tree between the real camera and the hero is cut out; one behind it is not', async () => {
  const { coverAmount, FADE_LIFT } = await import('../src/render3d/occlusion');
  settings.reset(['camPitch', 'camZoom']);
  const cam = new IsoCamera();
  cam.setViewport(480, 270);
  const heroWorld = new THREE.Vector3(40, 0, 40);
  cam.snap(heroWorld.x, heroWorld.z);

  const toView = (p: THREE.Vector3): THREE.Vector3 => p.clone().applyMatrix4(cam.camera.matrixWorldInverse);
  const heroView = toView(new THREE.Vector3(heroWorld.x, heroWorld.y + FADE_LIFT, heroWorld.z));

  // the camera sits at +x/+z of the target, so "between camera and hero" means a bit toward +x/+z
  const inFront = toView(new THREE.Vector3(heroWorld.x + 1.4, 1.6, heroWorld.z + 1.4));
  assert.ok(coverAmount(inFront, heroView) > 0, 'a tree crown right in front of the hero dissolves');

  const behind = toView(new THREE.Vector3(heroWorld.x - 1.4, 1.6, heroWorld.z - 1.4));
  assert.equal(coverAmount(behind, heroView), 0, 'the same crown on the far side stays solid');

  const offToTheSide = toView(new THREE.Vector3(heroWorld.x + 6, 1.6, heroWorld.z + 6));
  assert.equal(coverAmount(offToTheSide, heroView), 0, 'and one well off to the side stays solid');

  const ground = toView(new THREE.Vector3(heroWorld.x + 2, 0, heroWorld.z + 2));
  assert.ok(coverAmount(ground, heroView) < 0.7, 'the ground under the hero is barely touched');
  cam.dispose();
});
