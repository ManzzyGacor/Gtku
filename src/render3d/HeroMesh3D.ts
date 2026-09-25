/**
 * The player's low-poly body (docs/OVERHAUL.md, Fase 2).
 *
 * Built procedurally from boxes on a small joint hierarchy — no modelling tool involved, which is
 * the only workable option when the developer has no desktop. Colours come from `HERO_LOOK`, the
 * same palette entries the 2D sprite uses, so it is recognisably the same character.
 *
 * Every pose is read from `HeroCore`; this class owns no game state of its own. The lantern is part
 * of the body and carries a real light, because the lantern is what the story is about.
 */
import * as THREE from 'three';
import { HERO_LOOK } from '../art/characters';
import { P, shade } from '../art/palette';
import { mix } from '../art/pixmap';
import type { GearLook } from '../core/items/look';
import type { MeleeStyle } from '../core/combat/weapons';
import { ELEMENTS } from '../core/combat/elements';
import { HeroCore, HERO_STATS } from '../core/entities/HeroCore';
import { u } from './worldPlan';

/** Every joint value a pose can set; see `HeroMesh3D.target`. */
interface PoseTarget {
  bodyY: number;
  bodyZ: number;
  bodyRotX: number;
  bodyRotY: number;
  bodyRotZ: number;
  torsoScaleY: number;
  headRotX: number;
  armLX: number;
  armLZ: number;
  armRX: number;
  armRZ: number;
  legLX: number;
  legRX: number;
  cloakX: number;
  slashOpacity: number;
  slashRotZ: number;
  slashScale: number;
}

const blankPose = (): PoseTarget => ({
  bodyY: 0,
  bodyZ: 0,
  bodyRotX: 0,
  bodyRotY: 0,
  bodyRotZ: 0,
  torsoScaleY: 1,
  headRotX: 0,
  armLX: 0,
  armLZ: 0,
  armRX: 0,
  armRZ: 0,
  legLX: 0,
  legRX: 0,
  cloakX: 0,
  slashOpacity: 0,
  slashRotZ: 0,
  slashScale: 1,
});

const POSE_KEYS = Object.keys(blankPose()) as (keyof PoseTarget)[];

function resetPose(p: PoseTarget): void {
  Object.assign(p, blankPose());
}

/** Seconds a hammer's ground ring lasts. */
const IMPACT_TIME = 0.4;

/** How much further and brighter the lantern is underground. */
export const CAVE_LANTERN = { range: 1.1, brightness: 0.6 };

/** Total height in world units (≈ 25 px, matching the 2D sprite). */
export const HERO_HEIGHT = 1.55;

interface Joint {
  /** Rotates around its own pivot. */
  pivot: THREE.Group;
  mesh: THREE.Mesh;
}

/** Recolour one of the model's boxes (each has its own material, so this touches only that box). */
const paint = (m: THREE.Mesh, c: number): void => void (m.material as THREE.MeshLambertMaterial).color.setHex(c);

const flat = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

/** A slash arc lying flat around the hero, opening forward (+Z); the pivot turns it through the swing. */
function slashArc(inner: number, outer: number, sweep: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, 20, 1, -Math.PI / 2 - sweep / 2, sweep);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  return g;
}

export class HeroMesh3D {
  readonly root = new THREE.Group();
  /** The hero's lantern light; the brightest thing in the world at night. */
  readonly lantern = new THREE.PointLight(0xffd9a0, 0, u(58), 1.5);
  /** Base reach in world units, before the character sheet's `lanternRange` scales it. */
  private readonly lanternBase = u(58);

  private body = new THREE.Group();
  private torso!: THREE.Mesh;
  private head!: THREE.Group;
  private cloak!: Joint;
  private armL!: Joint;
  private armR!: Joint;
  private legL!: Joint;
  private legR!: Joint;
  private lanternBox!: THREE.Mesh;
  private readonly sword = new THREE.Group();
  private readonly bow = new THREE.Group();
  private bowString!: THREE.Mesh;
  private readonly nocked = new THREE.Group();
  private nockHead!: THREE.Mesh;
  /** How far the string is drawn, eased (0..1). */
  private pull = 0;
  // ── equipment that shows (setGear) ──
  private readonly helmet = new THREE.Group();
  private helmetGem!: THREE.Mesh;
  private readonly pauldrons: THREE.Mesh[] = [];
  private readonly mittens: THREE.Mesh[] = [];
  private readonly boots: THREE.Mesh[] = [];
  private readonly bootCuffs: THREE.Mesh[] = [];
  private guard!: THREE.Mesh;
  /** The lantern's colour: gold without a core, the core's element with one. */
  private lanternColor = 0xffe066;
  /** Last applied look, so an unchanged sheet does not repaint. */
  gearKey = '';
  /** The swing trail: one mesh per weapon style, turned by a pivot at shoulder height. */
  private slashPivot = new THREE.Group();
  private readonly slashes = new Map<MeleeStyle, THREE.Mesh>();
  private slashMaterial!: THREE.MeshBasicMaterial;
  private slashGeometries: THREE.BufferGeometry[] = [];
  /** The model in the hand for each melee style. */
  private readonly weapons = new Map<MeleeStyle, THREE.Group>();
  /** Parts painted in the weapon's rarity colour, per style. */
  private readonly weaponAccents: THREE.Mesh[] = [];
  /** A hammer's landing: a ring that spreads over the ground. */
  private impactRing!: THREE.Mesh;
  private impactMat!: THREE.MeshBasicMaterial;
  private impactT = 0;
  private style: MeleeStyle = 'sword';
  private wasActive = false;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  private yaw = 0;
  private walkPhase = 0;
  private breath = 0;

  constructor(parent: THREE.Object3D) {
    this.root.add(this.body);
    this.build();
    this.lanternBox.add(this.lantern);
    parent.add(this.root);
  }

  // ───────────────────────── construction ─────────────────────────

  /**
   * A joint whose pivot sits at `pivotY` and whose limb hangs `len` downward (or along `axis`),
   * so rotating the pivot swings the limb like a real joint instead of spinning about its middle.
   */
  private joint(w: number, len: number, d: number, color: number, pivot: THREE.Vector3, hangDown = true): Joint {
    const geo = new THREE.BoxGeometry(w, len, d);
    const mat = flat(color);
    this.geometries.push(geo);
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = hangDown ? -len / 2 : len / 2;
    mesh.castShadow = true;
    const group = new THREE.Group();
    group.position.copy(pivot);
    group.add(mesh);
    this.body.add(group);
    return { pivot: group, mesh };
  }

  private box(w: number, h: number, d: number, color: number, parent: THREE.Object3D, y = 0, z = 0, emissive = false): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = emissive ? new THREE.MeshBasicMaterial({ color }) : flat(color);
    this.geometries.push(geo);
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, y, z);
    mesh.castShadow = !emissive;
    parent.add(mesh);
    return mesh;
  }

  private build(): void {
    const L = HERO_LOOK;
    /*
     * Chibi proportions, measured off the reference art: the head is about 37% of the whole
     * figure. The first version was a realistic 19% and read as a tiny stiff adult at this camera
     * distance — a big head is what makes a 14-pixel-tall character legible at all.
     */
    const legLen = 0.34;
    const torsoH = 0.44;
    const headS = 0.5;
    const hipY = legLen;
    const shoulderY = hipY + torsoH * 0.86;

    // legs: short and chunky, with heavy boots
    this.legL = this.joint(0.19, legLen, 0.22, L.pants, new THREE.Vector3(-0.13, hipY, 0));
    this.legR = this.joint(0.19, legLen, 0.22, L.pants, new THREE.Vector3(0.13, hipY, 0));
    for (const leg of [this.legL, this.legR]) {
      this.boots.push(this.box(0.22, 0.17, 0.3, L.boots, leg.pivot, -legLen + 0.085, 0.03));
      this.bootCuffs.push(this.box(0.23, 0.05, 0.31, shade(L.boots, 0.35), leg.pivot, -legLen + 0.17, 0.03));
    }

    // torso: a wide coat with a belt and a lit collar
    this.torso = this.box(0.48, torsoH, 0.3, L.tunic[1], this.body, hipY + torsoH / 2);
    this.box(0.5, 0.09, 0.32, L.trim, this.body, hipY + 0.1);
    this.box(0.5, 0.05, 0.32, shade(L.tunic[2], 0.2), this.body, hipY + torsoH * 0.72);
    // strap across the chest, the way the reference slings its sword
    this.box(0.52, 0.07, 0.33, shade(L.boots, 0.1), this.body, hipY + torsoH * 0.5, 0.005);
    // armour: a pair of pauldrons, only while something is worn in the body slot
    for (const side of [-1, 1]) {
      const pad = this.box(0.2, 0.12, 0.26, 0x8a93ad, this.body, shoulderY + 0.03);
      pad.position.x = side * 0.31;
      pad.visible = false;
      this.pauldrons.push(pad);
    }
    // scarf
    this.box(0.44, 0.12, 0.34, L.scarf![1], this.body, shoulderY + 0.02);
    this.box(0.44, 0.05, 0.34, shade(L.scarf![1], 0.3), this.body, shoulderY + 0.07);

    /*
     * Head: a big cube with a face on the front. At this camera distance the head is about 14
     * screen pixels tall, which is just enough for two eyes, a pair of blush marks and a mouth —
     * and those few pixels are what give the character an expression at all.
     */
    this.head = new THREE.Group();
    this.head.position.y = shoulderY + 0.06;
    this.body.add(this.head);
    const headY = headS / 2;
    this.box(headS, headS, headS * 0.92, L.skin[1], this.head, headY);
    // hair: a cap plus spikes, which is the reference's silhouette
    this.box(headS * 1.06, headS * 0.42, headS * 0.98, L.hair[1], this.head, headY + headS * 0.32);
    this.box(headS * 1.04, headS * 0.3, headS * 0.5, L.hair[0], this.head, headY + headS * 0.1, -headS * 0.28);
    // helmet: a steel circlet over the hair with a gem in the rarity's colour
    this.head.add(this.helmet);
    this.helmet.visible = false;
    this.box(headS * 1.12, headS * 0.2, headS * 1.02, 0x9aa3bd, this.helmet, headY + headS * 0.3);
    this.helmetGem = this.box(0.09, 0.09, 0.03, 0xffffff, this.helmet, headY + headS * 0.3, headS * 0.52, true);
    const spikes: [number, number, number, number][] = [
      [-0.17, 0.3, -0.04, 0.13],
      [0.0, 0.34, -0.02, 0.15],
      [0.17, 0.31, -0.05, 0.12],
      [-0.1, 0.26, 0.16, 0.1],
      [0.12, 0.27, 0.15, 0.1],
      [-0.26, 0.2, 0.02, 0.1],
      [0.26, 0.21, 0.0, 0.1],
    ];
    for (const [dx, dy, dz, size] of spikes) {
      const spike = this.box(size, size * 1.5, size, L.hair[1], this.head, headY + headS * dy + size * 0.5, dz);
      spike.position.x = dx * headS * 2;
      spike.rotation.z = dx * 1.1;
      spike.rotation.x = -dz * 1.4;
    }
    // face, on the +Z side (the model faces +Z)
    const faceZ = headS * 0.47;
    for (const ex of [-0.12, 0.12]) {
      const eye = this.box(0.09, 0.13, 0.03, 0x140f26, this.head, headY + 0.01, faceZ);
      eye.position.x = ex;
      const glint = this.box(0.04, 0.05, 0.02, P.white, this.head, headY + 0.05, faceZ + 0.01);
      glint.position.x = ex - 0.015;
    }
    for (const bx of [-0.19, 0.19]) {
      const blush = this.box(0.07, 0.04, 0.02, mix(L.skin[2], P.p2, 0.55), this.head, headY - 0.07, faceZ);
      blush.position.x = bx;
    }
    this.box(0.05, 0.03, 0.02, shade(L.skin[0], -0.3), this.head, headY - 0.1, faceZ);

    // cloak hangs from the shoulders and sways
    this.cloak = this.joint(0.52, 0.72, 0.08, L.tunic[0], new THREE.Vector3(0, shoulderY, -0.17));

    // arms: short and thick, chibi mittens rather than hands
    this.armL = this.joint(0.15, 0.34, 0.15, L.tunic[1], new THREE.Vector3(-0.3, shoulderY, 0));
    this.armR = this.joint(0.15, 0.34, 0.15, L.tunic[1], new THREE.Vector3(0.3, shoulderY, 0));
    for (const arm of [this.armL, this.armR]) this.mittens.push(this.box(0.17, 0.14, 0.17, shade(L.boots, 0.15), arm.pivot, -0.34));

    /*
     * The melee weapons, one model per style, in the right hand. Sized to read on a phone — a
     * blade one pixel wide at this distance is not a blade — with a bright edge that stays visible
     * in the dark (unlit), and a part in the weapon's rarity colour.
     */
    const hand = -0.34;
    // sword: a long steel blade, a wrapped grip and a guard
    this.armR.pivot.add(this.sword);
    this.box(0.1, 0.98, 0.14, 0xbcc4dc, this.sword, hand - 0.55);
    this.box(0.035, 0.98, 0.05, 0xf4f8ff, this.sword, hand - 0.55, 0.06, true);
    this.guard = this.box(0.26, 0.08, 0.18, P.y3, this.sword, hand - 0.06);
    this.weaponAccents.push(this.guard);
    this.box(0.08, 0.16, 0.1, P.o0, this.sword, hand + 0.04);
    this.weapons.set('sword', this.sword);
    // dagger: short and thin, held low
    const dagger = new THREE.Group();
    this.armR.pivot.add(dagger);
    this.box(0.07, 0.46, 0.1, 0xc8d0e6, dagger, hand - 0.3);
    this.box(0.03, 0.46, 0.04, 0xf4f8ff, dagger, hand - 0.3, 0.05, true);
    this.weaponAccents.push(this.box(0.18, 0.06, 0.14, P.y3, dagger, hand - 0.05));
    this.box(0.07, 0.13, 0.08, P.o0, dagger, hand + 0.03);
    this.weapons.set('dagger', dagger);
    // hammer: a long handle and a heavy head
    const hammer = new THREE.Group();
    this.armR.pivot.add(hammer);
    this.box(0.07, 0.95, 0.07, 0x7a5236, hammer, hand - 0.35);
    this.box(0.4, 0.26, 0.26, 0x8a93ad, hammer, hand - 0.86);
    this.weaponAccents.push(this.box(0.42, 0.07, 0.28, P.y3, hammer, hand - 0.86));
    this.box(0.08, 0.26, 0.28, 0xf4f8ff, hammer, hand - 0.86, 0, true).position.x = 0.2;
    this.weapons.set('hammer', hammer);
    // spear: a shaft through the hand, a bright point beyond the fist
    const spear = new THREE.Group();
    this.armR.pivot.add(spear);
    this.box(0.055, 1.6, 0.055, 0x8a5a36, spear, hand - 0.3);
    this.box(0.1, 0.3, 0.12, 0xf4f8ff, spear, hand - 1.2, 0, true);
    this.weaponAccents.push(this.box(0.12, 0.07, 0.12, P.y3, spear, hand - 1.02));
    this.weapons.set('spear', spear);

    /*
     * The bow, in the same hand, shown instead of the sword while it is the active weapon. Until
     * the first phone test the hero drew and loosed arrows with a sword in his hand.
     *
     * Built in its own frame — limbs along Y, forward along +Z — and counter-rotated against the
     * arm every frame (see `update`), so it stays upright whether the arm hangs or points.
     */
    this.bow.position.y = -0.34 - 0.07;
    this.armR.pivot.add(this.bow);
    const wood = 0x8a5a36;
    this.box(0.07, 0.16, 0.08, 0x5a3a26, this.bow);
    const upper = this.box(0.05, 0.38, 0.05, wood, this.bow, 0.2, -0.03);
    upper.rotation.x = -0.35;
    const lower = this.box(0.05, 0.38, 0.05, wood, this.bow, -0.2, -0.03);
    lower.rotation.x = 0.35;
    this.bowString = this.box(0.015, 0.72, 0.015, 0xe8e0c8, this.bow, 0, -0.1);
    this.bowString.castShadow = false;
    this.nocked.visible = false;
    this.bow.add(this.nocked);
    const shaft = this.box(0.03, 0.03, 0.52, 0xd9c7a0, this.nocked, 0, 0.26);
    shaft.castShadow = false;
    this.nockHead = this.box(0.07, 0.07, 0.09, 0xf2f6ff, this.nocked, 0, 0.55, true);

    // lantern on a short bar in the left hand
    const bar = this.box(0.04, 0.22, 0.04, 0x4a4e6f, this.armL.pivot, -0.34 - 0.11);
    bar.castShadow = false;
    this.lanternBox = this.box(0.22, 0.24, 0.22, 0xffe066, this.armL.pivot, -0.34 - 0.3, 0, true);
    this.box(0.26, 0.06, 0.26, 0x4a4e6f, this.armL.pivot, -0.34 - 0.44);

    /*
     * The slash trail: one additive shape per weapon style, hidden except during the active frames
     * of a swing, coloured by the active element.
     */
    this.slashMaterial = new THREE.MeshBasicMaterial({
      color: 0x7cc4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shapes: [MeleeStyle, THREE.BufferGeometry][] = [
      ['sword', slashArc(0.45, 1.15, Math.PI * 0.85)], // wide sweep
      ['dagger', slashArc(0.4, 0.72, Math.PI * 0.55)], // thin and quick
      ['hammer', slashArc(0.3, 1.0, Math.PI * 0.45)], // short and thick
    ];
    const thrust = new THREE.PlaneGeometry(0.16, 1.7);
    thrust.rotateX(-Math.PI / 2);
    thrust.translate(0, 0, 1.0);
    shapes.push(['spear', thrust]); // one straight line forward
    for (const [st, geo] of shapes) {
      this.slashGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, this.slashMaterial);
      mesh.visible = false;
      mesh.renderOrder = 9;
      this.slashPivot.add(mesh);
      this.slashes.set(st, mesh);
    }
    this.slashPivot.position.set(0, shoulderY - 0.18, 0);
    this.body.add(this.slashPivot);

    const ring = new THREE.RingGeometry(0.8, 1, 28);
    ring.rotateX(-Math.PI / 2);
    this.slashGeometries.push(ring);
    this.impactMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.impactRing = new THREE.Mesh(ring, this.impactMat);
    this.impactRing.position.set(0, 0.04, 0.7);
    this.impactRing.visible = false;
    this.root.add(this.impactRing);
  }

  // ───────────────────────── animation ─────────────────────────

  /**
   * Every number a pose can set. Poses write *targets*; the body then eases toward them, which is
   * what turns four discrete attack frames into a continuous swing. The stiffness the test report
   * described came from setting these directly and snapping between them.
   */
  private readonly target: PoseTarget = blankPose();
  private readonly current: PoseTarget = blankPose();
  /** Full-turn rotations (the dodge roll) bypass the smoother — easing a 2π spin would unwind it. */
  private rollSpin = 0;
  private rollLift = 0;
  private smoothRate = 12;

  /**
   * Pose the body from the core's state. `dt` is simulation time, `realDt` keeps the idle breath
   * and the lantern flicker alive even during hit-stop.
   */
  update(dt: number, realDt: number, core: HeroCore, time: number): void {
    // position: 2D (x, y) px → 3D (x, z) units, y is up
    this.root.position.set(u(core.x), 0, u(core.y));

    // face the aim direction, eased so quick flicks don't snap
    const wantYaw = Math.atan2(Math.cos(core.aim), Math.sin(core.aim));
    let d = wantYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // turning is quicker mid-swing, so a steered attack actually points where you aimed it
    const turnRate = core.state === 'attack' ? 26 : 18;
    this.yaw += d * Math.min(1, realDt * turnRate);
    this.root.rotation.y = this.yaw;

    const speed = Math.hypot(core.vx, core.vy);
    this.breath += realDt;
    resetPose(this.target);
    this.rollSpin = 0;
    this.rollLift = 0;
    this.smoothRate = 12;

    switch (core.state) {
      case 'roll':
        this.poseRoll(core);
        break;
      case 'attack':
        this.poseAttack(core);
        break;
      case 'hurt':
        this.poseHurt();
        break;
      case 'cast':
        this.poseCast(core);
        break;
      case 'dead':
        this.poseDead(core);
        break;
      case 'shoot':
        this.poseDraw(core, speed, dt);
        break;
      default:
        if (core.isRanged && core.charge > 0) this.poseDraw(core, speed, dt);
        else if (speed > 14) this.poseWalk(dt, speed);
        else this.poseIdle();
    }

    this.ease(realDt);
    this.apply();

    // the weapon in hand, and the bowstring: it follows the charge back and snaps forward on release
    const ranged = core.isRanged;
    this.style = core.meleeStyle;
    for (const [st, g] of this.weapons) g.visible = !ranged && st === this.style;
    this.bow.visible = ranged;
    // the swing trail takes the colour of the element on the weapon
    this.slashMaterial.color.setHex(core.element ? ELEMENTS[core.element].color : 0x7cc4ff);
    // a hammer's blow lands: a ring spreads over the ground in front
    const active = core.state === 'attack' && core.stateT >= core.attackDef.windup && core.stateT < core.attackDef.windup + core.attackDef.active;
    if (active && !this.wasActive && this.style === 'hammer') this.impactT = IMPACT_TIME;
    this.wasActive = active;
    if (this.impactT > 0) {
      this.impactT = Math.max(0, this.impactT - realDt);
      const k = 1 - this.impactT / IMPACT_TIME;
      this.impactRing.visible = true;
      this.impactRing.scale.setScalar(0.3 + k * 1.3);
      this.impactMat.opacity = (1 - k) * 0.8;
    } else this.impactRing.visible = false;
    if (ranged) {
      const drawing = core.charge > 0;
      const want = drawing ? 0.25 + core.charge * 0.75 : 0;
      // the release is instant; the draw eases in
      this.pull = want < this.pull ? want : this.pull + (want - this.pull) * Math.min(1, realDt * 14);
      this.bow.rotation.x = -this.current.armRX;
      this.bowString.position.z = -0.1 - this.pull * 0.24;
      this.nocked.visible = drawing;
      this.nocked.position.z = this.bowString.position.z;
      (this.nockHead.material as THREE.MeshBasicMaterial).color.setHex(core.charge >= 1 ? 0xffe066 : 0xf2f6ff);
    }

    // the lamp always burns, with a small flicker
    const flicker = 0.9 + Math.sin(time * 9) * 0.06 + Math.sin(time * 23) * 0.04;
    this.lantern.intensity = core.alive ? 2.4 * (1 + CAVE_LANTERN.brightness * this.cave) * flicker : 0;
    (this.lanternBox.material as THREE.MeshBasicMaterial).color.setHex(core.state === 'cast' ? 0xfff6b0 : this.lanternColor);
  }

  /**
   * Paint the equipped gear onto the model (`core/items/look.ts`). Cheap — a handful of colour
   * writes and visibility flags — and skipped entirely when nothing changed.
   */
  setGear(look: GearLook): void {
    if (look.key === this.gearKey) return;
    this.gearKey = look.key;
    const L = HERO_LOOK;
    this.helmet.visible = look.helmet !== null;
    if (look.helmet !== null) paint(this.helmetGem, look.helmet);
    for (const pad of this.pauldrons) {
      pad.visible = look.armor !== null;
      if (look.armor !== null) paint(pad, mix(0x8a93ad, look.armor, 0.45));
    }
    for (const m of this.mittens) paint(m, look.gloves !== null ? mix(shade(L.boots, 0.15), look.gloves, 0.55) : shade(L.boots, 0.15));
    for (const m of this.boots) paint(m, look.boots !== null ? mix(L.boots, look.boots, 0.45) : L.boots);
    for (const m of this.bootCuffs) paint(m, look.boots !== null ? look.boots : shade(L.boots, 0.35));
    for (const m of this.weaponAccents) paint(m, look.weapon ?? P.y3);
    this.lanternColor = look.core !== null ? mix(0xffe066, look.core, 0.55) : 0xffe066;
    this.lantern.color.setHex(look.core !== null ? mix(0xffd9a0, look.core, 0.35) : 0xffd9a0);
  }

  /** Exponential approach, so the rate is frame-rate independent. */
  private ease(realDt: number): void {
    const k = 1 - Math.exp(-this.smoothRate * Math.max(0, realDt));
    const c = this.current as unknown as Record<string, number>;
    const t = this.target as unknown as Record<string, number>;
    for (const key of POSE_KEYS) c[key] += (t[key] - c[key]) * k;
  }

  private apply(): void {
    const p = this.current;
    this.body.position.set(0, p.bodyY + this.rollLift, p.bodyZ);
    this.body.rotation.set(p.bodyRotX + this.rollSpin, p.bodyRotY, p.bodyRotZ);
    this.torso.scale.set(1, p.torsoScaleY, 1);
    this.head.rotation.set(p.headRotX, 0, 0);
    this.armL.pivot.rotation.set(p.armLX, 0, p.armLZ);
    this.armR.pivot.rotation.set(p.armRX, 0, p.armRZ);
    this.legL.pivot.rotation.set(p.legLX, 0, 0);
    this.legR.pivot.rotation.set(p.legRX, 0, 0);
    this.cloak.pivot.rotation.set(p.cloakX, 0, 0);
    for (const [st, mesh] of this.slashes) mesh.visible = st === this.style && p.slashOpacity > 0.02;
    this.slashMaterial.opacity = Math.max(0, p.slashOpacity);
    // the spear's line does not sweep; everything else turns through the swing
    this.slashPivot.rotation.y = this.style === 'spear' ? 0 : p.slashRotZ;
    this.slashPivot.scale.setScalar(Math.max(0.01, p.slashScale));
  }

  private poseIdle(): void {
    const b = Math.sin(this.breath * 2.1);
    const p = this.target;
    p.torsoScaleY = 1 + b * 0.03;
    p.bodyY = b * 0.014;
    p.headRotX = b * 0.05;
    p.armLX = 0.08 + b * 0.06;
    p.armRX = 0.08 - b * 0.06;
    p.cloakX = -0.12 + Math.sin(this.breath * 1.3) * 0.06;
    this.smoothRate = 9;
  }

  private poseWalk(dt: number, speed: number): void {
    this.walkPhase += dt * (3.2 + (speed / HERO_STATS.speed) * 4.6);
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase * 2);
    const p = this.target;
    p.legLX = s * 0.68;
    p.legRX = -s * 0.68;
    p.armLX = -s * 0.46;
    p.armRX = s * 0.46;
    p.bodyY = Math.abs(c) * 0.035;
    p.bodyRotZ = s * 0.04;
    // the cloak lags behind the stride
    p.cloakX = -0.32 - Math.sin(this.walkPhase - 0.7) * 0.18;
    this.smoothRate = 22;
  }

  /**
   * Four sub-phases, which is what the eye reads as a swing:
   * **anticipation** (the blade winds back), **slash** (it whips through), **follow-through**
   * (the body keeps turning past the target) and **recovery** (it settles back to guard).
   * The easing between them is what makes the four read as one motion.
   */
  private poseAttack(core: HeroCore): void {
    const a = core.attackDef;
    const twist = core.combo === 1 ? -1 : 1;
    const heavy = core.isHeavy;
    const p = this.target;
    const t = core.stateT;

    if (t < a.windup) {
      // anticipation: wind back and drop the weight onto the back foot
      const k = Math.min(1, t / Math.max(0.001, a.windup));
      p.armRX = -1.1 - k * 1.1;
      p.armRZ = -0.5 * twist;
      p.armLX = 0.55;
      p.bodyRotY = 0.4 * twist * k;
      p.bodyZ = -0.06 * k;
      p.torsoScaleY = 1 - 0.03 * k;
      this.smoothRate = heavy ? 16 : 26;
    } else if (t < a.windup + a.active) {
      // the slash itself: fastest possible transition, and the trail appears
      const k = Math.min(1, (t - a.windup) / Math.max(0.001, a.active));
      p.armRX = 0.5 + k * 0.7;
      p.armRZ = 0.35 * twist;
      p.armLX = 0.2;
      p.bodyRotY = -0.45 * twist;
      p.bodyZ = 0.12;
      p.torsoScaleY = 0.94;
      p.slashOpacity = (heavy ? 1 : 0.85) * (1 - k * 0.35);
      p.slashRotZ = twist * (0.6 - k * 1.5);
      p.slashScale = heavy ? 1.5 : core.combo === 2 ? 1.25 : 1;
      this.smoothRate = 45;
    } else {
      const rec = t - a.windup - a.active;
      const follow = a.recover * 0.4;
      if (rec < follow) {
        // follow-through: the swing overshoots before it comes back
        p.armRX = 1.35;
        p.armRZ = 0.5 * twist;
        p.bodyRotY = -0.6 * twist;
        p.bodyZ = 0.08;
        p.slashOpacity = 0.35 * (1 - rec / follow);
        p.slashRotZ = twist * -0.9;
        p.slashScale = heavy ? 1.5 : 1;
        this.smoothRate = 30;
      } else {
        // recovery: settle back to guard
        p.armRX = 0.35;
        p.armLX = 0.3;
        p.bodyRotY = -0.1 * twist;
        this.smoothRate = 14;
      }
    }
  }

  /**
   * Drawing the bow: the bow arm straight out in front, the lantern hand coming back toward the
   * string, the body turned a little side-on. The longer the draw, the further back the weight
   * sits; after the release the body rocks with the recoil.
   */
  private poseDraw(core: HeroCore, speed: number, dt: number): void {
    const p = this.target;
    const released = core.state === 'shoot' && core.charge === 0;
    const k = released ? 0 : core.charge;
    p.armRX = -1.5;
    p.armRZ = 0.08;
    p.armLX = released ? 0.2 : -0.85 - 0.45 * k;
    p.armLZ = released ? 0 : -0.35;
    p.bodyRotY = 0.28;
    p.bodyZ = released ? -0.07 : -0.03 * k;
    p.headRotX = 0.06;
    p.cloakX = -0.2 - k * 0.12;
    // still walking (slowly) while drawing: the legs keep moving
    if (speed > 10) {
      this.walkPhase += dt * (2.6 + (speed / HERO_STATS.speed) * 3);
      const sw = Math.sin(this.walkPhase);
      p.legLX = sw * 0.45;
      p.legRX = -sw * 0.45;
    }
    this.smoothRate = released ? 30 : 20;
  }

  private poseRoll(core: HeroCore): void {
    const t = Math.min(1, core.stateT / HERO_STATS.rollTime);
    this.rollSpin = t * Math.PI * 2;
    this.rollLift = -0.18 + Math.sin(t * Math.PI) * 0.16;
    const p = this.target;
    p.legLX = 0.95;
    p.legRX = 0.95;
    p.armLX = 1.15;
    p.armRX = 1.15;
    p.cloakX = -0.95;
    this.smoothRate = 30;
  }

  private poseHurt(): void {
    const p = this.target;
    p.bodyRotX = -0.32;
    p.bodyY = -0.05;
    p.armLX = -0.75;
    p.armRX = -0.75;
    p.headRotX = -0.28;
    this.smoothRate = 34;
  }

  private poseCast(core: HeroCore): void {
    const t = Math.min(1, core.stateT / HERO_STATS.skillCast);
    const p = this.target;
    p.armLX = -2.5 * t;
    p.armRX = -2.2 * t;
    p.bodyY = t * 0.06;
    p.headRotX = -0.32 * t;
    p.cloakX = -0.6 * t;
    this.smoothRate = 18;
  }

  private poseDead(core: HeroCore): void {
    const t = Math.min(1, core.stateT / 0.6);
    const p = this.target;
    p.bodyRotX = t * Math.PI * 0.46;
    p.bodyY = -t * 0.3;
    p.cloakX = -0.2;
    this.smoothRate = 8;
  }

  /**
   * Scale the lantern's reach (Batch 4: `lanternRange` from the character sheet).
   *
   * The lantern is the story's object, so gear that extends it is the one stat the player can
   * literally see: the circle of light around them gets wider.
   */
  setLanternRange(scale: number): void {
    const s = Number.isFinite(scale) ? Math.max(0.2, Math.min(3, scale)) : 1;
    this.rangeScale = s;
    this.lantern.distance = this.lanternBase * s * (1 + CAVE_LANTERN.range * this.cave);
  }

  private rangeScale = 1;
  /** 0 outside, 1 deep underground. */
  private cave = 0;

  /**
   * Underground the lantern is the light: it reaches much further and burns brighter, so the hero
   * always sees the floor around them — also when AUTO has turned the dynamic lights down, because
   * the lantern is not one of them.
   */
  setCave(weight: number): void {
    const w = Math.max(0, Math.min(1, weight));
    if (Math.abs(w - this.cave) < 0.01) return;
    this.cave = w;
    this.lantern.distance = this.lanternBase * this.rangeScale * (1 + CAVE_LANTERN.range * w);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.slashGeometries) g.dispose();
    this.slashMaterial.dispose();
    this.impactMat.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.lantern.dispose();
  }
}
