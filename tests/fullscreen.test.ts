/**
 * Fullscreen and landscape (`ui/fullscreen.ts`), against scripted browser objects: which ones
 * allow fullscreen without a tap, which ones refuse the orientation lock, and what the game is told.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installDom, walkEls } from './mocks/dom-mock';
import { Fullscreen, FULLSCREEN_SETTLE_MS, type FullscreenTargets } from '../src/ui/fullscreen';

function browser(opts: { allowWithoutGesture: boolean; lock: boolean; w?: number; h?: number }) {
  const doc = installDom();
  const listeners = new Map<string, (() => void)[]>();
  const on = (type: string, fn: () => void): void => void listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const off = (type: string, fn: () => void): void => void listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
  const fire = (type: string): void => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  const timers: (() => void)[] = [];
  const state = { gesture: false, locks: 0 };
  const d: FullscreenTargets['doc'] = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: async () => {
        if (!state.gesture && !opts.allowWithoutGesture) throw new Error('needs a gesture');
        d.fullscreenElement = {} as Element;
        fire('fullscreenchange');
      },
    },
    exitFullscreen: async () => {
      d.fullscreenElement = null;
      fire('fullscreenchange');
    },
    addEventListener: on,
    removeEventListener: off,
  };
  const win = { innerWidth: opts.w ?? 759, innerHeight: opts.h ?? 2318, addEventListener: on, removeEventListener: off };
  const t: FullscreenTargets = {
    doc: d,
    win,
    orientation: {
      lock: async () => {
        state.locks++;
        if (!opts.lock) throw new Error('not supported');
      },
    },
    later: (fn) => void timers.push(fn),
  };
  return { t, win, fire, timers, state, dom: doc };
}

const prompt = (dom: ReturnType<typeof installDom>) => walkEls(dom.body).find((e) => e.classes.has('lm-fsprompt'));

test('turning to landscape enters fullscreen and locks, where the browser allows it', async () => {
  const b = browser({ allowWithoutGesture: true, lock: true });
  const fs = new Fullscreen(b.t).install();
  b.win.innerWidth = 2318;
  b.win.innerHeight = 759;
  b.fire('orientationchange');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fs.active, true);
  assert.equal(b.state.locks, 1, 'and asked for the landscape lock');
  assert.equal(fs.prompting, false, 'no button needed');
});

test('a browser that wants a tap first gets the Layar Penuh button, and the tap works', async () => {
  const b = browser({ allowWithoutGesture: false, lock: false });
  const fs = new Fullscreen(b.t).install();
  b.win.innerWidth = 2318;
  b.win.innerHeight = 759;
  b.fire('orientationchange');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fs.active, false);
  assert.equal(fs.prompting, true, 'the button is offered');

  b.state.gesture = true;
  const go = walkEls(prompt(b.dom)!).find((e) => e.classes.has('go'))!;
  go.tap();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fs.active, true, 'a refused lock does not stop fullscreen');
  assert.equal(fs.prompting, false, 'and the button goes');
});

test('the button can be dismissed until the phone is turned again, and portrait never shows it', async () => {
  const b = browser({ allowWithoutGesture: false, lock: false, w: 2318, h: 759 });
  const fs = new Fullscreen(b.t).install();
  assert.equal(fs.prompting, true, 'already landscape at load: offered straight away');
  walkEls(prompt(b.dom)!).find((e) => e.classes.has('no'))!.tap();
  assert.equal(fs.prompting, false);
  b.win.innerWidth = 759;
  b.win.innerHeight = 2318;
  b.fire('resize');
  assert.equal(fs.prompting, false, 'portrait');
  b.win.innerWidth = 2318;
  b.win.innerHeight = 759;
  b.fire('resize');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fs.prompting, true, 'offered again after turning');
});

test('entering and leaving tell the game twice: at once and after the viewport settles', async () => {
  const b = browser({ allowWithoutGesture: true, lock: true, w: 2318, h: 759 });
  const fs = new Fullscreen(b.t).install();
  const seen: boolean[] = [];
  fs.onChange((a) => seen.push(a));
  await fs.enter();
  assert.deepEqual(seen, [true]);
  assert.equal(b.timers.length, 1, `and again after ${FULLSCREEN_SETTLE_MS} ms`);
  b.timers.shift()!();
  assert.deepEqual(seen, [true, true]);
  await fs.exit();
  b.timers.shift()!();
  assert.deepEqual(seen, [true, true, false, false]);
  assert.equal(fs.prompting, true, 'out of fullscreen in landscape: the button is back');
  fs.dispose();
});
