import Phaser from 'phaser';
import { installErrorOverlay } from './core/errors';
import { planDisplay } from './core/display';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

installErrorOverlay();

function currentPlan() {
  return planDisplay(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}

const plan = currentPlan();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
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
  scene: [BootScene, GameScene, UIScene],
});

/** Re-plan the integer scale whenever the window / orientation changes. */
function onWindowResize(): void {
  const p = currentPlan();
  game.scale.setZoom(p.cssZoom);
  game.scale.resize(p.width, p.height);
}
window.addEventListener('resize', onWindowResize);
window.addEventListener('orientationchange', () => setTimeout(onWindowResize, 200));

(window as unknown as { __game: Phaser.Game }).__game = game;
