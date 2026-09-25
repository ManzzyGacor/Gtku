/**
 * "Di gua, tampilan gelap sekali" — the cave's floor of light, the lantern as the main light, the
 * torches and crystals that stay lit whatever AUTO does, and the brightness setting.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import * as THREE from 'three';
import { World3D, CAVE_AMBIENT_FLOOR } from '../src/render3d/World3D';
import { HeroMesh3D, CAVE_LANTERN } from '../src/render3d/HeroMesh3D';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { buildTileSheet } from '../src/art/tiles';
import { PROPS } from '../src/core/world/props';
import { AREAS } from '../src/core/world/areas';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { settings } from '../src/core/settings';

test('underground the ambient never drops to black', () => {
  const w3d = new World3D(new THREE.Scene(), new GeneratedWorld(), buildTileSheet());
  w3d.update(0.95, new THREE.Vector3(0, 0, 0), 1, 0, 1 / 60);
  const hemi = (w3d as unknown as { hemi: THREE.HemisphereLight }).hemi;
  assert.ok(hemi.intensity >= 0.55 + CAVE_AMBIENT_FLOOR - 1e-9, `hemi ${hemi.intensity}`);
  const brightest = Math.max(...AREAS.cave.ambient);
  assert.ok(brightest >= 0.6, 'the cave ambient colour is not near-black any more');
  w3d.dispose();
});

test('the lantern reaches much further and burns brighter underground', () => {
  const mesh = new HeroMesh3D(new THREE.Scene());
  const outside = mesh.lantern.distance;
  mesh.setCave(1);
  assert.ok(Math.abs(mesh.lantern.distance - outside * (1 + CAVE_LANTERN.range)) < 1e-6);
  mesh.setLanternRange(1.2);
  assert.ok(mesh.lantern.distance > outside * 2, 'gear that extends the lantern still counts');
  mesh.dispose();
});

test('torches and crystals mark the way with light that does not depend on dynamic lights', () => {
  // baked light pools on the floor: they stay when AUTO turns the dynamic lights down
  for (const p of ['torch', 'crystal_a', 'crystal_b'] as const) {
    const light = PROPS[p].light;
    assert.ok(light && !light.nightOnly && light.radius >= 60, `${p} lights the floor by itself`);
  }
});

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => {
  settings.set('brightness', 1);
  removeGameEnv();
});

test('the brightness setting brightens the picture, shadows included', async () => {
  const game = await bootGame(env, { continue: false });
  const uniforms = (game.pixels as unknown as { quadMaterial: THREE.ShaderMaterial }).quadMaterial.uniforms;
  const gain = () => (uniforms.uGradeGain.value as THREE.Color).r;
  const lift = () => (uniforms.uGradeLift.value as THREE.Color).r;
  game.pixels.render = () => undefined;
  game.step(1 / 60);
  const g1 = gain();
  const l1 = lift();
  settings.set('brightness', 1.5);
  game.step(1 / 60);
  assert.ok(gain() > g1 * 1.4, `gain ${g1} → ${gain()}`);
  assert.ok(lift() > l1, 'and the shadows lift a little');
  game.dispose();
});
