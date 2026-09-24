/**
 * The one-shot sound vocabulary, so callers never build their own sounds.
 *
 * Each sound names the mixer bus it belongs on: a swing is `combat`, picking up an item is `ui`,
 * thunder is `sfx`. That is what makes "turn combat down but keep the music" possible, and it is
 * why every sound below passes `cat` explicitly rather than falling back to a default.
 */
import { noise, tone, type AudioCategory } from './engine';

const COMBAT: AudioCategory = 'combat';
const UI: AudioCategory = 'ui';
const FX: AudioCategory = 'sfx';

export const sfx = {
  swing(heavy = false): void {
    tone({ from: heavy ? 340 : 520, to: heavy ? 120 : 220, dur: heavy ? 0.18 : 0.11, type: 'sawtooth', gain: heavy ? 0.13 : 0.09 , cat: COMBAT });
    noise(heavy ? 0.14 : 0.08, heavy ? 0.1 : 0.06, heavy ? 900 : 1500, 0.7, COMBAT);
  },
  hit(heavy = false): void {
    tone({ from: heavy ? 180 : 260, to: 60, dur: 0.1, type: 'square', gain: 0.16 , cat: COMBAT });
    noise(0.09, heavy ? 0.16 : 0.11, 420, 0.9, COMBAT);
  },
  /** An element landing: a short ping in that element's register. */
  element(kind: 'api' | 'air' | 'es' | 'petir'): void {
    const map = { api: 300, air: 480, es: 880, petir: 1200 } as const;
    tone({ from: map[kind], to: map[kind] * (kind === 'es' ? 1.6 : 0.5), dur: 0.16, type: 'triangle', gain: 0.1 , cat: COMBAT });
  },
  reaction(): void {
    tone({ from: 220, to: 900, dur: 0.22, type: 'triangle', gain: 0.14 , cat: COMBAT });
    noise(0.2, 0.12, 700, 0.6, COMBAT);
  },
  bowDraw(): void {
    tone({ from: 160, to: 300, dur: 0.2, type: 'triangle', gain: 0.05 , cat: COMBAT });
  },
  bowShoot(charge: number): void {
    tone({ from: 700 + charge * 500, to: 240, dur: 0.12, type: 'sawtooth', gain: 0.08 + charge * 0.06 , cat: COMBAT });
    noise(0.07, 0.07, 2200, 1.2, COMBAT);
  },
  roll(): void {
    noise(0.16, 0.08, 600, 0.5, COMBAT);
  },
  swap(): void {
    tone({ from: 520, to: 780, dur: 0.07, type: 'square', gain: 0.07 , cat: UI });
    tone({ from: 780, to: 640, dur: 0.06, type: 'square', gain: 0.05, delay: 0.06 , cat: UI });
  },
  hurt(): void {
    tone({ from: 300, to: 90, dur: 0.22, type: 'sawtooth', gain: 0.16 , cat: COMBAT });
  },
  die(): void {
    tone({ from: 420, to: 60, dur: 0.4, type: 'square', gain: 0.14 , cat: COMBAT });
    noise(0.3, 0.12, 300, 0.5, COMBAT);
  },

  /** Level up: a small rising arpeggio, the one unambiguously happy sound in the game so far. */
  levelUp(): void {
    tone({ from: 523, to: 523, dur: 0.1, type: 'triangle', gain: 0.1 , cat: UI });
    tone({ from: 659, to: 659, dur: 0.1, type: 'triangle', gain: 0.1, delay: 0.08 , cat: UI });
    tone({ from: 784, to: 988, dur: 0.26, type: 'triangle', gain: 0.12, delay: 0.16 , cat: UI });
  },

  /** Picking something up. */
  pickup(): void {
    tone({ from: 700, to: 1050, dur: 0.1, type: 'square', gain: 0.07 , cat: UI });
  },

  // ── cutscene cues (Batch 5) ──

  /**
   * Thunder: a long, dark noise sweep with a crack on the front.
   *
   * Built from filtered noise rather than a tone, because a sine "boom" reads as a drum. The two
   * layers are the crack (bright, short) and the roll (dark, long) — the same anatomy a real
   * thunderclap has.
   */
  thunder(): void {
    noise(0.09, 0.2, 2600, 0.6, FX);
    noise(1.5, 0.22, 120, 0.4, FX);
    tone({ from: 70, to: 38, dur: 1.4, type: 'sine', gain: 0.12 , cat: FX });
  },

  /** A gust of rain, for a scene that needs the storm to swell. */
  rainBurst(): void {
    noise(1.6, 0.1, 4200, 0.25, FX);
  },

  /** A wooden door: the creak, then the stop. */
  door(): void {
    tone({ from: 240, to: 170, dur: 0.5, type: 'sawtooth', gain: 0.045 , cat: FX });
    noise(0.5, 0.05, 900, 0.8, FX);
    tone({ from: 120, to: 70, dur: 0.12, type: 'square', gain: 0.09, delay: 0.5 , cat: FX });
  },

  /** Broken glass on a floor. */
  glass(): void {
    noise(0.22, 0.12, 5200, 1.6, FX);
    tone({ from: 2400, to: 1400, dur: 0.14, type: 'triangle', gain: 0.05 , cat: FX });
    tone({ from: 1900, to: 900, dur: 0.1, type: 'triangle', gain: 0.04, delay: 0.08 , cat: FX });
  },

  /** Two low thuds. The cheapest way to make a quiet scene tense. */
  heartbeat(): void {
    tone({ from: 62, to: 44, dur: 0.16, type: 'sine', gain: 0.22 , cat: FX });
    tone({ from: 58, to: 40, dur: 0.2, type: 'sine', gain: 0.16, delay: 0.3 , cat: FX });
  },

  /** The lantern catching: a soft whoosh and a held, cold ring. */
  lanternLight(): void {
    noise(0.4, 0.07, 700, 0.5, FX);
    tone({ from: 300, to: 880, dur: 0.5, type: 'triangle', gain: 0.09 , cat: FX });
    tone({ from: 1320, to: 1320, dur: 0.9, type: 'sine', gain: 0.05, delay: 0.2 , cat: FX });
  },

  /** One footstep, for a scene that walks. */
  footstep(): void {
    noise(0.07, 0.05, 420, 0.7, FX);
  },
};
