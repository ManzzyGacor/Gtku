/**
 * Does the UI fit on the phone it is actually played on?
 *
 * The test device is **2318x759** — extremely wide and short — and the player has the text at 2x
 * and the buttons at 1.3x. That combination is where a layout breaks: panels sized in `vw` become
 * absurd, a bottom-anchored box lands on the gesture bar, and buttons whose offsets scale with
 * their size walk off the edge of the screen.
 *
 * So this file computes the real positions the code produces and asserts the things a screenshot
 * would show: nothing off screen, nothing under the notch, and the thumb targets big enough to hit.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';

/** The reported phone, plus a plausible landscape notch on the left and a gesture bar. */
const W = 2318;
const H = 759;
/*
 * Mutable, because the insets are the point: a 34px notch is small enough that the old unclamped
 * maths happened to survive it, so there is also a case below with a 140px cutout — which is what
 * a landscape punch-hole plus a curved edge looks like on some phones, and what actually catches a
 * regression in the clamping.
 */
let INSET = { top: 0, right: 34, bottom: 18, left: 34 };

const g = globalThis as Record<string, unknown>;
g.window = { innerWidth: W, innerHeight: H, devicePixelRatio: 2.75, addEventListener() {}, removeEventListener() {} };
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
/*
 * `env(safe-area-inset-*)` is resolved by the browser, so the fake DOM cannot compute it. The probe
 * element is fed the numbers above instead — which is exactly what a phone with a landscape notch
 * would report, and it means the clamping maths gets tested rather than the CSS.
 */
g.getComputedStyle = (node: FakeEl) =>
  node.classes?.has('lm-safe-probe')
    ? { paddingTop: `${INSET.top}px`, paddingRight: `${INSET.right}px`, paddingBottom: `${INSET.bottom}px`, paddingLeft: `${INSET.left}px` }
    : { paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' };

const doc = installDom();

const { TouchControls } = await import('../src/ui/TouchControls');
const { settings } = await import('../src/core/settings');
const { safeInsets, invalidateInsets } = await import('../src/ui/safearea');

/** The player's reported settings. */
beforeEach(() => {
  invalidateInsets();
  settings.set('textScale', 2);
  settings.set('buttonScale', 1.3);
  settings.set('stickScale', 1);
});

const px = (v: string | undefined): number => Number.parseFloat(v ?? '0') || 0;

interface Circle {
  label: string;
  cx: number;
  cy: number;
  r: number;
}

/** Read the circles the touch layer laid out: centre and radius in CSS pixels. */
function circles(root: FakeEl): Circle[] {
  return walkEls(root)
    .filter((e) => e.classes.has('lm-act'))
    .map((e) => ({
      label: e.textContent ?? '?',
      cx: px(e.style.left),
      cy: px(e.style.top),
      r: px(e.style.width) / 2,
    }));
}

test('the UI layers in the right order, so no panel opens behind another', () => {
  /*
   * This is here because it already happened: the settings panel sat at z-index 85 and the title
   * screen at 90, so tapping PENGATURAN in the main menu built the whole panel, laid it out, and
   * put it *behind* an opaque full-screen gradient. Nothing appeared, and nothing was broken enough
   * to throw. The order is asserted from the stylesheets themselves rather than trusted to comments.
   */
  /*
   * Read the z-index of each panel's *own* root rule. Taking the lowest number in the file would be
   * wrong: several of these stylesheets also style a corner button, which deliberately sits at a
   * different layer from the panel it opens.
   */
  const roots: [string, string][] = [
    ['Hud', '.lm-hud'],
    ['TouchControls', '.lm-touch'],
    ['Dialogue', '.lm-dlg'],
    ['PauseMenu', '.lm-pause'],
    ['CharacterPanel', '.lm-sheet'],
    ['TitleScreen', '.lm-title'],
    ['CutsceneOverlay', '.lm-cs'],
    ['SettingsPanel', '.lm-ov'],
  ];
  const z = new Map<string, number>();
  for (const [name, selector] of roots) {
    const src = readFileSync(`src/ui/${name}.ts`, 'utf8');
    const css = /const CSS = `([\s\S]*?)`;/.exec(src)?.[1] ?? '';
    const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const found = /z-index:\s*(\d+)/.exec(rule)?.[1];
    assert.ok(found, `${name}: no z-index on its root rule (${selector})`);
    z.set(name, Number(found));
  }

  // anything that can be opened *from* another panel has to sit above it
  assert.ok(z.get('SettingsPanel')! > z.get('TitleScreen')!, 'Pengaturan is opened from the main menu');
  assert.ok(z.get('SettingsPanel')! > z.get('PauseMenu')!, 'and from the pause menu');
  assert.ok(z.get('SettingsPanel')! > z.get('CharacterPanel')!);
  assert.ok(z.get('CharacterPanel')! > z.get('PauseMenu')!, 'Inventaris is opened from the pause menu');
  assert.ok(z.get('PauseMenu')! > z.get('Dialogue')!, 'the pause menu covers the dialogue box');
  assert.ok(z.get('CutsceneOverlay')! > z.get('TitleScreen')!, 'a cutscene plays over everything in the world');
  assert.ok(z.get('CutsceneOverlay')! > z.get('CharacterPanel')!);
  assert.ok(z.get('TouchControls')! > z.get('Hud')!, 'the stick is above the HUD it sits on');

  // and the error panel in index.html stays on top of all of it
  const html = readFileSync('index.html', 'utf8');
  const errZ = Number(/#err\s*\{[^}]*z-index:\s*(\d+)/.exec(html)?.[1] ?? 0);
  assert.ok(errZ > Math.max(...z.values()), `the error panel (${errZ}) must be visible over every panel`);
});

test('the safe-area insets are read from the browser rather than guessed', () => {
  const insets = safeInsets();
  assert.deepEqual(insets, INSET, 'the probe element is how these are readable from JavaScript');
});

test('every action button is fully on screen, inside the safe area, at 1.3x', () => {
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  controls.layout();
  const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
  const found = circles(root);
  assert.equal(found.length, 4, 'attack, dodge, swap and skill');

  for (const c of found) {
    assert.ok(c.r >= 20, `${c.label}: radius ${c.r} is too small for a thumb`);
    assert.ok(c.cx - c.r >= INSET.left, `${c.label}: crosses the left inset (${c.cx - c.r})`);
    assert.ok(c.cx + c.r <= W - INSET.right, `${c.label}: runs past the right inset (${c.cx + c.r} > ${W - INSET.right})`);
    assert.ok(c.cy - c.r >= INSET.top, `${c.label}: crosses the top inset`);
    assert.ok(c.cy + c.r <= H - INSET.bottom, `${c.label}: runs past the gesture bar (${c.cy + c.r} > ${H - INSET.bottom})`);
  }
  controls.destroy();
});

test('the action buttons do not overlap each other', () => {
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  controls.layout();
  const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
  const found = circles(root);
  for (let i = 0; i < found.length; i++)
    for (let j = i + 1; j < found.length; j++) {
      const a = found[i];
      const b = found[j];
      const gap = Math.hypot(a.cx - b.cx, a.cy - b.cy) - (a.r + b.r);
      assert.ok(gap > -1, `${a.label} and ${b.label} overlap by ${(-gap).toFixed(1)}px`);
    }
  controls.destroy();
});

test('even at the largest button size nothing leaves the screen', () => {
  settings.set('buttonScale', 1.8);
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  controls.layout();
  const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
  for (const c of circles(root)) {
    assert.ok(c.cx + c.r <= W - INSET.right + 0.5, `${c.label} past the right edge at 1.8x`);
    assert.ok(c.cy + c.r <= H - INSET.bottom + 0.5, `${c.label} past the bottom at 1.8x`);
    assert.ok(c.cx - c.r >= 0, `${c.label} off the left at 1.8x`);
  }
  controls.destroy();
  settings.set('buttonScale', 1.3);
});

test('the joystick rests inside the safe area and on its own half of the screen', () => {
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  controls.layout();
  const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
  const base = walkEls(root).find((e) => e.classes.has('lm-stick-base'))!;
  const r = px(base.style.width) / 2;
  const cx = px(base.style.left);
  const cy = px(base.style.top);
  assert.ok(cx - r >= INSET.left - 6, `the stick crosses the left inset (${cx - r})`);
  assert.ok(cy + r <= H - INSET.bottom + 6, `the stick sits on the gesture bar (${cy + r})`);
  assert.ok(cx < W * 0.55, 'the stick must stay on the left half, clear of the action buttons');
  controls.destroy();
});

test('the joystick stays reachable however the player moves it', () => {
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  for (const [x, y] of [[0.06, 0.4], [0.42, 0.9], [0.2, 0.55]] as const) {
    settings.set('stickX', x);
    settings.set('stickY', y);
    controls.layout();
    const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
    const base = walkEls(root).find((e) => e.classes.has('lm-stick-base'))!;
    const r = px(base.style.width) / 2;
    const cx = px(base.style.left);
    const cy = px(base.style.top);
    assert.ok(cx - r >= 0 && cx + r <= W, `stick off screen horizontally at ${x}`);
    assert.ok(cy - r >= 0 && cy + r <= H, `stick off screen vertically at ${y}`);
    assert.ok(cy + r <= H - INSET.bottom + 6, `stick on the gesture bar at ${y}`);
  }
  settings.reset(['stickX', 'stickY']);
  controls.destroy();
});

test('a large landscape cutout pushes the buttons clear rather than under it', () => {
  INSET = { top: 12, right: 140, bottom: 24, left: 140 };
  invalidateInsets();
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  controls.layout();
  const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
  const found = circles(root);
  assert.equal(found.length, 4);
  for (const c of found) {
    assert.ok(c.cx + c.r <= W - INSET.right + 0.5, `${c.label} is under the cutout (${c.cx + c.r} > ${W - INSET.right})`);
    assert.ok(c.cy + c.r <= H - INSET.bottom + 0.5, `${c.label} is under the gesture bar`);
  }
  const base = walkEls(root).find((e) => e.classes.has('lm-stick-base'))!;
  const r = px(base.style.width) / 2;
  assert.ok(px(base.style.left) - r >= INSET.left - 0.5, 'and the stick clears the other side');

  controls.destroy();
  INSET = { top: 0, right: 34, bottom: 18, left: 34 };
  invalidateInsets();
});

test('a tall narrow screen (portrait, rotated mid-game) still lays out', () => {
  g.window = { innerWidth: 412, innerHeight: 915, devicePixelRatio: 2.75, addEventListener() {}, removeEventListener() {} };
  invalidateInsets();
  const controls = new TouchControls(doc.body as unknown as HTMLElement);
  controls.layout();
  const root = walkEls(doc.body).find((e) => e.classes.has('lm-touch'))!;
  for (const c of circles(root)) {
    assert.ok(c.cx - c.r >= 0 && c.cx + c.r <= 412, `${c.label} off screen in portrait`);
    assert.ok(c.cy - c.r >= 0 && c.cy + c.r <= 915, `${c.label} off screen in portrait`);
  }
  controls.destroy();
  g.window = { innerWidth: W, innerHeight: H, devicePixelRatio: 2.75, addEventListener() {}, removeEventListener() {} };
  invalidateInsets();
});
