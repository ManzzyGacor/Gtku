/**
 * The backdrop and the distance fog.
 *
 * Because the camera is orthographic there is no vanishing point: an infinite ground plane would
 * simply fill the screen, and our finite world instead just *stops*, which is what made the edge
 * look empty. Two things fix that together:
 *
 *   1. a screen-space gradient drawn at the far plane, so whatever is beyond the world is sky/haze
 *      rather than a flat clear colour;
 *   2. linear distance fog dyed the same haze colour, so the far ground dissolves into that
 *      backdrop — and, as a bonus, hides the edge of the streamed chunks.
 *
 * The quad ignores the camera matrices entirely (it writes clip space directly), which is the only
 * way to cover the screen under an orthographic projection. It writes no depth, so the pixel-outline
 * pass still draws a clean silhouette against it.
 */
import * as THREE from 'three';
import { blendSky, skyAt, type SkyColors } from '../core/systems/daynight';

const VERT = /* glsl */ `
varying vec2 vScreen;
void main() {
  vScreen = position.xy * 0.5 + 0.5;
  // z = 1 puts the quad on the far plane no matter what the camera is doing
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uTop;
uniform vec3 uHaze;
uniform float uStars;
uniform float uTime;
varying vec2 vScreen;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Bayer 4x4 as arithmetic (GLSL ES 1.0 has no bit ops), for banding-free gradients.
float bayer2(float x, float y) {
  float d = mod(x + y, 2.0);
  return d * (2.0 + y) + (1.0 - d) * x;
}
float dither(vec2 p) {
  vec2 lo = mod(p, 2.0);
  vec2 hi = mod(floor(p * 0.5), 2.0);
  return (4.0 * bayer2(lo.x, lo.y) + bayer2(hi.x, hi.y) + 0.5) / 16.0 - 0.5;
}

void main() {
  // Two-stage ramp: a fast fall near the horizon and a slow one above it reads much more like sky
  // than a single linear blend, which is what made the first version look flat.
  float y = clamp(vScreen.y, 0.0, 1.0);
  float lowBlend = smoothstep(0.0, 0.42, y);
  float highBlend = smoothstep(0.30, 1.0, y);
  vec3 horizon = mix(uHaze, uTop, 0.35);
  vec3 c = mix(mix(uHaze, horizon, lowBlend), uTop, highBlend);

  // Stars: fixed to the screen, which is correct — the camera never rotates and the sky is at
  // infinity. Only above the horizon haze, and only once it is actually dark.
  if (uStars > 0.01) {
    vec2 cell = floor(gl_FragCoord.xy / 2.0);
    float r = hash(cell);
    if (r > 0.9975) {
      float twinkle = 0.55 + 0.45 * sin(uTime * 2.0 + r * 120.0);
      float high = smoothstep(0.25, 0.75, y);
      c += vec3(0.85, 0.88, 1.0) * uStars * high * twinkle * (0.5 + hash(cell + 7.0) * 0.5);
    }
  }

  // A low-resolution buffer bands badly on a smooth gradient; one LSB of ordered noise removes it.
  gl_FragColor = vec4(c + dither(gl_FragCoord.xy) * (2.0 / 255.0), 1.0);
}`;

export class Sky {
  readonly fog = new THREE.Fog(0x0f0b1c, 10, 60);
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private geometry = new THREE.PlaneGeometry(2, 2);
  /** Current haze colour, for the renderer's clear colour. */
  readonly haze = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2a3f70) },
        uHaze: { value: new THREE.Color(0x8fa8c0) },
        uStars: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // drawn before everything else, and it never occludes because it writes no depth
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
    // Set the fog up front: materials compiled later then include the fog chunks from the start.
    scene.fog = this.fog;
  }

  /**
   * @param dayTime  day fraction (0 = midnight)
   * @param cave     0..1 how deep inside the cave the camera is
   * @param near     where fog starts, distance from the camera (see `fogDistances`)
   * @param far      where fog reaches the backdrop colour — keep this inside the streamed radius
   */
  update(dayTime: number, cave: number, near: number, far: number, night = 0, clock = 0): void {
    const sky: SkyColors = blendSky(skyAt(dayTime), cave);
    const top = this.material.uniforms.uTop.value as THREE.Color;
    top.setRGB(sky.top[0], sky.top[1], sky.top[2]);
    const haze = this.material.uniforms.uHaze.value as THREE.Color;
    haze.setRGB(sky.haze[0], sky.haze[1], sky.haze[2]);
    this.haze.copy(haze);
    this.fog.color.copy(haze);
    // Stars fade in with the night and are invisible underground.
    this.material.uniforms.uStars.value = Math.max(0, (night - 0.35) / 0.65) * (1 - cave);
    this.material.uniforms.uTime.value = clock;
    // final distances, already shaped by weather, night and cave (core/systems/weather fogDistances)
    this.fog.near = near;
    this.fog.far = far;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.scene.fog = null;
    this.geometry.dispose();
    this.material.dispose();
  }
}
