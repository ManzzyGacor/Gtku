/**
 * Rain, for the developer menu's weather switch (and the weather system Batch 7 will add).
 *
 * One `InstancedMesh`, one draw call, and **no per-frame CPU work**: every streak's position is
 * computed in the vertex shader from a seed and the time, wrapped into a box that follows the
 * camera. That matters on a phone — a few hundred particles updated from JavaScript every frame is
 * a visible cost; the same particles animated by the GPU are close to free.
 *
 * Invisible (and so not drawn at all) whenever the weather has no rain, which is always, unless
 * someone asked for it.
 */
import * as THREE from 'three';

const COUNT = 420;
/** Half-size of the box the rain fills around the camera focus, in world units. */
const SPREAD = 24;
const HEIGHT = 16;

const VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uFocus;
uniform float uYaw;
varying float vFade;
void main() {
  // each streak falls at its own speed from its own starting height, wrapping forever
  float speed = 17.0 + aSeed.z * 8.0;
  float y = mod(aSeed.z * 97.0 - uTime * speed, ${HEIGHT.toFixed(1)});
  vec3 base = vec3(
    uFocus.x + (aSeed.x - 0.5) * ${(SPREAD * 2).toFixed(1)},
    y,
    uFocus.z + (aSeed.y - 0.5) * ${(SPREAD * 2).toFixed(1)}
  );
  // face the fixed camera yaw so a streak is never seen edge-on
  vec3 right = vec3(cos(uYaw), 0.0, -sin(uYaw));
  vec3 p = base + right * position.x + vec3(0.0, position.y, 0.0);
  // thin out near the ground and the top, so the box edges never show
  vFade = smoothstep(0.0, 2.0, y) * (1.0 - smoothstep(${(HEIGHT - 3).toFixed(1)}, ${HEIGHT.toFixed(1)}, y));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}`;

export class Rain {
  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private clock = 0;

  constructor(private readonly scene: THREE.Scene) {
    // a streak: very thin, fairly long
    this.geometry = new THREE.PlaneGeometry(0.035, 0.7);
    const seeds = new Float32Array(COUNT * 3);
    // deterministic scatter, so the rain looks the same every time it starts
    let s = 1234567;
    const rand = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < COUNT; i++) {
      seeds[i * 3] = rand();
      seeds[i * 3 + 1] = rand();
      seeds[i * 3 + 2] = rand();
    }
    this.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFocus: { value: new THREE.Vector3() },
        uYaw: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0xaec6e8) },
      },
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, COUNT);
    // identity matrices: all positioning is in the shader
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * `density` 0..1 from the weather table. Zero hides the mesh outright, so clear weather costs
   * nothing — not a transparent draw of 420 invisible quads.
   */
  update(realDt: number, focus: THREE.Vector3, yaw: number, density: number): void {
    const d = Number.isFinite(density) ? Math.max(0, Math.min(1, density)) : 0;
    this.mesh.visible = d > 0.01;
    if (!this.mesh.visible) return;
    this.clock += realDt;
    this.mesh.count = Math.max(1, Math.round(COUNT * d));
    const u = this.material.uniforms;
    u.uTime.value = this.clock;
    u.uFocus.value.copy(focus);
    u.uYaw.value = yaw;
    u.uOpacity.value = 0.35 + d * 0.3;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
