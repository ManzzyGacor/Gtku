/**
 * Plays the tracks from `tracks.ts` into the audio context, with crossfades.
 *
 * **How the scheduling works, and why.** Bars are scheduled *ahead of time*, one at a time, from a
 * timer that only decides "is the next bar close enough to schedule yet". WebAudio plays what it
 * was told to play at an exact `currentTime`, so the timer can be sloppy (and throttled by the
 * browser) without the music drifting — which it absolutely would if each note were started when a
 * JavaScript timer fired.
 *
 * The context's clock **stops** while the tab is hidden, so the scheduler stops with it
 * (`onAudioLifecycle`): otherwise everything queued would fire in one burst on the way back.
 */
import { audioGraph } from './engine';
import { onAudioLifecycle } from './lifecycle';
import { barSeconds, notesForBar, TRACKS, type Note, type TrackDef } from './tracks';

/** How far ahead of the clock a bar is queued. Two bars would be smoother; this is kinder to CPU. */
const LOOKAHEAD = 1.2;
/** How often the scheduler wakes up. */
const TICK_MS = 250;

interface Playing {
  track: TrackDef;
  gain: GainNode;
  /** Index of the next bar to schedule. */
  bar: number;
  /** Context time the next bar starts at. */
  nextAt: number;
  /** Nodes queued but not finished, so a crossfade can cut them short. */
  live: { osc: OscillatorNode; gain: GainNode }[];
}

let current: Playing | null = null;
let fading: Playing[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
/** What was asked for, remembered so a track requested before the first tap still starts. */
let wanted = '';
let wantedFade = 0;

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer(): void {
  if (timer !== null) return;
  timer = setInterval(tick, TICK_MS);
}

/** Queue one bar of a track. */
function scheduleBar(p: Playing, ctx: AudioContext, out: GainNode): void {
  const notes: Note[] = notesForBar(p.track, p.bar);
  for (const n of notes) {
    const at = p.nextAt + n.at;
    if (n.voice === 'drum') {
      // percussion is noise, not a pitch
      const frames = Math.max(1, Math.floor(ctx.sampleRate * n.dur));
      const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = n.gain;
      src.connect(g).connect(out);
      src.start(at);
      continue;
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.hz, at);
    // Soft attack and a long release: a hard edge on a sustained instrument reads as a bleep.
    const attack = Math.min(0.12, n.dur * 0.25);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(n.gain, at + attack);
    g.gain.setTargetAtTime(0, at + n.dur * 0.6, n.dur * 0.3);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + n.dur + 0.4);
    p.live.push({ osc, gain: g });
  }
  p.bar++;
  p.nextAt += barSeconds(p.track);
  // forget nodes that have certainly finished
  if (p.live.length > 96) p.live.splice(0, p.live.length - 96);
}

function tick(): void {
  const graph = audioGraph();
  if (!graph) return;
  const { ctx } = graph;
  if (wanted && (!current || current.track.id !== wanted)) begin(wanted, wantedFade);
  if (!current) return;
  while (current.nextAt < ctx.currentTime + LOOKAHEAD) {
    scheduleBar(current, ctx, current.gain);
  }
  fading = fading.filter((p) => {
    if (ctx.currentTime < p.nextAt + 4) return true;
    for (const node of p.live) {
      try {
        node.osc.stop();
      } catch {
        /* already stopped */
      }
    }
    p.gain.disconnect();
    return false;
  });
}

function begin(id: string, fade: number): void {
  const graph = audioGraph();
  const track = TRACKS[id];
  if (!graph || !track) return;
  const { ctx } = graph;
  const out = graph.bus('bgm');

  if (current) {
    // fade the old one out and let `tick` retire it
    current.gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.15, fade / 3));
    fading.push(current);
    current = null;
  }

  const gain = ctx.createGain();
  gain.gain.value = fade > 0 ? 0 : 1;
  if (fade > 0) gain.gain.setTargetAtTime(1, ctx.currentTime, Math.max(0.15, fade / 3));
  gain.connect(out);
  current = { track, gain, bar: 0, nextAt: ctx.currentTime + 0.08, live: [] };
  startTimer();
}

export const music = {
  /** Crossfade to a named track. `''` fades to silence. Safe before the first tap. */
  play(id: string, fade = 3): void {
    wanted = id;
    wantedFade = fade;
    if (!id) {
      this.stop(fade);
      return;
    }
    const graph = audioGraph();
    if (!graph) return; // it will start on the first tick after unlock
    if (current?.track.id === id) return;
    begin(id, fade);
  },

  stop(fade = 1.5): void {
    wanted = '';
    const graph = audioGraph();
    if (!graph || !current) {
      current = null;
      return;
    }
    current.gain.gain.setTargetAtTime(0, graph.ctx.currentTime, Math.max(0.1, fade / 3));
    fading.push(current);
    current = null;
  },

  /** What is playing, for the report. */
  get nowPlaying(): string {
    return current?.track.id ?? '';
  },
};

onAudioLifecycle(
  () => stopTimer(),
  () => {
    const graph = audioGraph();
    // The clock jumped while we were away; re-anchor the next bar to now.
    if (graph && current) current.nextAt = Math.max(current.nextAt, graph.ctx.currentTime + 0.08);
    if (current || wanted) startTimer();
  },
);
