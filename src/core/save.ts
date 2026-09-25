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
/**
 * Whose save this is. Every account has its own (`lentera-malam/save/v1@<akun>`), so two people on
 * one phone never overwrite each other. Empty = the unscoped key, which is what the developer
 * skip-login path and the tests use, and what every save written before accounts existed is under.
 */
let scope = '';

const keyOf = (): string => (scope ? `${SAVE_KEY}@${scope}` : SAVE_KEY);

/**
 * File saves under an account from now on.
 *
 * The first account to log in on a phone that already has progress **adopts** it: the unscoped
 * save moves under that account instead of the player starting over because accounts arrived.
 * Only when that account has no save of its own — nothing is ever overwritten.
 */
export function setSaveScope(account: string | null): void {
  scope = account ?? '';
  if (!scope || readRaw(keyOf()) !== null) return;
  const legacy = readRaw(SAVE_KEY, LEGACY_SAVE_KEY);
  if (legacy === null) return;
  if (writeRaw(keyOf(), legacy)) removeRaw(SAVE_KEY);
}

export function saveScope(): string {
  return scope;
}

export function saveGame(data: SaveData): boolean {
  if (wiped) return false;
  return writeRaw(keyOf(), JSON.stringify(data));
}

/** Set by `wipeSave`: nothing may write a save again until the page reloads. */
let wiped = false;

export function loadGame(): SaveData | null {
  try {
    const raw = scope ? readRaw(keyOf()) : readRaw(SAVE_KEY, LEGACY_SAVE_KEY);
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
  if (scope) removeRaw(keyOf());
  else removeRaw(SAVE_KEY, LEGACY_SAVE_KEY);
}

/**
 * "Reset save" — delete it **and keep it deleted**.
 *
 * `clearSave` alone is not enough while a world is running: the reload that follows a reset fires
 * `pagehide`, the lifecycle dutifully saves on `pagehide`, and the save the player just deleted is
 * written straight back. So after a wipe every later `saveGame` in this page is refused; the reload
 * starts a fresh page where saving works again.
 */
export function wipeSave(): void {
  wiped = true;
  clearSave();
}
