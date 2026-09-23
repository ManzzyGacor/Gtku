/** Global game constants. Keep magic numbers here. */

export const TILE = 16;
export const CHUNK_TILES = 16;
export const CHUNK_PX = TILE * CHUNK_TILES;

/** World size in chunks (Phase 1: 8 x 5 chunks = 128 x 80 tiles). */
export const WORLD_CHUNKS_W = 8;
export const WORLD_CHUNKS_H = 5;
export const WORLD_TILES_W = WORLD_CHUNKS_W * CHUNK_TILES;
export const WORLD_TILES_H = WORLD_CHUNKS_H * CHUNK_TILES;
export const WORLD_PX_W = WORLD_TILES_W * TILE;
export const WORLD_PX_H = WORLD_TILES_H * TILE;

/** Internal render height target (logical px). Width follows the screen aspect ratio. */
export const TARGET_LOGICAL_H = 270;
export const MIN_LOGICAL_W = 360;
export const MAX_LOGICAL_W = 720;

export const SAVE_KEY = 'lentera-malam/save/v1';
export const SETTINGS_KEY = 'lentera-malam/settings/v1';

/** Keys from before the game was renamed. Read once, then migrated (see core/storage.ts). */
export const LEGACY_SAVE_KEY = 'lentera-kelam/save/v1';
export const LEGACY_SETTINGS_KEY = 'lentera-kelam/settings/v1';
