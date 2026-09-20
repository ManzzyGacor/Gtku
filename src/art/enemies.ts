/** Enemy sprites: Lendir Lumut (slime), Pemanah Duri (archer), Kelelawar Kelam (bat), Kolosus Kelam (boss). */
import { finish, shadedBlob } from './draw';
import { P } from './palette';
import { Pixmap } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

const MOSS = [P.g0, P.g1, P.g2, P.g3, P.g4] as const;
const STONE = [P.s0, P.s1, P.s2, P.s3, P.s4] as const;

// ───────────────────────────── slime ─────────────────────────────

function slime(rx: number, ry: number, open: boolean, look: number): Pixmap {
  const W = 32;
  const H = 28;
  const b = new Pixmap(W, H);
  const cx = 16;
  const bottom = 24;
  const cy = bottom - ry;
  shadedBlob(b, cx, cy, rx, ry, MOSS, 4, -0.5, -0.8);
  // dark core + belly shade
  b.ellipse(cx + 1, cy + ry * 0.3, rx * 0.6, ry * 0.4, P.g1, 120);
  // moss tufts on top
  for (const [dx, dy] of [[-3, -ry + 1], [0, -ry], [4, -ry + 2], [-6, -ry + 3]] as const) {
    b.set(cx + dx, Math.round(cy + dy), P.f3);
    b.set(cx + dx, Math.round(cy + dy) - 1, P.g5);
    b.set(cx + dx + 1, Math.round(cy + dy), P.f2);
  }
  // shine
  b.set(cx - Math.round(rx * 0.55), Math.round(cy - ry * 0.5), P.white);
  b.set(cx - Math.round(rx * 0.55) + 1, Math.round(cy - ry * 0.5), P.g5);
  // face
  const ey = Math.round(cy - ry * 0.05);
  const ex = 3 + look;
  for (const x of [cx - ex, cx + ex - 1]) {
    b.rect(x, ey, 2, 3, P.white);
    b.rect(x + (look > 0 ? 1 : 0), ey + 1, 1, 2, P.ink0);
  }
  if (open) {
    b.rect(cx - 2, ey + 4, 4, 3, P.ink1);
    b.hline(cx - 1, ey + 4, 2, P.white);
    b.hline(cx - 1, ey + 6, 2, P.r3);
  } else b.hline(cx - 1, ey + 5, 3, P.ink1);
  return finish(b, { cx, cy: bottom + 1, rx: rx + 1, ry: 2.6, alpha: 95 });
}

// ───────────────────────────── archer ─────────────────────────────

interface ArcherPose {
  bob: number;
  step: number;
  aim: number; // 0 rest, 1 raised, 2 drawn
}

function archer(dir: 'd' | 's', pose: ArcherPose): Pixmap {
  const b = new Pixmap(32, 32);
  const by = pose.bob;
  const bark = [P.o1, P.o2, P.o3, P.o4] as const;
  const leaf = [P.g1, P.g2, P.g3] as const;
  const FY = 29;
  // legs
  const legY = 22 + by;
  if (dir === 'd') {
    b.rect(12, legY, 3, FY - legY - Math.max(0, pose.step), bark[1]);
    b.rect(17, legY, 3, FY - legY - Math.max(0, -pose.step), bark[1]);
    b.rect(11, FY - 1 - Math.max(0, pose.step), 4, 2, bark[0]);
    b.rect(17, FY - 1 - Math.max(0, -pose.step), 4, 2, bark[0]);
  } else {
    b.rect(14 + (pose.step > 0 ? -1 : 0), legY, 3, FY - legY, bark[1]);
    b.rect(16 + (pose.step > 0 ? 1 : 0), legY, 3, FY - legY - Math.max(0, pose.step), bark[2]);
    b.rect(14, FY - 1, 6, 2, bark[0]);
  }
  // body: leafy tunic
  b.rect(11, 14 + by, 10, 9, bark[2]);
  b.vline(11, 14 + by, 9, bark[3]);
  b.vline(20, 14 + by, 9, bark[1]);
  for (let x = 11; x < 21; x += 2) b.tri(x, 20 + by, x + 2, 20 + by, x + 1, 24 + by, leaf[(x >> 1) % 3]);
  b.hline(11, 19 + by, 10, leaf[0]);
  // thorns on shoulders / back
  b.tri(9, 15 + by, 12, 14 + by, 10, 10 + by, P.cream);
  b.tri(23, 15 + by, 20, 14 + by, 22, 10 + by, P.cream);
  b.tri(15, 14 + by, 17, 14 + by, 16, 9 + by, P.cream);
  // head
  const hy = 5 + by;
  b.ellipse(16, hy + 5, 6.4, 5.4, bark[3]);
  b.rect(10, hy + 3, 12, 6, bark[3]);
  b.set(9, hy + 4, bark[3]);
  b.set(22, hy + 4, bark[3]);
  // leaf hood
  b.ellipse(16, hy + 2.5, 7.4, 3.6, leaf[1]);
  for (let i = 0; i < 4; i++) b.tri(10 + i * 3, hy + 2, 13 + i * 3, hy + 2, 11.5 + i * 3, hy - 2 + (i % 2), leaf[2]);
  // pointed ears
  b.tri(8, hy + 5, 11, hy + 4, 5, hy + 1, bark[3]);
  b.tri(24, hy + 5, 21, hy + 4, 27, hy + 1, bark[3]);
  if (dir === 'd') {
    for (const x of [12, 18]) {
      b.rect(x, hy + 5, 3, 2, P.ink0);
      b.set(x + 1, hy + 5, P.y3);
      b.set(x + 1, hy + 6, P.y2);
    }
    b.hline(14, hy + 9, 4, P.ink1);
    b.set(15, hy + 9, P.white);
    b.set(17, hy + 9, P.white);
  } else {
    b.rect(17, hy + 5, 3, 2, P.ink0);
    b.set(18, hy + 5, P.y3);
    b.hline(18, hy + 9, 3, P.ink1);
  }
  // bow: arc on the side; raised & drawn when aiming
  const bx = dir === 'd' ? 25 : 22;
  const top = 12 + by - pose.aim * 1;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const off = Math.round(Math.sin(t * Math.PI) * (3 - pose.aim * 0.6));
    b.set(bx + off, top + i, bark[3]);
    b.set(bx + off + 1, top + i, bark[1]);
  }
  const stringX = bx - (pose.aim === 2 ? 4 : pose.aim === 1 ? 1 : 0);
  b.line(bx, top, stringX, top + 7, P.cream);
  b.line(stringX, top + 7, bx, top + 14, P.cream);
  if (pose.aim >= 1) b.hline(stringX, top + 7, 8 + pose.aim, P.o5);
  if (pose.aim === 2) b.set(bx + 8, top + 7, P.s5);
  // hand
  b.rect(dir === 'd' ? 20 : 17, 17 + by, 3, 3, bark[3]);
  return finish(b, { cx: 16, cy: FY, rx: 7.5, ry: 2.4, alpha: 95 });
}

// ───────────────────────────── bat ─────────────────────────────

function bat(wing: number, dive = false): Pixmap {
  const b = new Pixmap(32, 24);
  const cx = 16;
  const cy = 12;
  const body = [P.ink1, P.ink2, P.ink3, P.c0] as const;
  const mem = [P.c0, P.c1, P.ink3] as const;
  const wy = dive ? [4, 6, 8][1] : [-5, 0, 5][wing];
  const drawWing = (s: number): void => {
    const tipX = cx + s * (dive ? 6 : 13);
    const tipY = cy + wy - (dive ? 4 : 1);
    const elbowX = cx + s * 8;
    const elbowY = cy + wy - 5 + (dive ? 3 : 0);
    b.tri(cx + s * 2, cy - 2, elbowX, elbowY, tipX, tipY, mem[1]);
    b.tri(cx + s * 2, cy - 2, tipX, tipY, cx + s * 5, cy + 4, mem[0]);
    b.tri(cx + s * 2, cy + 1, tipX, tipY, cx + s * 4, cy + 5, mem[2]);
    b.line(cx + s * 2, cy - 2, elbowX, elbowY, P.c2);
    b.line(elbowX, elbowY, tipX, tipY, P.c2);
    b.line(cx + s * 3, cy + 1, tipX, tipY, P.c1);
  };
  drawWing(-1);
  drawWing(1);
  shadedBlob(b, cx, cy + 1, 4.4, 4.6, body, 9);
  // ears + head
  b.tri(cx - 4, cy - 3, cx - 2, cy - 4, cx - 4, cy - 8, body[1]);
  b.tri(cx + 4, cy - 3, cx + 2, cy - 4, cx + 4, cy - 8, body[1]);
  b.set(cx - 3, cy - 6, P.p0);
  b.set(cx + 3, cy - 6, P.p0);
  // eyes + fangs
  for (const x of [cx - 3, cx + 1]) {
    b.rect(x, cy - 1, 2, 2, P.y2);
    b.set(x, cy - 1, P.y4);
  }
  b.set(cx - 2, cy + 3, P.white);
  b.set(cx + 1, cy + 3, P.white);
  return finish(b, undefined);
}

// ───────────────────────────── boss ─────────────────────────────

interface BossPose {
  bob: number;
  armL: number; // vertical raise: -1 down, 0 idle, 1 raised
  armR: number;
  glow: number; // 0..1 core brightness
  open?: boolean;
}

function boss(p: BossPose): Pixmap {
  const W = 72;
  const H = 84;
  const b = new Pixmap(W, H);
  const by = p.bob;
  const cx = 36;
  // legs
  for (const x of [22, 40]) {
    shadedBlob(b, x + 5, 70, 8, 8, STONE, x);
    b.rect(x - 1, 58, 12, 12, P.s2);
    b.vline(x - 1, 58, 12, P.s4);
    b.vline(x + 10, 58, 12, P.s0);
    b.hline(x - 2, 76, 14, P.s1);
  }
  // torso
  shadedBlob(b, cx, 42 + by, 19, 18, STONE, 3, -0.5, -0.8);
  b.rect(cx - 15, 46 + by, 30, 12, P.s2);
  b.hline(cx - 15, 46 + by, 30, P.s3);
  b.vline(cx - 15, 46 + by, 12, P.s4);
  b.vline(cx + 14, 46 + by, 12, P.s0);
  // cracks
  b.line(cx - 12, 34 + by, cx - 6, 46 + by, P.s0);
  b.line(cx + 8, 32 + by, cx + 12, 44 + by, P.s0);
  b.line(cx - 4, 50 + by, cx - 8, 57 + by, P.s0);
  // glowing core
  const core = p.glow;
  b.ellipse(cx, 42 + by, 7, 7, P.c0);
  b.ellipse(cx, 42 + by, 5.4, 5.4, core > 0.6 ? P.c3 : P.c2);
  b.ellipse(cx, 42 + by, 3, 3, core > 0.6 ? P.c4 : P.c3);
  b.set(cx - 1, 41 + by, P.white);
  for (const [dx, dy] of [[-8, 0], [8, 0], [0, -8], [0, 8]] as const) b.set(cx + dx, 42 + by + dy, P.c2);
  // head (small, sunk between shoulders)
  shadedBlob(b, cx, 21 + by, 8.5, 7.5, STONE, 11, -0.5, -0.8);
  b.rect(cx - 6, 20 + by, 12, 3, P.s1);
  for (const x of [cx - 5, cx + 2]) {
    b.rect(x, 20 + by, 3, 2, P.c4);
    b.set(x + 1, 20 + by, P.white);
  }
  if (p.open) b.rect(cx - 3, 25 + by, 6, 2, P.ink0);
  // horn-like crystals on shoulders
  for (const s of [-1, 1]) {
    b.tri(cx + s * 17, 28 + by, cx + s * 22, 30 + by, cx + s * 21, 14 + by, P.c2);
    b.tri(cx + s * 17, 28 + by, cx + s * 20, 30 + by, cx + s * 19, 18 + by, P.c3);
  }
  // arms: upper arm + fist, angle set by raise
  for (const s of [-1, 1]) {
    const raise = s < 0 ? p.armL : p.armR;
    const sx = cx + s * 20;
    const sy = 34 + by;
    const fx = cx + s * (27 + (raise > 0 ? 1 : 0));
    const fy = raise > 0 ? 10 + by : raise < 0 ? 66 : 54 + by;
    b.line(sx, sy, fx, fy, P.s2);
    b.line(sx + s, sy, fx + s, fy, P.s3);
    b.line(sx - s, sy, fx - s, fy, P.s1);
    b.line(sx, sy + 1, fx, fy + 1, P.s2);
    b.line(sx + s * 2, sy + 1, fx + s * 2, fy + 1, P.s2);
    shadedBlob(b, fx, fy + 2, 8, 7.5, STONE, 30 + s, -0.5, -0.8);
    b.hline(fx - 5, fy + 5, 10, P.s1);
    b.set(fx - 2, fy, P.c2);
    b.set(fx + 2, fy, P.c2);
  }
  return finish(b, { cx: cx, cy: 79, rx: 26, ry: 5, alpha: 105 });
}

export const ENEMY_SHEET_KEY = 'enemies';

export function buildEnemySheet(): Sheet {
  const sb = new SheetBuilder(ENEMY_SHEET_KEY, 512, 1);
  // slime: anchor bottom (feet) at y=25
  const S = (name: string, pm: Pixmap): void => void sb.add(name, pm, 16, 25);
  S('slime_idle_0', slime(9, 7, false, 0));
  S('slime_idle_1', slime(9.6, 6.2, false, 0));
  S('slime_hop_0', slime(10.4, 5, false, 1));
  S('slime_hop_1', slime(7, 9.4, false, 1));
  S('slime_hop_2', slime(10, 5.4, false, 1));
  S('slime_atk_0', slime(7.4, 9.8, true, 0));
  S('slime_atk_1', slime(11, 5.4, true, 1));

  for (const dir of ['d', 's'] as const) {
    const A = (name: string, pm: Pixmap): void => void sb.add(name, pm, 16, 29);
    A(`archer_${dir}_idle_0`, archer(dir, { bob: 0, step: 0, aim: 0 }));
    A(`archer_${dir}_idle_1`, archer(dir, { bob: 1, step: 0, aim: 0 }));
    A(`archer_${dir}_walk_0`, archer(dir, { bob: 0, step: 2, aim: 0 }));
    A(`archer_${dir}_walk_1`, archer(dir, { bob: -1, step: -2, aim: 0 }));
    A(`archer_${dir}_aim_0`, archer(dir, { bob: 0, step: 0, aim: 1 }));
    A(`archer_${dir}_aim_1`, archer(dir, { bob: 0, step: 0, aim: 2 }));
  }
  for (let i = 0; i < 3; i++) sb.add(`bat_${i}`, bat(i), 16, 12);
  sb.add('bat_dive', bat(0, true), 16, 12);

  const B = (name: string, pm: Pixmap): void => void sb.add(name, pm, 36, 79);
  B('boss_idle_0', boss({ bob: 0, armL: 0, armR: 0, glow: 0.4 }));
  B('boss_idle_1', boss({ bob: 1, armL: 0, armR: 0, glow: 0.8 }));
  B('boss_slam_0', boss({ bob: -2, armL: 1, armR: 1, glow: 1, open: true }));
  B('boss_slam_1', boss({ bob: 3, armL: -1, armR: -1, glow: 0.6, open: true }));
  B('boss_cast_0', boss({ bob: -1, armL: 1, armR: 0, glow: 1, open: true }));
  B('boss_hurt', boss({ bob: 2, armL: 0, armR: 0, glow: 0.2, open: true }));
  return sb.build();
}

