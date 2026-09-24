/**
 * The audio system's public surface. See `engine.ts` for how it is put together and why the music
 * is generated rather than downloaded.
 */
export {
  audioGraph,
  audioReady,
  CATEGORIES,
  noise,
  resumeAudio,
  suspendAudio,
  tone,
  unlockAudio,
  type AudioCategory,
  type ToneOpts,
} from './engine';
export { sfx } from './sfx';
export { ambient, bus, music, type AudioBus } from './bus';
export { ambientFor, fadeFor, musicFor, NIGHT_SWITCH, type Situation } from './select';
export { BEDS } from './beds';
export { TRACKS } from './tracks';
