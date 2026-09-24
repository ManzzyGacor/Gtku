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
import { bakeChunk, bakeWaterMask, chunkHasWater } from '../art/bake';
import { buildGreyboxTextures, type GreyboxTexture } from '../art/greybox';
import type { Sheet } from '../art/sheet';
import { ambientAt, blendAmbient, nightAmount, sunDirection } from '../core/systems/daynight';
import { AREAS } from '../core/world/areas';
import type { WorldSource } from '../core/world/source';
import { InstancePool } from './InstancePool';
import { FADE_LIFT, FADE_RADIUS } from './occlusion';
import { pixmapTexture } from './textures';
import { makeWaterUniforms, WaterSurface, type WaterUniforms } from './WaterSurface';
import { bakeLightMap, lightMapHasLight } from './lightmap';
import { chunkLights, groupKeyOf, planChunk, u, VEGETATION, type ChunkPlan, type PointLightPlan, type ShapeKind } from './worldPlan';

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
 * Wind, in the vertex shader (docs/OVERHAUL.md §4 "lingkungan hidup": animated with instancing,
 * never a JS loop per blade).
 *
 * Every instance bends by a two-frequency gust whose phase comes from its own world position, so a
 * field of grass never moves in unison. The bend is weighted by height inside the shape — the base
 * stays planted — and divided by the instance's size so a big tree crown and a tuft of grass lean
 * by the same number of world units rather than by the same fraction of themselves.
 *
 * The hero pushes vegetation aside with the same formula, which is why walking through long grass
 * parts it: nothing about that is simulated on the CPU.
 */
const SWAY_VERTEX = /* glsl */ `
#ifdef LM_SWAY
  {
    vec3 lmInstPos = instanceMatrix[3].xyz;
    float lmHeight = clamp(position.y + 0.5, 0.0, 1.0);
    float lmPhase = lmInstPos.x * 0.33 + lmInstPos.z * 0.21;
    float lmGust = sin(uTime * 1.3 + lmPhase) * 0.6 + sin(uTime * 2.9 + lmPhase * 1.7) * 0.4;
    vec2 lmBend = uWind * lmGust;
    vec2 lmAway = lmInstPos.xz - uHeroPos;
    float lmPush = 1.0 - smoothstep(0.0, uPushRadius, length(lmAway));
    lmBend += normalize(lmAway + vec2(0.0001, 0.0)) * lmPush * 0.6;
    lmBend *= lmHeight * uSway;
    transformed.x += lmBend.x / max(aSize.x, 0.001);
    transformed.z += lmBend.y / max(aSize.z, 0.001);
  }
#endif
`;

/** Lantern glass and crystals breathe a little, on their own phase. */
const PULSE_FRAGMENT = /* glsl */ `
#ifdef LM_PULSE
  diffuseColor.rgb *= 0.86 + 0.14 * sin(uTime * 5.5 + vOccView.x * 2.3 + vOccView.y * 1.7);
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
varying float vFade;
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
  float lmNoise = lmDither(floor(gl_FragCoord.xy));
  // A chunk that has just streamed in dissolves up instead of popping into existence.
  if (vFade < 0.999 && (1.0 - vFade) > lmNoise) discard;
  if (uFadeOn > 0.5 && vOccView.z > uHeroView.z + 0.2) {
    vec2 delta = (vOccView.xy - uHeroView.xy) / uFadeRadius;
    float cover = 1.0 - clamp(dot(delta, delta), 0.0, 1.0);
    if (cover > 0.01 && cover > lmNoise) discard;
  }
`;

export interface OcclusionUniforms {
  uHeroView: { value: THREE.Vector3 };
  uFadeRadius: { value: THREE.Vector2 };
  uFadeOn: { value: number };
}

/** Shared by every instanced material: one place to advance time and the wind. */
export interface EnvUniforms {
  uTime: { value: number };
  /** Seconds a newly streamed instance takes to dissolve in. */
  uFadeIn: { value: number };
  /** Wind displacement in world units, already including strength and direction. */
  uWind: { value: THREE.Vector2 };
  /** Hero position on the ground (x, z). */
  uHeroPos: { value: THREE.Vector2 };
  uPushRadius: { value: number };
}

interface PatchOpts {
  /** Bends in the wind and parts around the hero. */
  sway: number;
  /** Brightness breathes on its own phase (lantern glass, crystals). */
  pulse: boolean;
}

function patchInstanceMaterial(material: THREE.Material, occlusion: OcclusionUniforms, env: EnvUniforms, opts: PatchOpts): void {
  const defines = `${opts.sway > 0 ? '#define LM_SWAY\n' : ''}${opts.pulse ? '#define LM_PULSE\n' : ''}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `${defines}attribute vec3 aSize;\nattribute float aFade;\nvarying vec3 vOccView;\nvarying float vFade;\n` +
      `uniform float uTime;\nuniform vec2 uWind;\nuniform vec2 uHeroPos;\nuniform float uPushRadius;\nuniform float uSway;\nuniform float uFadeIn;\n${shader.vertexShader}`
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n${UV_SCALE_CHUNK}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_VERTEX}`)
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vOccView = mvPosition.xyz;\n  vFade = clamp((uTime - aFade) / uFadeIn, 0.0, 1.0);');
    shader.fragmentShader = `${defines}${OCCLUSION_PARS}uniform float uTime;\n${shader.fragmentShader}`
      .replace('void main() {', `void main() {\n${OCCLUSION_FRAGMENT}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${PULSE_FRAGMENT}`);
    // Shared uniform objects: updating `.value` once reaches every patched material.
    shader.uniforms.uHeroView = occlusion.uHeroView;
    shader.uniforms.uFadeRadius = occlusion.uFadeRadius;
    shader.uniforms.uFadeOn = occlusion.uFadeOn;
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWind = env.uWind;
    shader.uniforms.uHeroPos = env.uHeroPos;
    shader.uniforms.uPushRadius = env.uPushRadius;
    shader.uniforms.uSway = { value: opts.sway };
    shader.uniforms.uFadeIn = env.uFadeIn;
  };
  // Materials with different injected code must not share a compiled program.
  material.customProgramCacheKey = () => `lm-instance|${opts.sway > 0 ? 's' : ''}${opts.pulse ? 'p' : ''}`;
}

const keyOf = (cx: number, cy: number): number => cy * 1000 + cx;

interface LoadedChunk3D {
  cx: number;
  cy: number;
  ground: THREE.Mesh;
  texture: THREE.Texture;
  material: THREE.MeshLambertMaterial;
  /** Baked warm pools from the static lights; faded in with the night. */
  lightMap: THREE.Texture | null;
  /** Only chunks with water get a rippling overlay. */
  water: WaterSurface | null;
  lights: PointLightPlan[];
}

export class World3D {
  readonly group = new THREE.Group();
  private textures: Partial<Record<GreyboxTexture, THREE.Texture>> = {};
  private pools = new Map<string, InstancePool>();
  /** Pools that only show after dark (lit windows). */
  private nightPools = new Set<string>();
  private poolGeometries: THREE.BufferGeometry[] = [];
  private poolMaterials: THREE.Material[] = [];
  private groundGeometry: THREE.PlaneGeometry;
  private waterGeometry: THREE.PlaneGeometry;
  readonly waterUniforms: WaterUniforms = makeWaterUniforms();
  private waterEnabled = true;

  private loaded = new Map<number, LoadedChunk3D>();
  /** When each loaded chunk's ground appeared, for its fade-in. */
  private groundFade = new Map<number, number>();
  private planCache = new Map<number, ChunkPlan>();
  private queue: { cx: number; cy: number; pri: number }[] = [];
  private activeLights: PointLightPlan[] = [];
  private radiusChunks = 2;
  private shadowsOn = true;

  // lighting
  private hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a2f5e, 1);
  private sun = new THREE.DirectionalLight(0xfff2c0, 1.1);
  private pool: THREE.PointLight[] = [];

  private readonly env: EnvUniforms = {
    uTime: { value: 0 },
    uFadeIn: { value: 0.5 },
    uWind: { value: new THREE.Vector2(0.18, 0.07) },
    uHeroPos: { value: new THREE.Vector2(-1e4, -1e4) },
    uPushRadius: { value: 1.6 },
  };
  /** Wind strength, 0..1; the preset can calm it down or switch it off. */
  private windStrength = 1;
  /** How strong the baked light pools get at night. */
  private lightPoolScale = 1.6;
  /** Real seconds, for wind and flicker (keeps running while the simulation is frozen). */
  private clock = 0;

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
    this.waterGeometry = new THREE.PlaneGeometry(CHUNK_TILES, CHUNK_TILES);
    this.waterGeometry.rotateX(-Math.PI / 2);
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
   *
   * Unloading keeps half a chunk of hysteresis so walking along a border does not thrash — a full
   * chunk of margin sounds safer but grows the loaded disc by about a quarter, and every chunk is
   * a 256x256 texture.
   */
  private stream(focusX: number, focusZ: number): void {
    const want = this.desired(focusX, focusZ, 0);
    const keep = new Set(this.desired(focusX, focusZ, 0.5).map((c) => keyOf(c.cx, c.cy)));
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

  /**
   * Load what is around `focus` right now (first frame, teleports).
   *
   * `radius` lets the caller load a *small* neighbourhood synchronously and leave the rest to the
   * budgeted loader: baking dozens of ground textures in one go would freeze the first frame for a
   * second or more on a phone, and distance fog hides the rest arriving.
   */
  preload(focusX: number, focusZ: number, radius?: number): void {
    const full = this.radiusChunks;
    if (radius !== undefined) this.radiusChunks = Math.max(1, radius);
    this.stream(focusX, focusZ);
    this.step(this.queue.length);
    this.radiusChunks = full;
  }

  private loadChunk(cx: number, cy: number): void {
    const plan = this.chunkPlan(cx, cy);
    const pm = bakeChunk(this.world, this.tileSheet, cx, cy, 0);
    // Pixmap row 0 is north; a flat plane has v = 1 there, so the rows are flipped on upload.
    const texture = pixmapTexture(pm, { flipRows: true });
    const material = new THREE.MeshLambertMaterial({ map: texture });

    /*
     * Bake the static lights of this chunk *and its neighbours* into a pool map. A lamp two tiles
     * from the border still lights the ground on the other side of it, so a chunk-local bake would
     * leave a visible seam.
     */
    const lights: PointLightPlan[] = [];
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        if (cx + ox < 0 || cy + oy < 0 || cx + ox >= this.chunksWide() || cy + oy >= this.chunksHigh()) continue;
        lights.push(...(ox === 0 && oy === 0 ? plan.lights : chunkLights(this.world, cx + ox, cy + oy)));
      }
    const poolPm = bakeLightMap(lights, cx, cy);
    let lightMap: THREE.Texture | null = null;
    if (lightMapHasLight(poolPm)) {
      // Linear filtering here on purpose: these are soft pools of light, not pixel art.
      lightMap = pixmapTexture(poolPm, { flipRows: true, smooth: true });
      material.lightMap = lightMap;
      material.lightMapIntensity = 0;
    }
    const ground = new THREE.Mesh(this.groundGeometry, material);
    ground.position.set(u(cx * CHUNK_PX) + CHUNK_TILES / 2, 0, u(cy * CHUNK_PX) + CHUNK_TILES / 2);
    ground.receiveShadow = this.shadowsOn;
    this.group.add(ground);

    // rippling surface, only where there is water to ripple
    let water: WaterSurface | null = null;
    if (chunkHasWater(this.world, cx, cy)) {
      // Smooth filtering on the mask so the depth and shore bands blend instead of stepping.
      const maskTex = pixmapTexture(bakeWaterMask(this.world, cx, cy), { flipRows: true, smooth: true });
      water = new WaterSurface(this.waterGeometry, maskTex, this.waterUniforms, cx, cy, lightMap);
      water.mesh.visible = this.waterEnabled;
      this.group.add(water.mesh);
    }

    const key = keyOf(cx, cy);
    for (const [groupKey, shapes] of this.byGroup(plan)) this.poolFor(groupKey, shapes[0]).addChunk(key, shapes, this.clock);
    // The ground fades up out of the haze over the same window.
    this.groundFade.set(key, this.clock);
    this.loaded.set(key, { cx, cy, ground, texture, material, lightMap, water, lights: plan.lights });
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

  private poolFor(groupKey: string, sample: { kind: ShapeKind; texture: GreyboxTexture; emissive?: boolean; nightOnly?: boolean }): InstancePool {
    let pool = this.pools.get(groupKey);
    if (pool) return pool;
    if (sample.nightOnly) this.nightPools.add(groupKey);
    const geo = this.shapeGeometry(sample.kind);
    this.poolGeometries.push(geo);
    const map = this.textures[sample.texture]!;
    const mat = sample.emissive ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshLambertMaterial({ map });
    patchInstanceMaterial(mat, this.occlusion, this.env, {
      sway: VEGETATION.has(sample.texture) ? 1 : 0,
      pulse: !!sample.emissive,
    });
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
    c.lightMap?.dispose();
    c.water?.dispose();
    this.loaded.delete(key);
    this.groundFade.delete(key);
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

  /** How lively the vegetation is. The `vlow` preset stands still to save vertex work. */
  setWind(strength: number): void {
    this.windStrength = Math.max(0, strength);
  }

  /** How bright the baked lamp pools burn at night. */
  setLightPools(scale: number): void {
    this.lightPoolScale = Math.max(0, scale);
  }

  /** Rippling water costs one extra transparent pass per chunk; the bottom preset skips it. */
  setWater(on: boolean): void {
    this.waterEnabled = on;
    for (const c of this.loaded.values()) if (c.water) c.water.mesh.visible = on;
  }

  /** Where the hero stands, so grass parts around them (world units). */
  setHeroGround(x: number, z: number): void {
    this.env.uHeroPos.value.set(x, z);
  }

  /** Stream, then colour the world for the time of day and move the light pool. */
  update(dayTime: number, focus: THREE.Vector3, cave = 0, loadBudget = 1, realDt = 0): void {
    this.stream(focus.x, focus.z);
    this.step(loadBudget);
    // how much a just-arrived chunk is tinted toward the haze before it resolves
    const fogTint: [number, number, number] = [0.35, 0.35, 0.4];

    // Wind: a slow swing in direction on top of a steady breeze, so gusts never feel mechanical.
    this.clock += realDt;
    this.env.uTime.value = this.clock;
    const swing = Math.sin(this.clock * 0.13) * 0.35 + Math.sin(this.clock * 0.041) * 0.2;
    const calm = 1 - cave * 0.8; // barely a draught underground
    this.env.uWind.value.set(Math.cos(swing) * 0.2, Math.sin(swing) * 0.2).multiplyScalar(this.windStrength * calm);
    this.waterUniforms.uTime.value = this.clock;

    const amb = blendAmbient(ambientAt(dayTime), AREAS.cave.ambient, cave);
    // Inside the cave the sun is irrelevant: torches and crystals do the lighting.
    const night = Math.max(nightAmount(dayTime), cave);
    this.hemi.color.setRGB(amb[0], amb[1], amb[2]);
    this.hemi.intensity = 0.55 + (1 - night) * 0.5;

    // The sun really travels: it rises in the east, so shadows sweep over the day.
    const dir = sunDirection(dayTime);
    if (dir.up) this.sun.color.setRGB(Math.min(1, amb[0] * 1.15), amb[1], amb[2] * 0.95);
    else this.sun.color.setRGB(0.55, 0.62, 0.95); // a cold moon from overhead
    this.sun.intensity = (dir.up ? 1.25 : 0.35) * (1 - cave);
    this.sun.position.set(focus.x + dir.x * 45, dir.y * 45, focus.z + dir.z * 45);
    this.sun.target.position.copy(focus);

    // lit windows
    const lightsOn = night > 0.22;
    for (const key of this.nightPools) {
      const pool = this.pools.get(key);
      if (pool) pool.mesh.visible = lightsOn;
    }
    // Baked pools of lamp light on the ground: invisible by day, full strength at night.
    const poolStrength = Math.max(0, (night - 0.12) / 0.88) * this.lightPoolScale;
    for (const c of this.loaded.values()) if (c.lightMap) c.material.lightMapIntensity = poolStrength;
    // Lamplight reflected on the water follows the same curve, a little weaker.
    this.waterUniforms.uLightStrength.value = poolStrength * 0.5;

    // Ground fade-in: a fresh chunk starts tinted toward the haze and resolves out of it.
    for (const [key, at] of this.groundFade) {
      const t = (this.clock - at) / this.env.uFadeIn.value;
      const c = this.loaded.get(key);
      if (!c) {
        this.groundFade.delete(key);
        continue;
      }
      if (t >= 1) {
        c.material.color.setRGB(1, 1, 1);
        this.groundFade.delete(key);
      } else {
        const k = Math.max(0, t);
        c.material.color.setRGB(fogTint[0] + (1 - fogTint[0]) * k, fogTint[1] + (1 - fogTint[1]) * k, fogTint[2] + (1 - fogTint[2]) * k);
      }
    }

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
      // Torches and shrine flames breathe, each on its own phase, using the 2D flicker amounts.
      const phase = l.x * 0.13 + l.z * 0.29;
      const flick = l.flicker
        ? 1 + l.flicker * (Math.sin(this.clock * 9 + phase) * 0.6 + Math.sin(this.clock * 23 + phase * 1.7) * 0.4)
        : 1;
      p.intensity = l.intensity * flick * (l.nightOnly ? Math.min(1, night * 2) : 1) * 2.2;
    });
  }

  /** For the report. */
  stats(): { chunks: number; queued: number; instances: number; draws: number; lights: number; pools: number; water: number; windows: number } {
    let instances = 0;
    for (const p of this.pools.values()) instances += p.liveCount;
    let water = 0;
    for (const c of this.loaded.values()) if (c.water?.mesh.visible) water++;
    let windows = 0;
    for (const key of this.nightPools) if (this.pools.get(key)?.mesh.visible) windows += this.pools.get(key)!.liveCount;
    return {
      chunks: this.loaded.size,
      queued: this.queue.length,
      instances,
      draws: this.loaded.size + this.pools.size + water,
      lights: this.pool.length,
      pools: this.pools.size,
      water,
      windows,
    };
  }

  dispose(): void {
    for (const c of [...this.loaded.values()]) this.unloadChunk(c);
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
    this.nightPools.clear();
    for (const g of this.poolGeometries) g.dispose();
    for (const m of this.poolMaterials) m.dispose();
    this.poolGeometries = [];
    this.poolMaterials = [];
    this.groundGeometry.dispose();
    this.waterGeometry.dispose();
    for (const t of Object.values(this.textures)) t?.dispose();
    this.textures = {};
    this.planCache.clear();
    this.scene.remove(this.group, this.hemi, this.sun, this.sun.target);
    this.setLightBudget(0);
  }
}
