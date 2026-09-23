/**
 * The rippling water surface, one overlay plane per chunk that has any water in it.
 *
 * The baked ground already contains the water *pixels*; this adds the movement. Two crossing wave
 * trains are sampled from world coordinates (so ripples continue across chunk borders) and then
 * **quantised into four bands**, because a smooth gradient would look wrong next to hand-placed
 * pixel art. The crests pick up the sky colour, which is as much reflection as a phone can afford.
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
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
varying vec2 vMaskUv;
varying vec3 vWorld;
varying float vDepth;

void main() {
  vec4 mask = texture2D(tMask, vMaskUv);
  if (mask.a < 0.5) discard;

  float wave = sin(vWorld.x * 2.2 + uTime * 1.7)
             + sin(vWorld.z * 2.7 - uTime * 1.3)
             + sin((vWorld.x + vWorld.z) * 1.4 + uTime * 2.3);
  // four bands: pixel art, not a gradient
  float band = floor(clamp(wave * 0.33 + 0.5, 0.0, 0.999) * 4.0) / 3.0;

  vec3 c = mix(uShallow, uDeep, mask.r);
  c = mix(c, uSky, band * 0.4);
  float alpha = 0.34 + band * 0.26;

  // the same distance fog the rest of the world uses, applied by hand
  float fog = clamp((vDepth - uFogRange.x) / max(0.001, uFogRange.y - uFogRange.x), 0.0, 1.0);
  c = mix(c, uFogColor, fog);
  gl_FragColor = vec4(c, alpha * (1.0 - fog * 0.85));
}`;

export interface WaterUniforms {
  uTime: { value: number };
  uSky: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogRange: { value: THREE.Vector2 };
}

/** Uniform bag shared by every chunk's water plane. */
export function makeWaterUniforms(): WaterUniforms {
  return {
    uTime: { value: 0 },
    uSky: { value: new THREE.Color(0x9fc4e8) },
    uFogColor: { value: new THREE.Color(0x9fc4e8) },
    uFogRange: { value: new THREE.Vector2(70, 110) },
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
  ) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      // No depth writes: the water is a skin on the ground, and the outline pass must not see it.
      depthWrite: false,
      uniforms: {
        tMask: { value: maskTexture },
        uShallow: { value: new THREE.Color(P.w3) },
        uDeep: { value: new THREE.Color(P.w1) },
        uTime: shared.uTime,
        uSky: shared.uSky,
        uFogColor: shared.uFogColor,
        uFogRange: shared.uFogRange,
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
