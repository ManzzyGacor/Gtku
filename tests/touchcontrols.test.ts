/**
 * The DOM joystick. It is the only way the game is played on the target device, so its maths is
 * tested directly: dead zone, clamping, the base following the thumb, and the action buttons.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';

const W = 900;
const H = 412;
const g = globalThis as Record<string, unknown>;
g.window = { innerWidth: W, innerHeight: H, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} };
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const doc = installDom();

const { TouchControls } = await import('../src/ui/TouchControls');
const { input } = await import('../src/core/input');
const { settings } = await import('../src/core/settings');

const controls = new TouchControls(doc.body as unknown as HTMLElement);
const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;

/** Fire a pointer event on the control layer, the way a finger would. */
function pointer(type: string, x: number, y: number, id = 1): void {
  for (const fn of root.listeners.get(type) ?? []) fn({ clientX: x, clientY: y, pointerId: id, preventDefault() {}, stopPropagation() {} });
}

test('the control layer builds a stick and only the buttons Fase 2 can honour', () => {
  assert.ok(root, 'control layer exists');
  assert.ok(walkEls(doc.body).some((e) => e.classes.has('lm-stick-base')));
  assert.ok(walkEls(doc.body).some((e) => e.classes.has('lm-stick-knob')));
  const labels = controls.actionButtons.map((b) => b.label);
  assert.deepEqual(labels, ['TEBAS', 'GESER'], 'movement + dodge; combat buttons wait for Batch 3');
});

test('the stick has a dead zone, saturates at 1 and releases to zero', () => {
  pointer('pointerdown', 120, 320);
  assert.equal(input.stick.x, 0, 'a tap without movement is not a nudge');
  assert.equal(input.stick.y, 0);

  pointer('pointermove', 123, 320);
  assert.equal(input.stick.x, 0, 'inside the dead zone');

  pointer('pointermove', 400, 320); // far beyond the ring
  assert.ok(Math.abs(input.stick.x - 1) < 1e-6, `saturates at 1, got ${input.stick.x}`);
  assert.ok(Math.abs(input.stick.y) < 1e-6);

  pointer('pointerup', 400, 320);
  assert.deepEqual({ x: input.stick.x, y: input.stick.y }, { x: 0, y: 0 }, 'lifting the thumb stops the hero');
});

test('the stick vector never exceeds 1 in any direction', () => {
  for (const [dx, dy] of [[1, 1], [-1, 1], [-1, -1], [1, -1], [0.3, -0.9]] as const) {
    pointer('pointerdown', 150, 250, 2);
    pointer('pointermove', 150 + dx * 500, 250 + dy * 500, 2);
    const len = Math.hypot(input.stick.x, input.stick.y);
    assert.ok(len <= 1 + 1e-6, `direction ${dx},${dy} gave length ${len}`);
    assert.ok(len > 0.9, `direction ${dx},${dy} should be near full throw, got ${len}`);
    pointer('pointerup', 0, 0, 2);
  }
});

test('the stick ignores the right-hand side of the screen', () => {
  pointer('pointerdown', W - 40, 300, 3);
  pointer('pointermove', W - 200, 300, 3);
  assert.equal(input.stick.x, 0, 'the right side belongs to the buttons');
  pointer('pointerup', W - 200, 300, 3);
});

test('an action button presses and releases the real input hub', () => {
  const dodge = controls.actionButtons.find((b) => b.action === 'dodge')!;
  const node = dodge.node as unknown as FakeEl;
  const cx = parseFloat(dodge.node.style.left);
  const cy = parseFloat(dodge.node.style.top);
  input.clear();

  pointer('pointerdown', cx, cy, 4);
  assert.equal(node.classes.has('down'), true, 'button shows it is held');
  assert.equal(input.isHeld('dodge'), true);
  assert.equal(input.consume('dodge'), true, 'the press is buffered for the game loop');

  pointer('pointerup', cx, cy, 4);
  assert.equal(node.classes.has('down'), false);
  assert.equal(input.isHeld('dodge'), false);
  assert.equal(input.stick.x, 0, 'tapping a button never moves the hero');
});

test('the layout follows the joystick and button settings', () => {
  const base = walkEls(doc.body).find((e) => e.classes.has('lm-stick-base'))!;
  const before = { size: base.style.width, left: base.style.left };
  settings.set('stickScale', 1.6);
  settings.set('stickX', 0.3);
  assert.notEqual(base.style.width, before.size, 'the stick grew');
  assert.notEqual(base.style.left, before.left, 'and moved');

  const attack = controls.actionButtons.find((b) => b.action === 'attack')!;
  const w0 = attack.node.style.width;
  settings.set('buttonScale', 1.5);
  assert.notEqual(attack.node.style.width, w0, 'the buttons grew too');

  settings.set('stickScale', 1);
  settings.set('stickX', 0.14);
  settings.set('buttonScale', 1);
});

test('hiding the controls releases everything it was holding', () => {
  const attack = controls.actionButtons.find((b) => b.action === 'attack')!;
  pointer('pointerdown', parseFloat(attack.node.style.left), parseFloat(attack.node.style.top), 5);
  pointer('pointerdown', 120, 300, 6);
  pointer('pointermove', 400, 300, 6);
  assert.ok(input.isHeld('attack'));

  controls.setVisible(false);
  assert.equal(input.isHeld('attack'), false);
  assert.deepEqual({ x: input.stick.x, y: input.stick.y }, { x: 0, y: 0 });
  assert.equal((root as FakeEl).style.display, 'none');
  controls.setVisible(true);
  controls.destroy();
});
