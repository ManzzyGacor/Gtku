/**
 * Entry point.
 *
 * Deliberately tiny, and deliberately ordered:
 *
 *  1. the error overlay, so a failure in anything below is visible rather than a black screen;
 *  2. the debug overlay (settings, FPS), which is renderer-neutral and works while paused;
 *  3. the **title screen**, which lives in this chunk so it appears after ~20 kB instead of after
 *     the 730 kB the 3D renderer weighs;
 *  4. the renderer itself, fetched *while the title is on screen* and awaited only once the player
 *     has chosen. On a phone on mobile data that is the difference between a black screen for two
 *     seconds and a title screen straight away.
 *
 * The 2D (Phaser) renderer was removed once every one of its features had moved across — see the
 * inventory in docs/PROGRESS.md and the tag `v0.2-2d-final` if any of it is ever needed again.
 */
import { installErrorOverlay, recordError } from './core/errors';
import { ensureDebugUi } from './ui/DebugUi';
import { TitleScreen } from './ui/TitleScreen';

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
  document.getElementById('boot-msg')?.remove();
  const title = new TitleScreen();
  // Start the download now, not after the tap: by the time anyone reads the menu it is usually in.
  const loading = import('./render3d/boot3d');
  const choice = await title.choice();
  title.setBusy('Menyiapkan dunia…');
  try {
    const { startWorld } = await loading;
    (window as unknown as { __game3d: unknown }).__game3d = startWorld(host, debug, choice.continueGame);
  } catch (e) {
    /*
     * Show what actually failed.
     *
     * The first version said only "Gagal memuat. Muat ulang halaman." — which is useless on a
     * phone, where there is no console to open, and it hid a real crash inside the world's
     * constructor for a whole release. The message and the first line of the stack go on screen,
     * and into the error ring so "Salin laporan" carries them too.
     */
    const err = e as Error;
    recordError(String(err?.stack ?? err?.message ?? e), 'boot');
    const where = String(err?.stack ?? '').split('\n')[1]?.trim() ?? '';
    title.setBusy(`Gagal memuat:\n${err?.message ?? String(e)}\n${where}\n\nMuat ulang halaman, atau kirim laporan dari menu Pengaturan.`);
    return;
  }
  title.close();
}

void boot();
