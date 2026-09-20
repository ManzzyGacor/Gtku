/**
 * Frame-time meter. Frames are counted into fixed half-second buckets, so the readout is stable
 * (a smoothed average) while still showing the worst half-second of the recent past — that dip is
 * what a stutter actually feels like on a phone. Pure logic, no DOM.
 */
const BUCKET = 0.5;
const KEPT = 12; // 6 seconds of history

export class PerfMeter {
  private buckets: number[] = [];
  private acc = 0;
  private frames = 0;
  /** Smoothed average FPS over the kept history. */
  avg = 60;
  /** Lowest half-second average in the kept history. */
  low = 60;
  /** Instantaneous FPS of the last frame (unsmoothed). */
  last = 60;

  /** Feed one frame's real delta in seconds. Absurd deltas (tab resume) are ignored. */
  push(dt: number): void {
    if (!(dt > 0) || dt > 1) return;
    this.last = 1 / dt;
    this.acc += dt;
    this.frames++;
    if (this.acc < BUCKET) return;
    this.buckets.push(this.frames / this.acc);
    if (this.buckets.length > KEPT) this.buckets.shift();
    this.acc = 0;
    this.frames = 0;
    this.avg = this.buckets.reduce((a, b) => a + b, 0) / this.buckets.length;
    this.low = Math.min(...this.buckets);
  }

  /** True once there is enough history to judge the device. */
  get ready(): boolean {
    return this.buckets.length >= 4;
  }

  reset(): void {
    this.buckets.length = 0;
    this.acc = 0;
    this.frames = 0;
    this.avg = 60;
    this.low = 60;
  }
}
