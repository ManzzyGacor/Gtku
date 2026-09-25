/**
 * The ambience beds, as data (docs/OVERHAUL.md §4 "Audio": angin, serangga malam, tetesan air di
 * gua, api).
 *
 * A bed is a continuous layer plus a scatter of one-off events. Both parts are described here as
 * numbers so the *content* of an ambience can be reviewed and tested; `ambient.ts` turns it into
 * filtered noise and oscillators.
 */

export interface BedLayer {
  /** Band-pass centre, Hz. */
  freq: number;
  q: number;
  gain: number;
  /** How far the filter wanders, Hz, and how fast, Hz of LFO. */
  sweep?: number;
  sweepRate?: number;
}

export interface BedEvent {
  /** Average seconds between occurrences. */
  every: number;
  /** Random spread around `every`, as a fraction (0.5 = ±50%). */
  jitter: number;
  kind: 'chirp' | 'drip' | 'crackle' | 'gust' | 'rumble';
  /** Pitch range for tonal events. */
  hz?: [number, number] | undefined;
  gain: number;
}

export interface BedDef {
  id: string;
  name: string;
  layers: BedLayer[];
  events: BedEvent[];
}

export const BEDS: Record<string, BedDef> = {
  /** Daytime outdoors: wind through leaves, with gusts. */
  wind: {
    id: 'wind',
    name: 'Angin',
    layers: [{ freq: 520, q: 0.7, gain: 0.05, sweep: 260, sweepRate: 0.07 }],
    events: [{ every: 9, jitter: 0.6, kind: 'gust', gain: 0.05 }],
  },

  /** Night outdoors: quieter wind, and insects. */
  night: {
    id: 'night',
    name: 'Malam',
    layers: [{ freq: 380, q: 0.8, gain: 0.03, sweep: 120, sweepRate: 0.05 }],
    events: [
      { every: 1.6, jitter: 0.8, kind: 'chirp', hz: [3800, 5200], gain: 0.022 },
      { every: 14, jitter: 0.5, kind: 'gust', gain: 0.035 },
    ],
  },

  /** The cave: a low drone, and water finding its way down. */
  cave: {
    id: 'cave',
    name: 'Gua',
    layers: [
      { freq: 90, q: 1.4, gain: 0.055 },
      { freq: 240, q: 2.2, gain: 0.02, sweep: 40, sweepRate: 0.03 },
    ],
    events: [
      { every: 3.4, jitter: 0.9, kind: 'drip', hz: [900, 2100], gain: 0.05 },
      { every: 20, jitter: 0.5, kind: 'rumble', gain: 0.05 },
    ],
  },

  /** Beside a fire: crackle over a low rumble. */
  fire: {
    id: 'fire',
    name: 'Api',
    layers: [{ freq: 700, q: 0.5, gain: 0.03, sweep: 200, sweepRate: 0.9 }],
    events: [{ every: 0.5, jitter: 0.9, kind: 'crackle', gain: 0.03 }],
  },

  /** The prologue's storm. */
  storm: {
    id: 'storm',
    name: 'Badai',
    layers: [
      { freq: 3200, q: 0.25, gain: 0.075 },
      { freq: 180, q: 0.6, gain: 0.04, sweep: 60, sweepRate: 0.2 },
    ],
    events: [{ every: 11, jitter: 0.7, kind: 'rumble', gain: 0.07 }],
  },

  /** Rain on the world: a steady hiss with a softer patter under it, no thunder. */
  rain: {
    id: 'rain',
    name: 'Hujan',
    layers: [
      { freq: 2600, q: 0.3, gain: 0.05 },
      { freq: 650, q: 0.5, gain: 0.02, sweep: 150, sweepRate: 0.3 },
    ],
    // drops off the eaves and leaves
    events: [{ every: 0.9, jitter: 0.8, kind: 'drip', hz: [900, 1600], gain: 0.018 }],
  },

  /** A storm's downpour. The thunder is not here: it follows each lightning flash (Game3D). */
  'rain-heavy': {
    id: 'rain-heavy',
    name: 'Hujan Deras',
    layers: [
      { freq: 3000, q: 0.25, gain: 0.08 },
      { freq: 800, q: 0.4, gain: 0.035, sweep: 250, sweepRate: 0.45 },
      { freq: 160, q: 0.6, gain: 0.03, sweep: 60, sweepRate: 0.15 },
    ],
    // the wind throws the rain in gusts
    events: [{ every: 5, jitter: 0.6, kind: 'gust', gain: 0.05 }],
  },

  /** The same storm, heard from inside or from further away. */
  'storm-far': {
    id: 'storm-far',
    name: 'Badai Jauh',
    layers: [{ freq: 1500, q: 0.3, gain: 0.035 }],
    events: [{ every: 13, jitter: 0.7, kind: 'rumble', gain: 0.05 }],
  },
};

/** Next gap for an event, in seconds. `rand` is passed in so a test can pin it. */
export function nextGap(event: BedEvent, rand: () => number): number {
  const spread = event.every * Math.max(0, Math.min(1, event.jitter));
  return Math.max(0.05, event.every - spread + rand() * spread * 2);
}

/** Pitch for a tonal event. */
export function eventHz(event: BedEvent, rand: () => number): number {
  const [lo, hi] = event.hz ?? [400, 400];
  return lo + rand() * (hi - lo);
}
