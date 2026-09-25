/**
 * What the hero's equipment looks like, as plain colours.
 *
 * Until the character panel got an avatar, gear changed numbers and nothing else: the hero model
 * was the same whatever he wore. This turns the equipped slots into the handful of colours the 3D
 * model paints — a cap for a helmet, pauldrons for armour, tinted gloves and boots, a sword guard in
 * the weapon's rarity colour, the lantern glowing in its core's element — so a change of gear shows
 * on the hero in the world and in the portrait alike.
 *
 * Pure: `HeroMesh3D.setGear` does the painting.
 */
import { ELEMENTS } from '../combat/elements';
import type { Equipped } from './inventory';
import { itemDef, rarityMeta } from './items';

export interface GearLook {
  /** Rarity colour of each worn piece, or null when the slot is empty. */
  helmet: number | null;
  armor: number | null;
  gloves: number | null;
  boots: number | null;
  weapon: number | null;
  /** The lantern core's element colour, or null without a core. */
  core: number | null;
  /** Changes whenever anything above does: the portrait redraws on a new key only. */
  key: string;
}

const hex = (css: string): number => Number.parseInt(css.replace('#', ''), 16);

export function gearLook(equipped: Equipped): GearLook {
  const tint = (slot: keyof Equipped): number | null => {
    const held = equipped[slot];
    return held && itemDef(held.id) ? hex(rarityMeta(held.rarity).color) : null;
  };
  const coreHeld = equipped.lantern;
  const coreDef = coreHeld ? itemDef(coreHeld.id) : undefined;
  const look = {
    helmet: tint('helmet'),
    armor: tint('armor'),
    gloves: tint('gloves'),
    boots: tint('boots'),
    weapon: tint('weapon'),
    core: coreDef?.element ? ELEMENTS[coreDef.element].color : null,
  };
  return { ...look, key: [look.helmet, look.armor, look.gloves, look.boots, look.weapon, look.core].join('|') };
}
