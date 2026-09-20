/**
 * Graphics presets and the adaptive watchdog that drops one step when the phone can't keep up.
 * `low`..`high` use the built-in generated art; `ultra` additionally needs the downloaded HD pack.
 * Pure logic (no Phaser) so the whole ladder is unit-testable.
 */
import type { PerfMeter } from './perf';
import { PRESET_IDS, type PresetId } from './settings';

export interface GraphicsProfile {
  id: PresetId;
  /** Shown in the settings panel. */
  name: string;
  note: string;
  bloom: boolean;
  /** Particle count multiplier. */
  particles: number;
  /** Redraw the lightmap every N frames. */
  lightmapEveryN: number;
  /** Parallax layers (canopy, clouds, cave dust). */
  parallax: boolean;
  /** Per-area ground fog. */
  fog: boolean;
  /** Maximum simultaneous light halos. */
  halos: number;
  /** Needs the HD asset pack. */
  hd: boolean;
}

export const PROFILES: Record<PresetId, GraphicsProfile> = {
  low: { id: 'low', name: 'Low', note: 'Paling ringan', bloom: false, particles: 0.4, lightmapEveryN: 2, parallax: false, fog: false, halos: 10, hd: false },
  medium: { id: 'medium', name: 'Medium', note: 'Seimbang', bloom: false, particles: 0.7, lightmapEveryN: 1, parallax: true, fog: false, halos: 16, hd: false },
  high: { id: 'high', name: 'High', note: 'Semua efek dasar', bloom: true, particles: 1, lightmapEveryN: 1, parallax: true, fog: true, halos: 22, hd: false },
  ultra: { id: 'ultra', name: 'Ultra', note: 'Perlu paket HD', bloom: true, particles: 1.4, lightmapEveryN: 1, parallax: true, fog: true, halos: 22, hd: true },
};

export const profileOf = (id: PresetId): GraphicsProfile => PROFILES[id] ?? PROFILES.high;

/** One step down the ladder, or null at the bottom. */
export function lowerPreset(id: PresetId): PresetId | null {
  const i = PRESET_IDS.indexOf(id);
  return i > 0 ? PRESET_IDS[i - 1] : null;
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
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const win = (typeof window !== 'undefined' ? window : { innerWidth: 0, innerHeight: 0, devicePixelRatio: 1 }) as Window;
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
 * First-run suggestion. Deliberately never suggests `ultra`: that one costs a download,
 * so the player has to ask for it.
 */
export function suggestPreset(d: DeviceInfo): PresetId {
  let score = 0;
  if (d.cores >= 8) score += 2;
  else if (d.cores >= 6) score += 1;
  else if (d.cores > 0 && d.cores <= 4) score -= 1;
  if (d.memoryGB >= 6) score += 2;
  else if (d.memoryGB >= 4) score += 1;
  else if (d.memoryGB > 0 && d.memoryGB <= 2) score -= 2;
  if (d.webgl2) score += 1;
  else score -= 2;
  const pixels = d.screenW * d.screenH;
  if (pixels > 2_600_000) score -= 1; // lots of pixels to push
  if (score >= 3) return 'high';
  if (score >= 0) return 'medium';
  return 'low';
}

// ───────────────────────── adaptive watchdog ─────────────────────────

/** Below this average FPS for `HOLD` seconds, the preset drops one step. */
export const FPS_FLOOR = 45;
const HOLD = 3;
/** Don't drop again immediately: give the new preset time to show its effect. */
const COOLDOWN = 8;

export class AdaptiveQuality {
  /** Fires when the watchdog lowered the preset by itself. */
  onDrop: (from: PresetId, to: PresetId) => void = () => undefined;
  /** Set false to stop the watchdog (URL-locked preset, settings panel open). */
  enabled = true;
  private bad = 0;
  private cooldown = 4;

  constructor(private readonly meter: PerfMeter) {}

  /** Call once per frame with the real delta and the current preset. */
  update(dt: number, current: PresetId): void {
    if (!(dt > 0) || dt > 1) return;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    if (!this.enabled || !this.meter.ready) return;
    if (this.meter.avg >= FPS_FLOOR) {
      this.bad = 0;
      return;
    }
    this.bad += dt;
    if (this.bad < HOLD) return;
    this.bad = 0;
    const next = lowerPreset(current);
    if (!next) {
      this.enabled = false;
      return;
    }
    this.cooldown = COOLDOWN;
    this.meter.reset();
    this.onDrop(current, next);
  }
}
