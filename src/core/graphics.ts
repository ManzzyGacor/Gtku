/**
 * Graphics presets and the AUTO watchdog (docs/OVERHAUL.md §4 "Grafik").
 *
 * AUTO is the default: it watches the smoothed FPS and steps the quality **down** when the phone
 * can't hold the target, or back **up** when it comfortably can. Every change starts a cooldown, and
 * the hold time before raising doubles after each drop, so the quality settles instead of oscillating.
 *
 * Pure logic (no renderer) so the whole ladder is unit-testable.
 */
import type { PerfMeter } from './perf';
import { PRESET_IDS, type PresetId } from './settings';

export interface GraphicsProfile {
  id: PresetId;
  /** Label shown in the settings menu. */
  name: string;
  note: string;

  // ── knobs used by the 2D (Phaser) renderer ──
  bloom: boolean;
  /** Particle count multiplier. */
  particles: number;
  /** Redraw the lightmap every N frames. */
  lightmapEveryN: number;
  /** Parallax layers (canopy, clouds, cave motes). */
  parallax: boolean;
  /** Per-area ground fog. */
  fog: boolean;
  /** Maximum simultaneous light halos. */
  halos: number;

  // ── knobs used by the 3D renderer from Fase 1 on ──
  /** Fraction of the pixel buffer actually rendered, then upscaled (performance dial). */
  renderScale: number;
  /** Height of the low-resolution pixel buffer in px (the "pixel size" dial). */
  pixelHeight: number;
  /** Post-process pixel outline. */
  outline: boolean;
  shadows: 'off' | 'low' | 'high';
  /** How many world chunks to keep around the camera. */
  renderDistance: number;
}

export const PROFILES: Record<PresetId, GraphicsProfile> = {
  vlow: {
    id: 'vlow', name: 'Sangat Rendah', note: 'Untuk HP lama',
    bloom: false, particles: 0.2, lightmapEveryN: 3, parallax: false, fog: false, halos: 6,
    renderScale: 0.6, pixelHeight: 270, outline: false, shadows: 'off', renderDistance: 1,
  },
  low: {
    id: 'low', name: 'Rendah', note: 'Paling ringan',
    bloom: false, particles: 0.4, lightmapEveryN: 2, parallax: false, fog: false, halos: 10,
    renderScale: 0.75, pixelHeight: 270, outline: false, shadows: 'off', renderDistance: 2,
  },
  medium: {
    id: 'medium', name: 'Sedang', note: 'Seimbang',
    bloom: false, particles: 0.7, lightmapEveryN: 1, parallax: true, fog: false, halos: 16,
    renderScale: 1, pixelHeight: 270, outline: true, shadows: 'low', renderDistance: 2,
  },
  high: {
    id: 'high', name: 'Tinggi', note: 'Semua efek dasar',
    bloom: true, particles: 1, lightmapEveryN: 1, parallax: true, fog: true, halos: 22,
    renderScale: 1, pixelHeight: 324, outline: true, shadows: 'high', renderDistance: 3,
  },
  ultra: {
    id: 'ultra', name: 'Ultra', note: 'Paling berat',
    bloom: true, particles: 1.4, lightmapEveryN: 1, parallax: true, fog: true, halos: 22,
    renderScale: 1, pixelHeight: 360, outline: true, shadows: 'high', renderDistance: 4,
  },
};

export const profileOf = (id: PresetId): GraphicsProfile => PROFILES[id] ?? PROFILES.medium;

/** One step down the ladder, or null at the bottom. */
export function lowerPreset(id: PresetId): PresetId | null {
  const i = PRESET_IDS.indexOf(id);
  return i > 0 ? PRESET_IDS[i - 1] : null;
}

/** One step up the ladder, or null at the top. */
export function higherPreset(id: PresetId): PresetId | null {
  const i = PRESET_IDS.indexOf(id);
  return i >= 0 && i < PRESET_IDS.length - 1 ? PRESET_IDS[i + 1] : null;
}

// ───────────────────────── device probe ─────────────────────────

export interface DeviceInfo {
  cores: number;
  /** GB reported by `navigator.deviceMemory`, or 0 when unknown. */
  memoryGB: number;
  screenW: number;
  screenH: number;
  dpr: number;
  webgl2: boolean;
  touch: boolean;
  ua: string;
}

export function probeDevice(): DeviceInfo {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  const win = typeof window !== 'undefined' ? window : ({ innerWidth: 0, innerHeight: 0, devicePixelRatio: 1 } as Window);
  let webgl2 = false;
  try {
    webgl2 = typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return {
    cores: nav.hardwareConcurrency ?? 0,
    memoryGB: nav.deviceMemory ?? 0,
    screenW: Math.round(win.innerWidth * (win.devicePixelRatio || 1)),
    screenH: Math.round(win.innerHeight * (win.devicePixelRatio || 1)),
    dpr: win.devicePixelRatio || 1,
    webgl2,
    touch: (nav.maxTouchPoints ?? 0) > 0,
    ua: nav.userAgent ?? '',
  };
}

/**
 * Where AUTO starts on a device it has never seen. Deliberately conservative: it is much nicer to
 * be raised into the pretty settings after a few smooth seconds than to start at 20 fps.
 */
export function suggestPreset(d: DeviceInfo): PresetId {
  if (!d.webgl2) return 'vlow';
  let score = 0;
  if (d.cores >= 8) score += 2;
  else if (d.cores >= 6) score += 1;
  else if (d.cores > 0 && d.cores <= 4) score -= 1;
  if (d.memoryGB >= 6) score += 2;
  else if (d.memoryGB >= 4) score += 1;
  else if (d.memoryGB > 0 && d.memoryGB <= 2) score -= 2;
  if (d.screenW * d.screenH > 2_600_000) score -= 1; // lots of pixels to push
  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  if (score >= -1) return 'low';
  return 'vlow';
}

// ───────────────────────── AUTO watchdog ─────────────────────────

/** Below this average FPS the quality steps down. */
export const FPS_FLOOR = 45;
/** Above this average FPS (with a clean worst-bucket too) the quality may step back up. */
export const FPS_CEIL = 57;
const DROP_HOLD = 3;
const RAISE_HOLD = 12;
const MAX_RAISE_HOLD = 120;
/** After any change, wait this long before judging again. */
const COOLDOWN = 8;

export type QualityChange = 'drop' | 'raise';

export class AdaptiveQuality {
  /** Fires when the watchdog changed the preset by itself. */
  onChange: (from: PresetId, to: PresetId, why: QualityChange) => void = () => undefined;
  /** AUTO mode. When false the player pinned a preset and the watchdog keeps its hands off. */
  auto = true;
  private bad = 0;
  private good = 0;
  private raiseHold = RAISE_HOLD;
  private cooldown = 4;

  constructor(private readonly meter: PerfMeter) {}

  /** Call once per frame with the real delta and the preset currently in effect. */
  update(dt: number, current: PresetId): void {
    if (!(dt > 0) || dt > 1) return;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    if (!this.auto || !this.meter.ready) return;

    if (this.meter.avg < FPS_FLOOR) {
      this.good = 0;
      this.bad += dt;
      if (this.bad >= DROP_HOLD) this.change(current, lowerPreset(current), 'drop');
      return;
    }
    this.bad = 0;
    // Raising needs the worst half-second to be healthy too, not just the average.
    if (this.meter.avg > FPS_CEIL && this.meter.low > FPS_FLOOR + 5) {
      this.good += dt;
      if (this.good >= this.raiseHold) this.change(current, higherPreset(current), 'raise');
    } else {
      this.good = 0;
    }
  }

  private change(from: PresetId, to: PresetId | null, why: QualityChange): void {
    this.bad = 0;
    this.good = 0;
    if (!to) return; // already at the end of the ladder
    this.cooldown = COOLDOWN;
    // Each drop makes the next raise harder to earn, so the quality settles instead of flapping.
    if (why === 'drop') this.raiseHold = Math.min(MAX_RAISE_HOLD, this.raiseHold * 2);
    this.meter.reset();
    this.onChange(from, to, why);
  }
}
