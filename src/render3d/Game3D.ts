/**
 * The 3D game loop (docs/OVERHAUL.md, Fase 1).
 *
 * It owns the pixel renderer, the isometric camera and the greybox world, and it reuses the same
 * `src/core` logic as the 2D build: the same `GeneratedWorld`, the same day/night curve, the same
 * `input` hub, the same graphics presets and the same FPS watchdog. Nothing here is a second copy
 * of the game — it is a second *view* of it.
 */
import { WORLD_TILES_H } from '../config';
import { buildTileSheet } from '../art/tiles';
import { AdaptiveQuality, probeDevice, profileOf, suggestPreset } from '../core/graphics';
import { input } from '../core/input';
import { PerfMeter } from '../core/perf';
import { settings } from '../core/settings';
import { DAY_SECONDS } from '../core/systems/daynight';
import { FOREST_X0 } from '../core/world/areas';
import { GeneratedWorld } from '../core/world/worldgen';
import type { DiagnosticsSource } from '../ui/diagnostics';
import { IsoCamera } from './IsoCamera';
import { PixelRenderer } from './PixelRenderer';
import { World3D } from './World3D';
import { u } from './worldPlan';

/** How many dynamic point lights each preset may keep alive. */
const LIGHT_BUDGET: Record<string, number> = { vlow: 0, low: 2, medium: 4, high: 8, ultra: 12 };

export class Game3D {
  readonly pixels: PixelRenderer;
  readonly camera = new IsoCamera();
  readonly world = new GeneratedWorld();
  readonly scene3d: World3D;
  readonly perf = new PerfMeter();

  private adaptive = new AdaptiveQuality(this.perf);
  private tileSheet = buildTileSheet();
  private raf = 0;
  private lastFrame = 0;
  private dayTime = 0.35;
  private paused = false;
  private unsubscribe: () => void;
  private disposed = false;

  constructor(parent: HTMLElement) {
    this.pixels = new PixelRenderer(parent);
    this.scene3d = new World3D(this.pixels.scene, this.world, this.tileSheet);

    // Fase 1 builds Desa Lentera only; the other areas arrive with chunk streaming in Batch 6.
    this.scene3d.build({ x0: 0, y0: 0, x1: FOREST_X0, y1: WORLD_TILES_H });

    const start = this.world.markers.playerStart;
    this.camera.snap(u(start.x), u(start.y));

    if (settings.firstRun && settings.get('presetAuto') && !settings.isLocked('preset')) {
      settings.set('preset', suggestPreset(probeDevice()));
    }
    this.adaptive.auto = settings.get('presetAuto') && !settings.isLocked('preset');
    this.adaptive.onChange = (_from, to) => settings.set('preset', to);
    this.unsubscribe = settings.on((key) => {
      if (key === 'presetAuto') this.adaptive.auto = settings.get('presetAuto') && !settings.isLocked('preset');
      if (key === 'preset') this.applyProfile();
    });

    this.applyProfile();
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => this.resize();

  resize(): void {
    const p = profileOf(settings.get('preset'));
    const plan = this.pixels.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, p.pixelHeight, p.renderScale);
    this.camera.setViewport(plan.pixelW, plan.pixelH);
  }

  private applyProfile(): void {
    const p = profileOf(settings.get('preset'));
    this.pixels.setOutline(p.outline);
    this.scene3d.setLightBudget(LIGHT_BUDGET[p.id] ?? 4);
    this.scene3d.setShadows(p.shadows);
    this.resize();
  }

  // ───────────────────────── loop ─────────────────────────

  start(): void {
    if (this.raf) return;
    this.lastFrame = 0;
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** One frame. Exposed so a test can drive the simulation without a browser. */
  step(dt: number): void {
    if (this.disposed) return;
    if (!this.paused && dt > 0) {
      this.dayTime = (this.dayTime + dt / DAY_SECONDS) % 1;
      this.moveCamera(dt);
      this.perf.push(dt);
      this.adaptive.update(dt, settings.get('preset'));
    }
    this.scene3d.update(this.dayTime, this.camera.target);
    this.pixels.render(this.camera.camera);
  }

  /**
   * Fase 1 has no player yet, so the stick pans the camera over the village.
   * Fase 2 replaces this with `HeroCore` and makes the camera follow the hero.
   */
  private moveCamera(dt: number): void {
    const ax = input.axis();
    if (!ax.x && !ax.y) return;
    const dir = this.camera.stickToWorld(ax.x, ax.y);
    const speed = 14; // world units per second
    const t = this.camera.target;
    this.camera.snap(
      Math.max(0, Math.min(FOREST_X0, t.x + dir.x * speed * dt)),
      Math.max(0, Math.min(WORLD_TILES_H, t.z + dir.y * speed * dt)),
    );
  }

  // ───────────────────────── diagnostics ─────────────────────────

  diagnostics(): DiagnosticsSource {
    return {
      name: 'three3d',
      fps: () => ({ avg: this.perf.avg, low: this.perf.low }),
      objects: () => {
        const s = this.scene3d.stats();
        return s.instances + s.chunks;
      },
      view: () => ({ w: this.pixels.plan.renderW, h: this.pixels.plan.renderH }),
      setPaused: (p) => {
        this.paused = p;
        input.enabled = !p;
        if (p) input.reset();
      },
      report: () => this.extraReport(),
    };
  }

  /** Extra lines for the "Salin laporan" report. */
  private extraReport(): string[] {
    const s = this.scene3d.stats();
    const plan = this.pixels.plan;
    return [
      `grid pixel: ${plan.pixelW}x${plan.pixelH} (zoom ${plan.zoom})`,
      `render target: ${plan.renderW}x${plan.renderH}`,
      `chunk tanah: ${s.chunks}   instance: ${s.instances}   draw group: ${s.draws}   lampu: ${s.lights}`,
      `outline tersedia: ${this.pixels.canOutline ? 'ya' : 'tidak'}`,
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.unsubscribe();
    this.scene3d.dispose();
    this.pixels.dispose();
  }
}
