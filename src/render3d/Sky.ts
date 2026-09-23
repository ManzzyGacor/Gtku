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
varying vec2 vScreen;

void main() {
  float t = smoothstep(0.0, 1.0, vScreen.y);
  vec3 c = mix(uHaze, uTop, t);
  // A 270 px buffer bands badly on a smooth gradient, so dither with a 2x2 ordered pattern.
  vec2 p = mod(gl_FragCoord.xy, 2.0);
  float d = (p.x * 0.5 + p.y * 0.25) - 0.375;
  gl_FragColor = vec4(c + d / 255.0 * 3.0, 1.0);
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
   * @param near     where fog starts, in world units
   * @param far      where fog reaches the backdrop colour — keep this inside the streamed radius
   */
  update(dayTime: number, cave: number, near: number, far: number): void {
    const sky: SkyColors = blendSky(skyAt(dayTime), cave);
    const top = this.material.uniforms.uTop.value as THREE.Color;
    top.setRGB(sky.top[0], sky.top[1], sky.top[2]);
    const haze = this.material.uniforms.uHaze.value as THREE.Color;
    haze.setRGB(sky.haze[0], sky.haze[1], sky.haze[2]);
    this.haze.copy(haze);
    this.fog.color.copy(haze);
    // Inside the cave the fog closes in: you should never see the whole cavern at once.
    this.fog.near = near * (1 - cave * 0.55);
    this.fog.far = far * (1 - cave * 0.5);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.scene.fog = null;
    this.geometry.dispose();
    this.material.dispose();
  }
}
