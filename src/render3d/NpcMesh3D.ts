/**
 * Villager bodies, built from the same `NPC_LOOKS` palette entries the 2D sprites used, so the
 * elder is still the one in the teal robe and the smith still wears the red apron.
 *
 * Each NPC carries the quest marker the 2D game floated above their head — a `!` when they have
 * something to give you and a `?` when they are waiting for something — as a small emissive
 * billboard, because that marker is the only navigation aid the main quest has.
 */
import * as THREE from 'three';
import { NPC_LOOKS } from '../art/characters';
import { P, shade } from '../art/palette';
import { buildMarkerTextures, type MarkerId } from '../art/markers';
import type { NpcDef } from '../core/world/source';
import { pixmapTexture } from './textures';
import { u } from './worldPlan';

const flat = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

/** Shared marker textures: built once, used by every NPC. */
let markerTextures: Partial<Record<MarkerId, THREE.Texture>> | null = null;

/** Shared with `Story3D`, which hovers the same badges over signs, chests and shrines. */
export function markerTexture(id: MarkerId): THREE.Texture {
  if (!markerTextures) {
    markerTextures = {};
    for (const [key, pm] of Object.entries(buildMarkerTextures())) {
      markerTextures[key as MarkerId] = pixmapTexture(pm);
    }
  }
  return markerTextures[id]!;
}

export class NpcMesh3D {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private marker: THREE.Mesh;
  private markerMat: THREE.MeshBasicMaterial;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private breath = 0;
  private current: MarkerId | null = null;

  constructor(parent: THREE.Object3D, readonly def: NpcDef) {
    this.root.add(this.body);
    this.build();

    const geo = new THREE.PlaneGeometry(0.62, 0.62);
    this.geometries.push(geo);
    this.markerMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 });
    this.materials.push(this.markerMat);
    this.marker = new THREE.Mesh(geo, this.markerMat);
    this.marker.position.y = 1.95;
    this.marker.visible = false;
    this.marker.renderOrder = 11;
    this.root.add(this.marker);

    this.root.position.set(u(def.x), 0, u(def.y));
    parent.add(this.root);
  }

  private box(w: number, h: number, d: number, color: number, y: number, z = 0, x = 0): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = flat(color);
    this.geometries.push(geo);
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.body.add(mesh);
    return mesh;
  }

  private build(): void {
    const look = NPC_LOOKS[this.def.look] ?? NPC_LOOKS.elder;
    const small = look.small ? 0.78 : 1;
    const legLen = 0.3 * small;
    const torsoH = 0.42 * small;
    const headS = 0.44 * small;

    if (look.robe) {
      // a robe is one tapering mass rather than two legs
      this.box(0.5 * small, legLen + torsoH, 0.42 * small, look.tunic[1], (legLen + torsoH) / 2);
      this.box(0.54 * small, 0.08, 0.46 * small, look.trim, legLen * 0.6);
    } else {
      this.box(0.17 * small, legLen, 0.2 * small, look.pants, legLen / 2, 0, -0.11 * small);
      this.box(0.17 * small, legLen, 0.2 * small, look.pants, legLen / 2, 0, 0.11 * small);
      this.box(0.46 * small, torsoH, 0.3 * small, look.tunic[1], legLen + torsoH / 2);
      this.box(0.48 * small, 0.08, 0.32 * small, look.trim, legLen + 0.08);
    }
    if (look.pack) {
      this.box(0.4 * small, 0.5 * small, 0.24, look.pack, legLen + torsoH * 0.62, -0.26 * small);
      this.box(0.44 * small, 0.08, 0.28, shade(look.pack, -0.25), legLen + torsoH * 0.95, -0.26 * small);
    }
    if (look.apron) this.box(0.4 * small, torsoH * 0.7, 0.06, look.apron, legLen + torsoH * 0.45, 0.16 * small);

    const shoulder = legLen + torsoH;
    // head, hair and a face turned toward the camera-facing side (+Z)
    this.box(headS, headS, headS * 0.92, look.skin[1], shoulder + headS / 2);
    this.box(headS * 1.06, headS * 0.4, headS * 0.98, look.hair[1], shoulder + headS * 0.9);
    for (const ex of [-0.09 * small, 0.09 * small]) {
      this.box(0.07, 0.1, 0.03, 0x140f26, shoulder + headS * 0.52, headS * 0.47, ex);
    }
    if (look.beard) this.box(headS * 0.8, headS * 0.34, 0.06, look.beard, shoulder + headS * 0.24, headS * 0.45);
    if (look.scarf) this.box(0.42 * small, 0.1, 0.32 * small, look.scarf[1], shoulder + 0.02);

    // arms
    for (const ex of [-0.28 * small, 0.28 * small]) {
      this.box(0.13 * small, 0.34 * small, 0.13 * small, look.tunic[1], shoulder - 0.17 * small, 0, ex);
    }
    if (look.staff) {
      this.box(0.08, 1.5 * small, 0.08, P.o3, 0.75 * small, 0, 0.3 * small);
      this.box(0.2, 0.2, 0.2, shade(P.k3, 0.2), 1.55 * small, 0, 0.3 * small);
    }
  }

  /** `!` when the NPC has something for you, `?` when they are waiting, null for nothing. */
  setMarker(id: MarkerId | null): void {
    if (id === this.current) return;
    this.current = id;
    this.marker.visible = id !== null;
    if (id) {
      this.markerMat.map = markerTexture(id);
      this.markerMat.needsUpdate = true;
    }
  }

  /** Face the camera's yaw so the villager is never seen from behind. */
  update(realDt: number, cameraYaw: number): void {
    this.breath += realDt;
    this.root.rotation.y = cameraYaw;
    this.body.position.y = Math.sin(this.breath * 2) * 0.012;
    if (this.marker.visible) {
      this.marker.position.y = 1.95 + Math.sin(this.breath * 3.2) * 0.07;
      this.markerMat.opacity = 0.85 + Math.sin(this.breath * 6) * 0.15;
      this.marker.rotation.y = cameraYaw;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
