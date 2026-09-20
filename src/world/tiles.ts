/** Ground tile ids. The ground layer is what the chunk baker draws; solidity also lives here. */
export const T = {
  GRASS: 0,
  FLOWERS: 1,
  FOREST: 2,
  DIRT: 3,
  COBBLE: 4,
  SAND: 5,
  WATER: 6,
  SHALLOW: 7,
  CAVE: 8,
  WALL: 9,
  BRIDGE_H: 10,
  BRIDGE_V: 11,
  ARENA: 12,
} as const;

export type TileId = (typeof T)[keyof typeof T];

export interface TileInfo {
  solid: boolean;
  /** Ground bakes multiple frames (water shimmer). */
  animated: boolean;
  /** Movement speed multiplier while standing on it. */
  speed: number;
  /** Footstep flavour → particles/sfx. */
  surface: 'grass' | 'dirt' | 'stone' | 'sand' | 'water' | 'wood';
}

const info = (surface: TileInfo['surface'], o: Partial<TileInfo> = {}): TileInfo => ({
  solid: false,
  animated: false,
  speed: 1,
  surface,
  ...o,
});

export const TILE_INFO: Record<number, TileInfo> = {
  [T.GRASS]: info('grass'),
  [T.FLOWERS]: info('grass'),
  [T.FOREST]: info('grass'),
  [T.DIRT]: info('dirt'),
  [T.COBBLE]: info('stone'),
  [T.SAND]: info('sand', { speed: 0.92 }),
  [T.WATER]: info('water', { solid: true, animated: true }),
  [T.SHALLOW]: info('water', { animated: true, speed: 0.7 }),
  [T.CAVE]: info('stone'),
  [T.WALL]: info('stone', { solid: true }),
  [T.BRIDGE_H]: info('wood'),
  [T.BRIDGE_V]: info('wood'),
  [T.ARENA]: info('stone'),
};

/** Tiles that count as "grass family" for fringe overlays. */
export const isGrassy = (t: number): boolean => t === T.GRASS || t === T.FLOWERS || t === T.FOREST;
export const isWater = (t: number): boolean => t === T.WATER || t === T.SHALLOW;
export const isBridge = (t: number): boolean => t === T.BRIDGE_H || t === T.BRIDGE_V;
