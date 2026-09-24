/**
 * The push-rock puzzle and the two doors it controls (docs/OVERHAUL.md, ported from the 2D build).
 *
 * The logic is the same pure `RockPuzzle` the 2D game used and the same `pushIntent` contact test,
 * so the puzzle is still solvable in exactly the same number of pushes. This file is the 3D half:
 * a carved rock the hero shoves a tile at a time, a pressure plate that sinks, and the gate plus
 * the boss door, both of which add and remove real collision as they open and close.
 */
import * as THREE from 'three';
import { TILE } from '../config';
import { P, shade } from '../art/palette';
import { pushIntent, RockPuzzle, type TilePos } from '../core/systems/puzzleLogic';
import type { Collision } from '../core/world/collision';
import type { WorldMarkers } from '../core/world/source';

const flat = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

/** A door: a slab that slides down into the floor when it opens. */
class Door {
  readonly mesh: THREE.Mesh;
  private open = false;
  private t = 0;

  constructor(
    parent: THREE.Object3D,
    private readonly tiles: TilePos[],
    private readonly collision: Collision,
    color: number,
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    startOpen: boolean,
  ) {
    this.mesh = new THREE.Mesh(geo, mat);
    const cx = tiles.reduce((a, t) => a + t.tx, 0) / tiles.length + 0.5;
    const cz = tiles.reduce((a, t) => a + t.ty, 0) / tiles.length + 0.5;
    this.mesh.position.set(cx, 1.1, cz);
    this.mesh.scale.set(1, 2.2, tiles.length);
    parent.add(this.mesh);
    void color;
    this.open = startOpen;
    this.t = startOpen ? 1 : 0;
    this.applyCollision();
  }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.applyCollision();
  }

  get isOpen(): boolean {
    return this.open;
  }

  private applyCollision(): void {
    for (const t of this.tiles) {
      if (this.open) this.collision.removeBlocker(t.tx, t.ty);
      else this.collision.addBlocker(t.tx, t.ty);
    }
  }

  update(dt: number): void {
    const want = this.open ? 1 : 0;
    this.t += (want - this.t) * Math.min(1, dt * 6);
    // sinks into the floor as it opens
    this.mesh.position.y = 1.1 - this.t * 2.2;
    this.mesh.visible = this.t < 0.98;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    void this.geo;
    void this.mat;
  }
}

export class Puzzle3D {
  readonly logic: RockPuzzle;
  private rockMesh: THREE.Group;
  private plateMesh: THREE.Mesh;
  private gate: Door;
  private bossDoor: Door;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  /** Where the rock is being drawn, eased toward its tile so a push looks like a shove. */
  private drawX: number;
  private drawZ: number;
  private plateSink = 0;
  /** Fires the first time the plate is pressed. */
  onSolved: () => void = () => undefined;

  constructor(
    parent: THREE.Object3D,
    private readonly markers: WorldMarkers,
    private readonly collision: Collision,
    alreadySolved: boolean,
  ) {
    const p = markers.puzzle;
    this.logic = new RockPuzzle(p.rock, p.plate, (tx, ty) => !this.collision.solidTile(tx, ty));

    // ── the rock: a carved block with a lighter rune face ──
    this.rockMesh = new THREE.Group();
    const rockGeo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    const runeGeo = new THREE.BoxGeometry(0.5, 0.5, 0.04);
    const rockMat = flat(shade(P.s2, -0.1));
    const runeMat = new THREE.MeshBasicMaterial({ color: P.k3 });
    this.geometries.push(rockGeo, runeGeo);
    this.materials.push(rockMat, runeMat);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.y = 0.46;
    const rune = new THREE.Mesh(runeGeo, runeMat);
    rune.position.set(0, 0.46, 0.47);
    this.rockMesh.add(rock, rune);
    parent.add(this.rockMesh);

    // ── the plate ──
    const plateGeo = new THREE.BoxGeometry(0.9, 0.16, 0.9);
    const plateMat = flat(P.s3);
    this.geometries.push(plateGeo);
    this.materials.push(plateMat);
    this.plateMesh = new THREE.Mesh(plateGeo, plateMat);
    this.plateMesh.position.set(p.plate.tx + 0.5, 0.08, p.plate.ty + 0.5);
    parent.add(this.plateMesh);

    // ── the doors ──
    const doorGeo = new THREE.BoxGeometry(1, 1, 1);
    const gateMat = flat(P.s1);
    const bossMat = flat(shade(P.c0, 0.15));
    this.geometries.push(doorGeo);
    this.materials.push(gateMat, bossMat);
    const gateTiles = Array.from({ length: p.gate.h }, (_, i) => ({ tx: p.gate.tx, ty: p.gate.ty + i }));
    const bossTiles = Array.from({ length: markers.boss.door.h }, (_, i) => ({ tx: markers.boss.door.tx, ty: markers.boss.door.ty + i }));
    this.gate = new Door(parent, gateTiles, collision, P.s1, doorGeo, gateMat, alreadySolved);
    this.bossDoor = new Door(parent, bossTiles, collision, P.c0, doorGeo, bossMat, true);

    if (alreadySolved) this.restoreSolved();
    this.drawX = this.logic.rock.tx + 0.5;
    this.drawZ = this.logic.rock.ty + 0.5;
    this.blockRock();
  }

  /** A solved puzzle starts with the rock already on the plate and the gate down. */
  restoreSolved(): void {
    this.logic.rock = { ...this.logic.plate };
    this.logic.solved = true;
    this.gate.setOpen(true);
    this.plateSink = 1;
  }

  private blockRock(): void {
    this.collision.addBlocker(this.logic.rock.tx, this.logic.rock.ty);
  }

  private unblockRock(): void {
    this.collision.removeBlocker(this.logic.rock.tx, this.logic.rock.ty);
  }

  closeBossDoor(): void {
    this.bossDoor.setOpen(false);
  }

  openBossDoor(): void {
    this.bossDoor.setOpen(true);
  }

  get bossDoorOpen(): boolean {
    return this.bossDoor.isOpen;
  }

  /** Put the rock back where it started (the hero left the room without solving it). */
  reset(): void {
    if (this.logic.solved) return;
    this.unblockRock();
    this.logic.reset();
    this.blockRock();
  }

  /** True while the hero stands inside the puzzle room. */
  private inRoom(x: number, y: number): boolean {
    const r = this.markers.puzzle.room;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1;
  }

  /**
   * @param hero  feet position in world px
   * @param mx/my the stick direction, for the contact test
   */
  update(dt: number, realDt: number, hero: { x: number; y: number }, mx: number, my: number): void {
    if (dt > 0 && !this.logic.solved) {
      const intent = this.inRoom(hero.x, hero.y) ? pushIntent(hero, mx, my, this.logic.rock) : null;
      /*
       * `RockPuzzle.update` moves the rock itself and returns the direction as a *notification*.
       * The first version treated that as "now push it", which moved the rock two tiles per shove
       * and left a phantom blocker on the tile it started from — the hero was then walled in
       * behind an invisible rock and the puzzle became unsolvable. Remember where it was, and
       * move the collision to follow it.
       */
      const from = { tx: this.logic.rock.tx, ty: this.logic.rock.ty };
      const move = this.logic.update(dt, intent);
      if (move) {
        this.collision.removeBlocker(from.tx, from.ty);
        this.blockRock();
        if (this.logic.solved) {
          this.gate.setOpen(true);
          this.onSolved();
        }
      }
    }

    // ease the drawn position toward the tile, so a push is a shove rather than a teleport
    const wantX = this.logic.rock.tx + 0.5;
    const wantZ = this.logic.rock.ty + 0.5;
    const k = Math.min(1, realDt * 14);
    this.drawX += (wantX - this.drawX) * k;
    this.drawZ += (wantZ - this.drawZ) * k;
    this.rockMesh.position.set(this.drawX, 0, this.drawZ);

    const wantSink = this.logic.solved ? 1 : 0;
    this.plateSink += (wantSink - this.plateSink) * Math.min(1, realDt * 8);
    this.plateMesh.position.y = 0.08 - this.plateSink * 0.06;
    (this.plateMesh.material as THREE.MeshLambertMaterial).color.setHex(this.plateSink > 0.5 ? P.y4 : P.s3);

    this.gate.update(realDt);
    this.bossDoor.update(realDt);
  }

  dispose(): void {
    this.rockMesh.removeFromParent();
    this.plateMesh.removeFromParent();
    this.gate.dispose();
    this.bossDoor.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
