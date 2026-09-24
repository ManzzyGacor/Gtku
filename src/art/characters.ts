/**
 * Parametric humanoid rig (32x32 frames, feet on row 29). One rig draws the hero and every NPC from a `Look`.
 * Poses are tables of joint offsets, so animation frames are cheap to author and stay consistent.
 */
import { finish } from './draw';
import { P, shade } from './palette';
import { mix, Pixmap, type Color } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

export type Dir = 'd' | 'u' | 's';
type Tri = readonly [Color, Color, Color];

export interface Look {
  skin: Tri;
  hair: Tri;
  hairStyle: 'messy' | 'bun' | 'long' | 'bald' | 'cap' | 'braid';
  tunic: Tri;
  trim: Color;
  pants: Color;
  boots: Color;
  scarf?: readonly [Color, Color];
  beard?: Color;
  robe?: boolean;
  /** Shrinks the body (kids). */
  small?: boolean;
  sword?: boolean;
  staff?: boolean;
  apron?: Color;
}

export interface Pose {
  bob?: number;
  /** Leg lift (front/back) or forward offset (side), in px. */
  legL?: number;
  legR?: number;
  lean?: number;
  /** Hand target relative to its shoulder. */
  armL?: [number, number];
  armR?: [number, number];
  sword?: { angle: number; len?: number; behind?: boolean } | undefined;
  face?: 'normal' | 'hurt';
  scarfWave?: number;
}

export const HERO_LOOK: Look = {
  skin: [P.h1, P.h2, P.h3],
  hair: [P.ink2, P.b0, P.b1],
  hairStyle: 'messy',
  tunic: [P.b1, P.b2, P.b3],
  trim: P.y3,
  pants: P.o2,
  boots: P.o1,
  scarf: [P.y1, P.y2],
  sword: true,
};

const FY = 29;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Thick 2px limb: sleeve colour then a 2x2 hand. */
function arm(pm: Pixmap, sx: number, sy: number, hx: number, hy: number, sleeve: Color, skin: Color, cuff: Color): void {
  const ex = Math.round(hx);
  const ey = Math.round(hy);
  pm.line(sx, sy, ex, ey, sleeve);
  pm.line(sx + 1, sy, ex + 1, ey, sleeve);
  pm.line(sx, sy + 1, ex, ey + 1, shade(sleeve, -0.25));
  pm.rect(ex, ey, 2, 2, skin);
  pm.set(ex, ey - 1, cuff);
  pm.set(ex + 1, ey - 1, cuff);
}

function swordAt(pm: Pixmap, hx: number, hy: number, angle: number, len: number): void {
  const a = rad(angle);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const x0 = hx + 1;
  const y0 = hy + 1;
  const x1 = x0 + dx * len;
  const y1 = y0 + dy * len;
  // blade: light edge + body + amber glow
  const px = -dy;
  const py = dx;
  pm.line(x0, y0, x1, y1, P.s4);
  pm.line(x0 + px, y0 + py, x1 + px, y1 + py, P.s6);
  pm.line(x0 - px, y0 - py, x1 - px, y1 - py, P.y3, 200);
  pm.set(Math.round(x1 + dx), Math.round(y1 + dy), P.white);
  // guard + grip
  pm.line(x0 - px * 2 - dx, y0 - py * 2 - dy, x0 + px * 2 - dx, y0 + py * 2 - dy, P.y4);
  pm.set(Math.round(x0 - dx * 2), Math.round(y0 - dy * 2), P.o2);
}

function hairFront(pm: Pixmap, look: Look, hx: number, hy: number, back: boolean): void {
  const [h0, h1, h2] = look.hair;
  switch (look.hairStyle) {
    case 'bald': {
      pm.ellipse(hx + 6, hy + 2, 6, 3, look.skin[1]);
      break;
    }
    case 'cap': {
      pm.rect(hx - 1, hy - 1, 14, 6, P.r2);
      pm.hline(hx - 1, hy - 1, 14, P.r4);
      pm.rect(hx - 1, hy + 4, 14, 1, P.r0);
      break;
    }
    default: {
      pm.rect(hx - 1, hy, 14, back ? 10 : 5, h1);
      pm.rect(hx, hy - 1, 12, 1, h1);
      pm.hline(hx + 1, hy - 1, 5, h2);
      pm.hline(hx, hy, 3, h2);
      pm.rect(hx + 8, hy + 1, 4, 2, h0);
      if (!back) {
        // fringe
        for (const [x, y] of [[0, 5], [2, 6], [4, 5], [7, 6], [9, 5], [11, 5]] as const) pm.set(hx + x, hy + y, h1);
        pm.vline(hx - 1, hy + 5, 3, h0);
        pm.vline(hx + 12, hy + 5, 3, h0);
      } else {
        pm.hline(hx, hy + 9, 12, h0);
        pm.vline(hx + 6, hy + 4, 5, h0);
      }
      if (look.hairStyle === 'bun') {
        pm.ellipse(hx + 6, hy - 4, 3, 2.4, h1);
        pm.hline(hx + 4, hy - 5, 3, h2);
      }
      if (look.hairStyle === 'long' || look.hairStyle === 'braid') {
        pm.vline(hx - 1, hy + 5, 9, h1);
        pm.vline(hx + 12, hy + 5, 9, h0);
        if (look.hairStyle === 'braid') {
          pm.rect(hx + 12, hy + 8, 2, 7, h1);
          pm.set(hx + 12, hy + 15, P.r3);
        }
      }
    }
  }
}

export function drawHumanoid(look: Look, dir: Dir, pose: Pose = {}): Pixmap {
  const b = new Pixmap(32, 32);
  const by = pose.bob ?? 0;
  const lean = pose.lean ?? 0;
  const small = look.small ? 3 : 0;
  const [t0, t1, t2] = look.tunic;
  const skin = look.skin;
  const legL = pose.legL ?? 0;
  const legR = pose.legR ?? 0;
  const top = 16 + by + small; // torso top
  const hipY = top + 7;
  const headY = 6 + by + small - (look.small ? 0 : 0);

  const swordPose = look.sword && pose.sword;
  const weaponBehind = swordPose && pose.sword!.behind;

  const drawSword = (hx: number, hy: number): void => {
    if (swordPose) swordAt(b, hx, hy, pose.sword!.angle, pose.sword!.len ?? 11);
  };

  if (dir === 'd' || dir === 'u') {
    const back = dir === 'u';
    const legTop = hipY;
    const drawLeg = (x: number, lift: number): void => {
      const bottom = FY - Math.max(0, lift);
      const len = Math.max(2, bottom - legTop + 1);
      if (look.robe) return;
      b.rect(x, legTop, 3, len - 2, look.pants);
      b.vline(x, legTop, len - 2, shade(look.pants, 0.2));
      b.rect(x, bottom - 1, 3, 2, look.boots);
      b.hline(x, bottom - 1, 3, shade(look.boots, 0.3));
      b.set(x + 3, bottom, look.boots);
    };
    if (weaponBehind && swordPose) drawSword(16 + lean, top + 3);
    drawLeg(12 + lean, legL);
    drawLeg(17 + lean, legR);
    // robe
    if (look.robe) {
      b.rect(10 + lean, top + 6, 12, FY - top - 6 - 1, t1);
      b.rect(10 + lean, FY - 3, 12, 3, t0);
      b.vline(10 + lean, top + 6, FY - top - 8, t2);
      b.vline(21 + lean, top + 6, FY - top - 8, t0);
      b.hline(10 + lean, FY - 1, 12, look.trim);
    }
    // torso
    b.rect(11 + lean, top, 10, 8, t1);
    b.vline(11 + lean, top, 8, t2);
    b.vline(12 + lean, top, 6, shade(t2, -0.15));
    b.vline(20 + lean, top, 8, t0);
    b.hline(11 + lean, hipY - 2, 10, look.trim);
    b.hline(11 + lean, hipY - 1, 10, shade(look.trim, -0.4));
    if (!back) b.rect(15 + lean, hipY - 2, 2, 2, P.y4);
    if (look.apron) {
      b.rect(12 + lean, top + 2, 8, 6, look.apron);
      b.hline(12 + lean, top + 2, 8, shade(look.apron, 0.3));
    }
    // scarf
    if (look.scarf) {
      b.rect(10 + lean, top - 1, 12, 2, look.scarf[1]);
      b.hline(10 + lean, top - 1, 12, shade(look.scarf[1], 0.3));
      b.hline(10 + lean, top, 12, look.scarf[0]);
      const w = pose.scarfWave ?? 0;
      b.rect(back ? 12 + lean : 20 + lean, top, 3, 6 + w, look.scarf[1]);
      b.vline(back ? 12 + lean : 22 + lean, top + 1, 5 + w, look.scarf[0]);
    }
    // arms
    const aL = pose.armL ?? [-1, 6];
    const aR = pose.armR ?? [1, 6];
    if (!(swordPose && pose.sword!.behind && back)) {
      arm(b, 10 + lean, top + 2, 10 + lean + aL[0], top + 2 + aL[1], t1, skin[1], look.trim);
      arm(b, 20 + lean, top + 2, 20 + lean + aR[0], top + 2 + aR[1], t1, skin[1], look.trim);
    }
    // head
    const hx = 10 + lean;
    b.rect(hx, headY, 12, 10, skin[1]);
    b.set(hx, headY, 0, 0);
    b.rect(hx + 1, headY + 9, 10, 1, skin[0]);
    b.vline(hx, headY + 3, 5, skin[2]);
    if (!back) {
      const hurt = pose.face === 'hurt';
      hairFront(b, look, hx, headY - 1, false);
      // eyes
      const ey = headY + 5;
      if (hurt) {
        for (const ex of [hx + 2, hx + 8]) {
          b.set(ex, ey, P.ink1);
          b.set(ex + 1, ey + 1, P.ink1);
          b.set(ex + 1, ey, P.ink1);
          b.set(ex, ey + 1, P.ink1);
        }
      } else {
        for (const ex of [hx + 3, hx + 8]) {
          b.rect(ex, ey, 1, 2, P.ink1);
          b.set(ex, ey, P.ink0);
        }
        b.set(hx + 3, ey, P.white);
        b.set(hx + 8, ey, P.white);
        b.set(hx + 3, ey + 1, P.ink0);
        b.set(hx + 8, ey + 1, P.ink0);
      }
      b.set(hx + 1, ey + 2, P.p2, 200);
      b.set(hx + 10, ey + 2, P.p2, 200);
      b.hline(hx + 5, ey + 3, 2, hurt ? P.ink1 : P.h0);
      if (look.beard) {
        b.rect(hx + 1, headY + 6, 10, 4, look.beard);
        b.rect(hx + 3, headY + 10, 6, 2, look.beard);
        b.hline(hx + 4, headY + 6, 4, skin[1]);
        b.hline(hx + 2, headY + 5, 8, look.beard);
      }
    } else {
      hairFront(b, look, hx, headY - 1, true);
    }
    if (swordPose && !weaponBehind) {
      const hand = pose.armR ?? [1, 6];
      drawSword(20 + lean + hand[0], top + 2 + hand[1]);
    }
    if (look.staff) {
      b.vline(23 + lean, top - 8, 32 - top + 8 - 3, P.o3);
      b.vline(24 + lean, top - 8, 32 - top + 8 - 3, P.o1);
      b.ellipse(23.5 + lean, top - 9, 2.4, 2.4, P.k3);
      b.set(23 + lean, top - 10, P.k4);
    }
  } else {
    // ── side view (facing right) ──
    // legs swing from the hip: `stride` shifts the foot forward (+) / back (-), the forward foot lifts a pixel
    const drawLegS = (x: number, stride: number, dark: boolean): void => {
      if (look.robe) return;
      const bottom = FY - (stride > 1 ? 1 : 0);
      const c = dark ? shade(look.pants, -0.25) : look.pants;
      const boots = dark ? shade(look.boots, -0.2) : look.boots;
      const len = bottom - hipY - 1;
      for (let i = 0; i < len; i++) b.rect(x + Math.round((stride * i) / Math.max(1, len - 1)), hipY + i, 3, 1, c);
      b.rect(x + stride, bottom - 1, 4, 2, boots);
      b.set(x + stride + 3, bottom, boots);
    };
    const farArm = pose.armL ?? [-1, 6];
    const nearArm = pose.armR ?? [1, 6];
    if (weaponBehind && swordPose) drawSword(18 + lean + nearArm[0], top + 2 + nearArm[1]);
    // far arm (behind torso)
    arm(b, 15 + lean, top + 2, 15 + lean + farArm[0], top + 2 + farArm[1], shade(t1, -0.3), shade(skin[1], -0.2), look.trim);
    drawLegS(14 + lean, legL, true);
    drawLegS(15 + lean, legR, false);
    if (look.robe) {
      b.rect(11 + lean, top + 6, 10, FY - top - 7, t1);
      b.rect(11 + lean, FY - 3, 10, 3, t0);
      b.vline(11 + lean, top + 6, FY - top - 8, t2);
      b.hline(11 + lean, FY - 1, 10, look.trim);
    }
    b.rect(12 + lean, top, 8, 8, t1);
    b.vline(12 + lean, top, 8, t2);
    b.vline(19 + lean, top, 8, t0);
    b.hline(12 + lean, hipY - 2, 8, look.trim);
    b.hline(12 + lean, hipY - 1, 8, shade(look.trim, -0.4));
    if (look.apron) {
      b.rect(16 + lean, top + 2, 4, 6, look.apron);
    }
    if (look.scarf) {
      b.rect(11 + lean, top - 1, 9, 2, look.scarf[1]);
      b.hline(11 + lean, top - 1, 9, shade(look.scarf[1], 0.3));
      const w = pose.scarfWave ?? 0;
      b.rect(8 + lean - w, top, 4 + w, 2, look.scarf[1]);
      b.rect(6 + lean - w, top + 1, 4, 2, look.scarf[0]);
    }
    // head (profile)
    const hx = 10 + lean;
    b.rect(hx + 1, headY, 11, 10, skin[1]);
    b.rect(hx + 12, headY + 6, 1, 2, skin[1]); // nose
    b.hline(hx + 2, headY + 9, 9, skin[0]);
    b.set(hx + 1, headY, 0, 0);
    b.set(hx + 11, headY, 0, 0);
    hairFront(b, look, hx - 1, headY - 1, true);
    b.rect(hx + 7, headY + 2, 6, 8, skin[1]); // face: keep the front of the head free of hair
    b.hline(hx + 8, headY + 9, 4, skin[0]);
    b.rect(hx + 8, headY + 1, 4, 1, look.hairStyle === 'bald' ? skin[1] : look.hair[1]);
    if (look.hairStyle !== 'bald' && look.hairStyle !== 'cap') {
      b.hline(hx + 7, headY + 2, 5, look.hair[1]);
      b.set(hx + 12, headY + 3, look.hair[1]);
    }
    const hurt = pose.face === 'hurt';
    const ey = headY + 5;
    if (hurt) {
      b.set(hx + 9, ey, P.ink1);
      b.set(hx + 10, ey + 1, P.ink1);
      b.set(hx + 10, ey, P.ink1);
      b.set(hx + 9, ey + 1, P.ink1);
    } else {
      b.rect(hx + 10, ey, 1, 2, P.ink1);
      b.set(hx + 10, ey, P.white);
      b.set(hx + 10, ey + 1, P.ink0);
    }
    b.set(hx + 9, ey + 2, P.p2, 200);
    b.hline(hx + 11, ey + 3, 1, P.h0);
    b.rect(hx + 4, headY + 4, 2, 3, skin[0]); // ear
    if (look.beard) {
      b.rect(hx + 5, headY + 6, 7, 5, look.beard);
      b.rect(hx + 8, headY + 5, 4, 2, look.beard);
    }
    // near arm + weapon
    arm(b, 16 + lean, top + 2, 16 + lean + nearArm[0], top + 2 + nearArm[1], t1, skin[1], look.trim);
    if (swordPose && !weaponBehind) drawSword(16 + lean + nearArm[0], top + 2 + nearArm[1]);
    if (look.staff) {
      const sx = 22 + lean;
      b.vline(sx, top - 8, 32 - top + 8 - 3, P.o3);
      b.vline(sx + 1, top - 8, 32 - top + 8 - 3, P.o1);
      b.ellipse(sx + 0.5, top - 9, 2.4, 2.4, P.k3);
      b.set(sx, top - 10, P.k4);
    }
  }
  return finish(b, { cx: 16, cy: FY, rx: 7.5, ry: 2.6, alpha: 95 });
}

// ───────────────────────────── hero animation tables ─────────────────────────────

const BASE_ANGLE: Record<Dir, number> = { d: 90, u: -90, s: 0 };

/** Sword hand reach from shoulder along the swing angle. */
function reach(angle: number, r: number): [number, number] {
  return [Math.round(Math.cos(rad(angle)) * r), Math.round(Math.sin(rad(angle)) * r)];
}

function attackPose(dir: Dir, n: 1 | 2 | 3 | 4, f: 0 | 1 | 2): Pose {
  const base = BASE_ANGLE[dir];
  const table: Record<number, [number, number, number]> = {
    1: [-105, -10, 55],
    2: [75, 5, -70],
    3: [0, 0, 0],
    // the heavy finisher: a wide overhead swing that travels further than any light swing
    4: [-140, -15, 80],
  };
  const ang = base + table[n][f];
  const isThrust = n === 3;
  const r = isThrust ? [2, 7, 6][f] : n === 4 ? [3, 8, 7][f] : [3, 6, 5][f];
  const armAngle = isThrust ? base : ang;
  const hand = reach(armAngle, r);
  const lean = dir === 's' ? [0, 2, 1][f] * (isThrust ? 1.5 : 1) : 0;
  return {
    bob: f === 1 ? 1 : 0,
    lean: Math.round(lean),
    armR: [hand[0], hand[1] + 1],
    armL: dir === 's' ? [-2, 5] : [-2, 5],
    sword: { angle: ang, len: isThrust ? 12 : n === 4 ? 13 : 11, behind: dir === 'u' && f === 1 },
    legL: 0,
    legR: 0,
    scarfWave: f,
  };
}

const IDLE: Pose[] = [
  { bob: 0, scarfWave: 0 },
  { bob: 1, scarfWave: 1, armL: [-1, 5], armR: [1, 5] },
];

function walkPose(dir: Dir, i: number): Pose {
  const bob = [0, -1, 0, -1][i];
  const l = [2, 0, 0, 0][i];
  const r = [0, 0, 2, 0][i];
  const swing = [2, 0, -2, 0][i];
  if (dir === 's') {
    return { bob, legL: [3, 0, -3, 0][i], legR: [-3, 0, 3, 0][i], armL: [swing, 6], armR: [-swing, 6], scarfWave: i % 3 };
  }
  return { bob, legL: l, legR: r, armL: [-1, 6 + (swing > 0 ? -1 : 0)], armR: [1, 6 + (swing < 0 ? -1 : 0)], scarfWave: i % 3 };
}

const HURT: Pose = { bob: 1, lean: -1, face: 'hurt', armL: [-3, 3], armR: [3, 3] };

function heroRoll(frame: number): Pixmap {
  const b = new Pixmap(32, 32);
  const cx = 16;
  const cy = 22;
  b.ellipse(cx, cy, 7, 6.5, HERO_LOOK.tunic[1]);
  b.ellipse(cx - 2, cy - 2, 3.5, 3, HERO_LOOK.tunic[2]);
  b.ellipse(cx + 3, cy + 3, 4, 3, HERO_LOOK.tunic[0]);
  const a = rad(frame * 90 + 20);
  // head patch (skin + hair) orbiting the ball
  const hx = cx + Math.cos(a) * 5;
  const hy = cy + Math.sin(a) * 5;
  b.ellipse(hx, hy, 3.6, 3.4, HERO_LOOK.skin[1]);
  b.ellipse(hx - Math.cos(a) * 1.4, hy - Math.sin(a) * 1.4, 3.6, 3, HERO_LOOK.hair[1]);
  // scarf ring
  const sa = a + 0.9;
  b.rect(Math.round(cx + Math.cos(sa) * 6.5) - 1, Math.round(cy + Math.sin(sa) * 6) - 1, 3, 3, HERO_LOOK.scarf![1]);
  // boots patch opposite
  const ba = a + Math.PI;
  b.rect(Math.round(cx + Math.cos(ba) * 6) - 1, Math.round(cy + Math.sin(ba) * 5.5) - 1, 3, 3, HERO_LOOK.boots);
  return finish(b, { cx: 16, cy: FY, rx: 8, ry: 2.4, alpha: 95 });
}

function heroCast(frame: number): Pixmap {
  const pose: Pose = frame === 0
    ? { bob: 0, armL: [-4, -3], armR: [4, -3], sword: { angle: -90, len: 11 }, scarfWave: 1 }
    : { bob: -1, legL: 0, legR: 0, armL: [-5, -7], armR: [5, -7], sword: { angle: -90, len: 12 }, scarfWave: 2 };
  return drawHumanoid(HERO_LOOK, 'd', pose);
}

function heroDead(): Pixmap {
  const b = new Pixmap(32, 32);
  const L = HERO_LOOK;
  // lying on the side: body ellipse + head
  b.ellipse(16, 24, 9, 4.6, L.tunic[1]);
  b.hline(9, 22, 14, L.tunic[2]);
  b.hline(10, 27, 12, L.tunic[0]);
  b.rect(8, 26, 3, 3, L.boots);
  b.rect(11, 27, 4, 2, L.pants);
  b.ellipse(24, 23, 4.6, 4.2, L.skin[1]);
  b.ellipse(23, 21, 4.6, 3.2, L.hair[1]);
  b.set(26, 24, P.ink1);
  b.set(27, 25, P.ink1);
  b.set(27, 24, P.ink1);
  b.set(26, 25, P.ink1);
  b.rect(13, 20, 5, 2, L.scarf![1]);
  b.line(6, 22, 3, 19, P.s4);
  return finish(b, { cx: 16, cy: 28, rx: 12, ry: 2.6, alpha: 90 });
}

export const HERO_SHEET_KEY = 'hero';
export const HERO_ANIMS = {
  idle: 2,
  walk: 4,
  a1: 3,
  a2: 3,
  a3: 3,
  /** The heavy finisher, reached by holding the attack button. */
  a4: 3,
  hurt: 1,
} as const;
export type HeroAnim = keyof typeof HERO_ANIMS;

export function buildHeroSheet(): Sheet {
  const sb = new SheetBuilder(HERO_SHEET_KEY, 512, 1);
  const add = (name: string, pm: Pixmap): void => {
    sb.add(name, pm, 16, FY);
  };
  for (const dir of ['d', 'u', 's'] as Dir[]) {
    IDLE.forEach((p, i) => add(`hero_${dir}_idle_${i}`, drawHumanoid(HERO_LOOK, dir, { ...p, sword: undefined })));
    for (let i = 0; i < 4; i++) add(`hero_${dir}_walk_${i}`, drawHumanoid(HERO_LOOK, dir, walkPose(dir, i)));
    for (const n of [1, 2, 3, 4] as const)
      for (const f of [0, 1, 2] as const) add(`hero_${dir}_a${n}_${f}`, drawHumanoid(HERO_LOOK, dir, attackPose(dir, n, f)));
    add(`hero_${dir}_hurt_0`, drawHumanoid(HERO_LOOK, dir, HURT));
  }
  for (let i = 0; i < 4; i++) add(`hero_roll_${i}`, heroRoll(i));
  for (let i = 0; i < 2; i++) add(`hero_cast_${i}`, heroCast(i));
  add('hero_dead', heroDead());
  return sb.build();
}

// ───────────────────────────── NPCs ─────────────────────────────

export const NPC_LOOKS: Record<string, Look> = {
  elder: {
    skin: [P.h1, P.h2, P.h3],
    hair: [P.s3, P.s5, P.s6],
    hairStyle: 'bun',
    tunic: [P.t0, P.t2, P.t3],
    trim: P.y3,
    pants: P.t0,
    boots: P.o1,
    beard: P.s6,
    robe: true,
    staff: true,
    scarf: [P.y1, P.y3],
  },
  smith: {
    skin: [P.h0, P.h1, P.h2],
    hair: [P.o0, P.o1, P.o2],
    hairStyle: 'braid',
    tunic: [P.r0, P.r1, P.r2],
    trim: P.o4,
    pants: P.o1,
    boots: P.o0,
    apron: P.o3,
  },
  kid: {
    skin: [P.h1, P.h2, P.h3],
    hair: [P.y1, P.y2, P.y3],
    hairStyle: 'messy',
    tunic: [P.g1, P.g2, P.g3],
    trim: P.white,
    pants: P.o2,
    boots: P.o1,
    small: true,
  },
  guard: {
    skin: [P.h0, P.h1, P.h2],
    hair: [P.ink2, P.ink3, P.s2],
    hairStyle: 'cap',
    tunic: [P.s1, P.s2, P.s3],
    trim: P.y3,
    pants: P.s1,
    boots: P.o1,
    beard: P.o1,
  },
};

export const NPC_SHEET_KEY = 'npc';

export function buildNpcSheet(): Sheet {
  const sb = new SheetBuilder(NPC_SHEET_KEY, 512, 1);
  for (const [name, look] of Object.entries(NPC_LOOKS)) {
    for (const dir of ['d', 'u', 's'] as Dir[])
      IDLE.forEach((p, i) => sb.add(`${name}_${dir}_${i}`, drawHumanoid(look, dir, { ...p, sword: undefined }), 16, FY));
    // portrait: head + shoulders crop of the front frame (2x, outlined face)
    const front = drawHumanoid(look, 'd', {});
    sb.add(`portrait_${name}`, front.sub(6, 0, 20, 20).mapColors((c) => mix(c, c, 0)), 10, 20);
  }
  return sb.build();
}

