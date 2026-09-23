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

export const AREAS: Record<AreaId, AreaDef> = {
  village: { id: 'village', name: 'Desa Lentera', indoor: false, ambient: [1, 1, 1] },
  forest: { id: 'forest', name: 'Hutan Bisik', indoor: false, ambient: [1, 1, 1] },
  cave: { id: 'cave', name: 'Gua Kelam', indoor: true, ambient: [0.22, 0.2, 0.38] },
};

/** Area boundaries in tiles (x only; the journey runs west→east). Areas blend seamlessly, no loading. */
export const FOREST_X0 = 6 * CHUNK_TILES; // 96
export const CAVE_X0 = 12 * CHUNK_TILES; // 192

export function areaAtTile(tx: number): AreaId {
  if (tx >= CAVE_X0) return 'cave';
  if (tx >= FOREST_X0) return 'forest';
  return 'village';
}
