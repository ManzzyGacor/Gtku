/**
 * Boots the 3D (Three.js) renderer: the pixel pipeline, the isometric camera, the greybox
 * Desa Lentera, and the DOM touch controls (docs/OVERHAUL.md, Fase 1).
 */
import { Game3D } from './render3d/Game3D';
import type { DebugUi } from './ui/DebugUi';
import { TouchControls } from './ui/TouchControls';

export interface Booted3D {
  game: Game3D;
  controls: TouchControls;
  dispose(): void;
}

export function start3d(parent: HTMLElement, debug: DebugUi): Booted3D {
  const game = new Game3D(parent);
  const controls = new TouchControls();
  debug.attach(game.diagnostics());
  game.start();
  document.getElementById('boot-msg')?.remove();

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
