/**
 * The music, as **data** — and the pure functions that turn it into notes.
 *
 * Everything here is arithmetic: no WebAudio, no browser, no timers. That is deliberate, because
 * it means the actual *music* — the scales, the chord progressions, which note plays on which
 * sixteenth — can be checked by a test, and only the thin layer that turns a note into an
 * oscillator needs a real audio context.
 *
 * Why procedural at all: a two minute loop as an .ogg is a megabyte or two per area, and this game
 * has to boot on mobile data. Five areas of generated music cost a few hundred bytes of numbers.
 * The seam for replacing it with recorded music later is `overrides.ts`.
 */

/** Semitones above the root, for one bar's chord. */
export type Chord = number[];

export interface VoiceDef {
  /** Which scale degrees to play, as a 16-step pattern. `-1` is a rest. */
  pattern: number[];
  type: OscillatorType;
  gain: number;
  /** Octave offset applied to every note. */
  octave?: number;
  /** Note length in beats. */
  length?: number;
}

export interface TrackDef {
  id: string;
  /** Human name, for the settings screen. */
  name: string;
  bpm: number;
  /** MIDI note of the tonic. 57 = A3. */
  root: number;
  /** Semitone offsets of the scale, one octave. */
  scale: number[];
  /** One chord per bar; the progression loops. */
  chords: Chord[];
  /** The tune. */
  lead?: VoiceDef | undefined;
  /** The low end. */
  bass?: VoiceDef | undefined;
  /** A held chord under everything. */
  pad?: { type: OscillatorType; gain: number } | undefined;
  /** Sparse percussion (noise), on these sixteenths. */
  drums?: number[] | undefined;
  /** Overall level, so one track is not twice as loud as the next. */
  gain: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN_PENT = [0, 3, 5, 7, 10];

/**
 * The five tracks.
 *
 * They share a key (A minor) on purpose: crossfading between two pieces in unrelated keys sounds
 * like a mistake, and the player crosses these borders constantly. What changes between areas is
 * the *register*, the tempo and how much space there is — which is how real game music
 * distinguishes a village from a cave.
 */
export const TRACKS: Record<string, TrackDef> = {
  /** Ravenhollow by day: slow, warm, a simple folk tune over open chords. */
  village: {
    id: 'village',
    name: 'Ravenhollow',
    bpm: 72,
    root: 57,
    scale: MINOR,
    chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]],
    lead: { pattern: [0, -1, 2, -1, 4, -1, 2, -1, 3, -1, 2, -1, 0, -1, -1, -1], type: 'triangle', gain: 0.075, octave: 1, length: 1.1 },
    bass: { pattern: [0, -1, -1, -1, 4, -1, -1, -1, 0, -1, -1, -1, 2, -1, -1, -1], type: 'sine', gain: 0.1, octave: -1, length: 1.6 },
    pad: { type: 'sine', gain: 0.035 },
    gain: 1,
  },

  /** The same village at night: the tune thins out to almost nothing. */
  night: {
    id: 'night',
    name: 'Ravenhollow, Malam',
    bpm: 58,
    root: 57,
    scale: MINOR,
    chords: [[0, 3, 7], [-5, 0, 3], [0, 3, 7], [-2, 2, 5]],
    lead: { pattern: [0, -1, -1, -1, -1, -1, 4, -1, -1, -1, -1, -1, 3, -1, -1, -1], type: 'sine', gain: 0.055, octave: 1, length: 2.4 },
    pad: { type: 'sine', gain: 0.05 },
    gain: 0.9,
  },

  /** Hutan Noctis: dorian, restless, a plucked figure that never quite resolves. */
  forest: {
    id: 'forest',
    name: 'Hutan Noctis',
    bpm: 84,
    root: 57,
    scale: DORIAN,
    chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 7]],
    lead: { pattern: [0, 2, -1, 4, -1, 5, 4, -1, 2, -1, 0, -1, 4, -1, 2, -1], type: 'triangle', gain: 0.06, octave: 1, length: 0.5 },
    bass: { pattern: [0, -1, -1, 0, -1, -1, 4, -1, 0, -1, -1, 0, -1, -1, 2, -1], type: 'sine', gain: 0.09, octave: -1, length: 0.9 },
    pad: { type: 'sine', gain: 0.03 },
    gain: 0.95,
  },

  /** Gua Lumen: a drone, a pentatonic bell every few bars, and nothing else. */
  cave: {
    id: 'cave',
    name: 'Gua Lumen',
    bpm: 50,
    root: 45,
    scale: AEOLIAN_PENT,
    chords: [[0, 7], [0, 7], [-3, 4], [0, 7]],
    lead: { pattern: [-1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1, 2, -1, -1, -1], type: 'sine', gain: 0.06, octave: 2, length: 3 },
    pad: { type: 'sine', gain: 0.07 },
    gain: 0.85,
  },

  /** The boss: same key, twice the tempo, and a pulse under it. */
  boss: {
    id: 'boss',
    name: 'Kolosus Kelam',
    bpm: 132,
    root: 45,
    scale: MINOR,
    chords: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-1, 3, 6]],
    lead: { pattern: [0, -1, 0, 3, -1, 0, -1, 4, 0, -1, 0, 3, 5, -1, 4, -1], type: 'sawtooth', gain: 0.05, octave: 1, length: 0.4 },
    bass: { pattern: [0, 0, -1, 0, 0, -1, 0, -1, 0, 0, -1, 0, 0, -1, 0, -1], type: 'square', gain: 0.085, octave: -1, length: 0.22 },
    drums: [0, 4, 6, 8, 12, 14],
    gain: 1,
  },

  /** The prologue: no pulse at all, just two notes and the rain. */
  intro: {
    id: 'intro',
    name: 'Malam Terakhir',
    bpm: 46,
    root: 45,
    scale: MINOR,
    chords: [[0, 3, 7], [0, 3, 10], [-2, 2, 5], [0, 3, 7]],
    lead: { pattern: [0, -1, -1, -1, -1, -1, -1, -1, 4, -1, -1, -1, -1, -1, -1, -1], type: 'sine', gain: 0.07, octave: 1, length: 3.6 },
    pad: { type: 'sine', gain: 0.06 },
    gain: 0.9,
  },
};

/** Equal temperament, A4 = 440. */
export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/**
 * Scale degree → semitones, wrapping into higher octaves for degrees past the end.
 * So degree 7 in a seven-note scale is the tonic an octave up, which is what a pattern means by it.
 */
export function degreeToSemitone(scale: number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const index = ((degree % n) + n) % n;
  return scale[index] + octave * 12;
}

export interface Note {
  /** Seconds from the start of the bar. */
  at: number;
  hz: number;
  /** Seconds. */
  dur: number;
  gain: number;
  type: OscillatorType;
  voice: 'lead' | 'bass' | 'pad' | 'drum';
}

/** Seconds per bar (4/4). */
export function barSeconds(track: TrackDef): number {
  return (60 / track.bpm) * 4;
}

/**
 * Every note in one bar of a track. Pure — same bar index, same notes, every time.
 *
 * `bar` counts from the start of playback, so the chord progression advances and the same function
 * can be asked for bar 1000 without having generated the 999 before it.
 */
export function notesForBar(track: TrackDef, bar: number): Note[] {
  const out: Note[] = [];
  const beat = 60 / track.bpm;
  const sixteenth = beat / 4;
  const chord = track.chords[((bar % track.chords.length) + track.chords.length) % track.chords.length];

  const addVoice = (voice: VoiceDef, kind: 'lead' | 'bass'): void => {
    for (let i = 0; i < 16; i++) {
      const degree = voice.pattern[i % voice.pattern.length];
      if (degree === undefined || degree < 0) continue;
      const semis = degreeToSemitone(track.scale, degree) + (voice.octave ?? 0) * 12;
      out.push({
        at: i * sixteenth,
        hz: midiToHz(track.root + semis),
        dur: (voice.length ?? 1) * beat,
        gain: voice.gain * track.gain,
        type: voice.type,
        voice: kind,
      });
    }
  };
  if (track.lead) addVoice(track.lead, 'lead');
  if (track.bass) addVoice(track.bass, 'bass');

  if (track.pad) {
    for (const semi of chord) {
      out.push({
        at: 0,
        hz: midiToHz(track.root + semi),
        dur: barSeconds(track),
        gain: track.pad.gain * track.gain,
        type: track.pad.type,
        voice: 'pad',
      });
    }
  }

  if (track.drums) {
    for (const step of track.drums) {
      out.push({ at: step * sixteenth, hz: 0, dur: 0.06, gain: 0.07 * track.gain, type: 'square', voice: 'drum' });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}
