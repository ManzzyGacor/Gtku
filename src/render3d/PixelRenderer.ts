/**
 * The pixel pipeline (docs/OVERHAUL.md §3).
 *
 *   scene ──► low-resolution render target ──► full-screen quad ──► canvas (always full screen)
 *
 * Three independent things, which the first version wrongly tangled together:
 *   • **the canvas** always covers the whole screen at device resolution. The final blit is one
 *     textured quad, so this costs nothing and it is the only way to guarantee no letterboxing.
 *   • **pixelHeight** — the art-directed pixel grid (270…540 rows). It decides how big a "pixel"
 *     looks and nothing else. It no longer changes the framing.
 *   • **renderScale** — the performance dial, which shrinks the render target below the pixel grid.
 *
 * The upscale uses *sharp bilinear*: nearest-neighbour everywhere except a sub-pixel-wide ramp at
 * texel boundaries. At a whole-number scale that is identical to nearest; at a fractional one (540
 * rows on a 759-row screen) it keeps the pixels hard-edged without the crawling that plain nearest
 * produces when texel and pixel grids disagree.
 *
 * The same quad pass draws the pixel outline from neighbouring depths, a soft bloom of the
 * brightest areas, a gentle colour grade and a thin vignette.
 */
import * as THREE from 'three';
import { recordError } from '../core/errors';
import { planPixelBuffers, type PixelPlan } from './pixelPlan';

// The palette is authored as literal bytes; see textures.ts.
THREE.ColorManagement.enabled = false;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Composite pass: outline, bloom, colour grade and vignette — run at **render-target** resolution.
 *
 * The first version did all of this in the final blit, i.e. at full canvas resolution. On the test
 * phone that meant six texture samples across 1.76 million pixels every frame, when the picture
 * being composited only had 0.89 million. Doing it here and blitting the result costs roughly half.
 */
const COMPOSITE_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uTexel;       // 1 / render-target size
uniform float uOutline;
uniform float uThreshold;
uniform float uBloom;
uniform float uVignette;
uniform vec3 uGradeLift;   // pushed into the shadows (the night's blue)
uniform vec3 uGradeGain;   // multiplied into the highlights (the lanterns' warmth)
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec3 c = texture2D(tColor, uv).rgb;

  if (uOutline > 0.5) {
    float d = texture2D(tDepth, uv).x;
    // Only the *far* side of a silhouette darkens, so the outline hugs the shape in front of it.
    float nearest = min(
      min(texture2D(tDepth, uv + vec2(-uTexel.x, 0.0)).x, texture2D(tDepth, uv + vec2(uTexel.x, 0.0)).x),
      min(texture2D(tDepth, uv + vec2(0.0, -uTexel.y)).x, texture2D(tDepth, uv + vec2(0.0, uTexel.y)).x)
    );
    if (d - nearest > uThreshold) c *= 0.52;
  }

  // Bloom: a blurred copy of the bright areas, added back. This is what makes lanterns glow.
  if (uBloom > 0.0) {
    vec3 glow = texture2D(tBloom, uv).rgb;
    c += glow * uBloom;
  }

  // Colour grade: lift the shadows toward the night's blue, warm the highlights.
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = c * mix(uGradeGain, vec3(1.0), 1.0 - luma) + uGradeLift * (1.0 - luma);

  // Vignette, kept thin so it reads as lens falloff rather than a dark frame.
  vec2 v = vUv - 0.5;
  float vig = 1.0 - uVignette * dot(v, v) * 1.6;
  gl_FragColor = vec4(clamp(c * vig, 0.0, 1.0), 1.0);
}`;

/**
 * Final blit: one sharp-bilinear sample of the composited image onto the canvas.
 *
 * Sharp bilinear snaps to texel centres and then allows a single screen pixel of ramp across the
 * boundary — identical to nearest at whole-number scales, but without the crawling that plain
 * nearest produces when the texel and pixel grids disagree (540 art rows on a 759-row screen).
 */
const BLIT_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tSrc;
uniform vec2 uSize;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 pixels = vUv * uSize;
  vec2 base = floor(pixels) + 0.5;
  vec2 ramp = max(fwidth(pixels), vec2(0.0001));
  vec2 uv = (base + clamp((pixels - base) / ramp, -0.5, 0.5)) * uTexel;
  gl_FragColor = vec4(texture2D(tSrc, uv).rgb, 1.0);
}`;

/** Separable blur used to build the bloom, run at quarter resolution. */
const BLUR_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tSrc;
uniform vec2 uStep;
uniform float uCutoff;
uniform float uPrefilter;
varying vec2 vUv;
void main() {
  vec3 sum = vec3(0.0);
  // 9-tap Gaussian
  const float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
  sum += texture2D(tSrc, vUv).rgb * w0;
  sum += texture2D(tSrc, vUv + uStep * 1.0).rgb * w1;
  sum += texture2D(tSrc, vUv - uStep * 1.0).rgb * w1;
  sum += texture2D(tSrc, vUv + uStep * 2.0).rgb * w2;
  sum += texture2D(tSrc, vUv - uStep * 2.0).rgb * w2;
  sum += texture2D(tSrc, vUv + uStep * 3.0).rgb * w3;
  sum += texture2D(tSrc, vUv - uStep * 3.0).rgb * w3;
  sum += texture2D(tSrc, vUv + uStep * 4.0).rgb * w4;
  sum += texture2D(tSrc, vUv - uStep * 4.0).rgb * w4;
  if (uPrefilter > 0.5) {
    // keep only what is brighter than the cutoff, so only real light sources bloom
    float luma = dot(sum, vec3(0.299, 0.587, 0.114));
    sum *= smoothstep(uCutoff, uCutoff + 0.35, luma);
  }
  gl_FragColor = vec4(sum, 1.0);
}`;

export type { PixelPlan };

export interface GradeSettings {
  bloom: number;
  vignette: number;
  lift: THREE.Color;
  gain: THREE.Color;
}

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly canvas: HTMLCanvasElement;
  plan: PixelPlan = planPixelBuffers(640, 360, 1, 360, 1);

  private target: THREE.WebGLRenderTarget;
  private composite: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private blitScene = new THREE.Scene();
  private blurScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadMaterial: THREE.ShaderMaterial;
  private blitMaterial: THREE.ShaderMaterial;
  private blurMaterial: THREE.ShaderMaterial;
  private bloomEnabled = true;
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

    this.target = this.makeTarget(this.plan.renderW, this.plan.renderH, true);
    this.composite = this.makeTarget(this.plan.renderW, this.plan.renderH, false);
    this.composite.texture.minFilter = THREE.NearestFilter;
    this.composite.texture.magFilter = THREE.NearestFilter;
    this.bloomA = this.makeTarget(1, 1, false);
    this.bloomB = this.makeTarget(1, 1, false);

    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tSrc: { value: null },
        uStep: { value: new THREE.Vector2() },
        uCutoff: { value: 0.62 },
        uPrefilter: { value: 1 },
      },
    });
    const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    blurQuad.frustumCulled = false;
    this.blurScene.add(blurQuad);

    this.quadMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        tBloom: { value: this.bloomB.texture },
        uTexel: { value: new THREE.Vector2(1 / this.plan.renderW, 1 / this.plan.renderH) },
        uOutline: { value: 0 },
        uThreshold: { value: 0.0016 },
        uBloom: { value: 0.55 },
        uVignette: { value: 0.3 },
        uGradeLift: { value: new THREE.Color(0, 0, 0) },
        uGradeGain: { value: new THREE.Color(1, 1, 1) },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMaterial);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tSrc: { value: this.composite.texture },
        uSize: { value: new THREE.Vector2(this.plan.renderW, this.plan.renderH) },
        uTexel: { value: new THREE.Vector2(1 / this.plan.renderW, 1 / this.plan.renderH) },
      },
    });
    const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    blit.frustumCulled = false;
    this.blitScene.add(blit);
  }

  private makeTarget(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: depth,
      colorSpace: THREE.NoColorSpace,
    };
    if (depth) {
      const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      opts.depthTexture = depthTexture;
    }
    const rt = new THREE.WebGLRenderTarget(w, h, opts);
    // The scene target is sampled texel-exactly by the sharp-bilinear upscale.
    if (depth) {
      rt.texture.minFilter = THREE.NearestFilter;
      rt.texture.magFilter = THREE.NearestFilter;
    }
    return rt;
  }

  /**
   * Re-plan the buffers so the canvas fills the screen exactly.
   *
   * @param pixelHeight rows in the art grid (the "pixel size" dial)
   * @param renderScale fraction of that actually rendered (the performance dial)
   */
  resize(cssW: number, cssH: number, dpr: number, pixelHeight: number, renderScale: number, canvasScale = 1): PixelPlan {
    const plan = planPixelBuffers(cssW, cssH, dpr, pixelHeight, renderScale, canvasScale);
    const { canvasW, canvasH, renderW, renderH } = plan;
    this.plan = plan;

    this.renderer.setSize(canvasW, canvasH, false);
    // CSS always covers the whole viewport; the browser stretches the (possibly smaller) buffer.
    this.canvas.style.width = `${plan.cssW}px`;
    this.canvas.style.height = `${plan.cssH}px`;

    if (this.target.width !== renderW || this.target.height !== renderH) {
      this.target.setSize(renderW, renderH);
      this.target.depthTexture?.dispose();
      const depthTexture = new THREE.DepthTexture(renderW, renderH, THREE.UnsignedIntType);
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      this.target.depthTexture = depthTexture;
      this.quadMaterial.uniforms.tDepth.value = depthTexture;
      this.composite.setSize(renderW, renderH);
      const bw = Math.max(32, Math.round(renderW / 4));
      const bh = Math.max(18, Math.round(renderH / 4));
      this.bloomA.setSize(bw, bh);
      this.bloomB.setSize(bw, bh);
    }
    this.quadMaterial.uniforms.uTexel.value.set(1 / renderW, 1 / renderH);
    this.blitMaterial.uniforms.uSize.value.set(renderW, renderH);
    this.blitMaterial.uniforms.uTexel.value.set(1 / renderW, 1 / renderH);
    return this.plan;
  }

  setOutline(on: boolean): void {
    this.quadMaterial.uniforms.uOutline.value = on && this.canOutline ? 1 : 0;
  }

  get outlineOn(): boolean {
    return this.quadMaterial.uniforms.uOutline.value === 1;
  }

  /** Bloom strength, vignette depth and the colour grade, all driven by time of day. */
  setGrade(g: GradeSettings): void {
    this.bloomEnabled = g.bloom > 0.001;
    this.quadMaterial.uniforms.uBloom.value = g.bloom;
    this.quadMaterial.uniforms.uVignette.value = g.vignette;
    (this.quadMaterial.uniforms.uGradeLift.value as THREE.Color).copy(g.lift);
    (this.quadMaterial.uniforms.uGradeGain.value as THREE.Color).copy(g.gain);
  }

  /**
   * What the last frame cost, read *after* all of its passes.
   *
   * `renderer.info` resets itself at the start of every `render()` call by default, and a frame
   * here is four or five calls (scene, bloom ×2, composite, blit). The report read it after the
   * last one — the blit quad — and printed "1 draw call, 0k triangles" for a full 3D scene. Now it
   * is reset once per frame, and the scene pass's own numbers are kept separately.
   */
  readonly frameStats = { sceneCalls: 0, sceneTriangles: 0, calls: 0, triangles: 0, sceneMs: 0, postMs: 0, gpuSceneMs: -1, gpuPostMs: -1 };
  private gpu: GpuTimer | null = null;

  render(camera: THREE.Camera): void {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.gpu ??= GpuTimer.create(this.renderer.getContext());
    const t0 = now();
    this.gpu?.begin(0);
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    this.gpu?.end();
    const t1 = now();
    this.frameStats.sceneCalls = info.render.calls;
    this.frameStats.sceneTriangles = info.render.triangles;
    this.gpu?.begin(1);

    if (this.bloomEnabled) {
      // bright pass + horizontal blur, then vertical blur
      this.blurMaterial.uniforms.tSrc.value = this.target.texture;
      this.blurMaterial.uniforms.uPrefilter.value = 1;
      this.blurMaterial.uniforms.uStep.value.set(1 / this.bloomA.width, 0);
      this.renderer.setRenderTarget(this.bloomA);
      this.renderer.render(this.blurScene, this.quadCamera);

      this.blurMaterial.uniforms.tSrc.value = this.bloomA.texture;
      this.blurMaterial.uniforms.uPrefilter.value = 0;
      this.blurMaterial.uniforms.uStep.value.set(0, 1 / this.bloomB.height);
      this.renderer.setRenderTarget(this.bloomB);
      this.renderer.render(this.blurScene, this.quadCamera);
    }

    // composite at render-target resolution, then one cheap sample per screen pixel
    this.renderer.setRenderTarget(this.composite);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.quadCamera);
    this.gpu?.end();
    const fs = this.frameStats;
    fs.sceneMs = t1 - t0;
    fs.postMs = now() - t1;
    fs.calls = info.render.calls;
    fs.triangles = info.render.triangles;
    if (this.gpu) {
      this.gpu.poll();
      fs.gpuSceneMs = this.gpu.ms[0];
      fs.gpuPostMs = this.gpu.ms[1];
    }
  }

  /** Whether a GPU timer is available on this device (EXT_disjoint_timer_query_webgl2). */
  get gpuTiming(): boolean {
    return !!this.gpu;
  }

  /** Whether bloom passes run this frame (for the probe's check that "no bloom" really is none). */
  get bloomOn(): boolean {
    return this.bloomEnabled;
  }

  /** Draw calls of the whole last frame, for the report. */
  get drawCalls(): number {
    return this.frameStats.calls;
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.composite.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.quadMaterial.dispose();
    this.blitMaterial.dispose();
    this.blurMaterial.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/**
 * GPU time of the scene pass and of the post passes, where the phone offers
 * `EXT_disjoint_timer_query_webgl2` (many Android GPUs do; iOS does not).
 *
 * CPU laps only say how long JavaScript took to *submit* the draw calls; the GPU works on them
 * later. This is the one way to know whether the graphics card itself is the bottleneck. Queries
 * finish a few frames late, so there is a small ring of them, polled each frame, averaged.
 */
class GpuTimer {
  readonly ms = new Float64Array(2).fill(-1);
  private readonly ring: { q: WebGLQuery; slot: number }[] = [];
  private active: { q: WebGLQuery; slot: number } | null = null;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerExt,
  ) {}

  static create(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer | null {
    try {
      const g2 = gl as WebGL2RenderingContext;
      if (typeof g2.createQuery !== 'function') return null;
      const ext = g2.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
      return ext && typeof ext.TIME_ELAPSED_EXT === 'number' ? new GpuTimer(g2, ext) : null;
    } catch {
      return null;
    }
  }

  begin(slot: number): void {
    // at most a handful in flight: a slow GPU simply gets fewer samples
    if (this.active || this.ring.length > 8) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = { q, slot };
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.ring.push(this.active);
    this.active = null;
  }

  poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.ring.length) {
      const head = this.ring[0];
      if (!gl.getQueryParameter(head.q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.ring.shift();
      if (!disjoint) {
        const ms = (gl.getQueryParameter(head.q, gl.QUERY_RESULT) as number) / 1e6;
        this.ms[head.slot] = this.ms[head.slot] < 0 ? ms : this.ms[head.slot] + (ms - this.ms[head.slot]) * 0.1;
      }
      gl.deleteQuery(head.q);
    }
  }
}
