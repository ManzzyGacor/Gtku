import { CHUNK_TILES } from '../../config';

export type AreaId = 'village' | 'forest' | 'cave';

export interface AreaDef {
  id: AreaId;
  name: string;
  /** Darkest the ambient light may get from the day cycle (1 = always bright). Caves ignore the sun entirely. */
  indoor: boolean;
  /** Ambient RGB (0..1 multiplier) used when `indoor`. */
  ambient: [number, number, number];
}

/*
 * Display names come from docs/STORY.md (Chapter 1). The **ids** deliberately do not: `village`,
 * `forest` and `cave` are in save files, checkpoint ids and tests, so renaming them would break
 * saved games for a caption. Only what the player reads changed.
 */
export const AREAS: Record<AreaId, AreaDef> = {
  village: { id: 'village', name: 'Ravenhollow', indoor: false, ambient: [1, 1, 1] },
  forest: { id: 'forest', name: 'Hutan Noctis', indoor: false, ambient: [1, 1, 1] },
  // Raised after the phone test ("gelap sekali sampai sulit dilihat"): the cave is still the darkest
  // place, but the floor and walls read without a torch in view.
  cave: { id: 'cave', name: 'Gua Lumen', indoor: true, ambient: [0.46, 0.43, 0.66] },
};

/** Area boundaries in tiles (x only; the journey runs west→east). Areas blend seamlessly, no loading. */
export const FOREST_X0 = 6 * CHUNK_TILES; // 96
export const CAVE_X0 = 12 * CHUNK_TILES; // 192

export function areaAtTile(tx: number): AreaId {
  if (tx >= CAVE_X0) return 'cave';
  if (tx >= FOREST_X0) return 'forest';
  return 'village';
}
