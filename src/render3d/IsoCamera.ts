/**
 * Fixed-angle 3/4 isometric camera (docs/OVERHAUL.md §1).
 *
 * Orthographic, so the pixel grid never distorts with distance. The frustum width is derived from
 * the pixel buffer at exactly `TILE` pixels per world unit, which means one tile covers the same
 * number of pixels as it does in the 2D game — the view reads as the same world.
 *
 * The angle is fixed on purpose (no free rotation), and zoom is clamped to a narrow band so the
 * texel density stays close to 1:1.
 */
import * as THREE from 'three';
import { TILE } from '../config';

/** Rotation around Y. 45° gives the classic isometric diamond. */
export const ISO_YAW_DEG = 45;
/**
 * Tilt from the horizon. 35.26° is true isometric; we use a slightly steeper angle so the player
 * can see past walls and the view still feels like the top-down original. Tune from a phone report.
 */
export const ISO_PITCH_DEG = 42;

export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 1.6;
/** How far the camera sits from its target. Orthographic, so this only has to clear the geometry. */
const DISTANCE = 60;

const deg = (d: number): number => (d * Math.PI) / 180;

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
  /** Point the camera looks at, in world units. */
  readonly target = new THREE.Vector3();
  private zoomLevel = 1;
  private offset: THREE.Vector3;
  private pixelW = 480;
  private pixelH = 270;

  constructor() {
    // Direction from the target to the camera, from the two fixed angles.
    const yaw = deg(ISO_YAW_DEG);
    const pitch = deg(ISO_PITCH_DEG);
    this.offset = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(DISTANCE);
    this.apply();
  }

  get zoom(): number {
    return this.zoomLevel;
  }

  setZoom(z: number): void {
    this.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    this.fit();
  }

  /** Match the frustum to the pixel buffer: `TILE` px = 1 world unit. */
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

  /** Snap straight to a world position (teleport, first frame). */
  snap(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.apply();
  }

  /** Ease toward a world position. `dt` in seconds. */
  follow(x: number, z: number, dt: number, lerp = 9): void {
    const k = 1 - Math.exp(-lerp * dt);
    this.target.x += (x - this.target.x) * k;
    this.target.z += (z - this.target.z) * k;
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
}
