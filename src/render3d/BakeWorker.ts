/**
 * The main thread's side of `bake.worker.ts`: ask for a chunk's ground, get `'pending'` until the
 * worker answers, then the pixmap. Where workers are unavailable (tests in Node, very old WebViews)
 * `available` is false and the world bakes on the main thread as before.
 */
import { Pixmap } from '../art/pixmap';

const key = (cx: number, cy: number): number => cy * 1000 + cx;

export class BakeWorker {
  private worker: Worker | null = null;
  private readonly done = new Map<number, Pixmap>();
  private readonly asked = new Set<number>();
  private nextId = 1;
  /** Chunks baked off the main thread, for the report. */
  baked = 0;
  failed = false;

  constructor() {
    try {
      if (typeof Worker === 'undefined') return;
      this.worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (ev: MessageEvent<{ cx: number; cy: number; w: number; h: number; data: Uint8ClampedArray | null }>) => {
        const m = ev.data;
        const k = key(m.cx, m.cy);
        this.asked.delete(k);
        if (!m.data) return;
        this.done.set(k, Pixmap.wrap(m.w, m.h, m.data));
        this.baked++;
      });
      this.worker.addEventListener('error', () => {
        // a worker that cannot start (blocked, broken bundle): bake on the main thread instead
        this.failed = true;
        this.worker?.terminate();
        this.worker = null;
      });
    } catch {
      this.worker = null;
    }
  }

  get available(): boolean {
    return !!this.worker && !this.failed;
  }

  /** The chunk's ground if the worker has finished it, `'pending'` while it works, null if unavailable. */
  ground(cx: number, cy: number): Pixmap | 'pending' | null {
    if (!this.available) return null;
    const k = key(cx, cy);
    const pm = this.done.get(k);
    if (pm) {
      this.done.delete(k);
      return pm;
    }
    if (!this.asked.has(k)) {
      this.asked.add(k);
      // (Worker.postMessage has no targetOrigin)
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      this.worker!.postMessage({ id: this.nextId++, cx, cy });
    }
    return 'pending';
  }

  /** Start baking chunks that will be needed soon. */
  prefetch(cx: number, cy: number): void {
    if (!this.available) return;
    const k = key(cx, cy);
    if (this.done.has(k) || this.asked.has(k)) return;
    this.asked.add(k);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    this.worker!.postMessage({ id: this.nextId++, cx, cy });
  }

  /** Forget finished chunks that are no longer wanted (bounded memory). */
  trim(keep: number): void {
    while (this.done.size > keep) {
      const first = this.done.keys().next().value as number;
      this.done.delete(first);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.done.clear();
  }
}
