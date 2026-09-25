/**
 * The living, moving bits of the world that are not geometry: fireflies and drifting ground fog
 * (docs/OVERHAUL.md §4 "lingkungan hidup").
 *
 * Both follow the camera rather than existing everywhere, and both animate entirely in the vertex
 * shader from a per-instance seed, so nothing here costs a JS loop per frame. Fireflies only come
 * out at night and outdoors; the fog thickens in the forest, at night, and underground.
 */
import * as THREE from 'three';
import { buildFogNoise } from '../art/greybox';
import { hashf } from '../core/rng';
import { pixmapTexture } from './textures';

const FIREFLY_COUNT = 64;
/** Pooled hit sparks. Combat never allocates: it borrows from here and gives them back. */
const SPARK_COUNT = 140;
/** Half-extent of the box of fireflies kept around the camera, in world units. */
const FIREFLY_SPREAD = 22;

/**
 * Deterministic home position and animation seeds for firefly `i`. Pure so the spread can be
 * checked in a test: a clump of fireflies in one corner would be worse than none.
 */
export function fireflySeed(i: number): { x: number; y: number; z: number; sx: number; sy: number; sz: number } {
  return {
    x: (hashf(i, 1, 7) - 0.5) * 2 * FIREFLY_SPREAD,
    y: 0.5 + hashf(i, 2, 7) * 2.2,
    z: (hashf(i, 3, 7) - 0.5) * 2 * FIREFLY_SPREAD,
    sx: hashf(i, 4, 7) * 6.283,
    sy: hashf(i, 5, 7) * 6.283,
    sz: hashf(i, 6, 7) * 6.283,
  };
}

const FLY_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
varying float vGlow;
void main() {
  vec3 home = instanceMatrix[3].xyz;
  // three unrelated frequencies per axis: no two fireflies ever fly in step
  vec3 drift = vec3(
    sin(uTime * 0.7 + aSeed.x) * 1.6 + sin(uTime * 0.23 + aSeed.y) * 2.4,
    sin(uTime * 0.9 + aSeed.y) * 0.5,
    cos(uTime * 0.6 + aSeed.z) * 1.6 + cos(uTime * 0.19 + aSeed.x) * 2.4
  );
  // they blink, and they are dark for longer than they are lit
  vGlow = smoothstep(0.45, 1.0, sin(uTime * 2.1 + aSeed.z * 3.0) * 0.5 + 0.5);
  vec4 world = vec4(home + drift, 1.0);
  vec4 view = viewMatrix * modelMatrix * world;
  // billboard: the quad is built in view space so it always faces the camera
  view.xy += position.xy * 0.09;
  gl_Position = projectionMatrix * view;
}`;

const FLY_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vGlow;
void main() {
  float a = vGlow * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const SPARK_VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec2 aLife;   // x = age, y = lifetime
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
  // ballistic: outward, then gravity takes over
  vec3 pos = home + aVel * age + vec3(0.0, -3.2 * age * age, 0.0);
  vec4 view = viewMatrix * vec4(pos, 1.0);
  view.xy += position.xy * aSize * (0.35 + vFade * 0.65);
  gl_Position = projectionMatrix * view;
}`;

const SPARK_FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vFade;
void main() {
  if (vFade <= 0.01) discard;
  gl_FragColor = vec4(vColor * (0.6 + vFade * 0.8), vFade);
}`;

const FOG_VERT = /* glsl */ `
varying vec2 vWorldXz;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldXz = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FOG_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tNoise;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec2 uCenter;
varying vec2 vWorldXz;
void main() {
  // thin around the hero, thick further out: the mist has depth instead of lying on the lens
  float clear = mix(0.3, 1.0, smoothstep(2.5, 12.0, distance(vWorldXz, uCenter)));
  // and it fades before the plane's edge, so the square never shows
  float edge = 1.0 - smoothstep(34.0, 44.0, distance(vWorldXz, uCenter));
  // two layers drifting at different speeds: the fog churns instead of sliding
  float a = texture2D(tNoise, vWorldXz * 0.02 + vec2(uTime * 0.004, uTime * 0.0021)).a;
  float b = texture2D(tNoise, vWorldXz * 0.037 - vec2(uTime * 0.0027, uTime * 0.0045)).a;
  float m = a * 0.6 + b * 0.4;
  float alpha = smoothstep(0.35, 0.95, m) * uOpacity * clear * edge;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}`;

const WHITE = new THREE.Color(0xffffff);

export class Environment {
  private flies: THREE.InstancedMesh;
  private flyMaterial: THREE.ShaderMaterial;
  private flyGeometry: THREE.PlaneGeometry;
  private fog: THREE.Mesh;
  private fogMaterial: THREE.ShaderMaterial;
  private fogGeometry: THREE.PlaneGeometry;
  private fogTexture: THREE.Texture;
  private sparks: THREE.InstancedMesh;
  private sparkMaterial: THREE.ShaderMaterial;
  private sparkGeometry: THREE.PlaneGeometry;
  private sparkNext = 0;
  private sparkVel!: THREE.InstancedBufferAttribute;
  private sparkLife!: THREE.InstancedBufferAttribute;
  private sparkColor!: THREE.InstancedBufferAttribute;
  private sparkSize!: THREE.InstancedBufferAttribute;
  private sparkMatrix = new THREE.Matrix4();
  /** 0..1, set by the graphics preset. */
  private budget = 1;
  private clock = 0;

  constructor(private readonly scene: THREE.Scene) {
    // ── fireflies ──
    this.flyGeometry = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(FIREFLY_COUNT * 3);
    this.flyMaterial = new THREE.ShaderMaterial({
      vertexShader: FLY_VERT,
      fragmentShader: FLY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffe08a) },
        uOpacity: { value: 0 },
      },
    });
    this.flies = new THREE.InstancedMesh(this.flyGeometry, this.flyMaterial, FIREFLY_COUNT);
    this.flies.frustumCulled = false;
    this.flies.renderOrder = 10;
    const m = new THREE.Matrix4();
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const s = fireflySeed(i);
      this.flies.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z));
      seeds[i * 3] = s.sx;
      seeds[i * 3 + 1] = s.sy;
      seeds[i * 3 + 2] = s.sz;
    }
    this.flyGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    this.flies.instanceMatrix.needsUpdate = true;
    this.flies.visible = false;
    scene.add(this.flies);

    // ── drifting ground fog ──
    this.fogTexture = pixmapTexture(buildFogNoise(), { tile: true });
    this.fogGeometry = new THREE.PlaneGeometry(90, 90);
    this.fogGeometry.rotateX(-Math.PI / 2);
    this.fogMaterial = new THREE.ShaderMaterial({
      vertexShader: FOG_VERT,
      fragmentShader: FOG_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        tNoise: { value: this.fogTexture },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0xd8d0e8) },
        uCenter: { value: new THREE.Vector2() },
      },
    });
    this.fog = new THREE.Mesh(this.fogGeometry, this.fogMaterial);
    this.fog.frustumCulled = false;
    this.fog.renderOrder = 3;
    this.fog.visible = false;
    scene.add(this.fog);

    // ── hit sparks ──
    this.sparkGeometry = new THREE.PlaneGeometry(1, 1);
    this.sparkMaterial = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
    });
    this.sparks = new THREE.InstancedMesh(this.sparkGeometry, this.sparkMaterial, SPARK_COUNT);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 12;
    this.sparkVel = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_COUNT * 3), 3);
    this.sparkLife = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_COUNT * 2).fill(-999), 2);
    this.sparkColor = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_COUNT * 3).fill(1), 3);
    this.sparkSize = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_COUNT).fill(0.1), 1);
    this.sparkGeometry.setAttribute('aVel', this.sparkVel);
    this.sparkGeometry.setAttribute('aLife', this.sparkLife);
    this.sparkGeometry.setAttribute('aColor', this.sparkColor);
    this.sparkGeometry.setAttribute('aSize', this.sparkSize);
    scene.add(this.sparks);
  }

  /**
   * A burst of sparks at a world position (world units). Borrowed from a fixed ring buffer and
   * animated entirely in the vertex shader from a spawn timestamp, so a busy fight allocates
   * nothing and costs no per-frame CPU.
   */
  spark(x: number, z: number, color: number, big: boolean): void {
    if (this.budget <= 0) return;
    const count = Math.max(3, Math.round((big ? 14 : 7) * this.budget));
    const r = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const slot = this.sparkNext % SPARK_COUNT;
      this.sparkNext++;
      const a = Math.random() * Math.PI * 2;
      const up = 1.4 + Math.random() * 2.2;
      const speed = (big ? 2.6 : 1.7) * (0.5 + Math.random());
      this.sparks.setMatrixAt(slot, this.sparkMatrix.makeTranslation(x, 0.7 + Math.random() * 0.3, z));
      (this.sparkVel.array as Float32Array).set([Math.cos(a) * speed, up, Math.sin(a) * speed], slot * 3);
      (this.sparkLife.array as Float32Array).set([this.clock, big ? 0.55 : 0.36], slot * 2);
      (this.sparkColor.array as Float32Array).set([r.r, r.g, r.b], slot * 3);
      (this.sparkSize.array as Float32Array)[slot] = big ? 0.15 : 0.1;
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    this.sparkVel.needsUpdate = true;
    this.sparkLife.needsUpdate = true;
    this.sparkColor.needsUpdate = true;
    this.sparkSize.needsUpdate = true;
  }

  /** 0 switches both effects off (the bottom graphics preset). */
  setBudget(v: number): void {
    this.budget = Math.max(0, Math.min(1, v));
  }

  get currentBudget(): number {
    return this.budget;
  }

  /**
   * @param realDt  seconds since the last frame
   * @param focus   where the camera is looking, in world units
   * @param night   0..1 from the day/night cycle
   * @param cave    0..1 how deep underground
   * @param forest  0..1 how deep into the forest
   * @param haze    the current fog colour, so the mist matches the sky
   * @param mist    extra ground mist from the weather, 0..1
   */
  update(realDt: number, focus: THREE.Vector3, night: number, cave: number, forest: number, haze: THREE.Color, mist = 0): void {
    this.clock += realDt;
    this.flyMaterial.uniforms.uTime.value = this.clock;
    this.fogMaterial.uniforms.uTime.value = this.clock;
    this.sparkMaterial.uniforms.uTime.value = this.clock;

    // Fireflies: a summer-night thing, so night-only and never underground.
    const flyAmount = Math.max(0, night - 0.25) / 0.75 * (1 - cave) * this.budget;
    this.flies.visible = flyAmount > 0.02;
    if (this.flies.visible) {
      this.flies.position.set(Math.round(focus.x), 0, Math.round(focus.z));
      this.flyMaterial.uniforms.uOpacity.value = flyAmount * 0.85;
    }

    // Fog: thickest underground, then in the forest at night, and a thin veil at dawn.
    const dawn = Math.max(0, 1 - Math.abs(night - 0.55) * 4);
    // (the weather's mist stays even on the lowest budget: it is the weather, not decoration)
    const fogAmount = Math.min(1, (cave * 0.8 + forest * night * 0.6 + dawn * 0.3) * this.budget + mist * Math.max(0.5, this.budget));
    this.fog.visible = fogAmount > 0.02;
    if (this.fog.visible) {
      this.fog.position.set(Math.round(focus.x), 0.35 + cave * 0.15, Math.round(focus.z));
      this.fogMaterial.uniforms.uOpacity.value = fogAmount * 0.5;
      (this.fogMaterial.uniforms.uCenter.value as THREE.Vector2).set(focus.x, focus.z);
      (this.fogMaterial.uniforms.uColor.value as THREE.Color).copy(haze).lerp(WHITE, 0.25);
    }
  }

  dispose(): void {
    this.scene.remove(this.flies, this.fog, this.sparks);
    this.sparks.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.flies.dispose();
    this.flyGeometry.dispose();
    this.flyMaterial.dispose();
    this.fogGeometry.dispose();
    this.fogMaterial.dispose();
    this.fogTexture.dispose();
  }
}
