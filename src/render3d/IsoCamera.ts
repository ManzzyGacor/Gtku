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
import { TILE } from '../config';
import { RANGES, settings } from '../core/settings';

/** Rotation around Y. 45° gives the classic isometric diamond. */
export const ISO_YAW_DEG = 45;
/** Tilt above the ground, in degrees; the player's range. Lower = more side-on. */
export const PITCH_MIN = RANGES.camPitch.min;
export const PITCH_MAX = RANGES.camPitch.max;
export const ZOOM_MIN = RANGES.camZoom.min;
export const ZOOM_MAX = RANGES.camZoom.max;
/** How far the camera sits from its target. Orthographic, so this only has to clear the geometry. */
const DISTANCE = 70;
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
  private pixelW = 480;
  private pixelH = 270;
  private unsubscribe: () => void;

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
      .multiplyScalar(DISTANCE);
  }

  get pitch(): number {
    return this.pitchDeg;
  }

  get zoom(): number {
    return this.zoomLevel;
  }

  /** Match the frustum to the pixel buffer: `TILE` px = 1 world unit at zoom 1. */
  setViewport(pixelW: number, pixelH: number): void {
    this.pixelW = pixelW;
    this.pixelH = pixelH;
    this.fit();
  }

  private fit(): void {
    const halfW = this.pixelW / TILE / 2 / this.zoomLevel;
    const halfH = this.pixelH / TILE / 2 / this.zoomLevel;
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = halfH;
    c.bottom = -halfH;
    c.updateProjectionMatrix();
  }

  /** Half-extent of the visible ground, in world units — what the chunk streamer needs. */
  get viewRadius(): number {
    const halfW = this.pixelW / TILE / 2 / this.zoomLevel;
    const halfH = this.pixelH / TILE / 2 / this.zoomLevel;
    // a tilted camera sees further along the ground than its vertical half-extent suggests
    return Math.hypot(halfW, halfH / Math.max(0.35, Math.sin(deg(this.pitchDeg))));
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

  private apply(): void {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
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
