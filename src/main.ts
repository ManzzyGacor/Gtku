/**
 * Entry point. Picks a renderer and loads only that one (`?renderer=2d|3d`, or the settings menu),
 * so a phone never downloads Phaser and Three.js at the same time.
 */
import { installErrorOverlay } from './core/errors';
import { settings } from './core/settings';
import { ensureDebugUi } from './ui/DebugUi';

installErrorOverlay();

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
  if (settings.get('renderer') === '3d') {
    const { start3d } = await import('./boot3d');
    const booted = start3d(host, debug);
    (window as unknown as { __game3d: unknown }).__game3d = booted;
  } else {
    const { start2d } = await import('./boot2d');
    (window as unknown as { __game: unknown }).__game = start2d(host);
  }
}

void boot();
