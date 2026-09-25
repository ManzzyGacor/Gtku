/**
 * On-device A/B performance probe.
 *
 * There is no GPU on the VPS, so the only honest way to find out what a frame costs is to measure
 * it on the phone: all features on, then each expensive one switched off in turn.
 *
 * The first version reported 16.7 ms and "saves 0.0 ms" for *everything*, including a render at
 * 60% scale. Three reasons, all fixed here:
 *
 *  1. **It measured a paused game.** It was started from the Settings panel, which pauses the world
 *     while open — so every scenario timed the same cheap paused frame. Frames now only count while
 *     the game is actually running (`update(dt, playing)`), and the caller closes Settings first.
 *  2. **It used the median of vsync-locked frame intervals.** On a 60 Hz screen every interval is
 *     16.7 or 33.3 ms; a mix of the two has a median of 16.7 whatever the features cost. It now
 *     records the **mean** interval, the 90th percentile, and — the numbers vsync cannot hide — the
 *     CPU time per frame and, where available, the GPU time.
 *  3. **Some "off" switches were switched straight back on** by code that re-applies settings every
 *     frame (bloom, chunk radius). Each scenario now has a `verify` that must hold while it is
 *     measured; a scenario whose feature did not really turn off is reported as such, not as "0 ms".
 *
 * And the result checks itself: if nothing changed anything, it says the run is invalid.
 */

export interface ProbeScenario {
  id: string;
  label: string;
  /** Turn this scenario's change on. Called once when the scenario starts. */
  apply: () => void;
  /** True while the change is really in effect (checked when measuring starts). */
  verify?: (() => boolean) | undefined;
}

export interface ProbeStats {
  /** CPU milliseconds for this frame (all stages). */
  cpuMs: number;
  /** GPU milliseconds (scene + post), or −1 when the device cannot measure it. */
  gpuMs: number;
  calls: number;
  triangles: number;
}

export interface ProbeSample {
  id: string;
  label: string;
  /** Mean frame interval, ms. */
  ms: number;
  p90: number;
  cpuMs: number;
  gpuMs: number;
  frames: number;
  calls: number;
  triangles: number;
  /** False when the feature was not actually off while measured. */
  verified: boolean;
}

/** Frames and seconds to wait after a change before measuring (shaders compile, textures upload). */
export const SETTLE_FRAMES = 20;
export const SETTLE_SECONDS = 0.5;
/** Frames measured per scenario. */
export const MEASURE_FRAMES = 90;
const gpu = (v: number): string => (v >= 0 ? `gpu ${v.toFixed(1)}` : 'gpu -');
/** "−1.2" for a saving, "+0.4" for a cost. */
const d = (a: number, b: number): string => `${a - b >= 0 ? '-' : '+'}${Math.abs(a - b).toFixed(1)}`;

/** A difference smaller than this (ms) is noise. */
const NOISE = 0.3;

export class PerfProbe {
  private scenarios: ProbeScenario[] = [];
  private restore: (() => void) | null = null;
  private stats: () => ProbeStats = () => ({ cpuMs: 0, gpuMs: -1, calls: 0, triangles: 0 });
  private index = -1;
  private settleFrames = 0;
  private settleTime = 0;
  private verified = true;
  private readonly intervals = new Float64Array(MEASURE_FRAMES);
  private n = 0;
  private cpu = 0;
  private gpu = 0;
  private gpuN = 0;
  private samples: ProbeSample[] = [];
  /** Frames skipped because the game was paused during the run. */
  pausedFrames = 0;

  get running(): boolean {
    return this.index >= 0;
  }

  get label(): string {
    return this.running ? this.scenarios[this.index].label : '';
  }

  get progress(): number {
    if (!this.running) return 1;
    const within = this.settleFrames < SETTLE_FRAMES ? 0 : this.n / MEASURE_FRAMES;
    return (this.index + Math.min(1, within)) / this.scenarios.length;
  }

  /** Begin a run. `restore` puts every knob back the way the player had it. */
  start(scenarios: ProbeScenario[], restore: () => void, stats: () => ProbeStats): void {
    if (this.running || !scenarios.length) return;
    this.scenarios = scenarios;
    this.restore = restore;
    this.stats = stats;
    this.samples = [];
    this.pausedFrames = 0;
    this.index = 0;
    this.beginScenario();
  }

  private beginScenario(): void {
    this.settleFrames = 0;
    this.settleTime = 0;
    this.n = 0;
    this.cpu = 0;
    this.gpu = 0;
    this.gpuN = 0;
    this.verified = true;
    // every scenario is measured against the player's own settings, one change at a time
    this.restore?.();
    this.scenarios[this.index].apply();
  }

  cancel(): void {
    if (!this.running) return;
    this.index = -1;
    this.restore?.();
  }

  /**
   * Call once per frame with the real frame interval (s) and whether the game is running. Paused
   * frames are not measured — a paused game is not the game.
   */
  update(dt: number, playing: boolean): void {
    if (!this.running || !(dt > 0) || dt > 0.5) return;
    if (!playing) {
      this.pausedFrames++;
      return;
    }
    const s = this.scenarios[this.index];
    if (this.settleFrames < SETTLE_FRAMES || this.settleTime < SETTLE_SECONDS) {
      this.settleFrames++;
      this.settleTime += dt;
      return;
    }
    // the change must still be in effect while measuring
    if (s.verify && !s.verify()) this.verified = false;
    const st = this.stats();
    this.intervals[this.n++] = dt * 1000;
    this.cpu += st.cpuMs;
    if (st.gpuMs >= 0) {
      this.gpu += st.gpuMs;
      this.gpuN++;
    }
    if (this.n < MEASURE_FRAMES) return;

    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += this.intervals[i];
    const sorted = Array.from(this.intervals.subarray(0, this.n)).sort((a, b) => a - b);
    this.samples.push({
      id: s.id,
      label: s.label,
      ms: sum / this.n,
      p90: sorted[Math.floor(this.n * 0.9)],
      cpuMs: this.cpu / this.n,
      gpuMs: this.gpuN ? this.gpu / this.gpuN : -1,
      frames: this.n,
      calls: st.calls,
      triangles: st.triangles,
      verified: this.verified,
    });
    this.index++;
    if (this.index >= this.scenarios.length) {
      this.index = -1;
      this.restore?.();
      return;
    }
    this.beginScenario();
  }

  get done(): boolean {
    return !this.running && this.samples.length > 0;
  }

  get results(): readonly ProbeSample[] {
    return this.samples;
  }

  /**
   * Is this run believable? Invalid when no scenario changed the frame, the CPU or the GPU time by
   * more than noise — that means the switches were not reaching anything (or the game was not
   * running), not that every feature is free.
   */
  validity(): { valid: boolean; why: string } {
    if (this.samples.length < 2) return { valid: false, why: 'belum ada hasil' };
    const base = this.samples[0];
    if (base.frames < MEASURE_FRAMES) return { valid: false, why: 'terlalu sedikit frame terukur' };
    const moved = this.samples.slice(1).some((s) => Math.abs(base.ms - s.ms) > NOISE || Math.abs(base.cpuMs - s.cpuMs) > NOISE || (s.gpuMs >= 0 && base.gpuMs >= 0 && Math.abs(base.gpuMs - s.gpuMs) > NOISE));
    if (!moved) return { valid: false, why: 'tidak satu pun fitur mengubah waktu frame, CPU, atau GPU — pengukuran tidak menjangkau fiturnya' };
    return { valid: true, why: '' };
  }

  /** Report lines: the baseline, then how much each feature costs relative to it. */
  lines(): string[] {
    if (!this.samples.length) return [];
    const base = this.samples[0];
    const v = this.validity();
    const out = [
      v.valid ? 'hasil: VALID' : `hasil: TIDAK VALID — ${v.why}. Jangan dipakai sebagai acuan.`,
      `baseline: frame ${base.ms.toFixed(1)} ms (p90 ${base.p90.toFixed(1)}, ${(1000 / base.ms).toFixed(1)} fps)  cpu ${base.cpuMs.toFixed(1)}  ${gpu(base.gpuMs)}  ${base.calls} draw  ${(base.triangles / 1000).toFixed(1)}k tri`,
    ];
    if (base.ms < 17.5 && base.p90 < 17.5)
      out.push('catatan: baseline sudah 60 fps (terkunci vsync) — hematnya terlihat di cpu/gpu, bukan di waktu frame');
    for (const s of this.samples.slice(1)) {
      const gpuDelta = s.gpuMs >= 0 && base.gpuMs >= 0 ? `  gpu ${d(base.gpuMs, s.gpuMs)}` : '';
      out.push(
        `${s.label.padEnd(22)} frame ${s.ms.toFixed(1)} ms (hemat ${d(base.ms, s.ms)})  cpu ${d(base.cpuMs, s.cpuMs)}${gpuDelta}  ${s.calls} draw` +
          (s.verified ? '' : '  ⚠ TIDAK BERUBAH: fitur tidak benar-benar mati saat diukur'),
      );
    }
    if (this.pausedFrames > 0) out.push(`(${this.pausedFrames} frame dilewati karena game dijeda)`);
    return out;
  }
}
