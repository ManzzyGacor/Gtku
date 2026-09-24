/**
 * On-device A/B performance probe.
 *
 * There is no GPU on the VPS, so the only honest way to find out what a frame costs is to measure
 * it on the phone. The probe walks a list of scenarios — all features on, then each expensive one
 * switched off in turn — holding each for a second or so and recording the **median** frame time
 * (median, not mean: one garbage-collection spike would otherwise swamp a whole sample).
 *
 * The result is a table the player can copy straight into a bug report, which turns "it's slow"
 * into "bloom costs 1.8 ms and the water costs 4.1 ms".
 */

export interface ProbeScenario {
  id: string;
  label: string;
  /** Turn this scenario's change on. Called once when the scenario starts. */
  apply: () => void;
}

export interface ProbeSample {
  id: string;
  label: string;
  /** Median frame time in ms. */
  ms: number;
  fps: number;
  frames: number;
  /** Draw calls in the last frame of the sample. */
  calls: number;
  triangles: number;
}

/** Seconds to settle after switching a scenario on, before timing starts. */
const SETTLE = 0.45;
/** Seconds of timing per scenario. */
const HOLD = 1.1;

export class PerfProbe {
  private scenarios: ProbeScenario[] = [];
  private restore: (() => void) | null = null;
  private index = -1;
  private elapsed = 0;
  private times: number[] = [];
  private samples: ProbeSample[] = [];
  private stats: () => { calls: number; triangles: number } = () => ({ calls: 0, triangles: 0 });

  get running(): boolean {
    return this.index >= 0;
  }

  get label(): string {
    return this.running ? this.scenarios[this.index].label : '';
  }

  get progress(): number {
    return this.running ? (this.index + Math.min(1, this.elapsed / (SETTLE + HOLD))) / this.scenarios.length : 1;
  }

  /** Begin a run. `restore` puts every knob back the way the player had it. */
  start(scenarios: ProbeScenario[], restore: () => void, stats: () => { calls: number; triangles: number }): void {
    if (this.running || !scenarios.length) return;
    this.scenarios = scenarios;
    this.restore = restore;
    this.stats = stats;
    this.samples = [];
    this.index = 0;
    this.elapsed = 0;
    this.times = [];
    restore();
    scenarios[0].apply();
  }

  cancel(): void {
    if (!this.running) return;
    this.index = -1;
    this.restore?.();
  }

  /** Call once per frame with the real frame time in seconds. */
  update(dt: number): void {
    if (!this.running || !(dt > 0) || dt > 0.5) return;
    this.elapsed += dt;
    if (this.elapsed > SETTLE) this.times.push(dt * 1000);
    if (this.elapsed < SETTLE + HOLD) return;

    const s = this.scenarios[this.index];
    const info = this.stats();
    this.times.sort((a, b) => a - b);
    const ms = this.times.length ? this.times[Math.floor(this.times.length / 2)] : 0;
    this.samples.push({ id: s.id, label: s.label, ms, fps: ms > 0 ? 1000 / ms : 0, frames: this.times.length, calls: info.calls, triangles: info.triangles });

    this.index++;
    this.elapsed = 0;
    this.times = [];
    if (this.index >= this.scenarios.length) {
      this.index = -1;
      this.restore?.();
      return;
    }
    // every scenario is measured against the player's own settings, one change at a time
    this.restore?.();
    this.scenarios[this.index].apply();
  }

  get done(): boolean {
    return !this.running && this.samples.length > 0;
  }

  /** Report lines: the baseline, then how much each feature costs relative to it. */
  lines(): string[] {
    if (!this.samples.length) return [];
    const base = this.samples[0];
    const out = [`baseline: ${base.ms.toFixed(1)} ms (${base.fps.toFixed(1)} fps)  ${base.calls} draw  ${(base.triangles / 1000).toFixed(0)}k tri`];
    for (const s of this.samples.slice(1)) {
      const saved = base.ms - s.ms;
      const sign = saved >= 0 ? '-' : '+';
      out.push(
        `${s.label.padEnd(22)} ${s.ms.toFixed(1)} ms (${s.fps.toFixed(1)} fps)  ` +
          `hemat ${sign}${Math.abs(saved).toFixed(1)} ms  ${s.calls} draw`,
      );
    }
    return out;
  }
}
