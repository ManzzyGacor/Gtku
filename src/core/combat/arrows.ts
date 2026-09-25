/**
 * Arrow flight, as pure logic: moving, hitting, piercing, and sticking where it lands.
 *
 * It used to live inline in `Combat3D`, which is how two problems went unnoticed: the hit test was
 * a point check at the arrow's new position, so a fast arrow could step *over* a small enemy between
 * two frames, and there was no notion of an arrow landing — it simply vanished. Both are rules of
 * the game, so they belong here, where a test can fire an arrow and watch it.
 *
 * **Swept hits.** Each frame the arrow's whole path segment is tested against every target, and
 * targets are hit in the order the arrow reaches them — which matters for a piercing shot that may
 * pass through two and stop in the third.
 *
 * **Sticking.** An arrow that meets a wall stops just short of it; one that spends its last pierce
 * in an enemy rides along with that enemy. Either way it stays `BOW.stickTime` seconds and then
 * goes, and an arrow in an enemy that dies goes with it.
 */
import { TILE } from '../../config';
import type { ElementId } from './elements';

/** What an arrow can hit. `cy` is the centre height the hit test aims at. */
export interface ArrowTarget {
  x: number;
  cy: number;
  radius: number;
  dead: boolean;
}

export interface Arrow<T extends ArrowTarget = ArrowTarget> {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Flight seconds left. */
  life: number;
  dmg: number;
  /** How many targets it may still pass through before it stops. */
  pierce: number;
  charge: number;
  element?: ElementId | undefined;
  hit: Set<T>;
  /** Seconds left stuck; negative while flying. */
  stuck: number;
  stuckTo: T | null;
  /** Offset from the target it is stuck in. */
  ox: number;
  oy: number;
}

export type ArrowPhase = 'flying' | 'stuck' | 'gone';

/** Extra reach around a target, px: the arrow has a head, not a point. */
const HIT_PAD = 4;
/** Step for the wall test along the path, px: smaller than any wall. */
const WALL_STEP = 4;

export function makeArrow<T extends ArrowTarget>(x: number, y: number, angle: number, speed: number, life: number, dmg: number, pierce: number, charge: number, element?: ElementId): Arrow<T> {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life,
    dmg,
    pierce: Math.max(1, Math.floor(pierce)),
    charge,
    element,
    hit: new Set<T>(),
    stuck: -1,
    stuckTo: null,
    ox: 0,
    oy: 0,
  };
}

/** Where along the segment (0..1) it passes within `r` of the point, or -1 if it does not. */
function segmentHit(x0: number, y0: number, dx: number, dy: number, px: number, py: number, r: number): number {
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x0 + dx * t - px;
  const cy = y0 + dy * t - py;
  return cx * cx + cy * cy <= r * r ? t : -1;
}

/**
 * Advance one arrow by `dt`.
 *
 * `onHit` is called once per target the arrow reaches, in path order, and returns whether the hit
 * counted (an invulnerable boss does not use up a pierce). `stickTime` is how long a landed arrow
 * stays. Allocation-free: this runs for every arrow every frame.
 */
export function stepArrow<T extends ArrowTarget>(
  a: Arrow<T>,
  dt: number,
  targets: readonly T[],
  solid: (tx: number, ty: number) => boolean,
  onHit: (target: T, arrow: Arrow<T>) => boolean,
  stickTime: number,
): ArrowPhase {
  if (a.stuck >= 0) {
    a.stuck -= dt;
    if (a.stuckTo) {
      if (a.stuckTo.dead) return 'gone';
      a.x = a.stuckTo.x + a.ox;
      a.y = a.stuckTo.cy + a.oy;
    }
    return a.stuck > 0 ? 'stuck' : 'gone';
  }

  a.life -= dt;
  const x0 = a.x;
  const y0 = a.y;
  let dx = a.vx * dt;
  let dy = a.vy * dt;

  // walls first: how far along the path the arrow may go at all
  const dist = Math.hypot(dx, dy);
  let wallT = 2;
  const steps = Math.max(1, Math.ceil(dist / WALL_STEP));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (solid(Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) {
      wallT = (i - 1) / steps;
      break;
    }
  }
  if (wallT <= 1) {
    dx *= wallT;
    dy *= wallT;
  }

  // then targets, nearest along the path first
  let lastT = -1;
  for (;;) {
    let best: T | null = null;
    let bestT = 2;
    for (const e of targets) {
      if (e.dead || a.hit.has(e)) continue;
      const t = segmentHit(x0, y0, dx, dy, e.x, e.cy, e.radius + HIT_PAD);
      if (t >= 0 && t >= lastT && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    if (!best) break;
    lastT = bestT;
    a.hit.add(best);
    if (!onHit(best, a)) continue;
    a.pierce--;
    if (a.pierce <= 0) {
      // the last pierce: the arrow stays in this one
      a.stuck = stickTime;
      a.stuckTo = best;
      const hx = x0 + dx * bestT;
      const hy = y0 + dy * bestT;
      const k = Math.min(1, (best.radius * 0.6) / Math.max(0.001, Math.hypot(hx - best.x, hy - best.cy)));
      a.ox = (hx - best.x) * k;
      a.oy = (hy - best.cy) * k;
      a.x = best.x + a.ox;
      a.y = best.cy + a.oy;
      return stickTime > 0 ? 'stuck' : 'gone';
    }
  }

  a.x = x0 + dx;
  a.y = y0 + dy;
  if (wallT <= 1) {
    a.stuck = stickTime;
    return stickTime > 0 ? 'stuck' : 'gone';
  }
  return a.life > 0 ? 'flying' : 'gone';
}
