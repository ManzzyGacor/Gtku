/**
 * The 3D night behind the title (`render3d/TitleBackdrop.ts`). The GL stub cannot draw, so the
 * final render call is replaced; what is checked is that it builds the real world around the Great
 * Lantern, that the camera drifts slowly and stays near it, and that it cleans up after itself —
 * it has to be gone before the game makes its own WebGL context.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { walkEls } from './mocks/dom-mock';
import { TitleBackdrop } from '../src/render3d/TitleBackdrop';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { u } from '../src/render3d/worldPlan';

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

test('the backdrop drifts slowly around the Great Lantern and leaves nothing behind', () => {
  const b = new TitleBackdrop(env.doc.body as unknown as HTMLElement);
  const inner = b as unknown as { pixels: { render(): void; renderer: { forceContextLoss(): void } }; camera: { target: { x: number; z: number } } };
  let frames = 0;
  inner.pixels.render = () => void frames++;
  inner.pixels.renderer.forceContextLoss = () => undefined;
  assert.equal(walkEls(env.doc.body).filter((e) => e.tagName === 'CANVAS').length, 1);

  const lantern = new GeneratedWorld().markers.lantern;
  let maxStep = 0;
  let prev = { x: inner.camera.target.x, z: inner.camera.target.z };
  let far = 0;
  for (let i = 0; i < 60 * 20; i++) {
    b.step(1 / 60);
    const t = inner.camera.target;
    maxStep = Math.max(maxStep, Math.hypot(t.x - prev.x, t.z - prev.z));
    far = Math.max(far, Math.hypot(t.x - u(lantern.x), t.z - u(lantern.y)));
    prev = { x: t.x, z: t.z };
  }
  assert.equal(frames, 1200);
  assert.ok(maxStep > 0, 'the camera moves');
  assert.ok(maxStep < u(2), `slowly: at most ${maxStep.toFixed(4)} units a frame`);
  assert.ok(far < u(100), `and stays around the lantern (${far.toFixed(1)} units away at most)`);

  b.dispose();
  assert.equal(walkEls(env.doc.body).filter((e) => e.tagName === 'CANVAS').length, 0, 'its canvas is gone');
  b.dispose();
});
