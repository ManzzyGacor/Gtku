/** Push-rock puzzle logic (pure). The rock lives on tiles; the hero pushes it one tile at a time. */
import { TILE } from '../config';

export interface TilePos {
  tx: number;
  ty: number;
}

export interface PushIntent {
  dx: number;
  dy: number;
}

/**
 * Is the hero (feet at hero.x/hero.y, moving toward `mx,my`) pressing against the rock? Returns the push direction.
 * Contact windows are slightly generous so pushing feels natural with an analog stick.
 */
export function pushIntent(hero: { x: number; y: number }, mx: number, my: number, rock: TilePos): PushIntent | null {
  const rx = rock.tx * TILE + TILE / 2;
  const ry = rock.ty * TILE + TILE / 2;
  const hx = hero.x;
  const hy = hero.y - 3;
  const ax = Math.abs(mx);
  const ay = Math.abs(my);
  if (ax < 0.35 && ay < 0.35) return null;
  if (ax >= ay) {
    const s = Math.sign(mx);
    const gap = (rx - hx) * s;
    if (gap >= 10 && gap <= 16 && Math.abs(ry - hy) <= 9) return { dx: s, dy: 0 };
  } else {
    const s = Math.sign(my);
    const gap = (ry - hy) * s;
    const lo = s > 0 ? 9 : 10;
    const hi = s > 0 ? 14 : 16;
    if (gap >= lo && gap <= hi && Math.abs(rx - hx) <= 9) return { dx: 0, dy: s };
  }
  return null;
}

export class RockPuzzle {
  rock: TilePos;
  solved = false;
  private pushDir: PushIntent | null = null;
  private pushT = 0;

  constructor(
    readonly start: TilePos,
    readonly plate: TilePos,
    /** Is a tile free for the rock to enter (not solid, no other blocker)? */
    private readonly isFree: (tx: number, ty: number) => boolean,
  ) {
    this.rock = { ...start };
  }

  canPush(dx: number, dy: number): boolean {
    if (this.solved) return false;
    return this.isFree(this.rock.tx + dx, this.rock.ty + dy);
  }

  /** Move the rock one tile. Returns true if it moved. */
  push(dx: number, dy: number): boolean {
    if (!this.canPush(dx, dy)) return false;
    this.rock = { tx: this.rock.tx + dx, ty: this.rock.ty + dy };
    if (this.rock.tx === this.plate.tx && this.rock.ty === this.plate.ty) this.solved = true;
    return true;
  }

  /**
   * Feed hero contact every frame. Pushing must be held for a moment before the rock budges.
   * Returns the direction if the rock moved this frame.
   */
  update(dt: number, intent: PushIntent | null, holdSeconds = 0.3): PushIntent | null {
    if (this.solved || !intent || !this.canPush(intent.dx, intent.dy)) {
      this.pushDir = null;
      this.pushT = 0;
      return null;
    }
    if (this.pushDir && this.pushDir.dx === intent.dx && this.pushDir.dy === intent.dy) this.pushT += dt;
    else {
      this.pushDir = intent;
      this.pushT = 0;
    }
    if (this.pushT >= holdSeconds) {
      this.pushT = 0;
      this.push(intent.dx, intent.dy);
      return intent;
    }
    return null;
  }

  /** 0..1 progress of the current push (for a little shudder animation). */
  get pushProgress(): number {
    return this.pushDir ? Math.min(1, this.pushT / 0.3) : 0;
  }

  reset(): void {
    if (this.solved) return;
    this.rock = { ...this.start };
    this.pushDir = null;
    this.pushT = 0;
  }

  /** Place the rock on the plate (loading a solved save). */
  forceSolved(): void {
    this.rock = { ...this.plate };
    this.solved = true;
  }
}
