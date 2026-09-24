/**
 * Weapons as data (docs/OVERHAUL.md §4 "Senjata").
 *
 * Two slots the player swaps between instantly. **Pedang** and **Busur** are implemented in full;
 * the other categories are declared so quests and drops can already name them, and are marked
 * `implemented: false` rather than half-built.
 *
 * Pure: the hero reads these definitions, nothing here touches a renderer.
 */
import type { ElementId } from './elements';

export type WeaponId = 'pedang' | 'busur' | 'tombak' | 'kapak' | 'tongkat' | 'cakram';
export type WeaponKind = 'melee' | 'ranged';

export interface ShotDef {
  id: string;
  name: string;
  /** Seconds to draw before the arrow leaves the bow. */
  draw: number;
  recover: number;
  dmg: number;
  /** World px per second. */
  speed: number;
  /** How many enemies one arrow may pass through. 1 = stops at the first. */
  pierce: number;
  /** Charge level (0..1) this shot needs. */
  needsCharge: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: WeaponKind;
  implemented: boolean;
  /** Element the weapon itself carries, if any. */
  element?: ElementId;
  /** Ranged weapons only. */
  shots?: ShotDef[];
  /** Seconds the swap animation locks input. Short on purpose: swapping is part of a combo. */
  swapTime: number;
}

/** Fully charged shots pierce; a tap does not. */
export const BOW_SHOTS: ShotDef[] = [
  { id: 'cepat', name: 'Tembakan Cepat', draw: 0.12, recover: 0.16, dmg: 2, speed: 300, pierce: 1, needsCharge: 0 },
  { id: 'terisi', name: 'Tembakan Terisi', draw: 0.1, recover: 0.24, dmg: 5, speed: 420, pierce: 2, needsCharge: 0.55 },
  { id: 'tembus', name: 'Tembakan Tembus', draw: 0.1, recover: 0.3, dmg: 7, speed: 520, pierce: 4, needsCharge: 1 },
];

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pedang: { id: 'pedang', name: 'Pedang', kind: 'melee', implemented: true, swapTime: 0.16 },
  busur: { id: 'busur', name: 'Busur', kind: 'ranged', implemented: true, shots: BOW_SHOTS, swapTime: 0.16 },
  tombak: { id: 'tombak', name: 'Tombak', kind: 'melee', implemented: false, swapTime: 0.2 },
  kapak: { id: 'kapak', name: 'Kapak', kind: 'melee', implemented: false, swapTime: 0.24 },
  tongkat: { id: 'tongkat', name: 'Tongkat', kind: 'ranged', implemented: false, swapTime: 0.2 },
  cakram: { id: 'cakram', name: 'Cakram', kind: 'ranged', implemented: false, swapTime: 0.18 },
};

/** The two slots the player carries. Only implemented weapons may be equipped. */
export const DEFAULT_LOADOUT: [WeaponId, WeaponId] = ['pedang', 'busur'];

export const IMPLEMENTED_WEAPONS: WeaponId[] = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].implemented);

/** Pick the strongest shot the current charge has paid for. */
export function shotForCharge(charge: number): ShotDef {
  let best = BOW_SHOTS[0];
  for (const s of BOW_SHOTS) if (charge + 1e-6 >= s.needsCharge && s.needsCharge >= best.needsCharge) best = s;
  return best;
}

/** Seconds of holding needed to reach full charge. */
export const FULL_CHARGE_TIME = 0.75;
