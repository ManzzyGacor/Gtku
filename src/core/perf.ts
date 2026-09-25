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

  /**
   * Average frame time in milliseconds — **the same measurement** as `avg`, just the other way up.
   * The report used to print a separately smoothed frame time next to this FPS, and the two
   * disagreed (16.7 ms beside 44.7 fps) because they did not count the same frames.
   */
  get avgMs(): number {
    return 1000 / Math.max(0.001, this.avg);
  }

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
    let sum = 0;
    let low = Infinity;
    for (const b of this.buckets) {
      sum += b;
      if (b < low) low = b;
    }
    this.avg = sum / this.buckets.length;
    this.low = low;
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

/**
 * Where a frame's time goes, stage by stage (CPU, measured with `performance.now()` laps).
 *
 * The first performance report had a single number per frame, and "the frame is slow" could not
 * say whether JavaScript or the GPU was to blame. Each stage here is an exponential average of the
 * milliseconds spent between two laps. Fixed stages, preallocated: nothing is allocated per frame.
 */
export const STAGES = ['logika', 'dunia', 'hud', 'lingkungan', 'render scene', 'render post'] as const;
export type StageId = 0 | 1 | 2 | 3 | 4 | 5;

export class StageTimer {
  /** Smoothed milliseconds per stage. */
  readonly ms = new Float64Array(STAGES.length);
  /** Worst single-frame milliseconds per stage, over the recent past (decays). */
  readonly peak = new Float64Array(STAGES.length);
  private last = 0;
  private readonly frame = new Float64Array(STAGES.length);

  constructor(private readonly now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {}

  /** Start of a frame. */
  begin(): void {
    this.frame.fill(0);
    this.last = this.now();
  }

  /** The time since the previous lap belongs to `stage`. */
  lap(stage: StageId): void {
    const t = this.now();
    this.frame[stage] += t - this.last;
    this.last = t;
  }

  /** Add time measured elsewhere (the renderer's own passes). */
  add(stage: StageId, ms: number): void {
    this.frame[stage] += ms;
  }

  /** End of a frame: fold it into the averages. */
  end(): void {
    for (let i = 0; i < STAGES.length; i++) {
      this.ms[i] += (this.frame[i] - this.ms[i]) * 0.05;
      this.peak[i] = Math.max(this.frame[i], this.peak[i] * 0.995);
    }
  }

  /** Total CPU milliseconds per frame (smoothed). */
  get total(): number {
    let t = 0;
    for (let i = 0; i < STAGES.length; i++) t += this.ms[i];
    return t;
  }

  reset(): void {
    this.ms.fill(0);
    this.peak.fill(0);
  }
}
