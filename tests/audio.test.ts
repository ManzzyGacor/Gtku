/**
 * The music and the ambience, tested where they can be: the data and the decisions.
 *
 * WebAudio needs a browser, but almost nothing that decides how this game *sounds* does. The
 * scales, the chord progressions, which note falls on which sixteenth, which track an area calls
 * for, how long a crossfade lasts and how often a cricket chirps are all arithmetic — and all of
 * it is wrong in ways a test can catch: a pattern that indexes past its scale, a track that is
 * twice as loud as its neighbour, an area border that flips the music back and forth.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { barSeconds, degreeToSemitone, midiToHz, notesForBar, TRACKS } from '../src/core/audio/tracks';
import { BEDS, eventHz, nextGap } from '../src/core/audio/beds';
import { ambientFor, fadeFor, musicFor, NIGHT_SWITCH } from '../src/core/audio/select';

test('every track is playable: a key, a progression, and levels in the same ballpark', () => {
  const ids = Object.keys(TRACKS);
  assert.ok(ids.length >= 5, `the plan asks for music per area, got ${ids.length} tracks`);
  for (const id of ids) {
    const t = TRACKS[id];
    assert.equal(t.id, id, 'the key and the id must agree');
    assert.ok(t.name.length > 2, `${id} needs a name for the settings screen`);
    assert.ok(t.bpm >= 40 && t.bpm <= 200, `${id} bpm ${t.bpm}`);
    assert.ok(t.scale.length >= 5, `${id} needs a usable scale`);
    assert.ok(t.chords.length >= 2, `${id} needs a progression, not one chord`);
    assert.ok(t.gain > 0.5 && t.gain <= 1, `${id} gain ${t.gain} — tracks must not differ wildly in level`);
    for (const voice of [t.lead, t.bass]) {
      if (!voice) continue;
      assert.equal(voice.pattern.length, 16, `${id}: a pattern is one bar of sixteenths`);
      for (const step of voice.pattern) assert.ok(Number.isInteger(step) && step >= -1, `${id}: bad step ${step}`);
    }
  }
});

test('scale degrees wrap into octaves instead of running off the end of the array', () => {
  const minor = [0, 2, 3, 5, 7, 8, 10];
  assert.equal(degreeToSemitone(minor, 0), 0);
  assert.equal(degreeToSemitone(minor, 4), 7);
  assert.equal(degreeToSemitone(minor, 7), 12, 'degree 7 of a 7-note scale is the octave');
  assert.equal(degreeToSemitone(minor, 8), 14);
  assert.equal(degreeToSemitone(minor, -1), -2, 'and it works downwards');
});

test('A4 is 440 Hz and the octaves line up', () => {
  assert.equal(Math.round(midiToHz(69)), 440);
  assert.equal(Math.round(midiToHz(57)), 220);
  assert.equal(Math.round(midiToHz(81)), 880);
});

test('a bar of every track produces audible, finite notes inside the bar', () => {
  for (const id of Object.keys(TRACKS)) {
    const track = TRACKS[id];
    const bar = barSeconds(track);
    const notes = notesForBar(track, 0);
    assert.ok(notes.length > 0, `${id} produced silence`);
    let last = -1;
    for (const n of notes) {
      assert.ok(Number.isFinite(n.at) && n.at >= 0 && n.at < bar, `${id}: note at ${n.at} outside a ${bar}s bar`);
      assert.ok(n.at >= last, `${id}: notes must come back sorted`);
      last = n.at;
      assert.ok(Number.isFinite(n.dur) && n.dur > 0, `${id}: duration ${n.dur}`);
      assert.ok(n.gain > 0 && n.gain < 0.4, `${id}: gain ${n.gain} — one voice must not drown the mix`);
      if (n.voice === 'drum') continue;
      // 27 Hz to 4.2 kHz: below that is a rumble, above it is a whistle
      assert.ok(n.hz > 27 && n.hz < 4200, `${id}: ${n.hz.toFixed(1)} Hz is not a musical note`);
    }
  }
});

test('the progression advances bar by bar and loops, so a track is not one bar repeated', () => {
  const track = TRACKS.village;
  const pads = (bar: number): number[] => notesForBar(track, bar).filter((n) => n.voice === 'pad').map((n) => Math.round(n.hz));
  const first = pads(0);
  assert.ok(first.length >= 2, 'the village has a pad chord');
  assert.notDeepEqual(pads(1), first, 'bar 2 is a different chord');
  assert.deepEqual(pads(track.chords.length), first, 'and the progression loops');
  // asked for bar 1000 directly, without generating the 999 before it
  assert.deepEqual(pads(track.chords.length * 250), first);
});

test('the boss track is the fast one and the cave track is the slow one', () => {
  assert.ok(TRACKS.boss.bpm > TRACKS.village.bpm, 'a boss fight cannot be slower than a stroll');
  assert.ok(TRACKS.cave.bpm < TRACKS.village.bpm);
  assert.ok(TRACKS.night.bpm < TRACKS.village.bpm, 'and the village quiets down at night');
  assert.ok(!!TRACKS.boss.drums, 'only the boss gets percussion');
  assert.ok(!TRACKS.cave.drums && !TRACKS.night.drums);
});

test('every track shares a key, because crossfading between unrelated keys sounds like a bug', () => {
  const roots = new Set(Object.values(TRACKS).map((t) => t.root % 12));
  assert.equal(roots.size, 1, `all tracks should share a tonic pitch class, got ${[...roots].join(', ')}`);
});

// ───────────────────────────── selection rules ─────────────────────────────

const at = (over: Partial<Parameters<typeof musicFor>[0]> = {}): Parameters<typeof musicFor>[0] => ({
  area: 'village',
  night: 0,
  boss: false,
  ...over,
});

test('the boss overrides everything, everywhere', () => {
  for (const area of ['village', 'forest', 'cave'] as const)
    for (const night of [0, 1])
      assert.equal(musicFor(at({ area, night, boss: true })), 'boss', `${area} at night=${night}`);
});

test('the village has a night track; the cave ignores the time of day entirely', () => {
  assert.equal(musicFor(at({ night: 0 })), 'village');
  assert.equal(musicFor(at({ night: 1 })), 'night');
  assert.equal(musicFor(at({ night: NIGHT_SWITCH })), 'night', 'the boundary counts as night');
  assert.equal(musicFor(at({ night: NIGHT_SWITCH - 0.01 })), 'village');
  // there is no sky in a cave, so the clock must not change its music
  assert.equal(musicFor(at({ area: 'cave', night: 0 })), 'cave');
  assert.equal(musicFor(at({ area: 'cave', night: 1 })), 'cave');
  assert.equal(musicFor(at({ area: 'forest', night: 0 })), 'forest');
  assert.equal(musicFor(at({ area: 'forest', night: 1 })), 'forest');
});

test('every track and bed the rules can ask for actually exists', () => {
  for (const area of ['village', 'forest', 'cave'] as const)
    for (const night of [0, 0.4, 0.6, 1])
      for (const boss of [false, true]) {
        const s = at({ area, night, boss });
        assert.ok(TRACKS[musicFor(s)], `missing track ${musicFor(s)}`);
        assert.ok(BEDS[ambientFor(s)], `missing bed ${ambientFor(s)}`);
      }
});

test('the crossfade is short into a boss fight and long across a seamless border', () => {
  assert.ok(fadeFor('village', 'boss') < 2, 'the music has to arrive with the fight');
  assert.ok(fadeFor('boss', 'village') < 2);
  assert.ok(fadeFor('village', 'forest') > 3, 'an invisible border must not be announced by the music');
  assert.ok(fadeFor('', 'village') >= 3, 'and the first track fades up rather than starting');
});

// ───────────────────────────── ambience ─────────────────────────────

test('every bed has something continuous and something that happens', () => {
  const ids = Object.keys(BEDS);
  for (const need of ['wind', 'night', 'cave', 'fire', 'storm']) assert.ok(ids.includes(need), `missing bed: ${need}`);
  for (const id of ids) {
    const b = BEDS[id];
    assert.ok(b.layers.length >= 1, `${id} has no continuous layer`);
    for (const l of b.layers) {
      assert.ok(l.freq > 20 && l.freq < 12000, `${id}: layer at ${l.freq} Hz`);
      assert.ok(l.gain > 0 && l.gain < 0.2, `${id}: layer gain ${l.gain} — ambience must sit under the game`);
    }
    for (const e of b.events) {
      assert.ok(e.every > 0.1 && e.every < 60, `${id}: an event every ${e.every}s`);
      assert.ok(e.jitter >= 0 && e.jitter <= 1, `${id}: jitter ${e.jitter}`);
      assert.ok(e.gain > 0 && e.gain < 0.2, `${id}: event gain ${e.gain}`);
    }
  }
  assert.ok(BEDS.cave.events.some((e) => e.kind === 'drip'), 'the cave needs its water');
  assert.ok(BEDS.night.events.some((e) => e.kind === 'chirp'), 'the night needs its insects');
  assert.ok(BEDS.fire.events.some((e) => e.kind === 'crackle'), 'fire needs to crackle');
});

test('event gaps are random but bounded, so nothing ever machine-guns or goes silent', () => {
  const event = BEDS.night.events[0];
  const gaps = [0, 0.25, 0.5, 0.75, 0.999].map((r) => nextGap(event, () => r));
  for (const g of gaps) {
    assert.ok(g > 0, `gap ${g}`);
    assert.ok(g <= event.every * (1 + event.jitter) + 1e-9, `gap ${g} exceeds the jitter window`);
    assert.ok(g >= event.every * (1 - event.jitter) - 1e-9, `gap ${g} below the jitter window`);
  }
  assert.ok(gaps[4] > gaps[0], 'and the random source actually moves it');
  // a zero-jitter event is exactly regular
  assert.equal(nextGap({ ...event, jitter: 0 }, () => 0.5), event.every);
});

test('event pitches stay inside their declared range', () => {
  const chirp = BEDS.night.events[0];
  assert.equal(eventHz(chirp, () => 0), chirp.hz![0]);
  assert.ok(eventHz(chirp, () => 0.999) <= chirp.hz![1]);
  // an event with no range is a fixed pitch rather than NaN
  assert.ok(Number.isFinite(eventHz({ ...chirp, hz: undefined }, () => 0.5)));
});
