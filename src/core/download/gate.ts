/**
 * Which areas the hero may walk into, given what data is on the phone.
 *
 * Pure, so the rule is testable on its own:
 *
 *  • the **core** area (Ravenhollow, where every game starts) is never gated — it downloads in the
 *    background, and until it arrives the phone simply generates the ground itself;
 *  • any other area needs its pack installed before the hero can cross into it;
 *  • if the data system is **unavailable** (no Cache Storage: a very old browser, a private window
 *    that refuses it), nothing is gated at all — the world can always be generated locally, and
 *    locking a player out of two thirds of the game because their browser cannot cache a file
 *    would be the wrong trade.
 */
import type { AreaStatus } from './manifest';

export type DataStatus = AreaStatus | 'mengunduh' | 'gagal';

export interface GateInput {
  /** False when the browser cannot store downloaded data at all. */
  available: boolean;
  core: string;
  status: (area: string) => DataStatus;
}

/** True when the hero must not enter `area` yet. */
export function areaBlocked(area: string, g: GateInput): boolean {
  if (!g.available) return false;
  if (area === g.core) return false;
  // an older version still works: the update is offered, not forced mid-walk
  const s = g.status(area);
  return s !== 'terpasang' && s !== 'versi-baru';
}
