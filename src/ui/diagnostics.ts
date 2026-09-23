/**
 * What the debug UI needs to know about whatever renderer is currently running.
 * Phaser implements it today; the Three.js renderer will implement the same interface in Fase 1,
 * so the FPS counter, the report and the settings menu do not change when the renderer does.
 */
export interface DiagnosticsSource {
  /** Short id that goes into the report, e.g. "phaser2d" or "three3d". */
  readonly name: string;
  /** Smoothed average and worst-half-second FPS. */
  fps(): { avg: number; low: number };
  /** Live display objects on screen — a leak shows up as a number that only grows. */
  objects(): number;
  /** Size of the logical pixel buffer. */
  view(): { w: number; h: number };
  /** Called when the settings menu opens/closes so gameplay can hold still. */
  setPaused(paused: boolean): void;
}

/** Stand-in used before a renderer has started (title screen, boot). */
export const NULL_DIAGNOSTICS: DiagnosticsSource = {
  name: 'none',
  fps: () => ({ avg: 0, low: 0 }),
  objects: () => 0,
  view: () => ({ w: 0, h: 0 }),
  setPaused: () => undefined,
};
