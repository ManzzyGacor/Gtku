import { LEGACY_SAVE_KEY, SAVE_KEY } from '../config';
import type { SaveData } from './state/GameState';
import { readRaw, removeRaw, writeRaw } from './storage';

/** localStorage persistence. Every access is guarded: private windows / blocked storage must never crash the game. */
export function saveGame(data: SaveData): boolean {
  return writeRaw(SAVE_KEY, JSON.stringify(data));
}

export function loadGame(): SaveData | null {
  try {
    const raw = readRaw(SAVE_KEY, LEGACY_SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d && d.v === 1 && d.hero ? d : null;
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
