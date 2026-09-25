/**
 * Every short-lived particle in combat and movement: hit sparks, crits, element bursts, footstep
 * dust, dodge puffs, a hammer's landing.
 *
 * **Pooled, and animated on the GPU.** Each pool is one `InstancedMesh` with a fixed ring of slots;
 * a burst writes a spawn time, a velocity, a gravity, a colour and a size into the next slots, and
 * the vertex shader does the rest (position = spawn + velocity·t + ½·gravity·t², fade over life).
 * Nothing is allocated per burst or per frame, and the CPU does no per-frame work at all.
 *
 * **Two pools**: glow (additive — sparks, embers, lightning, water, ice) and dust (normal blending —
 * dust and smoke, which must darken, not shine).
 *
 * **Density** follows the graphics preset and AUTO's particle dial (`setBudget`), so a weak phone
 * gets fewer particles, never a slower frame.
 */
import * as THREE from 'three';
import type { ElementId } from '../core/combat/elements';

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec3 aLife;   // x = spawn time, y = lifetime, z = gravity (negative rises)
attribute vec3 aColor;
attribute float aSize;
uniform float uTime;
varying vec3 vColor;
varying float vFade;
void main() {
  float age = uTime - aLife.x;
  float t = age / max(0.0001, aLife.y);
  if (t < 0.0 || t > 1.0) {
    // parked off screen; the alternative is a per-frame buffer rewrite
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vFade = 0.0;
    return;
  }
  vColor = aColor;
  vFade = 1.0 - t;
  vec3 home = instanceMatrix[3].xyz;
  vec3 pos = home + aVel * age + vec3(0.0, -0.5 * aLife.z * age * age, 0.0);
  pos.y = max(pos.y, 0.02);
  vec4 view = viewMatrix * vec4(pos, 1.0);
  view.xy += position.xy * aSize * (0.45 + vFade * 0.55);
  gl_Position = projectionMatrix * view;
}`;

const FRAG_GLOW = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vFade;
void main() {
  if (vFade <= 0.01) discard;
  gl_FragColor = vec4(vColor * (0.6 + vFade * 0.8), vFade);
}`;

const FRAG_DUST = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vFade;
void main() {
  if (vFade <= 0.01) discard;
  gl_FragColor = vec4(vColor, vFade * 0.55);
}`;

/** One kind of burst, as data. Speeds in world units per second. */
interface BurstDef {
  pool: 'glow' | 'dust';
  count: number;
  /** Horizontal speed range. */
  speed: [number, number];
  /** Upward speed range. */
  up: [number, number];
  life: [number, number];
  size: [number, number];
  /** Gravity (positive falls, negative rises). */
  gravity: number;
  /** Height the burst starts at. */
  y: number;
  /** Colour when the caller gives none; `alt` mixes in a second colour for some of them. */
  color: number;
  alt?: number | undefined;
}

export type BurstKind = 'hit' | 'crit' | 'dust' | 'dodge' | 'impact' | 'ember' | 'smoke' | 'splash' | 'shard' | 'zap';

export const BURSTS: Record<BurstKind, BurstDef> = {
  hit: { pool: 'glow', count: 7, speed: [0.9, 2.2], up: [1.2, 3.2], life: [0.25, 0.4], size: [0.08, 0.13], gravity: 6.4, y: 0.8, color: 0xffe9a8 },
  crit: { pool: 'glow', count: 16, speed: [1.8, 3.6], up: [1.6, 4], life: [0.35, 0.6], size: [0.12, 0.2], gravity: 5, y: 0.9, color: 0xfff4c0, alt: 0xff9f43 },
  dust: { pool: 'dust', count: 3, speed: [0.2, 0.6], up: [0.2, 0.6], life: [0.35, 0.55], size: [0.14, 0.24], gravity: 0.6, y: 0.08, color: 0x8a7a66 },
  dodge: { pool: 'dust', count: 9, speed: [0.5, 1.4], up: [0.3, 0.9], life: [0.4, 0.65], size: [0.18, 0.3], gravity: 0.8, y: 0.1, color: 0x9a8a76 },
  impact: { pool: 'dust', count: 18, speed: [1.4, 3.2], up: [0.6, 1.6], life: [0.45, 0.75], size: [0.2, 0.36], gravity: 2.2, y: 0.1, color: 0x8a7a66 },
  // Api: embers that rise, with grey smoke
  ember: { pool: 'glow', count: 9, speed: [0.3, 1.1], up: [1.2, 2.4], life: [0.55, 0.9], size: [0.08, 0.14], gravity: -1.2, y: 0.7, color: 0xff8a3a, alt: 0xffd15a },
  smoke: { pool: 'dust', count: 4, speed: [0.1, 0.4], up: [0.5, 1], life: [0.7, 1.1], size: [0.25, 0.4], gravity: -0.6, y: 0.9, color: 0x3a3440 },
  // Air: droplets that splash up and fall
  splash: { pool: 'glow', count: 10, speed: [0.8, 2], up: [1.6, 3.2], life: [0.35, 0.55], size: [0.07, 0.11], gravity: 9, y: 0.6, color: 0x5ac8ff, alt: 0xbdf0ff },
  // Es: crystal shards that fly and drop
  shard: { pool: 'glow', count: 8, speed: [1.2, 2.6], up: [1, 2.4], life: [0.4, 0.65], size: [0.1, 0.16], gravity: 7, y: 0.8, color: 0xbdf0ff, alt: 0xffffff },
  // Petir: sparks, fast and brief
  zap: { pool: 'glow', count: 10, speed: [2.2, 4.4], up: [-0.6, 1.6], life: [0.12, 0.22], size: [0.06, 0.1], gravity: 0, y: 0.8, color: 0xfff27a, alt: 0xb49bff },
};

/** What an element adds to a hit. */
export const ELEMENT_BURSTS: Partial<Record<ElementId, BurstKind[]>> = {
  api: ['ember', 'smoke'],
  air: ['splash'],
  es: ['shard'],
  petir: ['zap'],
};

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private next = 0;
  private readonly m = new THREE.Matrix4();

  constructor(
    scene: THREE.Object3D,
    readonly count: number,
    additive: boolean,
    readonly uTime: { value: number },
  ) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_GLOW : FRAG_DUST,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTime: uTime },
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.life = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(-999), 3);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(0.1), 1);
    this.geo.setAttribute('aVel', this.vel);
    this.geo.setAttribute('aLife', this.life);
    this.geo.setAttribute('aColor', this.color);
    this.geo.setAttribute('aSize', this.size);
    scene.add(this.mesh);
  }

  /** Write one particle into the next slot (oldest overwritten). */
  put(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, gravity: number, color: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.mesh.setMatrixAt(i, this.m.makeTranslation(x, y, z));
    const v = this.vel.array as Float32Array;
    v[i * 3] = vx;
    v[i * 3 + 1] = vy;
    v[i * 3 + 2] = vz;
    const l = this.life.array as Float32Array;
    l[i * 3] = this.uTime.value;
    l[i * 3 + 1] = life;
    l[i * 3 + 2] = gravity;
    const c = this.color.array as Float32Array;
    c[i * 3] = ((color >> 16) & 255) / 255;
    c[i * 3 + 1] = ((color >> 8) & 255) / 255;
    c[i * 3 + 2] = (color & 255) / 255;
    (this.size.array as Float32Array)[i] = size;
  }

  flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.vel.needsUpdate = true;
    this.life.needsUpdate = true;
    this.color.needsUpdate = true;
    this.size.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class Particles {
  private readonly uTime = { value: 0 };
  private readonly glow: Pool;
  private readonly dust: Pool;
  private budget = 1;
  private seed = 1;
  /** Particles written, for tests and the report. */
  emitted = 0;

  constructor(scene: THREE.Object3D, size = 384) {
    this.glow = new Pool(scene, size, true, this.uTime);
    this.dust = new Pool(scene, Math.round(size / 2), false, this.uTime);
  }

  /** 0 = none, 1 = the full count (preset × AUTO's particle dial). */
  setBudget(v: number): void {
    this.budget = Math.max(0, Math.min(1.5, v));
  }

  update(dt: number): void {
    this.uTime.value += Math.max(0, dt);
  }

  private rand(): number {
    // a tiny LCG: cheap, allocation-free, and repeatable in tests
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * One burst of `kind` at (x, z) in world units. `color` overrides the preset's; `dir` (radians)
   * biases the spray, `scale` multiplies the count.
   */
  burst(kind: BurstKind, x: number, z: number, color = -1, scale = 1, dir: number | null = null): void {
    const d = BURSTS[kind];
    const n = Math.round(d.count * scale * this.budget);
    if (n <= 0) return;
    const pool = d.pool === 'glow' ? this.glow : this.dust;
    const r = (a: [number, number]): number => a[0] + (a[1] - a[0]) * this.rand();
    for (let i = 0; i < n; i++) {
      const a = dir === null ? this.rand() * Math.PI * 2 : dir + (this.rand() - 0.5) * 1.6;
      const sp = r(d.speed);
      const c = color >= 0 ? color : d.alt !== undefined && this.rand() < 0.35 ? d.alt : d.color;
      pool.put(x, d.y + this.rand() * 0.15, z, Math.cos(a) * sp, r(d.up), Math.sin(a) * sp, r(d.life), d.gravity, c, r(d.size));
    }
    pool.flush();
    this.emitted += n;
  }

  /** A hit: sparks, more for a crit, plus the element's own burst. */
  hit(x: number, z: number, element: ElementId | null | undefined, crit: boolean, color = -1): void {
    this.burst('hit', x, z, color);
    if (crit) this.burst('crit', x, z);
    if (element) for (const k of ELEMENT_BURSTS[element] ?? []) this.burst(k, x, z, -1, crit ? 1.4 : 1);
  }

  dispose(): void {
    this.glow.dispose();
    this.dust.dispose();
  }
}
