/**
 * The suspend/resume registry for the audio schedulers.
 *
 * Its own file for one specific reason: `engine.ts` needs to *notify* on suspend, and the music and
 * ambience schedulers need to *register* — and they already import the engine for the context. Put
 * the registry in either of them and you get an import cycle whose only symptom is
 * "Cannot access 'onSuspend' before initialization" at boot, which is exactly the kind of failure
 * that costs an afternoon. Three lines in a leaf module instead.
 */

const suspendHandlers: (() => void)[] = [];
const resumeHandlers: (() => void)[] = [];

/** Register a scheduler. Called at module load by `music.ts` and `ambient.ts`. */
export function onAudioLifecycle(suspend: () => void, resume: () => void): void {
  suspendHandlers.push(suspend);
  resumeHandlers.push(resume);
}

export function notifySuspend(): void {
  for (const fn of suspendHandlers) fn();
}

export function notifyResume(): void {
  for (const fn of resumeHandlers) fn();
}
