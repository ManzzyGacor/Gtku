/**
 * Batch "senjata terlihat": each melee weapon type fights differently (as data), shows its own model
 * in the hand and its own slash, and hits throw pooled particles coloured by the element.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { HeroCore, ATTACKS } from '../src/core/entities/HeroCore';
import { MELEE_STYLES, type MeleeStyle } from '../src/core/combat/weapons';
import { ITEMS } from '../src/core/items/items';
import { HeroMesh3D } from '../src/render3d/HeroMesh3D';
import { Particles, BURSTS, ELEMENT_BURSTS } from '../src/render3d/Particles';

const STYLES: MeleeStyle[] = ['sword', 'dagger', 'hammer', 'spear'];

test('weapon styles shape the swing: dagger fast and light, hammer slow and heavy, spear long and narrow', () => {
  const h = new HeroCore(0, 0);
  const of = (s: MeleeStyle): { t: number; dmg: number; range: number; arc: number } => {
    h.meleeStyle = s;
    const a = h.attackDef;
    return { t: a.windup + a.active + a.recover, dmg: a.dmg, range: a.range, arc: a.arc };
  };
  const sword = of('sword');
  const dagger = of('dagger');
  const hammer = of('hammer');
  const spear = of('spear');
  const base = ATTACKS[0];
  assert.equal(sword.dmg, base.dmg, 'the sword is the reference');
  assert.ok(dagger.t < sword.t && dagger.dmg < sword.dmg);
  assert.ok(hammer.t > sword.t && hammer.dmg > sword.dmg);
  assert.ok(spear.range > sword.range && spear.arc < sword.arc);
  // DPS stays in the same ballpark: no style is simply better
  for (const s of STYLES) {
    const st = MELEE_STYLES[s];
    const dps = st.dmg / st.time;
    assert.ok(dps > 0.8 && dps < 1.25, `${s} dps ratio ${dps.toFixed(2)}`);
  }
  // attackDef is reused, not allocated per read
  assert.equal(h.attackDef, h.attackDef);
});

test('every style is reachable through an item', () => {
  for (const s of STYLES.slice(1)) assert.ok(Object.values(ITEMS).some((d) => d.style === s), `an item with style ${s}`);
});

test('the hand shows the equipped style, and only that one', () => {
  const parent = new THREE.Group();
  const mesh = new HeroMesh3D(parent);
  const hero = new HeroCore(0, 0);
  const weapons = (mesh as unknown as { weapons: Map<MeleeStyle, THREE.Group> }).weapons;
  for (const s of STYLES) {
    hero.meleeStyle = s;
    mesh.update(1 / 60, 1 / 60, hero, 0);
    for (const [k, g] of weapons) assert.equal(g.visible, k === s, `${s}: ${k} visible=${g.visible}`);
  }
  // with the bow out, no melee weapon shows
  hero.slot = 1;
  mesh.update(1 / 60, 1 / 60, hero, 0);
  if (hero.isRanged) for (const g of weapons.values()) assert.equal(g.visible, false);
  mesh.dispose();
});

test('particles are pooled: a thousand bursts never grow the pool, and the budget scales the count', () => {
  const scene = new THREE.Scene();
  const p = new Particles(scene, 64);
  const before = scene.children.length;
  for (let i = 0; i < 1000; i++) p.hit(0, 0, 'api', i % 3 === 0);
  assert.equal(scene.children.length, before, 'no new objects');
  for (const c of scene.children) assert.ok((c as THREE.InstancedMesh).count <= 64);

  p.emitted = 0;
  p.setBudget(1);
  p.burst('hit', 0, 0);
  const full = p.emitted;
  assert.equal(full, BURSTS.hit.count);
  p.emitted = 0;
  p.setBudget(0.35);
  p.burst('hit', 0, 0);
  assert.ok(p.emitted < full && p.emitted > 0, 'the weakest preset still shows a hit');
  p.dispose();
  assert.equal(scene.children.length, 0);
});

test('each element adds its own burst to a hit, and a crit adds more', () => {
  assert.deepEqual(ELEMENT_BURSTS.api, ['ember', 'smoke']);
  assert.ok(BURSTS.ember.gravity < 0, 'embers rise');
  assert.ok(BURSTS.shard.gravity > 0 && BURSTS.splash.gravity > 0, 'ice and water fall');
  const p = new Particles(new THREE.Scene());
  const count = (el: Parameters<Particles['hit']>[2], crit: boolean): number => {
    p.emitted = 0;
    p.hit(0, 0, el, crit);
    return p.emitted;
  };
  const plain = count(undefined, false);
  for (const el of ['api', 'air', 'es', 'petir'] as const) assert.ok(count(el, false) > plain, el);
  assert.ok(count(undefined, true) > plain, 'crit');
});
