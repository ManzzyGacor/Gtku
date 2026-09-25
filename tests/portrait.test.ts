/**
 * The hero's portrait in the Karakter panel, and the gear that shows on the hero.
 *
 * The request: an avatar rendered from the real hero model, that changes when the equipment does.
 * Before this, equipment changed numbers only — the model looked the same whatever was worn — so
 * "changes with the gear" needed the gear to show on the model first (`core/items/look.ts`).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import * as THREE from 'three';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { walkEls } from './mocks/dom-mock';
import { gearLook } from '../src/core/items/look';
import { Inventory } from '../src/core/items/inventory';
import { HeroMesh3D } from '../src/render3d/HeroMesh3D';

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

test('the gear look follows the equipped slots and their rarity', () => {
  const inv = new Inventory(6);
  const bare = gearLook(inv.equipped);
  assert.equal(bare.helmet, null);
  assert.equal(bare.core, null);
  inv.add('helm_lamplighter', 1, 'legendary');
  const helm = inv.slots.findIndex((s) => s?.id === 'helm_lamplighter');
  assert.ok(helm >= 0, 'a helmet item exists');
  inv.equip(helm);
  const worn = gearLook(inv.equipped);
  assert.equal(worn.helmet, 0xffb02e, 'Legendaris gold');
  assert.notEqual(worn.key, bare.key, 'a new key, so the portrait knows to redraw');
});

test('setGear shows a helmet and pauldrons on the model, and repaints only on a change', () => {
  const scene = new THREE.Scene();
  const mesh = new HeroMesh3D(scene);
  const visibleBoxes = (): number => {
    let n = 0;
    scene.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  };
  const before = visibleBoxes();
  const look = { helmet: 0x5aa9ff, armor: 0xc07cff, gloves: null, boots: null, weapon: 0xffb02e, core: 0xff7a3a, key: 'k1' };
  mesh.setGear(look);
  assert.ok(visibleBoxes() >= before + 4, 'helmet (2) and pauldrons (2) appear');
  mesh.setGear({ ...look, helmet: null, armor: null, key: 'k2' });
  assert.equal(visibleBoxes(), before, 'and go again');
  mesh.dispose();
});

test('the Karakter panel shows a live portrait of the hero, and it follows the gear', async () => {
  const game = await bootGame(env, { continue: false });
  /*
   * The GL stub can build a renderer but not compile a shader (see helpers/game.ts), so the draw
   * and the read-back are replaced with counters: what is tested is *when* the portrait draws and
   * that it reaches the panel, not the pixels — those are for the phone.
   */
  const renderer = game.pixels.renderer;
  let reads = 0;
  renderer.render = () => undefined;
  renderer.readRenderTargetPixels = (() => void reads++) as typeof renderer.readRenderTargetPixels;

  // nothing is built or rendered while the panel has never been opened
  assert.equal((game as unknown as { portrait: unknown }).portrait, null);

  game.sheet.openTab('char');
  const frame = walkEls(env.doc.body).find((e) => e.classes.has('lm-portrait'));
  assert.ok(frame, 'the portrait frame is in the Karakter tab');
  assert.ok(walkEls(frame!).some((e) => e.tagName === 'CANVAS'), 'with the rendered canvas in it');
  assert.ok(reads >= 1, 'drawn once on opening');

  // live while visible: a second of frames redraws it about ten times, not sixty
  const portrait = (game as unknown as { portrait: { update(dt: number, v: boolean): void } }).portrait;
  const r0 = reads;
  for (let i = 0; i < 60; i++) portrait.update(1 / 60, game.sheet.showingCharacter);
  assert.ok(reads - r0 >= 8 && reads - r0 <= 11, `${reads - r0} redraws in one second`);

  // closed: silent
  game.sheet.hide();
  const r1 = reads;
  for (let i = 0; i < 60; i++) portrait.update(1 / 60, game.sheet.showingCharacter);
  assert.equal(reads, r1, 'no renders while the panel is closed');

  // a gear change repaints once even while closed, so it is right the next time it opens
  game.character.inventory.add('helm_lamplighter', 1, 'epic');
  const idx = game.character.inventory.slots.findIndex((s) => s?.id === 'helm_lamplighter');
  game.character.inventory.equip(idx);
  game.applySheet();
  portrait.update(1 / 60, false);
  assert.equal(reads, r1 + 1);
  game.dispose();
});
