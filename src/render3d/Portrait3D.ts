/**
 * The hero's portrait for the Karakter panel: a live render of the real hero model.
 *
 * A second `HeroMesh3D` in a tiny scene of its own — half-body framing, a warm key light, a cool rim
 * and the hero's own lantern — drawn into a small render target and copied to a 2D canvas the UI can
 * show. It wears whatever the hero wears (`setGear`), holds the weapon in hand, and breathes.
 *
 * **Cost, on a phone.** The target is 84x104 pixels (the panel scales it up, pixelated, which is
 * also what makes it match the game's look), the scene is about sixty boxes, and it only renders
 * while the Karakter tab is actually on screen, at 10 frames a second. The read-back is the one
 * synchronous GPU stall in the game, which is why it is that small and that slow. Outside the
 * panel it costs nothing at all.
 */
import * as THREE from 'three';
import { HeroCore } from '../core/entities/HeroCore';
import type { GearLook } from '../core/items/look';
import { HeroMesh3D } from './HeroMesh3D';

export const PORTRAIT_W = 84;
export const PORTRAIT_H = 104;
/** Frames per second while the portrait is visible. */
const PORTRAIT_FPS = 10;

export class Portrait3D {
  /** What the panel shows. Owned here, drawn into here. */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly hero: HeroMesh3D;
  /** A stand-in hero: idle, facing the camera, holding the same weapon as the real one. */
  private readonly core = new HeroCore(0, 0);
  private readonly target: THREE.WebGLRenderTarget;
  private readonly buffer = new Uint8Array(PORTRAIT_W * PORTRAIT_H * 4);
  private readonly image: ImageData | null;
  private readonly clear = new THREE.Color();
  private readonly lights: THREE.Light[] = [];
  private since = Infinity;
  private time = 0;
  /** Rendered at least once since the gear or weapon last changed. */
  private fresh = false;
  /** Set when the read-back fails (a driver without it): the portrait stays as last drawn. */
  failed = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PORTRAIT_W;
    this.canvas.height = PORTRAIT_H;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx ? this.ctx.createImageData(PORTRAIT_W, PORTRAIT_H) : null;

    this.hero = new HeroMesh3D(this.scene);
    // three-quarter view: turned a little toward the lantern side, the way a portrait is posed
    this.core.aim = Math.PI / 2 - 0.42;
    this.core.x = 0;
    this.core.y = 0;

    // half-body: from the belt to just above the hair
    this.camera = new THREE.PerspectiveCamera(22, PORTRAIT_W / PORTRAIT_H, 0.1, 20);
    this.camera.position.set(0.25, 1.28, 3.3);
    this.camera.lookAt(0, 1.08, 0);

    const ambient = new THREE.AmbientLight(0x9a8cd6, 0.9);
    const key = new THREE.DirectionalLight(0xffe2b0, 1.5);
    key.position.set(-2, 3, 3);
    const rim = new THREE.DirectionalLight(0x7cc4ff, 1.1);
    rim.position.set(2.5, 2, -2.5);
    this.lights.push(ambient, key, rim);
    this.scene.add(ambient, key, rim);

    this.target = new THREE.WebGLRenderTarget(PORTRAIT_W, PORTRAIT_H, { depthBuffer: true });
  }

  /** The gear to wear; a change triggers a fresh render. */
  setGear(look: GearLook): void {
    if (look.key === this.hero.gearKey) return;
    this.hero.setGear(look);
    this.fresh = false;
  }

  /** The weapon in hand (0 = sword slot, 1 = bow slot), copied from the real hero. */
  setWeaponSlot(slot: 0 | 1, loadout: HeroCore['loadout'], style: HeroCore['meleeStyle'] = this.core.meleeStyle): void {
    if (this.core.slot === slot && this.core.loadout[0] === loadout[0] && this.core.loadout[1] === loadout[1] && this.core.meleeStyle === style) return;
    this.core.slot = slot;
    this.core.meleeStyle = style;
    this.core.loadout[0] = loadout[0];
    this.core.loadout[1] = loadout[1];
    this.fresh = false;
  }

  /**
   * Advance and, when due, redraw. `visible` is whether the Karakter tab is on screen: when it is
   * not, nothing is rendered — except one frame after a gear change, so the portrait is already
   * right the next time the panel opens.
   */
  update(realDt: number, visible: boolean): void {
    this.time += realDt;
    this.since += realDt;
    if (!visible && this.fresh) return;
    if (visible && this.since < 1 / PORTRAIT_FPS && this.fresh) return;
    this.since = 0;
    this.hero.update(realDt, realDt, this.core, this.time);
    this.draw();
  }

  private draw(): void {
    if (this.failed || !this.ctx || !this.image) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.getClearColor(this.clear);
    const prevAlpha = r.getClearAlpha();
    try {
      r.setRenderTarget(this.target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, this.camera);
      r.readRenderTargetPixels(this.target, 0, 0, PORTRAIT_W, PORTRAIT_H, this.buffer);
      // GL rows run bottom-up; the canvas runs top-down
      // (a plain byte loop: a subarray per row would allocate on every portrait frame)
      const out = this.image.data;
      const buf = this.buffer;
      const row = PORTRAIT_W * 4;
      for (let y = 0; y < PORTRAIT_H; y++) {
        const src = (PORTRAIT_H - 1 - y) * row;
        const dst = y * row;
        for (let i = 0; i < row; i++) out[dst + i] = buf[src + i];
      }
      this.ctx.putImageData(this.image, 0, 0);
      this.fresh = true;
    } catch {
      this.failed = true;
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(this.clear, prevAlpha);
    }
  }

  dispose(): void {
    this.hero.dispose();
    for (const l of this.lights) l.dispose();
    this.target.dispose();
  }
}
