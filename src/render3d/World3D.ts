/**
 * Builds the 3D world from the plan in `worldPlan.ts` (docs/OVERHAUL.md, Fase 1).
 *
 * Performance rules from the plan are baked in from the start:
 *   • the ground is **one textured mesh per chunk**, reusing the existing 2D chunk baker, so the
 *     ground art in 3D *is* the ground art in 2D;
 *   • every prop and wall block is an **InstancedMesh**, grouped by (shape, texture) — a whole
 *     village is a handful of draw calls;
 *   • dynamic point lights come from a **fixed pool** that follows the camera, so the light count
 *     never depends on how much scenery is in view.
 */
import * as THREE from 'three';
import { CHUNK_PX, CHUNK_TILES } from '../config';
import { bakeChunk } from '../art/bake';
import { buildGreyboxTextures, type GreyboxTexture } from '../art/greybox';
import type { Sheet } from '../art/sheet';
import { ambientAt, nightAmount } from '../core/systems/daynight';
import type { TileRect, WorldSource } from '../core/world/source';
import { pixmapTexture } from './textures';
import { countKinds, groupShapes, planArea, u, type ShapeKind, type WorldPlan } from './worldPlan';

/**
 * Per-instance UV scaling. Without it a 16x16 texture stretches across whatever face it lands on
 * and every object ends up with differently sized pixels. `aSize` carries the instance's world
 * size; the vertex shader picks the two components facing the camera-facing normal.
 */
const UV_SCALE_CHUNK = /* glsl */ `
#ifdef USE_MAP
  vec3 faceNormal = abs(normal);
  vec2 uvScale = faceNormal.y > 0.5
    ? vec2(aSize.x, aSize.z)
    : (faceNormal.x > 0.5 ? vec2(aSize.z, aSize.y) : vec2(aSize.x, aSize.y));
  vMapUv *= uvScale;
#endif
`;

function patchUvScale(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec3 aSize;\n${shader.vertexShader}`.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>\n${UV_SCALE_CHUNK}`,
    );
  };
  // Instances with different UV scaling still share one program.
  material.customProgramCacheKey = () => 'uvscale';
}

export class World3D {
  readonly group = new THREE.Group();
  private textures: Partial<Record<GreyboxTexture, THREE.Texture>> = {};
  private groundMeshes: THREE.Mesh[] = [];
  private instanced: THREE.InstancedMesh[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  // lighting
  private hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a2f5e, 1);
  private sun = new THREE.DirectionalLight(0xfff2c0, 1.1);
  private pool: THREE.PointLight[] = [];
  private plan: WorldPlan | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: WorldSource,
    private readonly tileSheet: Sheet,
  ) {
    scene.add(this.group);
    this.sun.position.set(-0.4, 1, 0.3).multiplyScalar(40);
    scene.add(this.hemi, this.sun, this.sun.target);
  }

  /** How many dynamic point lights the current preset allows. */
  setLightBudget(n: number): void {
    while (this.pool.length > n) {
      const l = this.pool.pop()!;
      this.scene.remove(l);
      l.dispose();
    }
    while (this.pool.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 1.6);
      l.visible = false;
      this.scene.add(l);
      this.pool.push(l);
    }
  }

  setShadows(mode: 'off' | 'low' | 'high'): void {
    const on = mode !== 'off';
    this.sun.castShadow = on;
    if (on) {
      const size = mode === 'high' ? 1024 : 512;
      this.sun.shadow.mapSize.set(size, size);
      const extent = 28;
      const cam = this.sun.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = 1;
      cam.far = 120;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0012;
    }
    for (const m of this.instanced) {
      m.castShadow = on;
      m.receiveShadow = on;
    }
    for (const m of this.groundMeshes) m.receiveShadow = on;
  }

  // ───────────────────────── building ─────────────────────────

  build(rect: TileRect): WorldPlan {
    this.clear();
    const pix = buildGreyboxTextures();
    for (const [name, pm] of Object.entries(pix)) {
      this.textures[name as GreyboxTexture] = pixmapTexture(pm, { tile: true });
    }
    const plan = planArea(this.world, rect);
    this.plan = plan;
    this.buildGround(plan);
    this.buildShapes(plan);
    return plan;
  }

  /** One plane per chunk, textured with the very same bake the 2D renderer uses. */
  private buildGround(plan: WorldPlan): void {
    const geo = new THREE.PlaneGeometry(CHUNK_TILES, CHUNK_TILES);
    geo.rotateX(-Math.PI / 2);
    this.geometries.push(geo);
    for (const { cx, cy } of plan.chunks) {
      const pm = bakeChunk(this.world, this.tileSheet, cx, cy, 0);
      // Pixmap row 0 is north; a flat plane has v = 1 there, so the rows are flipped on upload.
      const tex = pixmapTexture(pm, { flipRows: true });
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(u(cx * CHUNK_PX) + CHUNK_TILES / 2, 0, u(cy * CHUNK_PX) + CHUNK_TILES / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.groundMeshes.push(mesh);
    }
  }

  private shapeGeometry(kind: ShapeKind): THREE.BufferGeometry {
    if (kind === 'prism') {
      // A 4-sided cone is a square pyramid: roofs and tree crowns.
      const g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      return g;
    }
    return new THREE.BoxGeometry(1, 1, 1);
  }

  private buildShapes(plan: WorldPlan): void {
    const groups = groupShapes(plan.shapes);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    for (const g of groups) {
      const geo = this.shapeGeometry(g.kind);
      this.geometries.push(geo);
      const map = this.textures[g.texture]!;
      const mat = g.emissive
        ? new THREE.MeshBasicMaterial({ map })
        : new THREE.MeshLambertMaterial({ map });
      patchUvScale(mat);
      this.materials.push(mat);

      const mesh = new THREE.InstancedMesh(geo, mat, g.shapes.length);
      const sizes = new Float32Array(g.shapes.length * 3);
      g.shapes.forEach((s, i) => {
        pos.set(s.x, s.y, s.z);
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rotY ?? 0);
        scale.set(s.sx, s.sy, s.sz);
        mesh.setMatrixAt(i, m4.compose(pos, quat, scale));
        mesh.setColorAt(i, color.setHex(s.color));
        sizes[i * 3] = s.sx;
        sizes[i * 3 + 1] = s.sy;
        sizes[i * 3 + 2] = s.sz;
      });
      geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 3));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = !g.emissive;
      mesh.receiveShadow = !g.emissive;
      this.group.add(mesh);
      this.instanced.push(mesh);
    }
  }

  // ───────────────────────── per frame ─────────────────────────

  /** Day/night colouring plus the nearest planned lights, moved into the light pool. */
  update(dayTime: number, focus: THREE.Vector3): void {
    const amb = ambientAt(dayTime);
    const night = nightAmount(dayTime);
    this.hemi.color.setRGB(amb[0], amb[1], amb[2]);
    this.hemi.intensity = 0.55 + (1 - night) * 0.5;
    this.sun.color.setRGB(Math.min(1, amb[0] * 1.15), amb[1], amb[2] * 0.95);
    this.sun.intensity = (1 - night) * 1.2;
    this.sun.position.copy(focus).add(new THREE.Vector3(-16, 40, 12));
    this.sun.target.position.copy(focus);

    if (!this.pool.length || !this.plan) return;
    const lights = this.plan.lights;
    // nearest-first, but only the ones that are actually on right now
    const active = lights
      .filter((l) => !l.nightOnly || night > 0.15)
      .map((l) => ({ l, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length);
    this.pool.forEach((p, i) => {
      const hit = active[i];
      if (!hit) {
        p.visible = false;
        return;
      }
      const l = hit.l;
      p.visible = true;
      p.position.set(l.x, l.y, l.z);
      p.color.setHex(l.color);
      p.distance = l.radius;
      p.intensity = l.intensity * (l.nightOnly ? Math.min(1, night * 2) : 1) * 2.2;
    });
  }

  private clear(): void {
    for (const m of this.groundMeshes) this.group.remove(m);
    for (const m of this.instanced) {
      this.group.remove(m);
      m.dispose();
    }
    this.groundMeshes = [];
    this.instanced = [];
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of Object.values(this.textures)) t?.dispose();
    this.geometries = [];
    this.materials = [];
    this.textures = {};
  }

  /** For the report: how much the plan actually produced. */
  stats(): { chunks: number; instances: number; draws: number; lights: number } {
    return {
      chunks: this.groundMeshes.length,
      instances: this.plan ? this.plan.shapes.length : 0,
      draws: this.groundMeshes.length + this.instanced.length,
      lights: this.pool.length,
    };
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group, this.hemi, this.sun, this.sun.target);
    this.setLightBudget(0);
  }
}

export { countKinds };
