/**
 * Player settings: graphics preset, debug overlays, touch layout, text size, volumes.
 * Pure DOM + localStorage (no Phaser) so it can be unit-tested and read from anywhere.
 *
 * URL parameters override a stored value for the session and lock it in the UI:
 *   ?fps=1  ?bloom=0  ?preset=low|medium|high|ultra  ?q=0|1|2 (legacy, maps to low/medium/high)
 */
import { LEGACY_SETTINGS_KEY, SETTINGS_KEY } from '../config';
import { readRaw, writeRaw } from './storage';

/** Concrete quality levels, weakest first. "AUTO" is not a level — it is the `presetAuto` flag. */
export type PresetId = 'vlow' | 'low' | 'medium' | 'high' | 'ultra';
export const PRESET_IDS: readonly PresetId[] = ['vlow', 'low', 'medium', 'high', 'ultra'];

export interface Settings {
  /** The quality level currently in effect (persisted, so a reload resumes where AUTO left off). */
  preset: PresetId;
  /** AUTO mode: the watchdog may raise and lower `preset` by itself. Off once the player pins one. */
  presetAuto: boolean;
  fpsCounter: boolean;
  bloom: boolean;
  /** Joystick radius multiplier. */
  stickScale: number;
  /** Joystick home position as a fraction of the screen. */
  stickX: number;
  stickY: number;
  /** Action button radius multiplier. */
  buttonScale: number;
  /** Dialogue text scale (1 = small, 3 = large); HUD text follows at one step down. */
  textScale: number;
  /** 3/4 camera tilt above the ground, in degrees. Lower = more side-on, more of the buildings visible. */
  camPitch: number;
  /** 3/4 camera zoom. Higher = closer to the hero. */
  camZoom: number;
  /**
   * Extra multiplier on the preset's render scale, 0.5..1. The one direct performance lever:
   * it lowers how many pixels are actually shaded without changing the art's pixel size.
   */
  renderScale: number;
  musicVol: number;
  sfxVol: number;
  /** Set once the intro cutscene has been watched (or skipped) to the end. */
  cutsceneSeen: boolean;
}

export const DEFAULTS: Settings = {
  preset: 'medium',
  presetAuto: true,
  fpsCounter: false,
  bloom: true,
  stickScale: 1,
  stickX: 0.14,
  stickY: 0.78,
  buttonScale: 1,
  textScale: 2,
  camPitch: 38,
  camZoom: 1,
  renderScale: 1,
  musicVol: 0.6,
  sfxVol: 0.8,
  cutsceneSeen: false,
};

/** Allowed range + step for the numeric settings, shared by the settings panel and clamping. */
export const RANGES = {
  stickScale: { min: 0.7, max: 1.8, step: 0.1 },
  stickX: { min: 0.06, max: 0.42, step: 0.02 },
  stickY: { min: 0.4, max: 0.9, step: 0.02 },
  buttonScale: { min: 0.7, max: 1.8, step: 0.1 },
  textScale: { min: 1, max: 3, step: 1 },
  camPitch: { min: 22, max: 55, step: 1 },
  camZoom: { min: 0.6, max: 2, step: 0.05 },
  renderScale: { min: 0.5, max: 1, step: 0.05 },
  musicVol: { min: 0, max: 1, step: 0.1 },
  sfxVol: { min: 0, max: 1, step: 0.1 },
} as const;

export type NumericKey = keyof typeof RANGES;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Round to the nearest step so repeated +/- never drifts (0.30000000000000004). */
export function quantize(key: NumericKey, value: number): number {
  const r = RANGES[key];
  const steps = Math.round((clamp(value, r.min, r.max) - r.min) / r.step);
  return Math.round((r.min + steps * r.step) * 1000) / 1000;
}

function sanitize(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof o.preset === 'string' && PRESET_IDS.includes(o.preset as PresetId)) out.preset = o.preset as PresetId;
  for (const k of ['presetAuto', 'fpsCounter', 'bloom', 'cutsceneSeen'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  for (const k of Object.keys(RANGES) as NumericKey[]) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = quantize(k, o[k] as number);
  return out;
}

function readStored(): Partial<Settings> {
  try {
    const raw = readRaw(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Parse `?fps=1&bloom=0&preset=ultra&q=1` into a partial settings patch. */
export function parseUrlOverrides(search: string): Partial<Settings> {
  const out: Partial<Settings> = {};
  const q = new URLSearchParams(search);
  const bool = (v: string | null): boolean | null => (v === '1' || v === 'on' ? true : v === '0' || v === 'off' ? false : null);
  const fps = bool(q.get('fps'));
  if (fps !== null) out.fpsCounter = fps;
  const bloom = bool(q.get('bloom'));
  if (bloom !== null) out.bloom = bloom;
  const p = q.get('preset');
  if (p && PRESET_IDS.includes(p as PresetId)) out.preset = p as PresetId;
  const legacy = q.get('q');
  if (out.preset === undefined && (legacy === '0' || legacy === '1' || legacy === '2')) out.preset = (['low', 'medium', 'high'] as const)[Number(legacy)];
  if (out.preset !== undefined) out.presetAuto = false;
  return out;
}

export type SettingsListener = (key: keyof Settings | null) => void;

export class SettingsStore {
  private data: Settings;
  /** Keys pinned by the URL: changing them in the panel would be a lie, so the panel shows them locked. */
  readonly locked: ReadonlySet<keyof Settings>;
  /** True when nothing was stored yet, so AUTO may pick a starting preset from the device. */
  readonly firstRun: boolean;
  private listeners = new Set<SettingsListener>();

  constructor(search = typeof location !== 'undefined' ? location.search : '') {
    const overrides = parseUrlOverrides(search);
    const stored = readStored();
    this.firstRun = Object.keys(stored).length === 0;
    this.data = { ...DEFAULTS, ...stored, ...overrides };
    // `presetAuto` rides along with `preset` but must not show up as a locked row of its own.
    this.locked = new Set((Object.keys(overrides) as (keyof Settings)[]).filter((k) => k !== 'presetAuto'));
  }

  all(): Readonly<Settings> {
    return this.data;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.persist();
    for (const fn of this.listeners) fn(key);
  }

  /** Nudge a numeric setting by `dir` steps, clamped to its range. */
  step(key: NumericKey, dir: number): void {
    this.set(key, quantize(key, this.data[key] + RANGES[key].step * dir));
  }

  /** Put the named keys back to their defaults (the camera "reset" button). */
  reset(keys: readonly (keyof Settings)[]): void {
    for (const k of keys) {
      if (this.locked.has(k)) continue;
      this.set(k, DEFAULTS[k] as Settings[typeof k]);
    }
  }

  isLocked(key: keyof Settings): boolean {
    return this.locked.has(key);
  }

  on(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist(): void {
    // A blocked store just means the settings don't survive a reload.
    writeRaw(SETTINGS_KEY, JSON.stringify(this.data));
  }
}

export const settings = new SettingsStore();
