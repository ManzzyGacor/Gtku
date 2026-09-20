/**
 * Streams world chunks in/out around the camera. Each chunk = one baked ground texture (1 image, several frames when it
 * contains water) + prop sprites. Baking is spread over frames with a time budget so crossing chunk borders never hitches.
 */
import Phaser from 'phaser';
import { CHUNK_PX, CHUNK_TILES } from '../config';
import { frameOf } from '../art/register';
import type { Sheet } from '../art/sheet';
import { WATER_FRAMES } from '../art/tiles';
import { bakeChunk, chunkIsAnimated } from '../world/bake';
import { PROPS, type PropPlacement, type PropType } from '../world/props';
import type { ChunkData, WorldSource } from '../world/source';
import { sheetToCanvas } from '../art/register';
import { hashf } from '../core/rng';

export interface PropSprite {
  placement: PropPlacement;
  sprite: Phaser.GameObjects.Image;
  frames: number;
  fps: number;
  phase: number;
  lastFrame: number;
  /** Seconds left of being pushed aside by something walking through (tall grass). */
  bend: number;
}

export interface LoadedChunk {
  cx: number;
  cy: number;
  data: ChunkData;
  ground: Phaser.GameObjects.Image;
  texKeys: string[];
  animated: boolean;
  props: PropSprite[];
}

type Task = { kind: 'load'; cx: number; cy: number; pri: number } | { kind: 'frame'; cx: number; cy: number; frame: number; pri: number };

const keyOf = (cx: number, cy: number): number => cy * 1000 + cx;
const texKey = (cx: number, cy: number, f: number): string => `chunk:${cx}:${cy}:${f}`;

export class ChunkManager {
  readonly loaded = new Map<number, LoadedChunk>();
  private queue: Task[] = [];
  private animFrame = 0;
  /** The Great Lantern is dark until the quest is done. */
  lanternLit = false;
  onLoad: (c: LoadedChunk) => void = () => undefined;
  onUnload: (c: LoadedChunk) => void = () => undefined;
  private readonly tileSheet: Sheet;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: WorldSource,
    tileSheet: Sheet,
  ) {
    this.tileSheet = tileSheet;
  }

  /** Make sure the chunks around (x, y) exist *now* (used for the first frame / teleports). */
  preload(view: Phaser.Geom.Rectangle, marginChunks = 1): void {
    this.desired(view, marginChunks).forEach(({ cx, cy }) => {
      if (!this.loaded.has(keyOf(cx, cy))) this.loadChunk(cx, cy);
    });
    this.queue = this.queue.filter((t) => t.kind === 'frame');
  }

  private desired(view: Phaser.Geom.Rectangle, margin: number): { cx: number; cy: number }[] {
    const x0 = Math.max(0, Math.floor(view.x / CHUNK_PX) - margin);
    const y0 = Math.max(0, Math.floor(view.y / CHUNK_PX) - margin);
    const x1 = Math.min(this.world.widthTiles / CHUNK_TILES - 1, Math.floor(view.right / CHUNK_PX) + margin);
    const y1 = Math.min(this.world.heightTiles / CHUNK_TILES - 1, Math.floor(view.bottom / CHUNK_PX) + margin);
    const out: { cx: number; cy: number }[] = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) out.push({ cx, cy });
    return out;
  }

  /** Queue loads for chunks near the view and drop far ones. Call once per frame. */
  update(view: Phaser.Geom.Rectangle): void {
    const want = this.desired(view, 1);
    const wantSet = new Set(want.map((c) => keyOf(c.cx, c.cy)));
    const centerX = view.centerX / CHUNK_PX;
    const centerY = view.centerY / CHUNK_PX;
    for (const { cx, cy } of want) {
      const k = keyOf(cx, cy);
      if (this.loaded.has(k)) continue;
      if (this.queue.some((t) => t.kind === 'load' && t.cx === cx && t.cy === cy)) continue;
      this.queue.push({ kind: 'load', cx, cy, pri: Math.hypot(cx + 0.5 - centerX, cy + 0.5 - centerY) });
    }
    // unload chunks outside a 2-chunk margin (hysteresis avoids thrash at borders)
    const keep = new Set(this.desired(view, 2).map((c) => keyOf(c.cx, c.cy)));
    for (const [k, c] of this.loaded) if (!keep.has(k)) this.unload(c);
    this.queue = this.queue.filter((t) => t.kind === 'frame' ? this.loaded.has(keyOf(t.cx, t.cy)) : wantSet.has(keyOf(t.cx, t.cy)));
  }

  /** Process queued work within a time budget (ms). */
  step(budgetMs = 6): void {
    const t0 = performance.now();
    this.queue.sort((a, b) => a.pri - b.pri);
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const t = this.queue.shift()!;
      if (t.kind === 'load') this.loadChunk(t.cx, t.cy);
      else this.bakeFrame(t.cx, t.cy, t.frame);
    }
  }

  private makeTexture(cx: number, cy: number, f: number): string {
    const key = texKey(cx, cy, f);
    const baked = bakeChunk(this.world, this.tileSheet, cx, cy, f);
    const canvas = sheetToCanvas({ key, pixmap: baked, frames: {} });
    const tex = this.scene.textures.addCanvas(key, canvas);
    tex?.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return key;
  }

  private bakeFrame(cx: number, cy: number, frame: number): void {
    const c = this.loaded.get(keyOf(cx, cy));
    if (!c || c.texKeys[frame]) return;
    c.texKeys[frame] = this.makeTexture(cx, cy, frame);
  }

  loadChunk(cx: number, cy: number): LoadedChunk {
    const data = this.world.chunk(cx, cy);
    const animated = chunkIsAnimated(this.world, cx, cy);
    const key0 = this.makeTexture(cx, cy, 0);
    const ground = this.scene.add.image(cx * CHUNK_PX, cy * CHUNK_PX, key0).setOrigin(0, 0).setDepth(0);
    const chunk: LoadedChunk = { cx, cy, data, ground, texKeys: [key0], animated, props: [], };
    if (animated) for (let f = 1; f < WATER_FRAMES; f++) this.queue.push({ kind: 'frame', cx, cy, frame: f, pri: 100 + f });

    for (const p of data.props) {
      const def = PROPS[p.type];
      if (def.special) continue;
      chunk.props.push(this.makeProp(p));
    }
    this.loaded.set(keyOf(cx, cy), chunk);
    this.onLoad(chunk);
    return chunk;
  }

  private makeProp(p: PropPlacement): PropSprite {
    const def = PROPS[p.type];
    const frames = def.frames ?? 1;
    const name = this.frameName(p.type, 0);
    const f = frameOf('props', name);
    const sprite = this.scene.add.image(p.x, p.y, 'props', name).setOrigin((f.ax ?? f.w / 2) / f.w, (f.ay ?? f.h) / f.h);
    if (p.flip) sprite.setFlipX(true);
    sprite.setDepth(def.flat ? 1 : p.y);
    return { placement: p, sprite, frames, fps: def.fps ?? 0, phase: hashf(p.x, p.y, 3) * 10, lastFrame: 0, bend: 0 };
  }

  setLanternLit(v: boolean): void {
    this.lanternLit = v;
    for (const c of this.loaded.values())
      for (const ps of c.props) if (ps.placement.type === 'great_lantern') ps.sprite.setFrame(this.frameName('great_lantern', ps.lastFrame));
  }

  frameName(type: PropType, i: number): string {
    if (type === 'great_lantern' && !this.lanternLit) return 'great_lantern_off';
    return (PROPS[type].frames ?? 1) > 1 ? `${type}_${i}` : type;
  }

  /** Advance prop animations + water frames. `time` in seconds. */
  animate(time: number, dt = 0): void {
    for (const c of this.loaded.values()) {
      for (const ps of c.props) {
        if (ps.frames <= 1) continue;
        let i = Math.floor(time * ps.fps + ps.phase) % ps.frames;
        if (ps.bend > 0) {
          ps.bend -= dt;
          i = ps.frames - 1;
        }
        if (i !== ps.lastFrame) {
          ps.lastFrame = i;
          ps.sprite.setFrame(this.frameName(ps.placement.type, i));
        }
      }
    }
    const wf = Math.floor(time * 3) % WATER_FRAMES;
    if (wf !== this.animFrame) {
      this.animFrame = wf;
      for (const c of this.loaded.values()) {
        if (!c.animated) continue;
        const k = c.texKeys[wf] ?? c.texKeys[c.texKeys.length - 1];
        if (k && c.ground.texture.key !== k) c.ground.setTexture(k);
      }
    }
  }

  /** Push grass aside around (x, y). Returns how many blades newly started bending. */
  disturb(x: number, y: number, r: number): number {
    let fresh = 0;
    const cx = Math.floor(x / CHUNK_PX);
    const cy = Math.floor(y / CHUNK_PX);
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const c = this.loaded.get(keyOf(cx + ox, cy + oy));
        if (!c) continue;
        for (const ps of c.props) {
          if (ps.placement.type !== 'tallgrass') continue;
          if (Math.abs(ps.placement.x - x) > r || Math.abs(ps.placement.y - y) > r) continue;
          if (ps.bend <= 0) fresh++;
          ps.bend = 0.4;
        }
      }
    return fresh;
  }

  /** A random on-screen prop of one of the given types, or null. */
  randomProp(view: Phaser.Geom.Rectangle, types: string[]): PropPlacement | null {
    const chunks = [...this.loaded.values()];
    if (!chunks.length) return null;
    for (let tries = 0; tries < 4; tries++) {
      const c = chunks[Math.floor(Math.random() * chunks.length)];
      if (!c.props.length) continue;
      const p = c.props[Math.floor(Math.random() * c.props.length)].placement;
      if (types.includes(p.type) && view.contains(p.x, p.y - 20)) return p;
    }
    return null;
  }

  private unload(c: LoadedChunk): void {
    this.onUnload(c);
    c.ground.destroy();
    for (const k of c.texKeys) if (k) this.scene.textures.remove(k);
    for (const p of c.props) p.sprite.destroy();
    this.loaded.delete(keyOf(c.cx, c.cy));
  }

  destroy(): void {
    for (const c of [...this.loaded.values()]) this.unload(c);
    this.queue = [];
  }
}
