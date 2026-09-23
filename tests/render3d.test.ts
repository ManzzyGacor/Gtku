/**
 * The 3D pieces that can be checked without a GPU: the world→shapes plan, the pixel-buffer maths
 * and the isometric camera. Three.js core (vectors, cameras) runs fine in Node; only
 * `WebGLRenderer` needs a real context, and that is what the phone is for.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TILE, WORLD_TILES_H } from '../src/config';
import { planDisplay } from '../src/core/display';
import { FOREST_X0 } from '../src/core/world/areas';
import { PROPS } from '../src/core/world/props';
import { T } from '../src/core/world/tiles';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { IsoCamera, ISO_YAW_DEG, ZOOM_MAX, ZOOM_MIN } from '../src/render3d/IsoCamera';
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

test('the isometric camera is orthographic, fixed-angle and zoom-limited', () => {
  const cam = new IsoCamera();
  cam.setViewport(480, 270);
  assert.equal(cam.camera.isOrthographicCamera, true);
  assert.equal(cam.camera.right - cam.camera.left, 480 / TILE, 'one tile covers TILE pixels');
  assert.equal(cam.camera.top - cam.camera.bottom, 270 / TILE);

  cam.setZoom(99);
  assert.equal(cam.zoom, ZOOM_MAX);
  cam.setZoom(0);
  assert.equal(cam.zoom, ZOOM_MIN);
  cam.setZoom(1);

  cam.snap(20, 30);
  assert.deepEqual([cam.target.x, cam.target.z], [20, 30]);
  // the camera body sits off the target at the fixed angle and looks back at it
  assert.ok(cam.camera.position.y > 10, 'camera looks down from above');
  assert.ok(cam.camera.position.x > cam.target.x && cam.camera.position.z > cam.target.z);

  cam.follow(120, 30, 1 / 60);
  assert.ok(cam.target.x > 20 && cam.target.x < 120, 'follow eases instead of snapping');
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
