/**
 * Rain: falling streaks, splashes where they land, and puddles that fill while it rains.
 *
 * Three `InstancedMesh`es, three draw calls, and **no per-frame CPU work** beyond a few uniforms:
 * every streak, splash and puddle is placed by its vertex shader from a seed and the time.
 *
 * What was wrong with the first version (reported as "hujan cuma abu-abu"):
 *  - streaks were 0.035 units wide — about half a pixel of the low-resolution buffer, so most of
 *    them never rasterised and the rest flickered in and out;
 *  - they were positioned *relative to the camera focus*, so the whole rain slid with the hero;
 *  - nothing reached the ground, so the rain had no weight.
 * The grey itself was the fog (see `core/systems/weather.ts` `fogDistances`).
 *
 * Invisible (and so not drawn at all) whenever there is no rain and the ground is dry.
 */
import * as THREE from 'three';

const COUNT = 520;
const SPLASHES = 150;
/** Puddle grid: cells of this size, GRID × GRID of them around the focus. */
const CELL = 3;
const GRID = 15;
/** Half-size of the box the rain fills around the camera focus, in world units. */
const SPREAD = 22;
const HEIGHT = 14;

const HASH = /* glsl */ `
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const STREAK_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uFocus;
uniform float uYaw;
uniform float uDrift;
uniform float uWind;
varying float vFade;
void main() {
  float speed = 16.0 + aSeed.z * 7.0;
  float y = mod(aSeed.z * 97.0 - uTime * speed, ${HEIGHT.toFixed(1)});
  // anchored to the world, wrapped into a box around the focus: walking through rain, not with it
  float span = ${(SPREAD * 2).toFixed(1)};
  float x = uFocus.x + mod(aSeed.x * span + uDrift - uFocus.x, span) - ${SPREAD.toFixed(1)};
  float z = uFocus.z + mod(aSeed.y * span - uFocus.z, span) - ${SPREAD.toFixed(1)};
  vec3 base = vec3(x, y, z);
  // the streak leans with the wind, and is turned to face the camera so it is never edge-on
  vec3 right = vec3(cos(uYaw), 0.0, -sin(uYaw));
  vec3 along = normalize(vec3(uWind / speed, 1.0, 0.0));
  vec3 p = base + right * position.x + along * position.y;
  // thin out near the top of the box, so its edge never shows; drops end at the ground
  vFade = smoothstep(0.0, 0.4, y) * (1.0 - smoothstep(${(HEIGHT - 3).toFixed(1)}, ${HEIGHT.toFixed(1)}, y));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
precision mediump float;
uniform float uOpacity;
uniform vec3 uColor;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}`;

const SPLASH_VERT = /* glsl */ `
${HASH}
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uFocus;
varying vec2 vUv;
varying float vT;
void main() {
  float period = 0.4 + aSeed.z * 0.45;
  float c = uTime / period + aSeed.z * 7.0;
  float cycle = floor(c);
  float t = fract(c) / 0.35;
  vT = t;
  vUv = uv;
  if (t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // a new spot every cycle: splashes pop up all over, not in the same places
  vec2 h = vec2(hash1(aSeed.x * 91.7 + cycle * 1.37), hash1(aSeed.y * 53.3 + cycle * 2.11));
  vec2 xz = uFocus.xz + (h - 0.5) * 34.0;
  float r = 0.1 + t * 0.26;
  vec3 p = vec3(xz.x + position.x * r, 0.04, xz.y + position.z * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SPLASH_FRAG = /* glsl */ `
precision mediump float;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vT;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  // a ring that opens, with a bright centre at the moment of impact
  float ring = smoothstep(0.55, 0.8, d) * (1.0 - smoothstep(0.85, 1.0, d));
  float dot0 = (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - smoothstep(0.0, 0.3, vT));
  float a = max(ring, dot0) * (1.0 - vT) * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const PUDDLE_VERT = /* glsl */ `
${HASH}
attribute vec2 aCell;
uniform vec3 uFocus;
uniform float uWet;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 cell = floor(uFocus.xz / ${CELL.toFixed(1)}) + aCell;
  float h = hash2(cell);
  vUv = uv;
  vSeed = h;
  // about one cell in four gets a puddle, always the same ones (the ground's low spots)
  if (h > 0.27 || uWet < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float h2 = hash2(cell + 17.3);
  float h3 = hash2(cell + 41.9);
  float h4 = hash2(cell + 7.7);
  vec2 centre = (cell + 0.2 + 0.6 * vec2(h2, h3)) * ${CELL.toFixed(1)};
  // puddles grow as the ground gets wetter
  float size = (0.8 + h4 * 1.2) * sqrt(uWet);
  float ang = h * 40.0;
  vec2 q = vec2(position.x * size, position.z * size * (0.55 + h2 * 0.35));
  q = vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang));
  gl_Position = projectionMatrix * viewMatrix * vec4(centre.x + q.x, 0.025, centre.y + q.y, 1.0);
}`;

const PUDDLE_FRAG = /* glsl */ `
precision mediump float;
uniform float uWet;
uniform float uRain;
uniform float uTime;
uniform vec3 uSky;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 v = vUv - 0.5;
  float d = length(v) * 2.0;
  // a wobbly edge, so puddles are not perfect ellipses
  d += 0.08 * sin(atan(v.y, v.x) * 5.0 + vSeed * 30.0);
  float body = 1.0 - smoothstep(0.78, 1.0, d);
  if (body < 0.02) discard;
  // dark water that catches the sky toward the rim
  vec3 water = mix(vec3(0.08, 0.1, 0.16), uSky, 0.35 + 0.35 * smoothstep(0.4, 0.95, d));
  // rings from the drops, only while it rains
  float rip = smoothstep(0.82, 1.0, sin(d * 16.0 - uTime * 5.0 + vSeed * 50.0)) * uRain * (1.0 - d);
  gl_FragColor = vec4(water + rip * 0.35, body * (0.3 + 0.3 * uWet));
}`;

export class Rain {
  private readonly streaks: THREE.InstancedMesh;
  private readonly splashes: THREE.InstancedMesh;
  private readonly puddles: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly shared = {
    uTime: { value: 0 },
    uFocus: { value: new THREE.Vector3() },
  };
  private readonly streakU;
  private readonly splashU;
  private readonly puddleU;
  private clock = 0;
  private drift = 0;

  constructor(private readonly scene: THREE.Scene) {
    // deterministic scatter, so the rain looks the same every time it starts
    let s = 1234567;
    const rand = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const seeds = (n: number): THREE.InstancedBufferAttribute => {
      const a = new Float32Array(n * 3);
      for (let i = 0; i < a.length; i++) a[i] = rand();
      return new THREE.InstancedBufferAttribute(a, 3);
    };

    // streaks: about one low-res pixel wide (the old 0.035 was half a pixel), and long
    const streakGeo = new THREE.PlaneGeometry(0.09, 0.95);
    streakGeo.setAttribute('aSeed', seeds(COUNT));
    this.streakU = { ...this.shared, uYaw: { value: 0 }, uDrift: { value: 0 }, uWind: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xc4d8f0) } };
    this.streaks = this.instanced(streakGeo, STREAK_VERT, STREAK_FRAG, this.streakU, COUNT, 11);

    const splashGeo = new THREE.PlaneGeometry(2, 2);
    splashGeo.rotateX(-Math.PI / 2);
    splashGeo.setAttribute('aSeed', seeds(SPLASHES));
    this.splashU = { ...this.shared, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xd8e8ff) } };
    this.splashes = this.instanced(splashGeo, SPLASH_VERT, SPLASH_FRAG, this.splashU, SPLASHES, 10);

    const puddleGeo = new THREE.PlaneGeometry(1, 1);
    puddleGeo.rotateX(-Math.PI / 2);
    const cells = new Float32Array(GRID * GRID * 2);
    const half = Math.floor(GRID / 2);
    for (let i = 0; i < GRID * GRID; i++) {
      cells[i * 2] = (i % GRID) - half;
      cells[i * 2 + 1] = Math.floor(i / GRID) - half;
    }
    puddleGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    this.puddleU = { ...this.shared, uWet: { value: 0 }, uRain: { value: 0 }, uSky: { value: new THREE.Color(0x8fa8c0) } };
    this.puddles = this.instanced(puddleGeo, PUDDLE_VERT, PUDDLE_FRAG, this.puddleU, GRID * GRID, 2);
  }

  private instanced(geo: THREE.BufferGeometry, vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, count: number, order: number): THREE.InstancedMesh {
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, uniforms });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    // identity matrices: all positioning is in the shader
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    this.scene.add(mesh);
    this.geometries.push(geo);
    this.materials.push(mat);
    return mesh;
  }

  /**
   * @param density  0..1 rain (0 hides streaks and splashes outright — clear weather draws nothing)
   * @param wind     sideways drift, world units per second
   * @param wet      0..1 how wet the ground is (puddles; they stay a while after the rain)
   * @param budget   0..1.5 the particle budget (preset × AUTO)
   * @param sky      the haze colour, which the puddles reflect and the rain takes on
   */
  update(realDt: number, focus: THREE.Vector3, yaw: number, density: number, wind = 0, wet = 0, budget = 1, sky?: THREE.Color): void {
    const d = Number.isFinite(density) ? Math.max(0, Math.min(1, density)) : 0;
    const w = Number.isFinite(wet) ? Math.max(0, Math.min(1, wet)) : 0;
    const b = Number.isFinite(budget) ? Math.max(0.3, Math.min(1.5, budget)) : 1;
    this.streaks.visible = d > 0.01;
    this.splashes.visible = d > 0.01 && b > 0.45;
    this.puddles.visible = w > 0.02;
    if (!this.streaks.visible && !this.puddles.visible) return;
    const dt = Number.isFinite(realDt) ? Math.max(0, realDt) : 0;
    this.clock += dt;
    this.drift = (this.drift + wind * dt) % 10000;
    this.shared.uTime.value = this.clock;
    this.shared.uFocus.value.copy(focus);
    this.streaks.count = Math.max(1, Math.min(COUNT, Math.round(COUNT * d * Math.min(1, b + 0.2))));
    this.splashes.count = Math.max(1, Math.min(SPLASHES, Math.round(SPLASHES * d * b)));
    this.streakU.uYaw.value = yaw;
    this.streakU.uDrift.value = this.drift;
    this.streakU.uWind.value = wind;
    this.streakU.uOpacity.value = 0.45 + d * 0.25;
    this.splashU.uOpacity.value = 0.55 + d * 0.25;
    this.puddleU.uWet.value = w;
    this.puddleU.uRain.value = d;
    if (sky) {
      this.puddleU.uSky.value.copy(sky);
      // the rain takes on the light of the sky: pale by day, blue-grey at night
      this.streakU.uColor.value.copy(sky).lerp(WHITE, 0.55);
      this.splashU.uColor.value.copy(sky).lerp(WHITE, 0.65);
    }
  }

  get visible(): boolean {
    return this.streaks.visible;
  }

  /** For tests and the report: what is drawn right now. */
  get parts(): { streaks: number; splashes: number; puddles: boolean } {
    return {
      streaks: this.streaks.visible ? this.streaks.count : 0,
      splashes: this.splashes.visible ? this.splashes.count : 0,
      puddles: this.puddles.visible,
    };
  }

  dispose(): void {
    this.scene.remove(this.streaks, this.splashes, this.puddles);
    this.streaks.dispose();
    this.splashes.dispose();
    this.puddles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const WHITE = new THREE.Color(0xffffff);
