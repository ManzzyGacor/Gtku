/**
 * Boots the 2D (Phaser) renderer. Kept whole and untouched while the 3D build catches up —
 * `?renderer=2d` or the settings menu must always get the player back to a complete game
 * (docs/OVERHAUL.md §7 "aturan").
 */
import Phaser from 'phaser';
import { planDisplay } from './core/display';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';

export function start2d(parent: HTMLElement): Phaser.Game {
  const currentPlan = (): ReturnType<typeof planDisplay> => planDisplay(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  const plan = currentPlan();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0d0a16',
    width: plan.width,
    height: plan.height,
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: plan.cssZoom,
    },
    render: {
      pixelArt: true,
      antialias: false,
      powerPreference: 'high-performance',
    },
    fps: { target: 60 },
    input: { activePointers: 4, touch: { capture: true } },
    disableContextMenu: true,
    scene: [BootScene, TitleScene, GameScene, UIScene],
  });

  /** Re-plan the integer scale whenever the window / orientation changes. */
  const onWindowResize = (): void => {
    const p = currentPlan();
    game.scale.setZoom(p.cssZoom);
    game.scale.resize(p.width, p.height);
  };
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', () => setTimeout(onWindowResize, 200));

  return game;
}
