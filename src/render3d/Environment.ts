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
varying vec2 vWorldXz;
void main() {
  // two layers drifting at different speeds: the fog churns instead of sliding
  float a = texture2D(tNoise, vWorldXz * 0.02 + vec2(uTime * 0.004, uTime * 0.0021)).a;
  float b = texture2D(tNoise, vWorldXz * 0.037 - vec2(uTime * 0.0027, uTime * 0.0045)).a;
  float m = a * 0.6 + b * 0.4;
  float alpha = smoothstep(0.35, 0.95, m) * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}`;

export class Environment {
  private flies: THREE.InstancedMesh;
  private flyMaterial: THREE.ShaderMaterial;
  private flyGeometry: THREE.PlaneGeometry;
  private fog: THREE.Mesh;
  private fogMaterial: THREE.ShaderMaterial;
  private fogGeometry: THREE.PlaneGeometry;
  private fogTexture: THREE.Texture;
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
      },
    });
    this.fog = new THREE.Mesh(this.fogGeometry, this.fogMaterial);
    this.fog.frustumCulled = false;
    this.fog.renderOrder = 3;
    this.fog.visible = false;
    scene.add(this.fog);
  }

  /** 0 switches both effects off (the bottom graphics preset). */
  setBudget(v: number): void {
    this.budget = Math.max(0, Math.min(1, v));
  }

  /**
   * @param realDt  seconds since the last frame
   * @param focus   where the camera is looking, in world units
   * @param night   0..1 from the day/night cycle
   * @param cave    0..1 how deep underground
   * @param forest  0..1 how deep into the forest
   * @param haze    the current fog colour, so the mist matches the sky
   */
  update(realDt: number, focus: THREE.Vector3, night: number, cave: number, forest: number, haze: THREE.Color): void {
    this.clock += realDt;
    this.flyMaterial.uniforms.uTime.value = this.clock;
    this.fogMaterial.uniforms.uTime.value = this.clock;

    // Fireflies: a summer-night thing, so night-only and never underground.
    const flyAmount = Math.max(0, night - 0.25) / 0.75 * (1 - cave) * this.budget;
    this.flies.visible = flyAmount > 0.02;
    if (this.flies.visible) {
      this.flies.position.set(Math.round(focus.x), 0, Math.round(focus.z));
      this.flyMaterial.uniforms.uOpacity.value = flyAmount * 0.85;
    }

    // Fog: thickest underground, then in the forest at night, and a thin veil at dawn.
    const dawn = Math.max(0, 1 - Math.abs(night - 0.55) * 4);
    const fogAmount = Math.min(1, cave * 0.8 + forest * night * 0.6 + dawn * 0.3) * this.budget;
    this.fog.visible = fogAmount > 0.02;
    if (this.fog.visible) {
      this.fog.position.set(Math.round(focus.x), 0.35 + cave * 0.15, Math.round(focus.z));
      this.fogMaterial.uniforms.uOpacity.value = fogAmount * 0.5;
      (this.fogMaterial.uniforms.uColor.value as THREE.Color).copy(haze).lerp(new THREE.Color(0xffffff), 0.25);
    }
  }

  dispose(): void {
    this.scene.remove(this.flies, this.fog);
    this.flies.dispose();
    this.flyGeometry.dispose();
    this.flyMaterial.dispose();
    this.fogGeometry.dispose();
    this.fogMaterial.dispose();
    this.fogTexture.dispose();
  }
}
