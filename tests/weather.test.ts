/**
 * "Cuaca terlihat rusak": rain, storm and fog were a grey screen. The cause was the fog (the whole
 * camera distance multiplied by the weather, which put the fog in front of the hero); these tests
 * pin the fix, and the rain, splashes, puddles and lightning that replaced the grey.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import * as THREE from 'three';
import { fogDistances, fogFactor, Lightning, MAX_FOG_AT_HERO, WEATHER, WEATHER_IDS, wetnessStep } from '../src/core/systems/weather';
import { CAMERA_DISTANCE, IsoCamera } from '../src/render3d/IsoCamera';
import { Rain } from '../src/render3d/Rain';
import { BEDS } from '../src/core/audio/beds';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';

const radius = new IsoCamera().viewRadius;
const loaded = CAMERA_DISTANCE + 16 * 0.92; // radius-1 streaming, the worst case

test('the old formula fogged the hero completely (the grey screen), the new one never does', () => {
  // what the first version did: camera-distance fog range × a weather factor
  const raw: [number, number] = [CAMERA_DISTANCE + radius * 0.15, CAMERA_DISTANCE + radius * 1.3];
  const oldFar = Math.min(raw[1], loaded) * 0.45;
  const oldNear = Math.min(raw[0] * 0.45, oldFar - 8);
  assert.equal(fogFactor(CAMERA_DISTANCE, oldNear, oldFar), 1, 'the bug: fully fogged at the hero');

  const out: [number, number] = [0, 0];
  for (const w of WEATHER_IDS)
    for (const night of [0, 0.5, 1])
      for (const cave of [0, 0.5, 1]) {
        const [near, far] = fogDistances(CAMERA_DISTANCE, radius, loaded, WEATHER[w], night, cave, out);
        const atHero = fogFactor(CAMERA_DISTANCE, near, far);
        assert.ok(atHero <= MAX_FOG_AT_HERO + 1e-9, `${w} night ${night} cave ${cave}: ${atHero.toFixed(2)} at the hero`);
        assert.ok(far <= loaded + 1e-9, 'the fog is total before the streamed world ends');
        assert.ok(far > near);
      }
});

test('fog weather is thin at the hero and thick further out — and thicker than clear weather', () => {
  const a: [number, number] = [0, 0];
  const b: [number, number] = [0, 0];
  const [cn, cf] = fogDistances(CAMERA_DISTANCE, radius, 999, WEATHER.cerah, 0, 0, a);
  const [fn, ff] = fogDistances(CAMERA_DISTANCE, radius, 999, WEATHER.berkabut, 0, 0, b);
  const mid = CAMERA_DISTANCE + radius * 0.6;
  assert.ok(fogFactor(mid, fn, ff) > fogFactor(mid, cn, cf) + 0.3, 'fog is visibly foggier in the middle distance');
  assert.ok(fogFactor(CAMERA_DISTANCE + radius * 1.3, fn, ff) > 0.95, 'and total far away');
  assert.ok(fogFactor(CAMERA_DISTANCE, fn, ff) < fogFactor(mid, fn, ff), 'thinner near the hero');
  assert.ok(WEATHER.berkabut.mist > 0, 'plus drifting ground mist');
});

test('lightning: strikes on its own in a storm, never in clear weather, thunder once per strike', () => {
  const l = new Lightning();
  let r = 0.5;
  const rand = (): number => (r = (r * 9301 + 49297) % 233280 / 233280);
  for (let i = 0; i < 60 * 60; i++) l.update(1 / 60, 0, rand);
  assert.equal(l.strikes, 0);
  let thunders = 0;
  let maxFlash = 0;
  for (let i = 0; i < 60 * 60; i++) {
    l.update(1 / 60, WEATHER.badai.lightning, rand);
    maxFlash = Math.max(maxFlash, l.flash);
    assert.ok(l.flash >= 0 && l.flash <= 1);
    if (l.takeThunder()) thunders++;
  }
  assert.ok(l.strikes >= 3 && l.strikes <= 15, `${l.strikes} strikes in a minute`);
  assert.equal(maxFlash, 1);
  assert.ok(Math.abs(thunders - l.strikes) <= 1, 'a thunder for every strike');
  // the flash is brief
  l.strike(rand);
  for (let i = 0; i < 40; i++) l.update(1 / 60, 0, rand);
  assert.equal(l.flash, 0);
});

test('puddles fill while it rains and dry after', () => {
  let w = 0;
  for (let i = 0; i < 30; i++) w = wetnessStep(w, 1, 1);
  assert.ok(w > 0.95, `wet after 30 s of storm: ${w}`);
  for (let i = 0; i < 20; i++) w = wetnessStep(w, 0, 1);
  assert.ok(w > 0.3 && w < 0.8, 'still wet a little after');
  for (let i = 0; i < 60; i++) w = wetnessStep(w, 0, 1);
  assert.equal(w, 0);
  assert.equal(wetnessStep(NaN, 1, NaN), 0);
});

test('rain draws streaks, splashes and puddles — and nothing at all when dry', () => {
  const scene = new THREE.Scene();
  const rain = new Rain(scene);
  const focus = new THREE.Vector3(10, 0, 10);
  rain.update(1 / 60, focus, 0, 0, 0, 0, 1);
  assert.deepEqual(rain.parts, { streaks: 0, splashes: 0, puddles: false });
  rain.update(1 / 60, focus, 0, 1, 4, 0.8, 1, new THREE.Color(0x445566));
  const p = rain.parts;
  assert.ok(p.streaks > 300 && p.splashes > 50 && p.puddles);
  // the weakest preset: fewer, never none
  rain.update(1 / 60, focus, 0, 1, 4, 0.8, 0.3);
  assert.ok(rain.parts.streaks > 100 && rain.parts.streaks < p.streaks);
  // stopped raining, ground still wet: puddles only
  rain.update(1 / 60, focus, 0, 0, 0, 0.5, 1);
  assert.deepEqual(rain.parts, { streaks: 0, splashes: 0, puddles: true });
  rain.dispose();
  assert.equal(scene.children.length, 0);
});

test('every weather ambience exists; rain has its own sound, not the prologue storm', () => {
  for (const w of WEATHER_IDS) {
    const a = WEATHER[w].ambient;
    if (a) assert.ok(BEDS[a], `${w}: bed ${a}`);
  }
  assert.equal(WEATHER.hujan.ambient, 'rain');
  assert.ok(WEATHER.badai.darken >= 0.75, 'a storm is darker, never unreadable');
});

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => {
  removeGameEnv();
});

test('in the game: storm = rain + puddles + lightning flashes on the grade, fog off the hero', async () => {
  const game = await bootGame(env, { continue: false });
  game.pixels.render = () => undefined;
  const uniforms = (game.pixels as unknown as { quadMaterial: THREE.ShaderMaterial }).quadMaterial.uniforms;
  const gain = (): number => (uniforms.uGradeGain.value as THREE.Color).r;
  game.step(1 / 60);
  const clear = gain();
  game.setWeather('badai');
  for (let i = 0; i < 60; i++) game.step(1 / 30);
  const fog = game.sky.fog;
  assert.ok(fogFactor(CAMERA_DISTANCE, fog.near, fog.far) <= MAX_FOG_AT_HERO + 1e-6, `fog ${fog.near}-${fog.far}`);
  const rain = (game as unknown as { rain: Rain }).rain;
  assert.ok(rain.parts.streaks > 0 && rain.parts.puddles);
  const storm = gain();
  assert.ok(storm < clear, 'the storm darkens');
  game.strikeLightning();
  game.step(1 / 60);
  assert.ok(gain() > storm * 1.5, 'a flash lights everything up');
  const report = (game as unknown as { extraReport(): string[] }).extraReport();
  assert.ok(report.some((l) => l.startsWith('cuaca: Badai')), report.join('\n'));
  game.dispose();
});
