/**
 * The water surface: one overlay plane per chunk that has any water in it.
 *
 * The baked ground already contains the water *pixels*; this adds everything that moves. Modelled
 * on `docs/reference/referensi-visual.png`, which has five separate things going on in its river:
 *
 *   1. a **depth gradient** — near-black in the channel, bright teal in the shallows;
 *   2. **animated ripples** from two crossing wave trains, quantised into bands so they read as
 *      pixel art rather than as a smooth gradient;
 *   3. a **foam line** hugging the bank, which the mask's shore-distance channel locates;
 *   4. **reflections** — the sky on the crests, and the warm pools of the baked lamp light smeared
 *      across the surface (faked, but it is the single biggest thing the first version lacked);
 *   5. **sparkles** — a few bright specular glints that blink on and off.
 */
import * as THREE from 'three';
import { CHUNK_TILES } from '../config';
import { P } from '../art/palette';

const VERT = /* glsl */ `
varying vec2 vMaskUv;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vMaskUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tMask;
uniform sampler2D tLight;
uniform float uHasLight;
uniform float uLightStrength;
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
varying vec2 vMaskUv;
varying vec3 vWorld;
varying float vDepth;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 mask = texture2D(tMask, vMaskUv);
  if (mask.a < 0.5) discard;
  float deep = mask.r;
  float shore = mask.g;   // 0 at the bank, 1 two tiles out

  // ── ripples: two coarse trains plus a finer one, quantised into bands ──
  float coarse = sin(vWorld.x * 1.9 + uTime * 1.5)
               + sin(vWorld.z * 2.3 - uTime * 1.1)
               + sin((vWorld.x + vWorld.z) * 1.2 + uTime * 2.0);
  float fine = sin((vWorld.x - vWorld.z) * 6.1 + uTime * 3.4) * 0.5
             + sin((vWorld.x * 0.7 + vWorld.z * 1.3) * 7.7 - uTime * 2.6) * 0.5;
  float wave = coarse * 0.33 + fine * 0.22;
  float band = floor(clamp(wave * 0.5 + 0.5, 0.0, 0.999) * 5.0) / 4.0;

  // ── base colour: deep channel to bright shallows, lighter again right at the bank ──
  vec3 c = mix(uShallow, uDeep, deep * (0.35 + shore * 0.65));
  c = mix(c, uShallow, (1.0 - shore) * 0.45);

  // ── crests pick up the sky; this is the cheap reflection ──
  c = mix(c, uSky, band * 0.42 * (0.4 + deep * 0.6));

  // ── the warm pools of lamp light, reflected and smeared along the ripples ──
  if (uHasLight > 0.5) {
    vec3 lamp = texture2D(tLight, vMaskUv + vec2(0.0, band * 0.02)).rgb;
    c += lamp * uLightStrength * (0.35 + band * 0.75);
  }

  // ── foam: a bright band right along the bank, breathing with the swell ──
  float foamEdge = smoothstep(0.34, 0.0, shore);
  float foam = foamEdge * (0.45 + band * 0.55);
  c = mix(c, uFoam, clamp(foam, 0.0, 0.9));

  // ── sparkles: a handful of blinking glints on the open water ──
  vec2 cell = floor(vWorld.xz * 3.0);
  float r = hash(cell);
  if (r > 0.986) {
    float blink = max(0.0, sin(uTime * 2.6 + r * 90.0));
    c += vec3(0.9, 0.97, 1.0) * blink * blink * 0.7 * deep;
  }

  float alpha = 0.55 + band * 0.25 + foamEdge * 0.25;

  // the same distance fog the rest of the world uses, applied by hand
  float fog = clamp((vDepth - uFogRange.x) / max(0.001, uFogRange.y - uFogRange.x), 0.0, 1.0);
  c = mix(c, uFogColor, fog);
  gl_FragColor = vec4(c, clamp(alpha, 0.0, 1.0) * (1.0 - fog * 0.85));
}`;

export interface WaterUniforms {
  uTime: { value: number };
  uSky: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogRange: { value: THREE.Vector2 };
  /** How strongly the baked lamp pools show up on the water (faded with the night). */
  uLightStrength: { value: number };
}

/** Uniform bag shared by every chunk's water plane. */
export function makeWaterUniforms(): WaterUniforms {
  return {
    uTime: { value: 0 },
    uSky: { value: new THREE.Color(0x9fc4e8) },
    uFogColor: { value: new THREE.Color(0x9fc4e8) },
    uFogRange: { value: new THREE.Vector2(70, 110) },
    uLightStrength: { value: 0 },
  };
}

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(
    geometry: THREE.BufferGeometry,
    maskTexture: THREE.Texture,
    shared: WaterUniforms,
    cx: number,
    cy: number,
    lightMap: THREE.Texture | null,
  ) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      // No depth writes: the water is a skin on the ground, and the outline pass must not see it.
      depthWrite: false,
      uniforms: {
        tMask: { value: maskTexture },
        tLight: { value: lightMap },
        uHasLight: { value: lightMap ? 1 : 0 },
        uShallow: { value: new THREE.Color(P.w4) },
        uDeep: { value: new THREE.Color(P.w0) },
        uFoam: { value: new THREE.Color(P.w6) },
        uTime: shared.uTime,
        uSky: shared.uSky,
        uFogColor: shared.uFogColor,
        uFogRange: shared.uFogRange,
        uLightStrength: shared.uLightStrength,
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    // a hair above the ground so it never z-fights with the baked tiles
    this.mesh.position.set(cx * CHUNK_TILES + CHUNK_TILES / 2, 0.03, cy * CHUNK_TILES + CHUNK_TILES / 2);
    this.mesh.renderOrder = 2;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.material.dispose();
    (this.material.uniforms.tMask.value as THREE.Texture | null)?.dispose();
  }
}
