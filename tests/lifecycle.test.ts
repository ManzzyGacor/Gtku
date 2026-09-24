/**
 * The phone-interruption cases: switching apps, rotating the screen, and the GPU taking the WebGL
 * context away. None of these can be reproduced by playing on a desktop, so they are tested
 * against a fake window/document/canvas that fires exactly the events Android fires.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Lifecycle, ORIENTATION_SETTLE_MS } from '../src/core/lifecycle';

interface Target {
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  removeEventListener(type: string, fn: (ev: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
  count(): number;
}

function target(): Target {
  const map = new Map<string, ((ev: unknown) => void)[]>();
  return {
    addEventListener: (type, fn) => {
      const list = map.get(type) ?? [];
      list.push(fn);
      map.set(type, list);
    },
    removeEventListener: (type, fn) => {
      const list = (map.get(type) ?? []).filter((f) => f !== fn);
      if (list.length) map.set(type, list);
      else map.delete(type);
    },
    fire: (type, ev) => {
      for (const fn of map.get(type) ?? []) fn(ev ?? {});
    },
    count: () => [...map.values()].reduce((n, l) => n + l.length, 0),
  };
}

interface Harness {
  life: Lifecycle;
  win: Target;
  doc: Target & { hidden: boolean };
  canvas: Target;
  log: string[];
  timers: (() => void)[];
  runTimers(): void;
  fail: { rebuild: boolean };
}

function harness(): Harness {
  const win = target();
  const doc = Object.assign(target(), { hidden: false });
  const canvas = target();
  const log: string[] = [];
  const timers: (() => void)[] = [];
  const fail = { rebuild: false };
  const life = new Lifecycle(
    {
      pause: () => log.push('pause'),
      resume: () => log.push('resume'),
      save: () => log.push('save'),
      resize: () => log.push('resize'),
      contextLost: () => log.push('lost'),
      contextRestored: () => {
        log.push('restored');
        if (fail.rebuild) throw new Error('rebuild failed');
      },
    },
    {
      window: win as unknown as Window,
      document: doc as unknown as Document,
      canvas,
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => undefined,
    },
  ).install();
  return { life, win, doc, canvas, log, timers, runTimers: () => timers.splice(0).forEach((f) => f()), fail };
}

test('switching away from the game saves first, then pauses', () => {
  const h = harness();
  h.doc.hidden = true;
  h.doc.fire('visibilitychange');
  // the order matters: Android may kill the tab immediately after this
  assert.deepEqual(h.log, ['save', 'pause']);

  h.doc.hidden = false;
  h.doc.fire('visibilitychange');
  assert.deepEqual(h.log, ['save', 'pause', 'resume']);
  assert.equal(h.life.paused, false);
});

test('coming back twice does not start two loops', () => {
  const h = harness();
  h.doc.hidden = false;
  h.doc.fire('visibilitychange');
  h.doc.fire('visibilitychange');
  assert.deepEqual(h.log, [], 'a visible → visible transition must do nothing');

  h.doc.hidden = true;
  h.doc.fire('visibilitychange');
  h.doc.fire('visibilitychange');
  assert.deepEqual(h.log, ['save', 'pause'], 'hiding twice pauses once');
});

test('the page dying is the last chance to save', () => {
  const h = harness();
  h.win.fire('pagehide');
  assert.deepEqual(h.log, ['save']);
  h.win.fire('beforeunload');
  assert.deepEqual(h.log, ['save', 'save']);
});

test('rotating resizes twice: now, and again after Android settles', () => {
  const h = harness();
  h.win.fire('orientationchange');
  assert.deepEqual(h.log, ['resize'], 'immediately, with whatever size we are given');
  assert.equal(h.timers.length, 1, `a follow-up must be scheduled ${ORIENTATION_SETTLE_MS}ms later`);
  h.runTimers();
  assert.deepEqual(h.log, ['resize', 'resize'], 'and again once the real size is known');
});

test('a plain resize still resizes', () => {
  const h = harness();
  h.win.fire('resize');
  assert.deepEqual(h.log, ['resize']);
});

test('a lost WebGL context is saved, paused, and asks the browser for a restore', () => {
  const h = harness();
  let prevented = false;
  h.canvas.fire('webglcontextlost', { preventDefault: () => (prevented = true) });
  assert.ok(prevented, 'without preventDefault the browser never offers the context back');
  assert.deepEqual(h.log, ['save', 'pause', 'lost']);
  assert.equal(h.life.contextLost, true);

  // while the context is gone, coming back into the foreground must NOT restart the loop
  h.doc.hidden = false;
  h.doc.fire('visibilitychange');
  assert.deepEqual(h.log, ['save', 'pause', 'lost'], 'nothing to resume onto yet');

  h.canvas.fire('webglcontextrestored');
  assert.deepEqual(h.log, ['save', 'pause', 'lost', 'restored']);
  assert.equal(h.life.contextLost, false);
  assert.equal(h.life.paused, false, 'the rebuild owns the loop again');
});

test('the rebuilt canvas is watched, and the old one is not', () => {
  const h = harness();
  const fresh = target();
  const before = h.canvas.count();
  h.life.attachCanvas(fresh);
  assert.equal(h.canvas.count(), before - 2, 'the old canvas loses both handlers');
  assert.equal(fresh.count(), 2, 'the new one gains them');

  // a second loss, on the new canvas, must still be handled
  h.canvas.fire('webglcontextlost', { preventDefault: () => undefined });
  assert.deepEqual(h.log, [], 'the dead canvas is ignored');
  fresh.fire('webglcontextlost', { preventDefault: () => undefined });
  assert.deepEqual(h.log, ['save', 'pause', 'lost']);
});

test('dispose removes every listener it added', () => {
  const h = harness();
  assert.ok(h.life.listenerCount >= 6, `expected the whole set, got ${h.life.listenerCount}`);
  const total = h.win.count() + h.doc.count() + h.canvas.count();
  assert.equal(total, h.life.listenerCount);

  h.life.dispose();
  assert.equal(h.win.count(), 0);
  assert.equal(h.doc.count(), 0);
  assert.equal(h.canvas.count(), 0);
  assert.equal(h.life.listenerCount, 0);

  // and nothing fires afterwards
  h.doc.hidden = true;
  h.doc.fire('visibilitychange');
  h.win.fire('resize');
  assert.deepEqual(h.log, []);
});
