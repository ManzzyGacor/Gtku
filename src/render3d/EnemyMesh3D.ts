/**
 * Enemy bodies, built the same procedural way as the hero (docs/OVERHAUL.md, Batch 3).
 *
 * Each kind gets a silhouette you can read at a glance from a fixed 3/4 camera, because that is
 * what the player has to react to: a slime squats and hops, an archer stands tall and telegraphs,
 * a bat is small and airborne, the boss is huge. Every one also carries the two feedback channels
 * combat needs — a **flash** on being hit and a **telegraph glow** before it attacks.
 */
import * as THREE from 'three';
import { P, shade } from '../art/palette';
import type { EnemyCore } from '../core/entities/enemies';
import { u } from './worldPlan';

const flat = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

export class EnemyMesh3D {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private parts: THREE.Mesh[] = [];
  private materials: THREE.MeshLambertMaterial[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private baseColors: number[] = [];
  /** A glowing ring under the enemy while it winds up an attack. */
  private telegraph: THREE.Mesh;
  private telegraphMat: THREE.MeshBasicMaterial;
  private flashT = 0;
  private telegraphLeft = 0;
  private telegraphTotal = 0;
  private squash = 1;
  private bob = 0;

  constructor(parent: THREE.Object3D, private readonly core: EnemyCore) {
    this.root.add(this.body);
    this.build(core);

    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    this.telegraphMat = new THREE.MeshBasicMaterial({
      color: 0xff5a4a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.telegraph = new THREE.Mesh(ringGeo, this.telegraphMat);
    this.telegraph.position.y = 0.05;
    this.telegraph.visible = false;
    this.root.add(this.telegraph);
    parent.add(this.root);
  }

  private box(w: number, h: number, d: number, color: number, y: number, z = 0, x = 0): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = flat(color);
    this.geometries.push(geo);
    this.materials.push(mat);
    this.baseColors.push(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.body.add(mesh);
    this.parts.push(mesh);
    return mesh;
  }

  private build(core: EnemyCore): void {
    switch (core.kind) {
      case 'slime': {
        // a squat blob with a lighter dome and two dark eyes
        this.box(0.95, 0.6, 0.95, P.g1, 0.3);
        this.box(0.7, 0.28, 0.7, P.g3, 0.66);
        this.box(0.12, 0.12, 0.05, P.ink0, 0.42, 0.48, -0.18);
        this.box(0.12, 0.12, 0.05, P.ink0, 0.42, 0.48, 0.18);
        break;
      }
      case 'archer': {
        // tall and thin, with a bow arm: reads as "keeps its distance"
        this.box(0.36, 0.5, 0.3, P.f1, 0.25);
        this.box(0.44, 0.5, 0.36, shade(P.f2, -0.1), 0.75);
        this.box(0.34, 0.3, 0.32, P.h1, 1.13);
        this.box(0.36, 0.1, 0.34, P.o1, 1.3);
        this.box(0.1, 0.1, 0.5, P.o2, 0.95, 0.28);
        this.box(0.12, 0.6, 0.06, P.o3, 0.95, 0.34, 0.24);
        break;
      }
      case 'bat': {
        // small, airborne, wide wings
        this.box(0.3, 0.3, 0.3, P.c0, 0.0);
        this.box(0.55, 0.06, 0.3, P.c1, 0.04, 0, -0.42);
        this.box(0.55, 0.06, 0.3, P.c1, 0.04, 0, 0.42);
        this.box(0.09, 0.09, 0.04, P.r3, 0.04, 0.16, -0.07);
        this.box(0.09, 0.09, 0.04, P.r3, 0.04, 0.16, 0.07);
        break;
      }
      default: {
        // the boss: a stone colossus with a glowing violet core
        this.box(2.2, 1.5, 1.8, P.s1, 0.75);
        this.box(2.6, 0.5, 2.0, P.s2, 1.7);
        this.box(1.3, 0.9, 1.1, P.s2, 2.4);
        this.box(0.8, 0.5, 0.3, P.c2, 2.4, 0.55);
        this.box(0.7, 1.6, 0.7, P.s1, 1.2, 0, -1.4);
        this.box(0.7, 1.6, 0.7, P.s1, 1.2, 0, 1.4);
        this.box(0.9, 0.9, 0.9, P.s0, 0.45, 0, -1.4);
        this.box(0.9, 0.9, 0.9, P.s0, 0.45, 0, 1.4);
        break;
      }
    }
    for (const p of this.parts) p.castShadow = false;
  }

  /** Flash white for a moment — the "musuh berkedip" of the hit feedback list. */
  flash(seconds = 0.12): void {
    this.flashT = seconds;
    this.squash = 0.82;
  }

  update(realDt: number, time: number): void {
    const c = this.core;
    // y stays 0: the root sits on the floor and `body.position.y` carries the hover/bob.
    this.root.position.set(u(c.x), 0, u(c.y));
    // bats hover; everything else stands on the floor
    const lift = c.kind === 'bat' ? u(c.cy - c.y) : 0;
    this.body.position.y = -lift + this.bob;
    this.root.visible = !c.dead || c.kind === 'boss';

    // face the direction the AI is already using
    const yaw = Math.atan2(Math.cos(c.facing), Math.sin(c.facing));
    this.root.rotation.y = yaw;

    // idle life: a slow bob, faster for bats
    this.bob = Math.sin(time * (c.kind === 'bat' ? 9 : 2.4) + c.x * 0.2) * (c.kind === 'bat' ? 0.06 : 0.02);

    // hit flash + squash recovery
    this.flashT = Math.max(0, this.flashT - realDt);
    this.squash += (1 - this.squash) * Math.min(1, realDt * 12);
    this.body.scale.set(1 / Math.max(0.5, this.squash), this.squash, 1 / Math.max(0.5, this.squash));
    const lit = this.flashT > 0;
    this.materials.forEach((m, i) => {
      if (lit) m.color.setRGB(1, 1, 1);
      else m.color.setHex(this.baseColors[i]);
    });

    // telegraph ring while the AI is winding up, driven by the director's timer
    this.telegraphLeft = Math.max(0, this.telegraphLeft - realDt);
    const warn = this.telegraphTotal > 0 ? this.telegraphLeft / this.telegraphTotal : 0;
    this.telegraph.visible = warn > 0.01;
    if (this.telegraph.visible) {
      // the ring closes in as the attack approaches, which is what makes it readable
      const r = u(c.radius) * (1.4 + warn * 2.2);
      this.telegraph.scale.set(r, 1, r);
      this.telegraphMat.opacity = 0.2 + (1 - warn) * 0.5;
    }
  }

  /** The AI announced a wind-up: show the ring for `seconds`. */
  setTelegraph(seconds: number, color = 0xff5a4a): void {
    this.telegraphLeft = seconds;
    this.telegraphTotal = seconds;
    this.telegraphMat.color.setHex(color);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.telegraphMat.dispose();
  }
}
