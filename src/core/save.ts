import { LEGACY_SAVE_KEY, SAVE_KEY } from '../config';
import type { SaveData } from './state/GameState';
import { sanitizeSave } from './saveMigrate';
import { readRaw, removeRaw, writeRaw } from './storage';

/**
 * localStorage persistence. Every access is guarded: private windows / blocked storage must never
 * crash the game, and a corrupt or truncated payload is repaired by `sanitizeSave` (or refused) so
 * that a bad save can never crash the boot. Saves written by the 2D build live under
 * `LEGACY_SAVE_KEY` and are adopted by `readRaw`; `migrateSave` (which needs the world) then makes
 * sure the position they hold still exists — see `saveMigrate.ts`.
 */
export function saveGame(data: SaveData): boolean {
  return writeRaw(SAVE_KEY, JSON.stringify(data));
}

export function loadGame(): SaveData | null {
  try {
    const raw = readRaw(SAVE_KEY, LEGACY_SAVE_KEY);
    if (!raw) return null;
    return sanitizeSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return loadGame() !== null;
}

export function clearSave(): void {
  removeRaw(SAVE_KEY, LEGACY_SAVE_KEY);
}
