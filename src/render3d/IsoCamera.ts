/**
 * Fixed-angle 3/4 camera (docs/OVERHAUL.md §1).
 *
 * Orthographic, so the pixel grid never distorts with distance. The frustum width is derived from
 * the pixel buffer at exactly `TILE` pixels per world unit, which means one tile covers the same
 * number of pixels as it does in the 2D game — the view reads as the same world.
 *
 * The *yaw* is fixed (no free rotation, so the isometric diamond never breaks), but the **tilt and
 * zoom are player settings**: how side-on the view should be is a matter of taste and of what you
 * want to see of the buildings, and only the person holding the phone can judge that.
 */
import * as THREE from 'three';
import { RANGES, settings } from '../core/settings';

/** Rotation around Y. 45° gives the classic isometric diamond. */
export const ISO_YAW_DEG = 45;
/**
 * How many tiles fit on screen vertically at zoom 1 — i.e. the framing.
 *
 * Measured off the reference art: the hero fills about 8% of the screen height there, and the hero
 * is 1.55 units tall, so the view is roughly 19 tiles. Crucially this is **independent of the pixel
 * resolution**: raising `pixelHeight` makes the pixels smaller and the image sharper, it does not
 * zoom the camera out.
 */
export const VIEW_TILES_H = 19;
/** Tilt above the ground, in degrees; the player's range. Lower = more side-on. */
export const PITCH_MIN = RANGES.camPitch.min;
export const PITCH_MAX = RANGES.camPitch.max;
export const ZOOM_MIN = RANGES.camZoom.min;
export const ZOOM_MAX = RANGES.camZoom.max;
/** How far the camera sits from its target. Orthographic, so this only has to clear the geometry. */
export const CAMERA_DISTANCE = 70;
/**
 * The camera aims a little above the ground — roughly the hero's chest. At a side-on tilt this
 * keeps the hero in the middle of the screen instead of the bottom third.
 */
const TARGET_LIFT = 0.55;

const deg = (d: number): number => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  /** Ground point the camera is centred on, in world units. */
  readonly target = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private pitchDeg = 38;
  private zoomLevel = 1;
  private aspect = 16 / 9;
  private unsubscribe: () => void;
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeAmount = 0;
  private readonly shakeOffset = new THREE.Vector3();

  constructor() {
    this.readSettings();
    this.unsubscribe = settings.on((key) => {
      if (key === 'camPitch' || key === 'camZoom') this.readSettings();
    });
  }

  private readSettings(): void {
    this.pitchDeg = clamp(settings.get('camPitch'), PITCH_MIN, PITCH_MAX);
    this.zoomLevel = clamp(settings.get('camZoom'), ZOOM_MIN, ZOOM_MAX);
    this.rebuildOffset();
    this.fit();
    this.apply();
  }

  private rebuildOffset(): void {
    const yaw = deg(ISO_YAW_DEG);
    const pitch = deg(this.pitchDeg);
    // Direction from the target to the camera. Its elevation above the ground *is* `pitchDeg`.
    this.offset
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(CAMERA_DISTANCE);
  }

  get pitch(): number {
    return this.pitchDeg;
  }

  get zoom(): number {
    return this.zoomLevel;
  }

  /**
   * The screen's aspect ratio. The framing comes from `VIEW_TILES_H`, not from how many pixels
   * the buffer has, so the two dials stay independent.
   */
  setAspect(aspect: number): void {
    this.aspect = aspect > 0 ? aspect : 16 / 9;
    this.fit();
  }

  private fit(): void {
    const halfH = VIEW_TILES_H / 2 / this.zoomLevel;
    const halfW = halfH * this.aspect;
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = halfH;
    c.bottom = -halfH;
    c.updateProjectionMatrix();
  }

  /**
   * Half-extents of the ground the camera can see, in world units, measured along the camera's own
   * axes: `right` across the screen and `forward` into it. The forward extent is larger than the
   * vertical half-height because the camera is tilted.
   *
   * The streamer tests chunks against this **rectangle**. It used to use a circle of radius
   * `hypot(right, forward)`, which on a 3:1 phone covered nearly twice the area that is actually
   * on screen — and every extra chunk is a 256x256 texture and a pile of instances.
   */
  groundExtent(): { right: number; forward: number } {
    const halfH = VIEW_TILES_H / 2 / this.zoomLevel;
    return { right: halfH * this.aspect, forward: halfH / Math.max(0.35, Math.sin(deg(this.pitchDeg))) };
  }

  /** Worst-case half-extent, for anything that wants one number (fog reach, reports). */
  get viewRadius(): number {
    const e = this.groundExtent();
    return Math.hypot(e.right, e.forward);
  }

  /**
   * Project a world point onto the camera's ground axes, relative to `origin`.
   * Under a fixed yaw the ground projection is just a rotation, so this is two multiplies.
   */
  toGroundAxes(px: number, pz: number, originX: number, originZ: number, out = new THREE.Vector2()): THREE.Vector2 {
    const yaw = deg(ISO_YAW_DEG);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const dx = px - originX;
    const dz = pz - originZ;
    out.set(dx * cos - dz * sin, -(dx * sin + dz * cos));
    return out;
  }

  /**
   * Where distance fog should start and end, in view depth.
   *
   * Three measures fog from the camera, and an orthographic camera sits `CAMERA_DISTANCE` away from
   * what it is looking at — so "near" is around 70, not around 0. Fog therefore only touches the
   * half of the screen beyond the hero, which is exactly where the world runs out.
   */
  fogRange(): [number, number] {
    const r = this.viewRadius;
    return [CAMERA_DISTANCE + r * 0.15, CAMERA_DISTANCE + r * 1.3];
  }

  /** Snap straight to a world position (teleport, first frame). */
  snap(x: number, z: number): void {
    this.target.set(x, TARGET_LIFT, z);
    this.apply();
  }

  /** Ease toward a world position. `dt` in seconds. */
  follow(x: number, z: number, dt: number, lerp = 9): void {
    const k = 1 - Math.exp(-lerp * dt);
    this.target.x += (x - this.target.x) * k;
    this.target.z += (z - this.target.z) * k;
    this.target.y = TARGET_LIFT;
    this.apply();
  }

  /**
   * Kick the camera. Combat feedback: a landed hit needs a shove, but a fixed 3/4 camera must not
   * lose its angle, so the shake offsets the *position* and the look-at target together.
   */
  shake(amount: number, seconds = 0.15): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeLeft = Math.max(this.shakeLeft, seconds);
    this.shakeTotal = Math.max(this.shakeTotal, seconds);
  }

  /** Advance the shake. Call once per frame with the real delta. */
  tick(realDt: number): void {
    if (this.shakeLeft <= 0) return;
    this.shakeLeft = Math.max(0, this.shakeLeft - realDt);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.target).add(this.offset);
    if (this.shakeLeft > 0) {
      // decaying random offset in units; 1 unit = 16 px, so a few px of shake is a fraction of one
      const k = (this.shakeLeft / Math.max(0.001, this.shakeTotal)) * this.shakeAmount * (1 / 16);
      this.shakeOffset.set((Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k * 0.6, (Math.random() * 2 - 1) * k);
      this.camera.position.add(this.shakeOffset);
    }
    this.camera.lookAt(this.shakeLeft > 0 ? this.target.clone().add(this.shakeOffset) : this.target);
    this.camera.updateMatrixWorld();
  }

  /**
   * Turn a screen-space stick vector (x right, y down) into world XZ, so "push up" means
   * "walk away from the camera" no matter what the fixed yaw is.
   */
  stickToWorld(sx: number, sy: number, out = new THREE.Vector2()): THREE.Vector2 {
    const yaw = deg(ISO_YAW_DEG);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // screen up (-y) maps to the camera's forward direction projected on the ground
    out.set(sx * cos + sy * sin, -sx * sin + sy * cos);
    return out;
  }

  dispose(): void {
    this.unsubscribe();
  }
}
