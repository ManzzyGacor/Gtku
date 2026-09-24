/**
 * Boots the 3D (Three.js) renderer: the pixel pipeline, the isometric camera, the greybox
 * Desa Lentera, and the DOM touch controls (docs/OVERHAUL.md, Fase 1).
 */
import { Game3D } from './Game3D';
import type { DebugUi } from '../ui/DebugUi';
import { TitleScreen } from '../ui/TitleScreen';
import { TouchControls } from '../ui/TouchControls';

export interface Booted3D {
  game: Game3D;
  controls: TouchControls;
  dispose(): void;
}

/**
 * Show the title screen, then build the world once the player has chosen. Deciding *before*
 * construction is what lets a loaded save place the hero and the clock on the very first frame.
 */
export async function start3d(parent: HTMLElement, debug: DebugUi): Promise<Booted3D> {
  document.getElementById('boot-msg')?.remove();
  const title = new TitleScreen();
  const choice = await title.choice();
  return startWorld(parent, debug, choice.continueGame);
}

function startWorld(parent: HTMLElement, debug: DebugUi, continueGame: boolean): Booted3D {
  const game = new Game3D(parent, { continue: continueGame });
  const controls = new TouchControls();
  game.onWeaponState = (next, charge) => controls.setWeaponState(next, charge);
  debug.attach(game.diagnostics());
  game.start();

  const onOrientation = (): void => {
    setTimeout(() => {
      game.resize();
      controls.layout();
    }, 200);
  };
  window.addEventListener('orientationchange', onOrientation);
  window.addEventListener('resize', () => controls.layout());

  return {
    game,
    controls,
    dispose: () => {
      window.removeEventListener('orientationchange', onOrientation);
      controls.destroy();
      game.dispose();
    },
  };
}
