/**
 * localStorage access that never throws (private windows / blocked storage must not crash the game),
 * plus a one-time read-through migration from the keys used before the game was renamed
 * "Lentera Kelam" → "Lentera Malam", so nobody loses their progress or settings.
 */

export function readRaw(key: string, legacyKey?: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const own = localStorage.getItem(key);
    if (own !== null) return own;
    if (!legacyKey) return null;
    const old = localStorage.getItem(legacyKey);
    if (old === null) return null;
    // adopt it under the new name and forget the old one
    localStorage.setItem(key, old);
    localStorage.removeItem(legacyKey);
    return old;
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeRaw(key: string, legacyKey?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
    if (legacyKey) localStorage.removeItem(legacyKey);
  } catch {
    /* ignore */
  }
}
