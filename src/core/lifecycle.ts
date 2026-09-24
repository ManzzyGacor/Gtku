/**
 * Everything the game has to survive on a phone that is not a game console.
 *
 * A browser game on Android gets interrupted constantly, and each interruption has its own
 * failure mode:
 *
 *  • **Switching apps** stops `requestAnimationFrame`. The loop simply pauses, but the *audio*
 *    context keeps running (draining battery) and the last minute of play is still only in memory
 *    — Android may kill a backgrounded tab without ever running another line of our code. So:
 *    save first, then pause, then suspend audio.
 *  • **Coming back** needs the clock restarted from now, not from the timestamp of an hour ago,
 *    and needs the audio context resumed — on iOS Safari it comes back suspended every time.
 *  • **Losing the WebGL context** happens for real when the phone is under memory pressure or the
 *    GPU driver resets. By default the canvas stays black forever. The browser only offers a
 *    restore if the `webglcontextlost` handler calls `preventDefault()`, so that call is the
 *    difference between a recoverable hiccup and a dead session.
 *  • **Rotating the screen** reports the *old* viewport size for a moment on Android, so one
 *    resize right away is not enough; a second one has to follow after the rotation settles.
 *
 * This lives in `src/core` and talks to nothing but `window`, `document` and a canvas, so the
 * renderer can be swapped under it and it stays testable in Node.
 */

export interface LifecycleHooks {
  /** Stop simulating and rendering. */
  pause(): void;
  /** Start again, with the frame clock reset. */
  resume(): void;
  /** Persist progress. Called before every pause and on the last event before the page dies. */
  save(): void;
  /** Re-plan the buffers for the new viewport size. */
  resize(): void;
  /** The GPU context is gone. The game is already paused and saved when this runs. */
  contextLost?(): void;
  /** The GPU context is back: everything on it must be rebuilt. */
  contextRestored?(): void;
}

export interface LifecycleTargets {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document: Pick<Document, 'addEventListener' | 'removeEventListener'> & { hidden?: boolean };
  /** The WebGL canvas, for the context-loss events. Optional so tests can leave it out. */
  canvas?: { addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener'] } | undefined;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** How long after `orientationchange` Android has usually settled on the new viewport size. */
export const ORIENTATION_SETTLE_MS = 250;

export class Lifecycle {
  /** True while the game is paused *by the lifecycle* (hidden tab or lost context). */
  paused = false;
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  contextLost = false;

  private bound: { target: { removeEventListener: (t: string, f: never) => void }; type: string; fn: (ev: unknown) => void }[] = [];
  private timers: unknown[] = [];
  private readonly t: LifecycleTargets;

  constructor(
    private readonly hooks: LifecycleHooks,
    targets?: Partial<LifecycleTargets>,
  ) {
    this.t = {
      window: targets?.window ?? (globalThis as unknown as { window: Window }).window,
      document: targets?.document ?? (globalThis as unknown as { document: Document }).document,
      canvas: targets?.canvas,
      setTimeout: targets?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: targets?.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
  }

  private on(target: LifecycleTargets['window'] | NonNullable<LifecycleTargets['canvas']>, type: string, fn: (ev: unknown) => void): void {
    (target.addEventListener as (t: string, f: unknown) => void)(type, fn);
    this.bound.push({ target: target as never, type, fn });
  }

  private later(fn: () => void, ms: number): void {
    const handle = this.t.setTimeout!(fn, ms);
    this.timers.push(handle);
  }

  install(): this {
    const { window: win, document: doc, canvas } = this.t;

    this.on(doc as unknown as LifecycleTargets['window'], 'visibilitychange', () => {
      if (doc.hidden) this.hide();
      else this.show();
    });
    // `pagehide` is the only event Android reliably fires before killing a tab, and it is the one
    // iOS gives us too. `beforeunload` is kept as the desktop fallback.
    this.on(win, 'pagehide', () => this.hooks.save());
    this.on(win, 'beforeunload', () => this.hooks.save());

    this.on(win, 'resize', () => this.hooks.resize());
    this.on(win, 'orientationchange', () => {
      this.hooks.resize();
      this.later(() => this.hooks.resize(), ORIENTATION_SETTLE_MS);
    });

    if (canvas) this.attachCanvas(canvas);
    return this;
  }

  /**
   * Watch this canvas for context loss, replacing whatever canvas was being watched.
   *
   * Recovering from a lost context means building a *new* renderer, and therefore a new canvas, so
   * the handlers have to move with it — otherwise the game survives the first loss and is deaf to
   * the second.
   */
  attachCanvas(canvas: NonNullable<LifecycleTargets['canvas']>): void {
    for (const old of this.bound) {
      if (old.type.startsWith('webglcontext')) old.target.removeEventListener(old.type, old.fn as never);
    }
    this.bound = this.bound.filter((b) => !b.type.startsWith('webglcontext'));
    this.t.canvas = canvas;

    this.on(canvas, 'webglcontextlost', (ev) => {
      // Without this the browser will never offer the context back.
      (ev as Event).preventDefault();
      this.contextLost = true;
      this.hooks.save();
      this.pause();
      this.hooks.contextLost?.();
    });
    this.on(canvas, 'webglcontextrestored', () => {
      this.contextLost = false;
      // The rebuild starts its own loop, so the lifecycle is no longer the thing holding it.
      this.paused = false;
      this.hooks.contextRestored?.();
    });
  }

  /** Tab hidden / app switched away. Saving comes first: the tab may not get another turn. */
  hide(): void {
    if (this.paused) return;
    this.hooks.save();
    this.pause();
  }

  /** Back in the foreground. A lost context stays paused until it is restored. */
  show(): void {
    if (this.contextLost) return;
    if (!this.paused) return;
    this.paused = false;
    this.hooks.resume();
  }

  private pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.hooks.pause();
  }

  dispose(): void {
    for (const { target, type, fn } of this.bound) target.removeEventListener(type, fn as never);
    this.bound = [];
    for (const h of this.timers) this.t.clearTimeout!(h);
    this.timers = [];
  }

  /** For the tests and the report: how many listeners are currently installed. */
  get listenerCount(): number {
    return this.bound.length;
  }
}
