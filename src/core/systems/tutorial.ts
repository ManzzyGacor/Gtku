/**
 * "Bara Pertama" — the short tutorial that hands the player their first Lantern Core and element
 * right after the opening cutscene.
 *
 * Before this, the first element arrived when the boss dropped *Inti Bara* — i.e. at the end of the
 * game — so the element system Batch 3 built was unreachable for nearly the whole playthrough. Two
 * steps, both in Ravenhollow within a few seconds' walk of where a new game starts:
 *
 *   1. **Pray at the village shrine.** The lantern answers: the hero receives *Inti Bara* and learns
 *      Api. (The shrine is two tiles from the spawn point, deliberately.)
 *   2. **Strike the training dummy with fire.** The dummy shows the status it now carries, which is
 *      the moment the player sees the system work rather than being told about it.
 *
 * Pure: it reads and writes save flags and nothing else, so the whole path is testable without a
 * renderer. The main quest ("talk to the elder") is untouched and can be done in parallel.
 */
import type { ElementId } from '../combat/elements';
import type { GameState } from '../state/GameState';

export type TutorialStep = 'pray' | 'strike' | 'done';

export const TUTORIAL_TITLE = 'Bara Pertama';
/** The shrine that starts it: the one in Ravenhollow's plaza, beside the spawn point. */
export const TUTORIAL_SHRINE = 'cp_village';
/** What praying there gives. */
export const TUTORIAL_CORE = 'core_ember';
/** Where the training dummy stands, in tiles: east of the shrine, in plain view of the start. */
export const DUMMY_TILE = { tx: 39, ty: 67 };

export type TutorialEvent =
  | { type: 'pray'; checkpoint: string }
  | { type: 'element-hit'; element: ElementId | undefined; target: string };

export interface TutorialResult {
  changed: boolean;
  message?: string | undefined;
  /** Item id to hand over (step 1). */
  grantCore?: string | undefined;
  /** True on the event that finished the tutorial. */
  finished?: boolean | undefined;
}

export function tutorialStep(state: GameState): TutorialStep {
  if (state.flags.tut_done) return 'done';
  if (state.flags.tut_core) return 'strike';
  return 'pray';
}

export function advanceTutorial(state: GameState, ev: TutorialEvent): TutorialResult {
  const step = tutorialStep(state);
  if (step === 'pray' && ev.type === 'pray' && ev.checkpoint === TUTORIAL_SHRINE) {
    state.flags.tut_core = true;
    return {
      changed: true,
      grantCore: TUTORIAL_CORE,
      message: 'Lenteramu menjawab doamu. Inti Bara menyala di dalamnya.',
    };
  }
  // Only an *elemental* hit on the dummy counts: the point of step 2 is to see the element land.
  if (step === 'strike' && ev.type === 'element-hit' && ev.target === 'dummy' && ev.element) {
    state.flags.tut_done = true;
    return { changed: true, finished: true, message: 'Api merambat di boneka latihan. Kamu bisa memakai elemen sekarang.' };
  }
  return { changed: false };
}

/**
 * A save that already has an element (an older save, or a player who got Inti Bara from the boss)
 * has nothing left to learn here — so the tutorial counts as done rather than asking them to pray
 * for a core they are already wearing.
 */
export function settleTutorial(state: GameState, hasElement: boolean): boolean {
  if (tutorialStep(state) === 'done' || !hasElement) return false;
  state.flags.tut_core = true;
  state.flags.tut_done = true;
  return true;
}

/** Tracker lines while the tutorial is running, or null once it is done. */
export function tutorialLines(state: GameState): { title: string; lines: string[] } | null {
  switch (tutorialStep(state)) {
    case 'pray':
      return { title: TUTORIAL_TITLE, lines: ['Berdoa di shrine Ravenhollow', '(di plaza, dekat Lentera Agung)'] };
    case 'strike':
      return { title: TUTORIAL_TITLE, lines: ['Pukul boneka latihan dengan elemen Api', '(sebelah timur shrine)'] };
    default:
      return null;
  }
}
