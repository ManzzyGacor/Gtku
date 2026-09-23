/**
 * Streams the 3D world around the hero (docs/OVERHAUL.md, Batch 2).
 *
 * Performance rules from the plan are the shape of this file:
 *   • **ground** = one textured mesh per chunk, baked with the very same `bakeChunk` the 2D renderer
 *     uses, so the ground art in 3D *is* the ground art in 2D. Baking is budgeted per frame so
 *     crossing a chunk border never hitches;
 *   • **props and walls** = shared `InstancePool`s keyed by (shape, texture, lit). However many
 *     chunks are loaded, the scenery still draws in a handful of calls;
 *   • **dynamic lights** = a fixed pool that follows the camera, so the light count depends on the
 *     preset and never on how much scenery is in view;
 *   • chunks load and unload by distance from the hero, with one chunk of hysteresis so walking
 *     along a border does not thrash.
 */
import * as THREE from 'three';
import { CHUNK_PX, CHUNK_TILES } from '../config';
import { bakeChunk } from '../art/bake';
import { buildGreyboxTextures, type GreyboxTexture } from '../art/greybox';
import type { Sheet } from '../art/sheet';
import { ambientAt, blendAmbient, nightAmount } from '../core/systems/daynight';
import { AREAS } from '../core/world/areas';
import type { WorldSource } from '../core/world/source';
import { InstancePool } from './InstancePool';
import { FADE_LIFT, FADE_RADIUS } from './occlusion';
import { pixmapTexture } from './textures';
import { groupKeyOf, planChunk, u, type ChunkPlan, type PointLightPlan, type ShapeKind } from './worldPlan';

/**
 * Per-instance UV scaling. Without it a 16x16 texture stretches across whatever face it lands on
 * and every object ends up with differently sized pixels. `aSize` carries the instance's world
 * size; the vertex shader picks the two components facing the fragment's normal.
 */
const UV_SCALE_CHUNK = /* glsl */ `
#ifdef USE_MAP
  vec3 faceNormal = abs(normal);
  vec2 uvScale = faceNormal.y > 0.5
    ? vec2(aSize.x, aSize.z)
    : (faceNormal.x > 0.5 ? vec2(aSize.z, aSize.y) : vec2(aSize.x, aSize.y));
  vMapUv *= uvScale;
#endif
`;

/**
 * Cut a hole in whatever stands between the camera and the hero.
 *
 * A fixed 3/4 camera means roofs, tree crowns and cave walls regularly park themselves in front of
 * the player. Rather than raycasting and fading whole objects on the CPU, each fragment asks: am I
 * nearer the camera than the hero, and do I sit within an ellipse around the hero on screen? If so
 * it dissolves away. The dissolve is an ordered 4x4 dither plus `discard`, not alpha blending —
 * that keeps the pixel-art look, needs no transparency sorting, and leaves the depth buffer clean
 * so the outline pass still draws a proper silhouette.
 *
 * `vOccView` is the fragment's view-space position; under an orthographic camera its xy *is* the
 * screen position, which is what makes the test this cheap. The same rule lives as plain
 * arithmetic in `occlusion.ts`, where it can be unit-tested.
 */
const OCCLUSION_PARS = /* glsl */ `
varying vec3 vOccView;
uniform vec3 uHeroView;
uniform vec2 uFadeRadius;
uniform float uFadeOn;

// Bayer recursion M2n = [[4*Mn, 4*Mn+2], [4*Mn+3, 4*Mn+1]] with M2 = [[0,2],[3,1]],
// as arithmetic because GLSL ES 1.0 has no bit operations or dynamic array indexing.
float lmBayer2(float x, float y) {
  float d = mod(x + y, 2.0);
  return d * (2.0 + y) + (1.0 - d) * x;
}

float lmDither(vec2 p) {
  vec2 lo = mod(p, 2.0);
  vec2 hi = mod(floor(p * 0.5), 2.0);
  return (4.0 * lmBayer2(lo.x, lo.y) + lmBayer2(hi.x, hi.y) + 0.5) / 16.0;
}
`;

const OCCLUSION_FRAGMENT = /* glsl */ `
  if (uFadeOn > 0.5 && vOccView.z > uHeroView.z + 0.2) {
    vec2 delta = (vOccView.xy - uHeroView.xy) / uFadeRadius;
    float cover = 1.0 - clamp(dot(delta, delta), 0.0, 1.0);
    if (cover > 0.01 && cover > lmDither(floor(gl_FragCoord.xy))) discard;
  }
`;

export interface OcclusionUniforms {
  uHeroView: { value: THREE.Vector3 };
  uFadeRadius: { value: THREE.Vector2 };
  uFadeOn: { value: number };
}

function patchInstanceMaterial(material: THREE.Material, occlusion: OcclusionUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec3 aSize;\nvarying vec3 vOccView;\n${shader.vertexShader}`
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${UV_SCALE_CHUNK}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vOccView = mvPosition.xyz;');
    shader.fragmentShader = `${OCCLUSION_PARS}${shader.fragmentShader}`.replace(
      'void main() {',
      `void main() {\n${OCCLUSION_FRAGMENT}`,
    );
    // Shared uniform objects: updating `.value` once reaches every patched material.
    shader.uniforms.uHeroView = occlusion.uHeroView;
    shader.uniforms.uFadeRadius = occlusion.uFadeRadius;
    shader.uniforms.uFadeOn = occlusion.uFadeOn;
  };
  // Instances differing only in per-instance data still share one program.
  material.customProgramCacheKey = () => 'lm-instance';
}

const keyOf = (cx: number, cy: number): number => cy * 1000 + cx;

interface LoadedChunk3D {
  cx: number;
  cy: number;
  ground: THREE.Mesh;
  texture: THREE.Texture;
  material: THREE.Material;
  lights: PointLightPlan[];
}

export class World3D {
  readonly group = new THREE.Group();
  private textures: Partial<Record<GreyboxTexture, THREE.Texture>> = {};
  private pools = new Map<string, InstancePool>();
  private poolGeometries: THREE.BufferGeometry[] = [];
  private poolMaterials: THREE.Material[] = [];
  private groundGeometry: THREE.PlaneGeometry;

  private loaded = new Map<number, LoadedChunk3D>();
  private planCache = new Map<number, ChunkPlan>();
  private queue: { cx: number; cy: number; pri: number }[] = [];
  private activeLights: PointLightPlan[] = [];
  private radiusChunks = 2;
  private shadowsOn = true;

  // lighting
  private hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a2f5e, 1);
  private sun = new THREE.DirectionalLight(0xfff2c0, 1.1);
  private pool: THREE.PointLight[] = [];

  private readonly occlusion: OcclusionUniforms = {
    uHeroView: { value: new THREE.Vector3(0, 0, -1e9) },
    uFadeRadius: { value: new THREE.Vector2(FADE_RADIUS.x, FADE_RADIUS.y) },
    uFadeOn: { value: 1 },
  };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: WorldSource,
    private readonly tileSheet: Sheet,
  ) {
    scene.add(this.group);
    this.sun.position.set(-0.4, 1, 0.3).multiplyScalar(40);
    scene.add(this.hemi, this.sun, this.sun.target);

    const pix = buildGreyboxTextures();
    for (const [name, pm] of Object.entries(pix)) this.textures[name as GreyboxTexture] = pixmapTexture(pm, { tile: true });

    this.groundGeometry = new THREE.PlaneGeometry(CHUNK_TILES, CHUNK_TILES);
    this.groundGeometry.rotateX(-Math.PI / 2);
  }

  // ───────────────────────── settings ─────────────────────────

  /** How many chunks around the hero stay loaded. */
  setRenderDistance(chunks: number): void {
    this.radiusChunks = Math.max(1, Math.round(chunks));
  }

  /** How many dynamic point lights the current preset allows. */
  setLightBudget(n: number): void {
    while (this.pool.length > n) {
      const l = this.pool.pop()!;
      this.scene.remove(l);
      l.dispose();
    }
    while (this.pool.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 1.6);
      l.visible = false;
      this.scene.add(l);
      this.pool.push(l);
    }
  }

  setShadows(mode: 'off' | 'low' | 'high'): void {
    const on = mode !== 'off';
    this.shadowsOn = on;
    this.sun.castShadow = on;
    if (on) {
      const size = mode === 'high' ? 1024 : 512;
      this.sun.shadow.mapSize.set(size, size);
      const extent = 28;
      const cam = this.sun.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = 1;
      cam.far = 120;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0012;
    }
    for (const p of this.pools.values()) p.setShadows(on);
    for (const c of this.loaded.values()) c.ground.receiveShadow = on;
  }

  // ───────────────────────── streaming ─────────────────────────

  private chunkPlan(cx: number, cy: number): ChunkPlan {
    const key = keyOf(cx, cy);
    let plan = this.planCache.get(key);
    if (!plan) {
      plan = planChunk(this.world, cx, cy);
      this.planCache.set(key, plan);
    }
    return plan;
  }

  private chunksWide(): number {
    return Math.ceil(this.world.widthTiles / CHUNK_TILES);
  }

  private chunksHigh(): number {
    return Math.ceil(this.world.heightTiles / CHUNK_TILES);
  }

  /** Chunk coordinates wanted around a world position, nearest first. */
  private desired(focusX: number, focusZ: number, margin: number): { cx: number; cy: number; pri: number }[] {
    const hx = focusX / CHUNK_TILES;
    const hy = focusZ / CHUNK_TILES;
    const r = this.radiusChunks + margin;
    const out: { cx: number; cy: number; pri: number }[] = [];
    for (let cy = Math.floor(hy - r); cy <= Math.ceil(hy + r); cy++)
      for (let cx = Math.floor(hx - r); cx <= Math.ceil(hx + r); cx++) {
        if (cx < 0 || cy < 0 || cx >= this.chunksWide() || cy >= this.chunksHigh()) continue;
        const pri = Math.hypot(cx + 0.5 - hx, cy + 0.5 - hy);
        if (pri > r + 0.75) continue;
        out.push({ cx, cy, pri });
      }
    out.sort((a, b) => a.pri - b.pri);
    return out;
  }

  /**
   * Queue the chunks near `focus`, drop the far ones. Loading itself is budgeted by `step`.
   * Unloading uses one chunk of hysteresis so walking along a border does not thrash.
   */
  private stream(focusX: number, focusZ: number): void {
    const want = this.desired(focusX, focusZ, 0);
    const keep = new Set(this.desired(focusX, focusZ, 1).map((c) => keyOf(c.cx, c.cy)));
    let changed = false;
    for (const [key, c] of this.loaded) {
      if (keep.has(key)) continue;
      this.unloadChunk(c);
      changed = true;
    }
    this.queue = want.filter((c) => !this.loaded.has(keyOf(c.cx, c.cy)));
    if (changed) this.rebuildLightList();
  }

  /** Bake at most `budget` queued chunks. Baking a 256x256 ground texture is the expensive part. */
  step(budget = 1): void {
    for (let i = 0; i < budget && this.queue.length; i++) {
      const t = this.queue.shift()!;
      if (!this.loaded.has(keyOf(t.cx, t.cy))) this.loadChunk(t.cx, t.cy);
    }
  }

  /** Load everything within range right now (first frame, teleports). */
  preload(focusX: number, focusZ: number): void {
    this.stream(focusX, focusZ);
    this.step(this.queue.length);
  }

  private loadChunk(cx: number, cy: number): void {
    const plan = this.chunkPlan(cx, cy);
    const pm = bakeChunk(this.world, this.tileSheet, cx, cy, 0);
    // Pixmap row 0 is north; a flat plane has v = 1 there, so the rows are flipped on upload.
    const texture = pixmapTexture(pm, { flipRows: true });
    const material = new THREE.MeshLambertMaterial({ map: texture });
    const ground = new THREE.Mesh(this.groundGeometry, material);
    ground.position.set(u(cx * CHUNK_PX) + CHUNK_TILES / 2, 0, u(cy * CHUNK_PX) + CHUNK_TILES / 2);
    ground.receiveShadow = this.shadowsOn;
    this.group.add(ground);

    const key = keyOf(cx, cy);
    for (const [groupKey, shapes] of this.byGroup(plan)) this.poolFor(groupKey, shapes[0]).addChunk(key, shapes);
    this.loaded.set(key, { cx, cy, ground, texture, material, lights: plan.lights });
    this.rebuildLightList();
  }

  private byGroup(plan: ChunkPlan): Map<string, typeof plan.shapes> {
    const out = new Map<string, typeof plan.shapes>();
    for (const s of plan.shapes) {
      const k = groupKeyOf(s);
      const list = out.get(k);
      if (list) list.push(s);
      else out.set(k, [s]);
    }
    return out;
  }

  private poolFor(groupKey: string, sample: { kind: ShapeKind; texture: GreyboxTexture; emissive?: boolean }): InstancePool {
    let pool = this.pools.get(groupKey);
    if (pool) return pool;
    const geo = this.shapeGeometry(sample.kind);
    this.poolGeometries.push(geo);
    const map = this.textures[sample.texture]!;
    const mat = sample.emissive ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshLambertMaterial({ map });
    patchInstanceMaterial(mat, this.occlusion);
    this.poolMaterials.push(mat);
    // Room for a generous chunk neighbourhood; the pool doubles itself if a dense area needs more.
    pool = new InstancePool(this.group, geo, mat, 2048, !sample.emissive);
    this.pools.set(groupKey, pool);
    return pool;
  }

  private shapeGeometry(kind: ShapeKind): THREE.BufferGeometry {
    if (kind === 'prism') {
      // A 4-sided cone is a square pyramid: roofs and tree crowns.
      const g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      return g;
    }
    return new THREE.BoxGeometry(1, 1, 1);
  }

  private unloadChunk(c: LoadedChunk3D): void {
    const key = keyOf(c.cx, c.cy);
    for (const pool of this.pools.values()) pool.removeChunk(key);
    this.group.remove(c.ground);
    c.material.dispose();
    c.texture.dispose();
    this.loaded.delete(key);
  }

  private rebuildLightList(): void {
    this.activeLights = [];
    for (const c of this.loaded.values()) this.activeLights.push(...c.lights);
  }

  // ───────────────────────── per frame ─────────────────────────

  /**
   * Tell the shaders where the hero is, in view space, so anything in front of them dissolves.
   * Called once per frame; the cost is one matrix transform, not a raycast.
   */
  setHeroOcclusion(heroWorld: THREE.Vector3, camera: THREE.Camera, enabled = true): void {
    this.occlusion.uFadeOn.value = enabled ? 1 : 0;
    if (!enabled) return;
    // aim at the hero's middle, not their feet
    this.occlusion.uHeroView.value.set(heroWorld.x, heroWorld.y + FADE_LIFT, heroWorld.z).applyMatrix4(camera.matrixWorldInverse);
  }

  /** Stream, then colour the world for the time of day and move the light pool. */
  update(dayTime: number, focus: THREE.Vector3, cave = 0, loadBudget = 1): void {
    this.stream(focus.x, focus.z);
    this.step(loadBudget);

    const amb = blendAmbient(ambientAt(dayTime), AREAS.cave.ambient, cave);
    // Inside the cave the sun is irrelevant: torches and crystals do the lighting.
    const night = Math.max(nightAmount(dayTime), cave);
    this.hemi.color.setRGB(amb[0], amb[1], amb[2]);
    this.hemi.intensity = 0.55 + (1 - night) * 0.5;
    this.sun.color.setRGB(Math.min(1, amb[0] * 1.15), amb[1], amb[2] * 0.95);
    this.sun.intensity = (1 - night) * 1.2;
    this.sun.position.copy(focus).add(new THREE.Vector3(-16, 40, 12));
    this.sun.target.position.copy(focus);

    if (!this.pool.length) return;
    const active = this.activeLights
      .filter((l) => !l.nightOnly || night > 0.15)
      .map((l) => ({ l, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length);
    this.pool.forEach((p, i) => {
      const hit = active[i];
      if (!hit) {
        p.visible = false;
        return;
      }
      const l = hit.l;
      p.visible = true;
      p.position.set(l.x, l.y, l.z);
      p.color.setHex(l.color);
      p.distance = l.radius;
      p.intensity = l.intensity * (l.nightOnly ? Math.min(1, night * 2) : 1) * 2.2;
    });
  }

  /** For the report. */
  stats(): { chunks: number; queued: number; instances: number; draws: number; lights: number; pools: number } {
    let instances = 0;
    for (const p of this.pools.values()) instances += p.liveCount;
    return {
      chunks: this.loaded.size,
      queued: this.queue.length,
      instances,
      draws: this.loaded.size + this.pools.size,
      lights: this.pool.length,
      pools: this.pools.size,
    };
  }

  dispose(): void {
    for (const c of [...this.loaded.values()]) this.unloadChunk(c);
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
    for (const g of this.poolGeometries) g.dispose();
    for (const m of this.poolMaterials) m.dispose();
    this.poolGeometries = [];
    this.poolMaterials = [];
    this.groundGeometry.dispose();
    for (const t of Object.values(this.textures)) t?.dispose();
    this.textures = {};
    this.planCache.clear();
    this.scene.remove(this.group, this.hemi, this.sun, this.sun.target);
    this.setLightBudget(0);
  }
}
