/** Static prop metadata. Art frames live in src/art/props.ts under the same names. */

export type PropType =
  | 'tree_a' | 'tree_b' | 'tree_c' | 'tree_dead'
  | 'bush_a' | 'bush_b' | 'rock_a' | 'rock_b' | 'stump' | 'log'
  | 'tallgrass' | 'mushroom' | 'reeds' | 'lily' | 'flowerbed' | 'haystack'
  | 'house_a' | 'house_b' | 'house_c' | 'hall'
  | 'well' | 'lamp' | 'fence_h' | 'fence_v' | 'sign' | 'barrel' | 'crate' | 'stall'
  | 'great_lantern' | 'shrine'
  | 'torch' | 'crystal_a' | 'crystal_b' | 'stalagmite' | 'pillar' | 'gate' | 'plate' | 'boss_door';

export interface LightDef {
  radius: number;
  color: number;
  /** 0..1 strength of the light in the lightmap. */
  strength: number;
  flicker?: number;
  /** Only lit at night (street lamps) vs always (torches, crystals). */
  nightOnly?: boolean;
  /** Offset above the foot (px) where the glow is centred. */
  lift?: number;
}

export interface PropDef {
  /** Footprint in px relative to the foot point (x centred, y = bottom edge): [x, y, w, h]. null = walk-through. */
  fp: [number, number, number, number] | null;
  light?: LightDef;
  /** Animated frame count (`<type>_0..n-1`) and fps; 1 = static (`<type>`). */
  frames?: number;
  fps?: number;
  /** Drawn just above the ground, below every y-sorted object (lily pads, flower beds). */
  flat?: boolean;
  /** Created by a dedicated system instead of the chunk streamer. */
  special?: boolean;
}

const TRUNK: [number, number, number, number] = [-8, -16, 16, 16];
const TILE1: [number, number, number, number] = [-8, -16, 16, 16];

export const PROPS: Record<PropType, PropDef> = {
  tree_a: { fp: TRUNK },
  tree_b: { fp: TRUNK },
  tree_c: { fp: TRUNK },
  tree_dead: { fp: TRUNK },
  bush_a: { fp: null },
  bush_b: { fp: TILE1 },
  rock_a: { fp: TILE1 },
  rock_b: { fp: TILE1 },
  stump: { fp: TILE1 },
  log: { fp: [-16, -16, 32, 16] },
  tallgrass: { fp: null, frames: 3, fps: 3 },
  mushroom: { fp: null, light: { radius: 34, color: 0x5cf0d0, strength: 0.55, nightOnly: true, lift: 4 } },
  reeds: { fp: null, frames: 3, fps: 2.5 },
  lily: { fp: null, frames: 2, fps: 1.2, flat: true },
  flowerbed: { fp: null, flat: true },
  haystack: { fp: [-16, -14, 32, 14] },
  house_a: { fp: [-30, -30, 60, 30] },
  house_b: { fp: [-30, -30, 60, 30] },
  house_c: { fp: [-22, -28, 44, 28] },
  hall: { fp: [-38, -32, 76, 32] },
  well: { fp: [-14, -14, 28, 14] },
  lamp: { fp: [-4, -8, 8, 8], light: { radius: 78, color: 0xffc46a, strength: 0.95, nightOnly: true, lift: 30, flicker: 0.05 } },
  fence_h: { fp: [-8, -8, 16, 8] },
  fence_v: { fp: [-8, -16, 16, 16] },
  sign: { fp: [-6, -6, 12, 6] },
  barrel: { fp: TILE1 },
  crate: { fp: TILE1 },
  stall: { fp: [-24, -18, 48, 18] },
  great_lantern: { fp: [-14, -20, 28, 20], frames: 3, fps: 6 },
  shrine: { fp: [-8, -10, 16, 10], frames: 3, fps: 7, light: { radius: 84, color: 0xffb04a, strength: 0.95, flicker: 0.1, lift: 14 } },
  torch: { fp: null, frames: 3, fps: 8, light: { radius: 92, color: 0xff9b3a, strength: 1, flicker: 0.14, lift: 12 } },
  crystal_a: { fp: TILE1, light: { radius: 64, color: 0x69e6f2, strength: 0.75, flicker: 0.06, lift: 10 } },
  crystal_b: { fp: TILE1, light: { radius: 74, color: 0x9d86ff, strength: 0.8, flicker: 0.06, lift: 12 } },
  stalagmite: { fp: TILE1 },
  pillar: { fp: [-8, -14, 16, 14] },
  gate: { fp: null, special: true },
  plate: { fp: null, special: true },
  boss_door: { fp: null, special: true },
};

export interface PropPlacement {
  type: PropType;
  /** Foot position in world px (bottom-centre of the sprite). */
  x: number;
  y: number;
  /** Optional variant/flip flag. */
  flip?: boolean;
  /** Sign text (Indonesian) shown when interacting. */
  text?: string;
}
