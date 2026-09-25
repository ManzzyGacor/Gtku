import type { AreaId } from './areas';
import type { PropPlacement } from './props';

export type SpawnKind = 'slime' | 'archer' | 'bats' | 'boss';

export interface SpawnDef {
  /** Stable id (used to remember kills in the save file). */
  id: string;
  kind: SpawnKind;
  x: number;
  y: number;
  /** Pack size for `bats`. */
  count?: number | undefined;
}

export type NpcLook = 'elder' | 'smith' | 'kid' | 'guard' | 'merchant';

export interface NpcDef {
  id: string;
  name: string;
  look: NpcLook;
  x: number;
  y: number;
}

export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WorldMarkers {
  playerStart: { x: number; y: number };
  lantern: { x: number; y: number };
  checkpoints: { id: string; name: string; x: number; y: number }[];
  puzzle: {
    rock: { tx: number; ty: number };
    plate: { tx: number; ty: number };
    gate: { tx: number; ty: number; w: number; h: number };
    room: TileRect;
  };
  boss: {
    spawn: { x: number; y: number };
    arena: TileRect;
    door: { tx: number; ty: number; w: number; h: number };
  };
}

export interface ChunkData {
  cx: number;
  cy: number;
  props: PropPlacement[];
  spawns: SpawnDef[];
  npcs: NpcDef[];
}

/**
 * Anything that can supply world data. Phase 1 uses `GeneratedWorld`; later phases can add hand-authored chunk files
 * or streamed chunks without touching the renderer.
 */
export interface WorldSource {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly markers: WorldMarkers;
  /** Ground tile id. Out-of-range reads return a solid wall. */
  tileAt(tx: number, ty: number): number;
  /** Static collision (ground + props). Dynamic blockers are tracked separately by `Collision`. */
  solidAt(tx: number, ty: number): boolean;
  areaAt(tx: number, ty: number): AreaId;
  chunk(cx: number, cy: number): ChunkData;
}
