/**
 * The named-audio seam the rest of the game talks to.
 *
 * Callers say `bus.music('forest')`, not "play these oscillators": the cutscene engine, the area
 * code and the boss trigger all name a *track*, and this file is where that name becomes sound.
 * That indirection is what lets `overrides.ts` put a recorded file in front of any name later
 * without touching a single caller.
 */
import { ambient as ambientPlayer } from './ambient';
import { music as musicPlayer } from './music';

export interface AudioBus {
  /** Crossfade to a named track, or `''` for silence. */
  music(id: string, fadeSeconds?: number): void;
  /** Switch the ambience bed (wind, night insects, cave drips, fire). */
  ambient(id: string): void;
}

export const bus: AudioBus = {
  music: (id, fade) => musicPlayer.play(id, fade),
  ambient: (id) => ambientPlayer.play(id),
};

export { musicPlayer as music, ambientPlayer as ambient };
