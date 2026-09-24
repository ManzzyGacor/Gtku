/**
 * The minimap (docs/OVERHAUL.md §4 "UI": top-right corner).
 *
 * Ported from the 2D `UIScene`. The whole world is painted once into an offscreen canvas at one
 * pixel per tile — cheap, because it never changes — and each frame a window of it is blitted
 * into the visible canvas with the hero, the NPCs, the checkpoints and the current objective
 * drawn on top.
 */
import { CHUNK_TILES, TILE } from '../config';
import { T } from '../core/world/tiles';
import type { WorldSource } from '../core/world/source';
import { el, injectStyle } from './dom';

/** Tiles visible in the window. */
const VIEW_W = 48;
const VIEW_H = 32;
/** Screen pixels per tile. */
const ZOOM = 2;

const COLORS: Record<number, string> = {
  [T.GRASS]: '#3f7a38',
  [T.FLOWERS]: '#4d8c3f',
  [T.FOREST]: '#22562f',
  [T.DIRT]: '#8a5e36',
  [T.COBBLE]: '#8f8a8a',
  [T.SAND]: '#c4a473',
  [T.WATER]: '#1f5e8c',
  [T.SHALLOW]: '#338ab4',
  [T.CAVE]: '#33375180',
  [T.WALL]: '#141024',
  [T.BRIDGE_H]: '#7a4e2c',
  [T.BRIDGE_V]: '#7a4e2c',
  [T.ARENA]: '#4d3f85',
};

export interface MapMark {
  x: number;
  y: number;
  color: string;
  size?: number;
}

const CSS = `
.lm-map { position: fixed; right: calc(6px + var(--lm-sar, 0px)); top: calc(44px + var(--lm-sat, 0px));
  z-index: 66; pointer-events: none;
  padding: 3px; border-radius: 5px;
  background: linear-gradient(180deg, rgba(26,20,48,0.9), rgba(15,11,28,0.9));
  border: 1px solid rgba(154,140,214,0.45); }
.lm-map canvas { display: block; image-rendering: pixelated; border-radius: 3px; }
.lm-map-area { text-align: center; font: 10px/1.5 ui-monospace, monospace; color: #d8cfff; }
`;

export class Minimap {
  private box: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private areaLabel: HTMLDivElement;
  /** The whole world, one pixel per tile, painted once. */
  private atlas: HTMLCanvasElement;
  private blink = 0;
  /** Signature of the last frame drawn, so an unchanged minimap costs nothing (see `update`). */
  private lastSig = NaN;

  constructor(private readonly world: WorldSource, parent: HTMLElement = document.body) {
    injectStyle('lm-ui-map', CSS);
    this.atlas = document.createElement('canvas');
    this.atlas.width = world.widthTiles;
    this.atlas.height = world.heightTiles;
    this.paintAtlas();

    this.box = el('div');
    this.box.className = 'lm-map';
    this.canvas = document.createElement('canvas');
    this.canvas.width = VIEW_W * ZOOM;
    this.canvas.height = VIEW_H * ZOOM;
    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.areaLabel = el('div', {}, '');
    this.areaLabel.className = 'lm-map-area';
    this.box.append(this.canvas, this.areaLabel);
    parent.appendChild(this.box);
  }

  /**
   * The whole world painted once, at one pixel per tile.
   *
   * Exposed so the pause menu's full map can draw the same image scaled up rather than walking
   * 256x128 tiles again: the atlas is built at construction and never changes.
   */
  get worldAtlas(): HTMLCanvasElement {
    return this.atlas;
  }

  private paintAtlas(): void {
    const ctx = this.atlas.getContext('2d');
    if (!ctx) return;
    const w = this.world.widthTiles;
    const h = this.world.heightTiles;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = this.world.tileAt(x, y);
        let hex = COLORS[t] ?? '#000000';
        // props and walls read as "you cannot walk here"
        if (this.world.solidAt(x, y) && t !== T.WALL && t !== T.WATER) {
          hex = t === T.FOREST || t === T.GRASS || t === T.FLOWERS ? '#17402a' : '#5e4234';
        }
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }

  setVisible(v: boolean): void {
    this.box.style.display = v ? 'block' : 'none';
  }

  /** `heroX/Y` in world pixels; marks likewise. */
  update(dt: number, heroX: number, heroY: number, areaName: string, marks: readonly MapMark[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.blink += dt;
    const hx = heroX / TILE;
    const hy = heroY / TILE;
    const x0 = Math.max(0, Math.min(this.world.widthTiles - VIEW_W, Math.round(hx - VIEW_W / 2)));
    const y0 = Math.max(0, Math.min(this.world.heightTiles - VIEW_H, Math.round(hy - VIEW_H / 2)));

    /*
     * Redraw only when the picture would actually differ.
     *
     * Everything below — clearRect, a scaled drawImage of the atlas, the chunk grid, a dot per
     * marker — used to run on every single frame for a 96x64 image that changes when the hero
     * crosses a tile (a few times a second at most) or when the hero dot blinks (three times a
     * second). Canvas work on a phone is not free, and this was the HUD's largest per-frame cost.
     */
    const blinkPhase = Math.floor(this.blink * 3) % 2;
    let sig = (x0 * 1000 + y0) * 4 + blinkPhase + (Math.floor(hx) * 7 + Math.floor(hy) * 13) * 1e6;
    for (const m of marks) sig += m.x * 31 + m.y * 17 + (m.size ?? 2) * 5;
    if (sig === this.lastSig) {
      if (this.areaLabel.textContent !== areaName) this.areaLabel.textContent = areaName;
      return;
    }
    this.lastSig = sig;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.atlas, x0, y0, VIEW_W, VIEW_H, 0, 0, VIEW_W * ZOOM, VIEW_H * ZOOM);

    const dot = (tx: number, ty: number, color: string, size = 2): void => {
      const px = (tx - x0) * ZOOM;
      const py = (ty - y0) * ZOOM;
      if (px < 0 || py < 0 || px > this.canvas.width - size || py > this.canvas.height - size) return;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(px), Math.round(py), size, size);
    };
    for (const m of marks) dot(m.x / TILE, m.y / TILE, m.color, m.size ?? 2);
    // the hero blinks so it is never lost among the markers
    dot(hx - 0.5, hy - 1, blinkPhase === 0 ? '#ffffff' : '#ff5a5a', 3);

    // chunk grid, faint: it makes the scale readable
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(x0 / CHUNK_TILES) * CHUNK_TILES; gx < x0 + VIEW_W; gx += CHUNK_TILES) {
      ctx.beginPath();
      ctx.moveTo((gx - x0) * ZOOM, 0);
      ctx.lineTo((gx - x0) * ZOOM, this.canvas.height);
      ctx.stroke();
    }

    if (this.areaLabel.textContent !== areaName) this.areaLabel.textContent = areaName;
  }

  destroy(): void {
    this.box.remove();
  }
}
