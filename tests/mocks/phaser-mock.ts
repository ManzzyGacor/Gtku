/**
 * A tiny fake of the Phaser API surface this game uses. Game objects are chainable proxies that remember the state we set
 * (position, frame, alpha, …) and count live instances so the smoke test can detect leaks. Nothing is rendered.
 */
import { EventEmitter } from 'node:events';

export const live = { count: 0, created: 0, destroyed: 0, byType: new Map<string, number>() };

type Bag = Record<string, unknown>;

/** Fail loudly when code references a frame that does not exist in a registered sheet. */
export function checkFrame(key: string, frame: string | undefined): void {
  if (!frame || !key) return;
  const tex = textures.get(key);
  if (!tex) return; // e.g. chunk textures registered later
  const names = Object.keys(tex.frames);
  if (names.length > 1 && !(frame in tex.frames)) throw new Error(`Missing frame "${frame}" in texture "${key}"`);
}

export function mockGO(type: string, init: Bag = {}): any {
  const store: Bag = {
    x: 0, y: 0, alpha: 1, scaleX: 1, scaleY: 1, visible: true, depth: 0, rotation: 0, angle: 0, width: 0, height: 0,
    active: true, originX: 0.5, originY: 0.5, flipX: false, flipY: false, _destroyed: false, text: '', ...init,
  };
  store.texture = { key: String(init.textureKey ?? '') };
  store.frame = { name: String(init.frameName ?? '') };
  live.count++;
  live.created++;
  live.byType.set(type, (live.byType.get(type) ?? 0) + 1);
  const chain = (): any => proxy;
  const setters: Record<string, (...a: any[]) => void> = {
    setPosition: (x: number, y?: number) => { store.x = x; store.y = y ?? x; },
    setDepth: (d: number) => { store.depth = d; },
    setAlpha: (a: number) => { store.alpha = a; },
    setScale: (sx: number, sy?: number) => { store.scaleX = sx; store.scaleY = sy ?? sx; store.scale = sx; },
    setFrame: (f: string) => { checkFrame(String((store.texture as Bag).key), f); (store.frame as Bag).name = f; },
    setTexture: (k: string, f?: string) => { if (f) checkFrame(k, f); (store.texture as Bag).key = k; (store.frame as Bag).name = f ?? ''; },
    setVisible: (v: boolean) => { store.visible = v; },
    setOrigin: (x: number, y?: number) => { store.originX = x; store.originY = y ?? x; },
    setRotation: (r: number) => { store.rotation = r; },
    setFlipX: (v: boolean) => { store.flipX = v; },
    setFlipY: (v: boolean) => { store.flipY = v; },
    setText: (t: string) => { store.text = t; },
    setSize: (w: number, h: number) => { store.width = w; store.height = h; },
    setDisplaySize: (w: number, h: number) => { store.width = w; store.height = h; },
  };
  const handler: ProxyHandler<Bag> = {
    get(_t, k: string) {
      if (k === 'then') return undefined;
      if (k === 'destroy') {
        return () => {
          if (!store._destroyed) {
            store._destroyed = true;
            live.count--;
            live.destroyed++;
            live.byType.set(type, (live.byType.get(type) ?? 1) - 1);
          }
        };
      }
      if (k in setters) return (...a: any[]) => { setters[k](...a); return proxy; };
      if (k in store) return store[k];
      if (k === 'explode') return chain;
      return chain;
    },
    set(_t, k: string, v) {
      store[k] = v;
      return true;
    },
  };
  const proxy: any = new Proxy(store, handler);
  return proxy;
}

class Rect {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
  get right() { return this.x + this.width; }
  get bottom() { return this.y + this.height; }
  get centerX() { return this.x + this.width / 2; }
  get centerY() { return this.y + this.height / 2; }
  contains(px: number, py: number) { return px >= this.x && px <= this.right && py >= this.y && py <= this.bottom; }
}

function mockCamera(scale: { width: number; height: number }): any {
  const cam = mockGO('camera', { width: scale.width, height: scale.height, scrollX: 0, scrollY: 0 });
  cam.setScroll = (x: number, y: number) => { cam.scrollX = x; cam.scrollY = y; return cam; };
  return cam;
}

const textures = new Map<string, any>();
function mockTexture(key: string, source: any): any {
  const frames: Record<string, any> = { __BASE: { name: '__BASE' } };
  const tex: any = {
    key, frames, canvas: source, firstFrame: '__BASE',
    add(name: string) { frames[name] = { name }; return frames[name]; },
    setFilter() {}, getSourceImage: () => source, getCanvas: () => source, getContext: () => source.getContext('2d'),
    setSize(w: number, h: number) { if (source) { source.width = w; source.height = h; } return tex; },
    refresh() { return tex; }, has: (n: string) => n in frames, get: (n: string) => frames[n] ?? frames.__BASE,
  };
  textures.set(key, tex);
  return tex;
}

export class Scene {
  key: string;
  events = new EventEmitter();
  registry = new Map<string, unknown>() as any;
  scale: any;
  cameras: any;
  add: any;
  make: any;
  textures: any;
  cache: any;
  tweens: any;
  time: any;
  input: any;
  load: any;
  renderer = { type: 2 };
  scene: any;
  sys: any = {};
  constructor(key: string) {
    this.key = key;
    this.registry.set = (k: string, v: unknown) => Map.prototype.set.call(this.registry, k, v);
    this.scale = { width: 600, height: 270, on() {}, off() {}, isFullscreen: false, startFullscreen() {}, stopFullscreen() {} };
    this.cameras = { main: mockCamera(this.scale) };
    const goFactory = (type: string) => (...a: any[]) => {
      const init: Bag = { x: Number(a[0]) || 0, y: Number(a[1]) || 0 };
      if (type === 'image' || type === 'sprite') { init.textureKey = a[2]; init.frameName = a[3]; checkFrame(String(a[2] ?? ''), a[3]); }
      if (type === 'particles') { const f = (a[3] as any)?.frame; for (const n of Array.isArray(f) ? f : f ? [f] : []) checkFrame(String(a[2]), n); }
      if (type === 'bitmapText') init.text = a[3] ?? '';
      if (type === 'rectangle') { init.width = Number(a[2]) || 0; init.height = Number(a[3]) || 0; }
      return mockGO(type, init);
    };
    this.add = new Proxy({}, { get: (_t, k: string) => (k === 'container' ? (x: number, y: number) => mockGO('container', { x, y }) : goFactory(k)) });
    this.textures = {
      exists: (k: string) => textures.has(k),
      get: (k: string) => textures.get(k) ?? mockTexture(k, null),
      remove: (k: string) => { textures.delete(k); },
      addCanvas: (k: string, c: any) => mockTexture(k, c),
      createCanvas: (k: string, w: number, h: number) => mockTexture(k, makeCanvas(w, h)),
    };
    this.cache = { bitmapFont: { add() {} }, json: { get: () => ({ sheets: [] }) } };
    this.tweens = { add: (cfg: any) => { cfg.onComplete?.(); return {}; } };
    this.time = { now: 0, delayedCall: (_ms: number, fn: () => void) => fn() };
    this.input = { on() {}, keyboard: { on() {} }, addPointer() {} };
    this.load = { json() {}, image() {}, once() {}, start() {} };
    this.scene = {
      launch: (k: string) => { launched.add(k); },
      bringToTop() {},
      isActive: (k: string) => launched.has(k),
      get: (k: string) => sceneInstances.get(k),
      start() {},
    };
  }
}

export const launched = new Set<string>();
export const sceneInstances = new Map<string, unknown>();

function makeCtx(): any {
  const grad = { addColorStop() {} };
  return new Proxy({}, { get: (_t, k: string) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => grad : () => undefined), set: () => true });
}

export function makeCanvas(w = 1, h = 1): any {
  return { width: w, height: h, getContext: () => makeCtx() };
}

const Phaser: any = {
  Scene,
  AUTO: 0,
  WEBGL: 2,
  CANVAS: 1,
  BlendModes: { NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 },
  TintModes: { MULTIPLY: 0, FILL: 1 },
  Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } },
  Scale: { Events: { RESIZE: 'resize' }, NONE: 0 },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  Loader: { Events: { COMPLETE: 'complete' } },
  Cameras: { Scene2D: { Events: { FADE_OUT_COMPLETE: 'camerafadeoutcomplete' } } },
  Geom: { Rectangle: Rect },
  Math: { Clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)) },
  Actions: { AddEffectBloom: () => [{ parallelFilters: { setActive() {} } }] },
};
export default Phaser;
