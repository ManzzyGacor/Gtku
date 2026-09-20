import { TILE } from '../config';
import type { WorldSource } from './source';
import { TILE_INFO } from './tiles';

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

const EPS = 0.001;

/**
 * Tile-grid collision for feet-anchored boxes. An entity at (x, y) occupies [x-hw, x+hw] x [y-h, y].
 * Dynamic blockers (closed gates, the push-rock) are layered on top of the static world.
 */
export class Collision {
  private dyn = new Map<number, number>();

  constructor(readonly world: WorldSource) {}

  private key(tx: number, ty: number): number {
    return ty * this.world.widthTiles + tx;
  }

  addBlocker(tx: number, ty: number): void {
    const k = this.key(tx, ty);
    this.dyn.set(k, (this.dyn.get(k) ?? 0) + 1);
  }

  removeBlocker(tx: number, ty: number): void {
    const k = this.key(tx, ty);
    const n = (this.dyn.get(k) ?? 0) - 1;
    if (n <= 0) this.dyn.delete(k);
    else this.dyn.set(k, n);
  }

  solidTile(tx: number, ty: number): boolean {
    return this.world.solidAt(tx, ty) || this.dyn.has(this.key(tx, ty));
  }

  /** Is the point inside a solid tile? */
  solidAtPx(x: number, y: number): boolean {
    return this.solidTile(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  boxBlocked(x: number, y: number, hw: number, h: number): boolean {
    const x0 = Math.floor((x - hw) / TILE);
    const x1 = Math.floor((x + hw - EPS) / TILE);
    const y0 = Math.floor((y - h) / TILE);
    const y1 = Math.floor((y - EPS) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solidTile(tx, ty)) return true;
    return false;
  }

  /** Axis-separated move with sub-stepping so fast movers never tunnel through a tile. */
  move(x: number, y: number, hw: number, h: number, dx: number, dy: number): MoveResult {
    let hitX = false;
    let hitY = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        const nx = x + sx;
        if (this.boxBlocked(nx, y, hw, h)) {
          hitX = true;
          x = sx > 0 ? Math.floor((nx + hw) / TILE) * TILE - hw - EPS : (Math.floor((nx - hw) / TILE) + 1) * TILE + hw + EPS;
          if (this.boxBlocked(x, y, hw, h)) x -= sx;
        } else x = nx;
      }
      if (sy !== 0) {
        const ny = y + sy;
        if (this.boxBlocked(x, ny, hw, h)) {
          hitY = true;
          y = sy > 0 ? Math.floor(ny / TILE) * TILE - EPS : (Math.floor((ny - h) / TILE) + 1) * TILE + h + EPS;
          if (this.boxBlocked(x, y, hw, h)) y -= sy;
        } else y = ny;
      }
    }
    return { x, y, hitX, hitY };
  }

  /** Movement speed multiplier of the ground at a pixel position. */
  speedAt(x: number, y: number): number {
    return TILE_INFO[this.world.tileAt(Math.floor(x / TILE), Math.floor(y / TILE))]?.speed ?? 1;
  }

  surfaceAt(x: number, y: number): string {
    return TILE_INFO[this.world.tileAt(Math.floor(x / TILE), Math.floor(y / TILE))]?.surface ?? 'grass';
  }

  /** Line of sight test between two points (tile ray-march). */
  lineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(dist / 6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAtPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }
}
