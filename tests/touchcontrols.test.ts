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

test('the control layer builds a stick and the buttons combat actually honours', () => {
  assert.ok(root, 'control layer exists');
  assert.ok(walkEls(doc.body).some((e) => e.classes.has('lm-stick-base')));
  assert.ok(walkEls(doc.body).some((e) => e.classes.has('lm-stick-knob')));
  const actions = controls.actionButtons.map((b) => b.action);
  assert.deepEqual(actions, ['attack', 'dodge', 'swap', 'skill', 'interact'], 'attack, dodge, swap, skill and interact');
  assert.ok(walkEls(doc.body).some((e) => e.classes.has('lm-charge')), 'and the bow draw meter');
});

test('the interact button only exists when the world says there is something there', () => {
  const interact = controls.actionButtons.find((b) => b.action === 'interact')!;
  const node = interact.node as unknown as FakeEl;

  assert.equal(node.classes.has('on'), false, 'hidden with nothing in range');
  // pressing where it *would* be must do nothing while it is hidden
  const cx = parseFloat(node.style.left ?? '0');
  const cy = parseFloat(node.style.top ?? '0');
  pointer('pointerdown', cx, cy, 11);
  assert.equal(input.isHeld('interact'), false, 'an invisible button must not swallow taps');
  pointer('pointerup', cx, cy, 11);

  controls.setInteract('Bicara');
  assert.equal(node.classes.has('on'), true);
  assert.equal(node.textContent, 'Bicara', 'the world supplies the word');

  pointer('pointerdown', cx, cy, 12);
  assert.equal(input.isHeld('interact'), true, 'and now it presses the real input hub');
  pointer('pointerup', cx, cy, 12);
  assert.equal(input.isHeld('interact'), false);

  controls.setInteract('Baca');
  assert.equal(node.textContent, 'Baca');
  controls.setInteract(null);
  assert.equal(node.classes.has('on'), false, 'and hides again when you walk away');
});

test('an interact button that vanishes mid-press does not leave the action stuck down', () => {
  const interact = controls.actionButtons.find((b) => b.action === 'interact')!;
  const node = interact.node as unknown as FakeEl;
  controls.setInteract('Buka');
  const cx = parseFloat(node.style.left ?? '0');
  const cy = parseFloat(node.style.top ?? '0');
  pointer('pointerdown', cx, cy, 13);
  assert.equal(input.isHeld('interact'), true);
  // walking out of range while still holding the button
  controls.setInteract(null);
  assert.equal(input.isHeld('interact'), false, 'the release has to be synthesised');
  pointer('pointerup', cx, cy, 13);
});

test('the weapon display shows what the swap will switch to, and the draw meter follows the charge', () => {
  const ring = walkEls(doc.body).find((e) => e.classes.has('lm-charge'))!;
  const swap = controls.actionButtons.find((b) => b.action === 'swap')!;

  controls.setWeaponState('BUSUR', 0);
  assert.equal((swap.node as unknown as FakeEl).textContent, 'BUSUR');
  assert.equal(ring.style.opacity, '0', 'no meter when the string is slack');

  controls.setWeaponState('PEDANG', 0.5);
  assert.equal((swap.node as unknown as FakeEl).textContent, 'PEDANG', 'it names the *other* weapon');
  assert.ok(Number(ring.style.opacity) > 0.5, 'the meter shows while drawing');
  const half = parseFloat(ring.style.width);

  controls.setWeaponState('PEDANG', 1);
  assert.ok(parseFloat(ring.style.width) > half, 'and grows as the draw completes');
  assert.ok(ring.style.borderColor.includes('255'), 'a full draw changes colour');
  controls.setWeaponState('BUSUR', 0);
});

/** Where the fixed base is resting, read off the element the player can see. */
function stickCentre(): { x: number; y: number } {
  const base = walkEls(doc.body).find((e) => e.classes.has('lm-stick-base'))!;
  return { x: parseFloat(base.style.left ?? '0'), y: parseFloat(base.style.top ?? '0') };
}

test('the stick is fixed: the base stays put wherever the thumb goes', () => {
  const before = stickCentre();
  pointer('pointerdown', before.x + 10, before.y + 6);
  pointer('pointermove', before.x + 400, before.y + 300);
  assert.deepEqual(stickCentre(), before, 'the base must not chase the thumb');
  pointer('pointerup', before.x + 400, before.y + 300);
  assert.deepEqual(stickCentre(), before);
});

test('the stick has a dead zone, saturates at 1 and releases to zero', () => {
  const c = stickCentre();
  pointer('pointerdown', c.x, c.y);
  assert.equal(input.stick.x, 0, 'pressing the centre is not a nudge');
  assert.equal(input.stick.y, 0);

  pointer('pointermove', c.x + 3, c.y);
  assert.equal(input.stick.x, 0, 'inside the dead zone');

  pointer('pointermove', c.x + 400, c.y); // far beyond the ring
  assert.ok(Math.abs(input.stick.x - 1) < 1e-6, `saturates at 1, got ${input.stick.x}`);
  assert.ok(Math.abs(input.stick.y) < 1e-6);

  pointer('pointerup', c.x + 400, c.y);
  assert.deepEqual({ x: input.stick.x, y: input.stick.y }, { x: 0, y: 0 }, 'lifting the thumb stops the hero');
});

test('a touch far from the base is ignored, so the left half is not one giant stick', () => {
  const c = stickCentre();
  pointer('pointerdown', c.x + 300, c.y, 7);
  assert.deepEqual({ x: input.stick.x, y: input.stick.y }, { x: 0, y: 0 }, 'an accidental tap must not walk the hero');
  pointer('pointerup', c.x + 300, c.y, 7);
});

test('the stick vector never exceeds 1 in any direction', () => {
  const c = stickCentre();
  for (const [dx, dy] of [[1, 1], [-1, 1], [-1, -1], [1, -1], [0.3, -0.9]] as const) {
    pointer('pointerdown', c.x, c.y, 2);
    pointer('pointermove', c.x + dx * 500, c.y + dy * 500, 2);
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
