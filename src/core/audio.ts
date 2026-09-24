/**
 * Synthesised sound effects (WebAudio, no asset files).
 *
 * Batch 3 needs sound for one specific reason: a hit that makes no noise does not read as a hit.
 * The full audio system — music per area, ambience, sliders — belongs to Batch 5; this is the
 * minimum that makes combat feel connected, built from oscillators so it costs no download.
 *
 * Mobile browsers refuse to start audio before the first touch, so everything here is lazy and
 * every call is a no-op until `unlock()` has run inside a real gesture.
 */
import { settings } from './settings';

type Ctx = AudioContext & { state: AudioContextState };

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let ready = false;

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
    ready = true;
    void ctx.resume?.();
  } catch {
    ready = false;
  }
}

/**
 * Put the audio hardware to sleep while the game is in the background.
 *
 * Without this, a suspended tab keeps its audio graph alive and the phone keeps the audio path
 * powered — audible as battery drain rather than as sound. Calling it when audio was never
 * unlocked is a no-op.
 */
export function suspendAudio(): void {
  if (!ready || !ctx) return;
  void ctx.suspend?.();
}

/**
 * Wake it back up. iOS Safari hands the context back **suspended** every single time the app
 * returns to the foreground, so this has to run on the way back in, not only on the first tap.
 */
export function resumeAudio(): void {
  if (!ready || !ctx) return;
  void ctx.resume?.();
}

export function audioReady(): boolean {
  return ready && ctx?.state === 'running';
}

interface ToneOpts {
  /** Start frequency in Hz. */
  from: number;
  /** End frequency; a slide is what makes a swing sound like a swing. */
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Seconds to wait before playing. */
  delay?: number;
}

function tone(o: ToneOpts): void {
  if (!ready || !ctx || !master) return;
  const vol = settings.get('sfxVol');
  if (vol <= 0) return;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(o.from, t0);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  // a hard attack and a short exponential tail: the chiptune envelope
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime((o.gain ?? 0.2) * vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

/** Filtered noise, for impacts and footsteps. */
function noise(dur: number, gain: number, freq: number, q = 1): void {
  if (!ready || !ctx || !master) return;
  const vol = settings.get('sfxVol');
  if (vol <= 0) return;
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
  g.gain.value = gain * vol;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

/** The whole vocabulary, so callers never build their own sounds. */
export const sfx = {
  swing(heavy = false): void {
    tone({ from: heavy ? 340 : 520, to: heavy ? 120 : 220, dur: heavy ? 0.18 : 0.11, type: 'sawtooth', gain: heavy ? 0.13 : 0.09 });
    noise(heavy ? 0.14 : 0.08, heavy ? 0.1 : 0.06, heavy ? 900 : 1500, 0.7);
  },
  hit(heavy = false): void {
    tone({ from: heavy ? 180 : 260, to: 60, dur: 0.1, type: 'square', gain: 0.16 });
    noise(0.09, heavy ? 0.16 : 0.11, 420, 0.9);
  },
  /** An element landing: a short ping in that element's register. */
  element(kind: 'api' | 'air' | 'es' | 'petir'): void {
    const map = { api: 300, air: 480, es: 880, petir: 1200 } as const;
    tone({ from: map[kind], to: map[kind] * (kind === 'es' ? 1.6 : 0.5), dur: 0.16, type: 'triangle', gain: 0.1 });
  },
  reaction(): void {
    tone({ from: 220, to: 900, dur: 0.22, type: 'triangle', gain: 0.14 });
    noise(0.2, 0.12, 700, 0.6);
  },
  bowDraw(): void {
    tone({ from: 160, to: 300, dur: 0.2, type: 'triangle', gain: 0.05 });
  },
  bowShoot(charge: number): void {
    tone({ from: 700 + charge * 500, to: 240, dur: 0.12, type: 'sawtooth', gain: 0.08 + charge * 0.06 });
    noise(0.07, 0.07, 2200, 1.2);
  },
  roll(): void {
    noise(0.16, 0.08, 600, 0.5);
  },
  swap(): void {
    tone({ from: 520, to: 780, dur: 0.07, type: 'square', gain: 0.07 });
    tone({ from: 780, to: 640, dur: 0.06, type: 'square', gain: 0.05, delay: 0.06 });
  },
  hurt(): void {
    tone({ from: 300, to: 90, dur: 0.22, type: 'sawtooth', gain: 0.16 });
  },
  die(): void {
    tone({ from: 420, to: 60, dur: 0.4, type: 'square', gain: 0.14 });
    noise(0.3, 0.12, 300, 0.5);
  },

  /** Level up: a small rising arpeggio, the one unambiguously happy sound in the game so far. */
  levelUp(): void {
    tone({ from: 523, to: 523, dur: 0.1, type: 'triangle', gain: 0.1 });
    tone({ from: 659, to: 659, dur: 0.1, type: 'triangle', gain: 0.1, delay: 0.08 });
    tone({ from: 784, to: 988, dur: 0.26, type: 'triangle', gain: 0.12, delay: 0.16 });
  },

  /** Picking something up. */
  pickup(): void {
    tone({ from: 700, to: 1050, dur: 0.1, type: 'square', gain: 0.07 });
  },
};
