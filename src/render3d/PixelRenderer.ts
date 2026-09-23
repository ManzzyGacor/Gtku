/**
 * The pixel pipeline (docs/OVERHAUL.md §3).
 *
 *   scene ──► low-resolution render target ──► full-screen quad (nearest) ──► canvas
 *
 * Two independent dials, exactly as the plan asks:
 *   • **pixelHeight** — the art-directed pixel grid (270…360 px tall). The canvas is sized to an
 *     integer multiple of it, so one texel lands on a whole number of device pixels and the art
 *     stays crisp instead of shimmering.
 *   • **renderScale** — the performance dial. It shrinks the render target *below* the pixel grid;
 *     the quad blows it back up. Lower = fewer fragments to shade, chunkier pixels.
 *
 * The same quad pass also draws the optional pixel outline by comparing neighbouring depths, which
 * costs one extra depth sample per side and needs no second geometry pass.
 */
import * as THREE from 'three';
import { planDisplay } from '../core/display';
import { recordError } from '../core/errors';

// The palette is authored as literal bytes; see textures.ts.
THREE.ColorManagement.enabled = false;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const QUAD_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uOutline;
uniform float uThreshold;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tColor, vUv);
  if (uOutline > 0.5) {
    float d = texture2D(tDepth, vUv).x;
    // Only the *far* side of a silhouette darkens, so the outline hugs the shape in front of it.
    float nearest = min(
      min(texture2D(tDepth, vUv + vec2(-uTexel.x, 0.0)).x, texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x),
      min(texture2D(tDepth, vUv + vec2(0.0, -uTexel.y)).x, texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x)
    );
    if (d - nearest > uThreshold) c.rgb *= 0.52;
  }
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

export interface PixelPlan {
  /** The art-directed pixel grid. */
  pixelW: number;
  pixelH: number;
  /** Device pixels per pixel-grid cell. */
  zoom: number;
  /** Actual render-target size (pixel grid × renderScale). */
  renderW: number;
  renderH: number;
}

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly canvas: HTMLCanvasElement;
  plan: PixelPlan = { pixelW: 480, pixelH: 270, zoom: 1, renderW: 480, renderH: 270 };

  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadMaterial: THREE.ShaderMaterial;
  /** False when the device can't give us a depth texture; the outline is then skipped. */
  readonly canOutline: boolean;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.imageRendering = 'pixelated';
    parent.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1); // we size the drawing buffer ourselves
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x0f0b1c, 1);
    this.canOutline = this.renderer.capabilities.isWebGL2;
    if (!this.canOutline) recordError('WebGL2 tidak tersedia: outline pixel dimatikan', 'PixelRenderer');

    this.target = this.makeTarget(this.plan.renderW, this.plan.renderH);
    this.quadMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / this.plan.renderW, 1 / this.plan.renderH) },
        uOutline: { value: 0 },
        uThreshold: { value: 0.0016 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMaterial);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      depthTexture,
      colorSpace: THREE.NoColorSpace,
    });
    return rt;
  }

  /**
   * Re-plan the buffers. `pixelHeight` is the art grid, `renderScale` the performance dial.
   * Returns the plan so the camera can re-fit its frustum.
   */
  resize(cssW: number, cssH: number, dpr: number, pixelHeight: number, renderScale: number): PixelPlan {
    const d = planDisplay(cssW, cssH, dpr, pixelHeight);
    const renderW = Math.max(64, Math.round(d.width * renderScale));
    const renderH = Math.max(36, Math.round(d.height * renderScale));
    const plan: PixelPlan = { pixelW: d.width, pixelH: d.height, zoom: d.zoom, renderW, renderH };
    this.plan = plan;

    // Drawing buffer is an exact integer multiple of the pixel grid; CSS scales it to the screen.
    this.renderer.setSize(plan.pixelW * plan.zoom, plan.pixelH * plan.zoom, false);
    this.canvas.style.width = `${(plan.pixelW * plan.zoom) / dpr}px`;
    this.canvas.style.height = `${(plan.pixelH * plan.zoom) / dpr}px`;

    if (this.target.width !== renderW || this.target.height !== renderH) {
      this.target.setSize(renderW, renderH);
      this.target.depthTexture?.dispose();
      const depthTexture = new THREE.DepthTexture(renderW, renderH, THREE.UnsignedIntType);
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      this.target.depthTexture = depthTexture;
      this.quadMaterial.uniforms.tDepth.value = depthTexture;
    }
    this.quadMaterial.uniforms.uTexel.value.set(1 / renderW, 1 / renderH);
    return plan;
  }

  setOutline(on: boolean): void {
    this.quadMaterial.uniforms.uOutline.value = on && this.canOutline ? 1 : 0;
  }

  render(camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /** Live draw calls / triangles, for the FPS overlay. */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.quadMaterial.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
