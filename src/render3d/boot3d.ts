/**
 * Boots the 3D (Three.js) renderer: the pixel pipeline, the isometric camera, the greybox
 * Ravenhollow, and the DOM touch controls (docs/OVERHAUL.md, Fase 1).
 *
 * It also owns the *session*: pausing when the player switches apps, saving before the phone can
 * kill the tab, and rebuilding the whole world if the GPU takes the WebGL context away. See
 * `core/lifecycle.ts` for why each of those matters on a phone.
 */
import { Game3D } from './Game3D';
import { TitleBackdrop } from './TitleBackdrop';
import type { DevServer } from './DevTools';
import { resumeAudio, suspendAudio } from '../core/audio';
import { loadCombatTuning } from '../core/entities/combatTuning';
import { Lifecycle } from '../core/lifecycle';
import { invalidateInsets } from '../ui/safearea';
import { el, injectStyle, onTap } from '../ui/dom';
import { recordError } from '../core/errors';
import type { DebugUi } from '../ui/DebugUi';
import { TouchControls } from '../ui/TouchControls';
import { fullscreen } from '../ui/fullscreen';

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
  const box = existing ?? document.createElement('div');
  box.id = id;
  box.textContent = text;
  Object.assign(box.style, {
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
  if (!existing) document.body.appendChild(box);
}

/**
 * Build the world. The choice (continue or start over) is made *before* construction, which is
 * what lets a loaded save place the hero and the clock on the very first frame.
 */
/**
 * What this session may do beyond playing. `devServer` is present only when the server said the
 * logged-in account's role is "dev" (main.ts) — and every panel action still goes through it.
 */
export interface SessionAccess {
  devServer?: DevServer | undefined;
}

export function startWorld(parent: HTMLElement, debug: DebugUi, continueGame: boolean, access: SessionAccess = {}): Booted3D {
  // Whatever the player tuned in the combat panel on a previous run, applied before anything reads
  // an attack's numbers. It lives here rather than in the entry so the title screen does not have
  // to wait for the combat model to download.
  loadCombatTuning();
  let game = new Game3D(parent, { continue: continueGame });
  const controls = new TouchControls();

  const wire = (g: Game3D): void => {
    g.onWeaponState = (next, charge, held) => controls.setWeaponState(next, charge, held);
    g.onInteractPrompt = (label) => controls.setInteract(label);
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

  // ── Mode Pengembang ──
  const dev = installDevMode(() => game, debug, access.devServer);

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

  // entering or leaving fullscreen resizes the viewport, sometimes only after a beat
  const offFullscreen = fullscreen().onChange(() => {
    invalidateInsets();
    game.resize();
    controls.layout();
  });

  return {
    game,
    controls,
    dispose: () => {
      dev.dispose();
      offFullscreen();
      lifecycle.dispose();
      notice(null);
      controls.destroy();
      game.dispose();
    },
  };
}


/**
 * The animated night behind the title screen, or null if this device cannot draw it (the title's
 * own gradient then stays — nothing about the menu depends on it).
 */
export function startTitleBackdrop(parent: HTMLElement): { dispose(): void } | null {
  try {
    const backdrop = new TitleBackdrop(parent);
    backdrop.start();
    return backdrop;
  } catch (e) {
    recordError(String((e as Error)?.message ?? e), 'title-backdrop');
    return null;
  }
}

/**
 * The developer panel, for an account the server calls "dev" — and for nobody else.
 *
 * There is no other door: no `?debug=1`, no taps on the version number, no build flag, no
 * "skip login". The panel's code is a separate chunk loaded only here, and even with the chunk in
 * hand every action is authorised by the server (`DevTools.ts`). A small DEV badge on the HUD says
 * which mode the session is in.
 */
function installDevMode(getGame: () => Game3D, debug: DebugUi, server: DevServer | undefined): { dispose(): void } {
  debug.setDeveloper(!!server);
  if (!server) return { dispose: () => undefined };
  let menu: import('../ui/DevMenu').DevMenu | null = null;
  let button: HTMLButtonElement | null = null;
  let disposed = false;

  injectStyle(
    'lm-ui-devbtn',
    `.lm-devbtn { position: fixed; z-index: 80; pointer-events: auto; width: 40px; height: 34px; padding: 0;
      right: calc(158px + var(--lm-sar, 0px)); top: calc(4px + var(--lm-sat, 0px));
      border: 1px solid #7dffb0; border-radius: 17px; background: rgba(8, 26, 18, 0.85); color: #7dffb0;
      font: 11px/1 ui-monospace, monospace; letter-spacing: 1px; cursor: pointer; touch-action: manipulation; }`,
  );
  button = el('button', {}, 'DEV');
  button.className = 'lm-devbtn';
  button.setAttribute('aria-label', 'Panel pengembang');
  getGame().hud.setDevBadge(true);

  void Promise.all([import('../ui/DevMenu'), import('./DevTools')]).then(([{ DevMenu }, { buildDevActions }]) => {
    if (disposed) return;
    const game = getGame();
    menu = new DevMenu(buildDevActions(game, server, () => location.reload()));
    // the reaction log: every reaction, spelled out, while in developer mode
    game.onReactionLog = (line) => menu?.pushReaction(line);
    menu.onToggle = (isOpen) => game.setDevPaused(isOpen);
    onTap(button!, () => menu?.openMenu());
    document.body.appendChild(button!);
  });

  return {
    dispose: () => {
      disposed = true;
      menu?.destroy();
      button?.remove();
    },
  };
}
