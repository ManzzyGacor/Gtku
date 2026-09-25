/**
 * AUTO, per component (docs/OVERHAUL.md §4 "Grafik": AUTO memantau FPS lalu menurunkan/menaikkan
 * kualitas bertahap dengan cooldown).
 *
 * The first AUTO moved along one ladder of whole presets: when the frame rate sagged it dropped the
 * *entire* look a notch — pixel grid, lights, bloom, water, everything at once — which is the
 * bluntest possible instrument. This one turns individual dials, cheapest visual loss first, and
 * only drops the preset itself when every dial is already down.
 *
 * **The path.** `AUTO_PATH` is an ordered list of single steps, each one component moving one
 * notch. Dropping advances one step; raising undoes the most recent one. Because the order is
 * fixed, the tuner can never oscillate between two different components, and the log of decisions
 * reads as a story ("particles, then wind, then bloom…") rather than noise.
 *
 * **The order** comes from the on-device A/B probe run earlier on the tester's phone
 * (docs/PROGRESS.md, "Uji performa"): things that cost frame time but are hard to notice go first
 * (fireflies and fog, grass sway, ground grain), the expensive-and-noticeable ones later (dynamic
 * lights, resolution), and the outline — the thing that makes it read as pixel art — last.
 *
 * **Stability**, unchanged from the first AUTO because it worked: a drop needs 2.5 s below 48 fps; a
 * raise needs a sustained good stretch that *doubles* after every drop (so it settles instead of
 * flapping), and every change is followed by a cooldown. The difference is only in what moves.
 */
import { COOLDOWN, DROP_HOLD, FPS_CEIL, FPS_FLOOR, MAX_RAISE_HOLD, RAISE_HOLD } from './graphics';
import type { PerfMeter } from './perf';

/** Every dial AUTO may turn. 1 means "as the preset has it"; lower is cheaper. */
export interface ComponentLevels {
  /** Fireflies and drifting fog. */
  particles: number;
  /** Vegetation sway. */
  wind: number;
  /** Ground grain texture. */
  detail: number;
  /** Bloom strength. */
  bloom: number;
  /** Dynamic point lights (count). */
  lights: number;
  /** Animated water surface. */
  water: number;
  /** Extra chunk margin beyond what is on screen. */
  distance: number;
  /** Pixel outline pass. */
  outline: number;
  /** Render-scale multiplier on top of the preset's. */
  resolution: number;
}

export type ComponentId = keyof ComponentLevels;

export const COMPONENT_LABEL: Record<ComponentId, string> = {
  particles: 'partikel',
  wind: 'angin rumput',
  detail: 'grain tanah',
  bloom: 'bloom',
  lights: 'lampu dinamis',
  water: 'air beriak',
  distance: 'jarak pandang',
  outline: 'outline',
  resolution: 'resolusi',
};

export const FULL: ComponentLevels = {
  particles: 1,
  wind: 1,
  detail: 1,
  bloom: 1,
  lights: 3,
  water: 1,
  distance: 1,
  outline: 1,
  resolution: 1,
};

/** One notch of one dial. */
export interface PathStep {
  c: ComponentId;
  value: number;
}

/**
 * The degradation path, best first. Each step lowers exactly one component by one notch.
 * Read top to bottom: this is the order AUTO gives things up in.
 */
export const AUTO_PATH: PathStep[] = [
  { c: 'particles', value: 0.5 },
  { c: 'wind', value: 0.6 },
  { c: 'detail', value: 0 },
  { c: 'bloom', value: 0.6 },
  { c: 'particles', value: 0 },
  { c: 'lights', value: 2 },
  { c: 'bloom', value: 0 },
  { c: 'wind', value: 0 },
  { c: 'lights', value: 1 },
  { c: 'resolution', value: 0.85 },
  { c: 'water', value: 0 },
  { c: 'distance', value: 0 },
  { c: 'resolution', value: 0.7 },
  { c: 'lights', value: 0 },
  { c: 'resolution', value: 0.6 },
  { c: 'outline', value: 0 },
];

/** The dials after the first `rung` steps of the path. Pure. */
export function levelsAt(rung: number): ComponentLevels {
  const out = { ...FULL };
  const n = Math.max(0, Math.min(AUTO_PATH.length, Math.floor(rung)));
  for (let i = 0; i < n; i++) out[AUTO_PATH[i].c] = AUTO_PATH[i].value;
  return out;
}

export type AutoDirection = 'drop' | 'raise';

/** A decision, for the test report. */
export interface AutoDecision {
  /** Seconds since the tuner started. */
  at: number;
  dir: AutoDirection;
  /** "bloom 1 → 0.6", or "preset Tinggi → Sedang". */
  what: string;
  fps: number;
  low: number;
}

export interface AutoResult {
  /** The dials changed; re-apply them. */
  levels?: ComponentLevels | undefined;
  /** Every dial is exhausted (or all back up): move the whole preset one step. */
  preset?: AutoDirection | undefined;
}

const HISTORY = 12;

export class AutoTuner {
  /** How far along `AUTO_PATH` we are. 0 = everything as the preset has it. */
  rung = 0;
  auto = true;
  readonly decisions: AutoDecision[] = [];
  private bad = 0;
  private good = 0;
  private raiseHold = RAISE_HOLD;
  private cooldown = 4;
  private clock = 0;

  constructor(private readonly meter: Pick<PerfMeter, 'avg' | 'low' | 'ready' | 'reset'>) {}

  get levels(): ComponentLevels {
    return levelsAt(this.rung);
  }

  /** Put the dials back to full, e.g. after the player picks a preset by hand. */
  reset(): void {
    this.rung = 0;
    this.bad = 0;
    this.good = 0;
    this.raiseHold = RAISE_HOLD;
    this.cooldown = 4;
  }

  /**
   * Once per frame. Returns what changed, if anything.
   *
   * `canDropPreset` / `canRaisePreset` say whether there is a preset below/above the current one:
   * the path handles the dials, and only when it has nothing left does the preset move.
   */
  update(dt: number, canDropPreset: boolean, canRaisePreset: boolean, presetLabel = ''): AutoResult | null {
    if (!(dt > 0) || dt > 1) return null;
    this.clock += dt;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return null;
    }
    if (!this.auto || !this.meter.ready) return null;

    if (this.meter.avg < FPS_FLOOR) {
      this.good = 0;
      this.bad += dt;
      if (this.bad < DROP_HOLD) return null;
      return this.drop(canDropPreset, presetLabel);
    }
    this.bad = 0;
    // A raise needs the worst half-second healthy as well, not just the average.
    if (this.meter.avg > FPS_CEIL && this.meter.low > FPS_FLOOR) {
      this.good += dt;
      if (this.good < this.raiseHold) return null;
      return this.raise(canRaisePreset, presetLabel);
    }
    this.good = 0;
    return null;
  }

  private settle(dir: AutoDirection, what: string): void {
    this.decisions.push({ at: Math.round(this.clock), dir, what, fps: Math.round(this.meter.avg), low: Math.round(this.meter.low) });
    if (this.decisions.length > HISTORY) this.decisions.shift();
    this.bad = 0;
    this.good = 0;
    this.cooldown = COOLDOWN;
    // each drop makes the next raise harder to earn, so the picture settles instead of flapping
    if (dir === 'drop') this.raiseHold = Math.min(MAX_RAISE_HOLD, this.raiseHold * 2);
    this.meter.reset();
  }

  private drop(canDropPreset: boolean, presetLabel: string): AutoResult | null {
    if (this.rung < AUTO_PATH.length) {
      const step = AUTO_PATH[this.rung];
      const before = levelsAt(this.rung)[step.c];
      this.rung++;
      this.settle('drop', `${COMPONENT_LABEL[step.c]} ${before} → ${step.value}`);
      return { levels: this.levels };
    }
    if (!canDropPreset) {
      this.bad = 0;
      return null;
    }
    // every dial is down and it is still too slow: the pixel grid itself has to shrink
    this.rung = 0;
    this.settle('drop', `preset ${presetLabel} turun (semua komponen sudah minimum)`);
    return { preset: 'drop', levels: this.levels };
  }

  private raise(canRaisePreset: boolean, presetLabel: string): AutoResult | null {
    if (this.rung > 0) {
      this.rung--;
      const step = AUTO_PATH[this.rung];
      const after = levelsAt(this.rung)[step.c];
      this.settle('raise', `${COMPONENT_LABEL[step.c]} ${step.value} → ${after}`);
      return { levels: this.levels };
    }
    if (!canRaisePreset) {
      this.good = 0;
      return null;
    }
    // Everything is back at full and it is still comfortably fast. Moving up a preset makes the
    // dials start from the bottom again, so the new preset proves itself step by step instead of
    // arriving all at once.
    this.rung = AUTO_PATH.length;
    this.settle('raise', `preset ${presetLabel} naik (komponen mulai dari minimum)`);
    return { preset: 'raise', levels: this.levels };
  }
}
