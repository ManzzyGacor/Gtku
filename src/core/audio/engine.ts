/**
 * The audio system (docs/OVERHAUL.md §4 "Audio": BGM, SFX, ambient, combat, UI — masing-masing
 * dengan volume sendiri).
 *
 * Everything is synthesised from oscillators and filtered noise, because a game that has to boot
 * over mobile data cannot spend two megabytes per area on music. What the folder buys us is the
 * *seam*: sounds are asked for by name, five category buses sit between them and the speakers, and
 * `overrides.ts` can put a real recorded file in front of any name later without the callers
 * knowing.
 *
 *   index.ts    the barrel everything else imports
 *   engine.ts   this file: the context, the five buses, unlock/suspend/resume
 *   lifecycle.ts  the suspend/resume registry, kept separate to avoid an import cycle
 *   sfx.ts      the one-shot vocabulary (swing, hit, thunder, ...)
 *   tracks.ts   the music, as data + pure note generation
 *   music.ts    schedules `tracks.ts` into the context, with crossfades
 *   beds.ts     the ambience, as data
 *   ambient.ts  schedules `beds.ts` into the context
 *   select.ts   which track and which bed a situation calls for
 *
 * Mobile browsers refuse to start audio before the first touch, so everything here is lazy and
 * every call is a no-op until `unlockAudio()` has run inside a real gesture.
 */
import { settings, type Settings } from '../settings';
import { notifyResume, notifySuspend } from './lifecycle';

type Ctx = AudioContext & { state: AudioContextState };

/**
 * The five mixer categories. Each one is a gain node the player controls, so "turn the music down
 * but keep the hits" is a real thing rather than a single master slider.
 */
export type AudioCategory = 'bgm' | 'sfx' | 'ambient' | 'combat' | 'ui';

export const CATEGORIES: { id: AudioCategory; label: string; key: keyof Settings }[] = [
  { id: 'bgm', label: 'Musik', key: 'musicVol' },
  { id: 'ambient', label: 'Suasana', key: 'ambientVol' },
  { id: 'combat', label: 'Tempur', key: 'combatVol' },
  { id: 'sfx', label: 'Efek', key: 'sfxVol' },
  { id: 'ui', label: 'Antarmuka', key: 'uiVol' },
];

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let ready = false;
const buses = new Map<AudioCategory, GainNode>();
let unsubscribe: (() => void) | null = null;

/** Call from a real user gesture (first tap / keypress). Safe to call repeatedly. */
export function unlockAudio(): void {
  if (ready) {
    void ctx?.resume?.();
    return;
  }
  try {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor() as Ctx;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    for (const cat of CATEGORIES) {
      const g = ctx.createGain();
      g.gain.value = volumeOf(cat.id);
      g.connect(master);
      buses.set(cat.id, g);
    }
    ready = true;
    // The sliders apply live: a player adjusting the music volume should hear it move.
    unsubscribe?.();
    unsubscribe = settings.on(() => applyVolumes());
    void ctx.resume?.();
  } catch {
    ready = false;
  }
}

function volumeOf(cat: AudioCategory): number {
  const key = CATEGORIES.find((c) => c.id === cat)?.key;
  const v = key ? (settings.get(key) as number) : 1;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
}

function applyVolumes(): void {
  if (!ctx) return;
  for (const [cat, node] of buses) {
    const want = volumeOf(cat);
    // a short ramp rather than a jump, so dragging a slider does not click
    node.gain.setTargetAtTime(want, ctx.currentTime, 0.02);
  }
}

/**
 * Put the audio hardware to sleep while the game is in the background.
 *
 * Without this, a suspended tab keeps its audio graph alive and the phone keeps the audio path
 * powered — audible as battery drain rather than as sound. The music scheduler is stopped too:
 * `currentTime` freezes while the context is suspended, so anything already scheduled would all
 * fire at once on the way back in.
 */
export function suspendAudio(): void {
  if (!ready || !ctx) return;
  notifySuspend();
  void ctx.suspend?.();
}

/**
 * Wake it back up. iOS Safari hands the context back **suspended** every single time the app
 * returns to the foreground, so this has to run on the way back in, not only on the first tap.
 */
export function resumeAudio(): void {
  if (!ready || !ctx) return;
  void ctx.resume?.();
  notifyResume();
}

export function audioReady(): boolean {
  return ready && ctx?.state === 'running';
}

/** The context and the category buses, for the schedulers to build on. */
export function audioGraph(): { ctx: AudioContext; bus: (cat: AudioCategory) => GainNode } | null {
  if (!ready || !ctx) return null;
  const c = ctx;
  return { ctx: c, bus: (cat) => buses.get(cat) ?? (master as GainNode) };
}

export interface ToneOpts {
  /** Start frequency in Hz. */
  from: number;
  /** End frequency; a slide is what makes a swing sound like a swing. */
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Seconds to wait before playing. */
  delay?: number;
  /** Which mixer bus. Defaults to `sfx`. */
  cat?: AudioCategory;
}

export function tone(o: ToneOpts): void {
  if (!ready || !ctx) return;
  const out = buses.get(o.cat ?? 'sfx');
  if (!out) return;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(o.from, t0);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  // a hard attack and a short exponential tail: the chiptune envelope
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

/** Filtered noise, for impacts and footsteps. */
export function noise(dur: number, gain: number, freq: number, q = 1, cat: AudioCategory = 'sfx'): void {
  if (!ready || !ctx) return;
  const out = buses.get(cat);
  if (!out) return;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(out);
  src.start();
}

