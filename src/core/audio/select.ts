/**
 * Which music and which ambience a situation calls for.
 *
 * Pure decision functions, split out from the audio plumbing so the *rules* can be tested: the
 * boss overrides everything, the cave ignores the time of day because there is no sky in it, and
 * the village has a separate night track. Getting this wrong is the difference between music that
 * feels like it belongs and music that flips back and forth on an area border.
 */
import type { AreaId } from '../world/areas';

export interface Situation {
  area: AreaId;
  /** 0..1 from the day/night cycle. */
  night: number;
  /** True once the boss is awake and not yet dead. */
  boss: boolean;
  /** True while a cutscene is running its own music. */
  cutscene?: boolean;
}

/** Above this the village switches to its night track. */
export const NIGHT_SWITCH = 0.55;

export function musicFor(s: Situation): string {
  if (s.boss) return 'boss';
  if (s.area === 'cave') return 'cave';
  if (s.area === 'forest') return 'forest';
  return s.night >= NIGHT_SWITCH ? 'night' : 'village';
}

export function ambientFor(s: Situation): string {
  if (s.area === 'cave') return 'cave';
  if (s.area === 'forest') return s.night >= NIGHT_SWITCH ? 'night' : 'wind';
  return s.night >= NIGHT_SWITCH ? 'night' : 'wind';
}

/**
 * How long to crossfade between two tracks.
 *
 * Into a boss fight it is short, because the music has to arrive with the fight. Everywhere else it
 * is long, because area borders in this world are seamless and a two second fade would announce a
 * boundary the player cannot see.
 */
export function fadeFor(from: string, to: string): number {
  if (to === 'boss' || from === 'boss') return 1.2;
  if (!from) return 3;
  return 4.5;
}
