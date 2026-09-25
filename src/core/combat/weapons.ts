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

/**
 * The three shots, by how long the string was drawn. Fully charged shots pierce; a tap does not.
 *
 * Speeds are in world px per second, and were **lowered** from 300/420/520 after the first phone
 * test ("busur terasa kurang bagus"): at 520 px/s an arrow crosses the whole visible screen in
 * about half a second and moves 17 px per frame at 30 fps, so the player never actually saw it fly.
 * Around 230-340 px/s it reads as a projectile and is still much faster than anything that dodges.
 */
export const BOW_SHOTS: ShotDef[] = [
  { id: 'cepat', name: 'Tembakan Cepat', draw: 0.1, recover: 0.16, dmg: 2, speed: 230, pierce: 1, needsCharge: 0 },
  { id: 'terisi', name: 'Tembakan Terisi', draw: 0.08, recover: 0.22, dmg: 5, speed: 285, pierce: 2, needsCharge: 0.55 },
  { id: 'tembus', name: 'Tembakan Tembus', draw: 0.08, recover: 0.28, dmg: 7, speed: 340, pierce: 4, needsCharge: 1 },
];

/**
 * Everything else about how the bow *feels*, as data. Every field is on the "Setelan Combat" panel
 * (`combatTuning.ts`), because — like the sword — the only way to judge these is on the phone.
 */
export const BOW = {
  /** Seconds of holding to reach full charge. */
  fullCharge: 0.75,
  /** Fraction of walking speed kept while the string is drawn: slow enough to feel the weight. */
  drawMove: 0.45,
  /** Auto-aim for the bow: longer and narrower than the sword's, since arrows travel. */
  aimRange: 170,
  aimCone: 22,
  /** Length of the aim line on the ground at full charge, px. */
  aimLine: 96,
  /** Seconds an arrow flies before it drops. */
  arrowLife: 0.95,
  /** Seconds an arrow stays stuck in a wall or an enemy after it lands. */
  stickTime: 1.1,
  /** Camera shake on release, px (scaled by charge). */
  releaseShake: 2.2,
  /** Hit-stop on a fully charged release, ms: the "thwack" of a heavy bow. */
  fullReleaseFreeze: 45,
  /** Phone vibration on release, ms (0 = off). Full charge doubles it. */
  vibrate: 14,
  /** Fraction of the sword's hit-stop an arrow hit gets. */
  hitStop: 0.5,
};

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

/**
 * Seconds of holding needed to reach full charge. A function now, not a constant: the value lives
 * in `BOW.fullCharge` so it can be tuned at runtime.
 */
export const fullChargeTime = (): number => Math.max(0.05, BOW.fullCharge);

export type MeleeStyle = 'sword' | 'dagger' | 'hammer' | 'spear';

/**
 * How each kind of melee weapon fights, as multipliers on the sword combo (`ATTACKS` in
 * HeroCore). The equipped weapon item decides the style (`ItemDef.style`); its look, its swing
 * trail and its hit feel follow (render3d: HeroMesh3D, Game3D).
 */
export interface StyleDef {
  /** Windup, active and recovery times. Below 1 = faster. */
  time: number;
  dmg: number;
  range: number;
  arc: number;
  knock: number;
  lunge: number;
  /** Camera shake and hit-stop on a hit. */
  impact: number;
}

export const MELEE_STYLES: Record<MeleeStyle, StyleDef> = {
  sword: { time: 1, dmg: 1, range: 1, arc: 1, knock: 1, lunge: 1, impact: 1 },
  // quick and thin: more hits, each lighter, a little shorter
  dagger: { time: 0.68, dmg: 0.7, range: 0.82, arc: 0.75, knock: 0.55, lunge: 1.25, impact: 0.6 },
  // slow and heavy: the ground shakes
  hammer: { time: 1.45, dmg: 1.7, range: 1.05, arc: 1.2, knock: 1.7, lunge: 0.55, impact: 2 },
  // one straight line, far
  spear: { time: 1.1, dmg: 1.1, range: 1.5, arc: 0.4, knock: 1.1, lunge: 1.35, impact: 1.1 },
};
