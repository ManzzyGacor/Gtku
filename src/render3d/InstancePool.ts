/**
 * One `InstancedMesh` shared by every loaded chunk that needs the same (shape, texture, lit)
 * combination — so a streamed world still draws in a handful of calls instead of one per chunk.
 *
 * Slots are handed out from the front and released with a swap-remove: when a chunk unloads, the
 * last live instances are copied over the holes it leaves and `count` shrinks. That keeps the live
 * range compact (the GPU only processes what is on screen) and costs one buffer upload per change,
 * which happens when the hero crosses a chunk border — not every frame.
 */
import * as THREE from 'three';
import type { ShapeInstance } from './worldPlan';

const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class InstancePool {
  mesh: THREE.InstancedMesh;
  /** `chunkKey` per slot, for the live range only. */
  private owners: number[] = [];
  private used = 0;
  private capacity: number;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private sizes: THREE.InstancedBufferAttribute;
  /** When each instance appeared, so the shader can dissolve it in without any CPU work. */
  private fades: THREE.InstancedBufferAttribute;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    capacity: number,
    private readonly shadows: boolean,
  ) {
    this.capacity = Math.max(16, capacity);
    this.mesh = this.makeMesh(this.capacity);
    this.sizes = this.mesh.geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
    this.fades = this.mesh.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
  }

  private makeMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.count = 0;
    // The pool spans many chunks, so a single bounding box would be useless; keep it simple.
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (!mesh.geometry.getAttribute('aSize')) {
      mesh.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    }
    if (!mesh.geometry.getAttribute('aFade')) {
      mesh.geometry.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    }
    // Force `instanceColor` to exist so the shader always takes the USE_INSTANCING_COLOR path.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.parent.add(mesh);
    return mesh;
  }

  get liveCount(): number {
    return this.used;
  }

  private grow(need: number): void {
    let cap = this.capacity;
    while (cap < need) cap *= 2;
    const old = this.mesh;
    const oldSizes = this.sizes;
    this.parent.remove(old);

    // A fresh geometry clone so the new, larger aSize attribute has somewhere to live.
    const geo = this.geometry.clone();
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.count = this.used;
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.used * 16));
    if (old.instanceColor) mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, this.used * 3));
    (mesh.geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute).array.set(oldSizes.array.subarray(0, this.used * 3));
    (mesh.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute).array.set(this.fades.array.subarray(0, this.used));

    this.parent.add(mesh);
    old.dispose();
    if (old.geometry !== this.geometry) old.geometry.dispose();
    this.mesh = mesh;
    this.sizes = mesh.geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
    this.fades = mesh.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
    this.capacity = cap;
    this.markDirty();
  }

  /** Write one shape into a slot. */
  private write(slot: number, s: ShapeInstance, spawnTime: number): void {
    (this.fades.array as Float32Array)[slot] = spawnTime;
    this.tmpPos.set(s.x, s.y, s.z);
    this.tmpQuat.setFromAxisAngle(AXIS_Y, s.rotY ?? 0);
    this.tmpScale.set(s.sx, s.sy, s.sz);
    this.mesh.setMatrixAt(slot, this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale));
    this.mesh.setColorAt(slot, this.tmpColor.setHex(s.color));
    const a = this.sizes.array as Float32Array;
    a[slot * 3] = s.sx;
    a[slot * 3 + 1] = s.sy;
    a[slot * 3 + 2] = s.sz;
  }

  private copySlot(from: number, to: number): void {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    m.copyWithin(to * 16, from * 16, from * 16 + 16);
    if (this.mesh.instanceColor) {
      const c = this.mesh.instanceColor.array as Float32Array;
      c.copyWithin(to * 3, from * 3, from * 3 + 3);
    }
    const a = this.sizes.array as Float32Array;
    a.copyWithin(to * 3, from * 3, from * 3 + 3);
    (this.fades.array as Float32Array)[to] = (this.fades.array as Float32Array)[from];
    this.owners[to] = this.owners[from];
  }

  private markDirty(): void {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.sizes.needsUpdate = true;
    this.fades.needsUpdate = true;
  }

  /**
   * Add every shape of one chunk. `spawnTime` is written into each instance so the shader can
   * dissolve it in — a chunk arriving should fade up rather than pop, and doing it from a
   * per-instance timestamp costs nothing per frame.
   */
  addChunk(chunkKey: number, shapes: readonly ShapeInstance[], spawnTime = 0): void {
    if (!shapes.length) return;
    if (this.used + shapes.length > this.capacity) this.grow(this.used + shapes.length);
    for (const s of shapes) {
      this.write(this.used, s, spawnTime);
      this.owners[this.used] = chunkKey;
      this.used++;
    }
    this.markDirty();
  }

  /** Release every slot belonging to one chunk, compacting the live range. */
  removeChunk(chunkKey: number): void {
    let changed = false;
    for (let i = this.used - 1; i >= 0; i--) {
      if (this.owners[i] !== chunkKey) continue;
      const last = this.used - 1;
      if (i !== last) this.copySlot(last, i);
      this.used--;
      changed = true;
    }
    if (changed) this.markDirty();
  }

  setShadows(on: boolean): void {
    this.mesh.castShadow = on && this.shadows;
    this.mesh.receiveShadow = on && this.shadows;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    if (this.mesh.geometry !== this.geometry) this.mesh.geometry.dispose();
    this.used = 0;
    this.owners = [];
  }
}
