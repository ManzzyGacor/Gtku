/**
 * Boots the 3D (Three.js) renderer: the pixel pipeline, the isometric camera, the greybox
 * Ravenhollow, and the DOM touch controls (docs/OVERHAUL.md, Fase 1).
 *
 * It also owns the *session*: pausing when the player switches apps, saving before the phone can
 * kill the tab, and rebuilding the whole world if the GPU takes the WebGL context away. See
 * `core/lifecycle.ts` for why each of those matters on a phone.
 */
import { Game3D } from './Game3D';
import { resumeAudio, suspendAudio } from '../core/audio';
import { loadCombatTuning } from '../core/entities/combatTuning';
import { Lifecycle } from '../core/lifecycle';
import { invalidateInsets } from '../ui/safearea';
import { recordError } from '../core/errors';
import type { DebugUi } from '../ui/DebugUi';
import { TouchControls } from '../ui/TouchControls';

export interface Booted3D {
  game: Game3D;
  controls: TouchControls;
  dispose(): void;
}

/** A line of text over the canvas, for the one case the player cannot act on: a lost GPU context. */
function notice(text: string | null): void {
  const id = 'ctx-notice';
  const existing = document.getElementById(id);
  if (!text) {
    existing?.remove();
    return;
  }
  const el = existing ?? document.createElement('div');
  el.id = id;
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    padding: '10px 14px',
    background: 'rgba(12,10,24,0.92)',
    color: '#ffe6a8',
    font: '12px monospace',
    borderRadius: '6px',
    zIndex: '60',
    textAlign: 'center',
  });
  if (!existing) document.body.appendChild(el);
}

/**
 * Build the world. The choice (continue or start over) is made *before* construction, which is
 * what lets a loaded save place the hero and the clock on the very first frame.
 */
export function startWorld(parent: HTMLElement, debug: DebugUi, continueGame: boolean): Booted3D {
  // Whatever the player tuned in the combat panel on a previous run, applied before anything reads
  // an attack's numbers. It lives here rather than in the entry so the title screen does not have
  // to wait for the combat model to download.
  loadCombatTuning();
  let game = new Game3D(parent, { continue: continueGame });
  const controls = new TouchControls();

  const wire = (g: Game3D): void => {
    g.onWeaponState = (next, charge, held) => controls.setWeaponState(next, charge, held);
    // The touch controls get out of the way while a cutscene or the pause menu is up.
    g.onCutsceneChange = (playing) => controls.setVisible(!playing);
    g.pause.onToggle = ((original) => (open: boolean) => {
      original(open);
      controls.setVisible(!open);
    })(g.pause.onToggle);
    g.onOpenSettings = () => debug.openSettings();
    /*
     * Leaving to the title screen.
     *
     * A reload rather than tearing the world down and building a new one: the save is already
     * written by the time this runs, and a reload is the one teardown that cannot leave a stray
     * listener, a running scheduler or a leaked GPU buffer behind. It is also what the player
     * expects "keluar" to do.
     */
    g.onQuit = () => location.reload();
    debug.attach(g.diagnostics());
    g.start();
  };
  wire(game);

  /*
   * A new game opens with the prologue (docs/STORY.md).
   *
   * `auto: true` means "only if it has not been watched", and the save is what remembers that — so
   * starting over really does replay it, while a rebuild after a lost GPU context does not.
   */
  if (!continueGame) game.playCutscene('intro', { auto: true });

  /**
   * Rebuild everything that lived on the GPU.
   *
   * There is no way to "repair" a lost context: every texture, buffer and program is gone. What
   * makes a clean rebuild affordable here is that the world is generated and streamed rather than
   * loaded, and the player's progress is in the save — so the recovery is "save, throw the renderer
   * away, build a new one that continues the save", and the player lands back where they were.
   */
  const rebuild = (): void => {
    try {
      game.saveNow(true);
      game.dispose();
      game = new Game3D(parent, { continue: true });
      wire(game);
      lifecycle.attachCanvas(game.pixels.canvas);
      notice(null);
    } catch (e) {
      recordError(String((e as Error)?.message ?? e), 'webgl-restore');
      notice('Grafik gagal dipulihkan. Muat ulang halaman — progresmu sudah tersimpan.');
    }
  };

  const lifecycle = new Lifecycle(
    {
      pause: () => {
        game.stop();
        suspendAudio();
      },
      resume: () => {
        resumeAudio();
        game.start();
      },
      save: () => game.saveNow(true),
      resize: () => {
        // the insets change with rotation, so the cache has to go before anything lays out
        invalidateInsets();
        game.resize();
        controls.layout();
      },
      contextLost: () => notice('Grafik terputus sebentar…\nprogresmu sudah tersimpan.'),
      contextRestored: rebuild,
    },
    { canvas: game.pixels.canvas },
  ).install();

  return {
    game,
    controls,
    dispose: () => {
      lifecycle.dispose();
      notice(null);
      controls.destroy();
      game.dispose();
    },
  };
}
