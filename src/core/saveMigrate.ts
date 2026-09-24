/**
 * Save migration and repair — pure, so it can be tested without a renderer.
 *
 * Two jobs, both real:
 *
 *  1. **Old saves must keep working.** A 2D-era save lives under `lentera-kelam/save/v1`
 *     (`storage.ts` adopts that key) and its payload is the same `v: 1` shape, so the fields load
 *     as they are. What is *not* the same is the world: Batch 2 grew it from 128x80 to 256x128
 *     tiles and moved every area, so a position that was a village square in 2D can be the inside
 *     of a tree now. A save that drops the hero inside a wall is a save that soft-locks the game,
 *     so the position is checked against the collision grid and moved to the nearest free tile.
 *
 *  2. **A corrupt save must not take the game down with it.** localStorage is editable by anyone
 *     with a devtools window, and a half-finished write (phone killed mid-save) leaves truncated
 *     JSON. Every field is coerced, every number checked for NaN/Infinity, and anything that
 *     cannot be repaired makes the whole save fall back to `null` — a fresh start beats a game
 *     that crashes on boot.
 *
 * Both paths report what they changed (`notes`), so the migration is visible in the diagnostics
 * report rather than happening silently.
 */
import { TILE } from '../config';
import { clamp } from './rng';
import type { QuestState, SaveData } from './state/GameState';

/** The little bit of world a migration needs: bounds, collision, and where it can put the hero. */
export interface SaveWorld {
  widthTiles: number;
  heightTiles: number;
  solidAt(tx: number, ty: number): boolean;
  markers: {
    playerStart: { x: number; y: number };
    checkpoints: { id: string; x: number; y: number }[];
  };
}

export interface MigratedSave {
  save: SaveData;
  /** Human-readable list of everything that had to be changed. Empty when the save was already fine. */
  notes: string[];
}

/** The quest has 5 stages (0..4); `KILLS_NEEDED` is 6 but a save may legitimately hold more. */
const MAX_STAGE = 4;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A finite number, or the fallback. Rejects NaN, Infinity, strings and nulls alike. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function boolOf(v: unknown): boolean {
  return v === true;
}

/** Only finite numeric entries survive; a garbage timestamp would make `isDead()` permanent. */
function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
  return out;
}

function boolMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (val === true) out[k] = true;
  return out;
}

/**
 * Coerce whatever was in localStorage into a `SaveData`, or `null` if it is not a save at all.
 *
 * Deliberately forgiving about *missing* fields (an older build simply did not write them) and
 * unforgiving about the two things that identify a save: `v === 1` and a hero object.
 */
export function sanitizeSave(value: unknown, maxHp = Infinity, notes: string[] = []): SaveData | null {
  if (!isObj(value)) return null;
  if (value.v !== 1) return null;
  if (!isObj(value.hero)) return null;

  const hero = value.hero;
  const hx = num(hero.x, NaN);
  const hy = num(hero.y, NaN);
  if (!Number.isFinite(hx) || !Number.isFinite(hy)) return null;

  const rawHp = num(hero.hp, Number.isFinite(maxHp) ? maxHp : 12);
  const hp = clamp(Math.round(rawHp), 1, maxHp);
  if (hp !== rawHp) notes.push(`hp ${rawHp} -> ${hp}`);

  const q = isObj(value.quest) ? (value.quest as Record<string, unknown>) : {};
  const stage = clamp(Math.round(num(q.stage, 0)), 0, MAX_STAGE);
  const kills = Math.max(0, Math.round(num(q.kills, 0)));
  if (stage !== num(q.stage, 0)) notes.push(`tahap quest ${String(q.stage)} -> ${stage}`);
  const quest: QuestState = { stage, kills };

  const rawDay = num(value.dayTime, 0.33);
  // only wrap when it is actually out of range: `((0.12 % 1) + 1) % 1` is 0.12000000000000001,
  // and a save that loads back a hair different from what it wrote is a bug waiting to confuse.
  const dayTime = rawDay >= 0 && rawDay < 1 ? rawDay : ((rawDay % 1) + 1) % 1;
  if (dayTime !== rawDay) notes.push(`jam ${rawDay} -> ${dayTime.toFixed(3)}`);

  const checkpoint = typeof value.checkpoint === 'string' && value.checkpoint ? value.checkpoint : 'cp_village';

  return {
    v: 1,
    hero: { x: hx, y: hy, hp },
    checkpoint,
    worldTime: Math.max(0, num(value.worldTime, 0)),
    dayTime,
    killed: numberMap(value.killed),
    quest,
    flags: boolMap(value.flags),
    puzzle: { solved: isObj(value.puzzle) ? boolOf(value.puzzle.solved) : false },
    bossDefeated: boolOf(value.bossDefeated),
  };
}

/** Nearest free tile to (tx, ty), searched in rings. Returns null if everything nearby is solid. */
function nearestFree(world: SaveWorld, tx: number, ty: number, maxRadius = 16): { tx: number; ty: number } | null {
  for (let r = 0; r <= maxRadius; r++) {
    let best: { tx: number; ty: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        // only the ring's edge, so closer tiles always win
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= world.widthTiles || ny >= world.heightTiles) continue;
        if (world.solidAt(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { tx: nx, ty: ny };
        }
      }
    if (best) return best;
  }
  return null;
}

const centreOf = (t: { tx: number; ty: number }): { x: number; y: number } => ({
  x: t.tx * TILE + TILE / 2,
  y: t.ty * TILE + TILE / 2,
});

/**
 * Put the hero somewhere they can actually stand.
 *
 * Order of preference: where the save says (if free) → the nearest free tile → the saved
 * checkpoint → the world's player start. The last one always works, because worldgen guarantees it.
 */
export function placeHero(save: SaveData, world: SaveWorld, notes: string[] = []): { x: number; y: number } {
  const inBounds = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < world.widthTiles && ty < world.heightTiles;

  const tx = Math.floor(save.hero.x / TILE);
  const ty = Math.floor(save.hero.y / TILE);
  if (inBounds(tx, ty) && !world.solidAt(tx, ty)) return { x: save.hero.x, y: save.hero.y };

  const clampedX = clamp(tx, 0, world.widthTiles - 1);
  const clampedY = clamp(ty, 0, world.heightTiles - 1);
  const free = nearestFree(world, clampedX, clampedY);
  if (free) {
    notes.push(`posisi (${tx}, ${ty}) tertutup -> petak bebas terdekat (${free.tx}, ${free.ty})`);
    return centreOf(free);
  }

  const cp = world.markers.checkpoints.find((c) => c.id === save.checkpoint);
  if (cp && !world.solidAt(Math.floor(cp.x / TILE), Math.floor(cp.y / TILE))) {
    notes.push(`posisi (${tx}, ${ty}) tidak bisa dipakai -> checkpoint ${save.checkpoint}`);
    return { x: cp.x, y: cp.y };
  }

  notes.push(`posisi (${tx}, ${ty}) tidak bisa dipakai -> titik awal`);
  return { x: world.markers.playerStart.x, y: world.markers.playerStart.y };
}

/**
 * The whole migration: sanitize, then make sure the hero and the checkpoint still exist in this
 * world. Returns null when the value is not a usable save.
 */
export function migrateSave(value: unknown, world: SaveWorld, maxHp = Infinity): MigratedSave | null {
  const notes: string[] = [];
  const save = sanitizeSave(value, maxHp, notes);
  if (!save) return null;

  if (!world.markers.checkpoints.some((c) => c.id === save.checkpoint)) {
    notes.push(`checkpoint "${save.checkpoint}" tidak ada lagi -> ${world.markers.checkpoints[0].id}`);
    save.checkpoint = world.markers.checkpoints[0].id;
  }

  const pos = placeHero(save, world, notes);
  save.hero.x = pos.x;
  save.hero.y = pos.y;
  return { save, notes };
}
