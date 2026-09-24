/**
 * Entry point.
 *
 * The 2D (Phaser) renderer was removed once every one of its features had moved across — see the
 * inventory in docs/PROGRESS.md and the tag `v0.2-2d-final` if any of it is ever needed again.
 * The world, the quest and the combat all live in `src/core`, so that removal touched no game logic.
 */
import { loadCombatTuning } from './core/entities/combatTuning';
import { installErrorOverlay } from './core/errors';
import { ensureDebugUi } from './ui/DebugUi';

installErrorOverlay();
// Whatever the player tuned in the combat panel on a previous run.
loadCombatTuning();

// The settings menu, FPS counter and error panel live outside the canvas so they keep working
// unchanged while the renderer underneath changes (docs/OVERHAUL.md §7).
const debug = ensureDebugUi();

/** Drive the debug overlay from the page, not the game loop, so it also works while paused. */
function overlayFrame(now: number): void {
  debug.tick(now);
  requestAnimationFrame(overlayFrame);
}
requestAnimationFrame(overlayFrame);

const host = document.getElementById('game') ?? document.body;

async function boot(): Promise<void> {
  // Loaded on demand so the entry chunk stays tiny and the title screen appears immediately.
  const { start3d } = await import('./render3d/boot3d');
  (window as unknown as { __game3d: unknown }).__game3d = await start3d(host, debug);
}

void boot();
