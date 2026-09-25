/**
 * The night behind the title screen: Ravenhollow around the Great Lantern, in fog, with fireflies,
 * the lamp posts lit, and the camera drifting slowly across the square.
 *
 * Not a picture of the game — the game's own parts: the same pixel pipeline, sky, streamed world and
 * night particles, so the first thing the player sees is exactly what they are about to walk into.
 * It arrives with the renderer chunk, a moment after the title (which shows its own gradient until
 * then), and it is **disposed before the world is built**: two WebGL contexts at once on a phone is
 * asking for the second one to be refused.
 */
import * as THREE from 'three';
import { buildTileSheet } from '../art/tiles';
import { gradeAt, nightAmount } from '../core/systems/daynight';
import { profileOf } from '../core/graphics';
import { settings } from '../core/settings';
import { GeneratedWorld } from '../core/world/worldgen';
import { Environment } from './Environment';
import { CAMERA_DISTANCE, IsoCamera } from './IsoCamera';
import { fogDistances, WEATHER, type WeatherLook } from '../core/systems/weather';
import { PixelRenderer } from './PixelRenderer';
import { Sky } from './Sky';
import { World3D } from './World3D';
import { u } from './worldPlan';

/** Deep night: the lamps are lit and the fireflies are out. */
const NIGHT = 0.93;
/** How far the camera drifts from the lantern, px, and how slowly (radians per second). */
const DRIFT = { x: 56, y: 30, sx: 0.045, sy: 0.031 };
/** Thicker fog than the game uses, pulled in: the title is about atmosphere, not reading the map. */
const TITLE_FOG: WeatherLook = { ...WEATHER.berkabut, fogNear: -0.2, fogFar: 0.8 };
const fogOut: [number, number] = [0, 0];

export class TitleBackdrop {
  private readonly pixels: PixelRenderer;
  private readonly world = new GeneratedWorld();
  private readonly sky: Sky;
  private readonly scene3d: World3D;
  private readonly environment: Environment;
  private readonly camera = new IsoCamera();
  private readonly lift = new THREE.Color();
  private readonly gain = new THREE.Color();
  private readonly home: { x: number; y: number };
  private raf = 0;
  private last = 0;
  private time = 0;
  private disposed = false;

  constructor(parent: HTMLElement) {
    this.pixels = new PixelRenderer(parent);
    this.sky = new Sky(this.pixels.scene);
    this.scene3d = new World3D(this.pixels.scene, this.world, buildTileSheet());
    this.environment = new Environment(this.pixels.scene);
    const lantern = this.world.markers.lantern;
    // a little south of the lantern, so it stands in the upper third of the frame
    this.home = { x: lantern.x, y: lantern.y + 24 };
    this.camera.snap(u(this.home.x), u(this.home.y));
    this.scene3d.setLightBudget(profileOf(settings.get('preset')).id === 'vlow' ? 0 : 2);
    this.resize();
    this.scene3d.setView(this.camera.groundExtent(), (px, pz, ox, oz, out) => this.camera.toGroundAxes(px, pz, ox, oz, out));
    this.scene3d.preload(u(this.home.x), u(this.home.y), 1);
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const p = profileOf(settings.get('preset'));
    const plan = this.pixels.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, p.pixelHeight, p.renderScale * settings.get('renderScale'));
    this.camera.setAspect(plan.pixelW / plan.pixelH);
  };

  start(): void {
    if (this.raf || this.disposed) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.step(dt);
  };

  /** One frame. Public for the test, which drives it without `requestAnimationFrame`. */
  step(dt: number): void {
    this.time += dt;
    const tx = this.home.x + Math.sin(this.time * DRIFT.sx) * DRIFT.x;
    const ty = this.home.y + Math.sin(this.time * DRIFT.sy + 1.3) * DRIFT.y;
    this.camera.follow(u(tx), u(ty), dt, 1.2);
    this.camera.tick(dt);

    const night = nightAmount(NIGHT);
    const [near, far] = fogDistances(CAMERA_DISTANCE, this.camera.viewRadius, Infinity, TITLE_FOG, night, 0, fogOut);
    this.sky.update(NIGHT, 0, near, far, night, this.time);
    this.pixels.renderer.setClearColor(this.sky.haze, 1);
    const g = gradeAt(NIGHT, 0);
    this.pixels.setGrade({
      bloom: settings.get('bloom') && profileOf(settings.get('preset')).bloom ? g.bloom : 0,
      vignette: g.vignette * 1.3,
      lift: this.lift.setRGB(g.lift[0], g.lift[1], g.lift[2] + 0.01),
      gain: this.gain.setRGB(g.gain[0], g.gain[1], g.gain[2]),
    });
    this.scene3d.setRenderDistance(1);
    this.scene3d.setView(this.camera.groundExtent(), (px, pz, ox, oz, out) => this.camera.toGroundAxes(px, pz, ox, oz, out));
    this.scene3d.setHeroGround(this.camera.target.x, this.camera.target.z);
    this.scene3d.update(NIGHT, this.camera.target, 0, 1, dt);
    this.scene3d.waterUniforms.uSky.value.copy(this.sky.haze);
    this.scene3d.waterUniforms.uFogColor.value.copy(this.sky.haze);
    this.scene3d.waterUniforms.uFogRange.value.set(this.sky.fog.near, this.sky.fog.far);
    this.environment.update(dt, this.camera.target, night, 0, 0, this.sky.haze);
    this.pixels.render(this.camera.camera);
  }

  /** Everything on the GPU goes, and the canvas with it — before the game makes its own. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.environment.dispose();
    this.scene3d.dispose();
    this.sky.dispose();
    this.camera.dispose();
    this.pixels.renderer.forceContextLoss();
    this.pixels.dispose();
  }
}
