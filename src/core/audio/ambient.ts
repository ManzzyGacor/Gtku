/**
 * Plays the ambience beds from `beds.ts`.
 *
 * A bed is two things at once: continuous filtered noise (the wind, the cave's drone, the rain)
 * and a scatter of one-off events (an insect, a drip, a crackle, a distant rumble). The continuous
 * part is one looping noise buffer per layer — generating a few seconds of noise once and looping
 * it costs nothing, where re-creating it constantly would show up on a phone's CPU graph.
 *
 * The event scatter is scheduled by the same kind of timer the music uses, and stops with the
 * context for the same reason.
 */
import { audioGraph, noise, tone } from './engine';
import { onAudioLifecycle } from './lifecycle';
import { BEDS, eventHz, nextGap, type BedDef } from './beds';

/** Seconds of noise generated per loop. Long enough that the loop is not audible as a rhythm. */
const LOOP_SECONDS = 3;
const TICK_MS = 200;

interface Layer {
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  lfo?: OscillatorNode | undefined;
}

interface Bed {
  def: BedDef;
  gain: GainNode;
  layers: Layer[];
  /** Context time each event is next due. */
  due: number[];
}

let bed: Bed | null = null;
let fading: Bed[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let wanted = '';

/**
 * Cached: three seconds of noise is ~144k samples to generate, and switching beds happens on every
 * area border and at dusk. Every bed filters the same source differently, so one buffer is enough.
 */
let cachedNoise: { ctx: AudioContext; buf: AudioBuffer } | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoise?.ctx === ctx) return cachedNoise.buf;
  const frames = Math.floor(ctx.sampleRate * LOOP_SECONDS);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Brown-ish noise: a running sum sounds like wind and rain, white noise sounds like a TV.
  let last = 0;
  for (let i = 0; i < frames; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  // taper the seam so the loop does not click
  const taper = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < taper; i++) {
    const k = i / taper;
    data[i] *= k;
    data[frames - 1 - i] *= k;
  }
  cachedNoise = { ctx, buf };
  return buf;
}

function build(def: BedDef): Bed | null {
  const graph = audioGraph();
  if (!graph) return null;
  const { ctx } = graph;
  const out = graph.bus('ambient');
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(out);

  const buffer = noiseBuffer(ctx);
  const layers: Layer[] = def.layers.map((l) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = l.freq;
    filter.Q.value = l.q;
    const g = ctx.createGain();
    g.gain.value = l.gain;
    src.connect(filter).connect(g).connect(gain);
    src.start();

    let lfo: OscillatorNode | undefined;
    if (l.sweep) {
      // a slow wander on the filter is what turns steady noise into weather
      lfo = ctx.createOscillator();
      lfo.frequency.value = l.sweepRate ?? 0.08;
      const depth = ctx.createGain();
      depth.gain.value = l.sweep;
      lfo.connect(depth).connect(filter.frequency);
      lfo.start();
    }
    return { src, gain: g, filter, lfo };
  });

  return { def, gain, layers, due: def.events.map(() => ctx.currentTime + nextGap(def.events[0], Math.random)) };
}

function destroy(b: Bed): void {
  for (const l of b.layers) {
    try {
      l.src.stop();
      l.lfo?.stop();
    } catch {
      /* already stopped */
    }
    l.gain.disconnect();
  }
  b.gain.disconnect();
}

function fireEvent(b: Bed, index: number): void {
  const event = b.def.events[index];
  if (!event) return;
  switch (event.kind) {
    case 'chirp': {
      // two quick blips an octave apart: a cricket, near enough
      const hz = eventHz(event, Math.random);
      tone({ from: hz, to: hz * 0.98, dur: 0.05, type: 'triangle', gain: event.gain, cat: 'ambient' });
      tone({ from: hz, to: hz * 0.98, dur: 0.05, type: 'triangle', gain: event.gain * 0.8, delay: 0.08, cat: 'ambient' });
      break;
    }
    case 'drip':
      tone({ from: eventHz(event, Math.random), to: 180, dur: 0.22, type: 'sine', gain: event.gain, cat: 'ambient' });
      break;
    case 'crackle':
      noise(0.05, event.gain, 1800 + Math.random() * 2200, 1.4, 'ambient');
      break;
    case 'gust':
      noise(1.8, event.gain, 400 + Math.random() * 500, 0.4, 'ambient');
      break;
    case 'rumble':
      noise(2.2, event.gain, 90, 0.5, 'ambient');
      tone({ from: 58, to: 34, dur: 2, type: 'sine', gain: event.gain * 0.5, cat: 'ambient' });
      break;
    default:
      break;
  }
}

function tick(): void {
  const graph = audioGraph();
  if (!graph) return;
  const { ctx } = graph;
  if (wanted && bed?.def.id !== wanted) start(wanted);
  if (bed) {
    for (let i = 0; i < bed.def.events.length; i++) {
      if (ctx.currentTime < bed.due[i]) continue;
      fireEvent(bed, i);
      bed.due[i] = ctx.currentTime + nextGap(bed.def.events[i], Math.random);
    }
  }
  fading = fading.filter((b) => {
    if (b.gain.gain.value > 0.002) return true;
    destroy(b);
    return false;
  });
}

function start(id: string): void {
  const graph = audioGraph();
  const def = BEDS[id];
  if (!graph || !def) return;
  const { ctx } = graph;
  if (bed) {
    bed.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    fading.push(bed);
    bed = null;
  }
  const next = build(def);
  if (!next) return;
  next.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
  // stagger the first events so a bed does not open with everything at once
  next.due = def.events.map((e) => ctx.currentTime + nextGap(e, Math.random));
  bed = next;
  if (timer === null) timer = setInterval(tick, TICK_MS);
}

export const ambient = {
  /** Switch to a named bed, crossfading. `''` fades out. Safe before the first tap. */
  play(id: string): void {
    wanted = id;
    if (!id) {
      this.stop();
      return;
    }
    if (bed?.def.id === id) return;
    start(id);
  },

  stop(): void {
    wanted = '';
    const graph = audioGraph();
    if (!graph || !bed) return;
    bed.gain.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.5);
    fading.push(bed);
    bed = null;
  },

  get playing(): string {
    return bed?.def.id ?? '';
  },
};

onAudioLifecycle(
  () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  },
  () => {
    const graph = audioGraph();
    // re-anchor the event clock; it froze while we were away
    if (graph && bed) bed.due = bed.def.events.map((e) => graph.ctx.currentTime + nextGap(e, Math.random));
    if ((bed || wanted) && timer === null) timer = setInterval(tick, TICK_MS);
  },
);
