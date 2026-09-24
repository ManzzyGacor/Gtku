/**
 * Items, equipment slots and rarity (docs/OVERHAUL.md §4 "Equipment").
 *
 * Eight slots: Weapon, Helmet, Armor, Gloves, Boots, Accessory 1–2 and the **Lantern Core** — the
 * hero's own power source, which is the one that grants an element bonus and a passive rather than
 * plain numbers.
 *
 * **Rarity changes the numbers, not just the frame colour.** Every item definition carries its
 * modifiers at Common strength; the rarity multiplies them. So a Mythic version of a helmet is
 * genuinely 2.5× the helmet, and the player can read that off the tooltip instead of guessing.
 */
import type { ElementId } from '../combat/elements';
import type { Modifier } from '../stats/stats';

export type EquipSlot = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'accessory1' | 'accessory2' | 'lantern';

export interface SlotMeta {
  id: EquipSlot;
  label: string;
  /** Which item `kind` fits here. Both accessory slots take the same kind. */
  kind: ItemKind;
}

/** The order the character screen shows them in: weapon, then head to toe, then the core. */
export const EQUIP_SLOTS: SlotMeta[] = [
  { id: 'weapon', label: 'Senjata', kind: 'weapon' },
  { id: 'helmet', label: 'Kepala', kind: 'helmet' },
  { id: 'armor', label: 'Badan', kind: 'armor' },
  { id: 'gloves', label: 'Tangan', kind: 'gloves' },
  { id: 'boots', label: 'Kaki', kind: 'boots' },
  { id: 'accessory1', label: 'Aksesori 1', kind: 'accessory' },
  { id: 'accessory2', label: 'Aksesori 2', kind: 'accessory' },
  { id: 'lantern', label: 'Inti Lentera', kind: 'lantern' },
];

export type ItemKind = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'accessory' | 'lantern' | 'material' | 'consumable';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface RarityMeta {
  id: Rarity;
  label: string;
  /** Multiplies every modifier on the item. */
  scale: number;
  /** Frame/name colour, as a CSS hex. */
  color: string;
}

export const RARITIES: RarityMeta[] = [
  { id: 'common', label: 'Biasa', scale: 1, color: '#c3c8d4' },
  { id: 'uncommon', label: 'Tidak Biasa', scale: 1.2, color: '#79d67a' },
  { id: 'rare', label: 'Langka', scale: 1.45, color: '#5aa9ff' },
  { id: 'epic', label: 'Epik', scale: 1.75, color: '#c07cff' },
  { id: 'legendary', label: 'Legendaris', scale: 2.1, color: '#ffb02e' },
  { id: 'mythic', label: 'Mitos', scale: 2.5, color: '#ff5f7a' },
];

export const rarityMeta = (r: Rarity): RarityMeta => RARITIES.find((x) => x.id === r) ?? RARITIES[0];
export const rarityIndex = (r: Rarity): number => RARITIES.findIndex((x) => x.id === r);

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** The rarity this definition drops at by default. */
  rarity: Rarity;
  /** Modifiers **at Common strength**; `itemMods()` scales them by rarity. */
  mods: Modifier[];
  /** One line of flavour, shown under the name. */
  note: string;
  /** Lantern Cores: the element they empower. */
  element?: ElementId | undefined;
  /** Lantern Cores: a named passive, described in `note`. Behaviour lives in `passives.ts`. */
  passive?: PassiveId | undefined;
  /** Materials and consumables stack; equipment does not. */
  stack?: number | undefined;
  /** How much a single unit heals (consumables only). */
  heal?: number | undefined;
}

/** Lantern Core passives. Each one is read by the game at a specific moment; see `passives.ts`. */
export type PassiveId = 'emberGuard' | 'tideMend' | 'stormEdge' | 'frostWard';

export interface PassiveMeta {
  id: PassiveId;
  label: string
  note: string;
}

export const PASSIVES: PassiveMeta[] = [
  { id: 'emberGuard', label: 'Perisai Bara', note: 'Damage yang masuk berkurang 12% selagi HP di bawah setengah' },
  { id: 'tideMend', label: 'Pasang Pemulih', note: 'Setiap musuh yang tumbang memulihkan 1 HP' },
  { id: 'stormEdge', label: 'Mata Badai', note: 'Serangan berat menambah 20% peluang kritis' },
  { id: 'frostWard', label: 'Tameng Beku', note: 'Musuh yang memukulmu melambat sebentar' },
];

export const passiveMeta = (id: PassiveId): PassiveMeta | undefined => PASSIVES.find((p) => p.id === id);

/**
 * The item catalogue.
 *
 * Deliberately small and hand-written: eight slots' worth of gear the quest can actually hand out,
 * plus the four Lantern Cores matching the four implemented elements. Everything original — the
 * names come from `docs/STORY.md`'s village and cave, not from any other game.
 */
export const ITEMS: Record<string, ItemDef> = {
  // ── weapons (the two implemented ones, as findable items) ──
  sword_village: {
    id: 'sword_village',
    name: 'Pedang Penjaga Desa',
    kind: 'weapon',
    rarity: 'common',
    note: 'Baja tua yang dirawat baik. Berat di ujung, jadi tebasannya menghukum.',
    mods: [{ stat: 'atk', flat: 3, source: 'Pedang Penjaga Desa' }],
  },
  sword_dawn: {
    id: 'sword_dawn',
    name: 'Pedang Fajar',
    kind: 'weapon',
    rarity: 'rare',
    note: 'Bilahnya menyimpan cahaya pagi yang tidak pernah padam.',
    mods: [
      { stat: 'atk', flat: 6, source: 'Pedang Fajar' },
      { stat: 'crit', flat: 4, source: 'Pedang Fajar' },
    ],
  },
  bow_whisper: {
    id: 'bow_whisper',
    name: 'Busur Bisik',
    kind: 'weapon',
    rarity: 'uncommon',
    note: 'Kayu dari Hutan Bisik; talinya hampir tidak bersuara saat dilepas.',
    mods: [
      { stat: 'atk', flat: 4, source: 'Busur Bisik' },
      { stat: 'speed', pct: 4, source: 'Busur Bisik' },
    ],
  },

  // ── armour ──
  helm_lamplighter: {
    id: 'helm_lamplighter',
    name: 'Topi Penyala Lentera',
    kind: 'helmet',
    rarity: 'common',
    note: 'Kain tebal dengan pengait kecil untuk menggantung lentera.',
    mods: [
      { stat: 'def', flat: 2, source: 'Topi Penyala Lentera' },
      { stat: 'lanternRange', pct: 8, source: 'Topi Penyala Lentera' },
    ],
  },
  helm_stone: {
    id: 'helm_stone',
    name: 'Helm Batu Gua',
    kind: 'helmet',
    rarity: 'rare',
    note: 'Dipahat dari langit-langit Gua Kelam. Berat, tapi jujur.',
    mods: [
      { stat: 'def', flat: 5, source: 'Helm Batu Gua' },
      { stat: 'maxHp', flat: 3, source: 'Helm Batu Gua' },
    ],
  },
  armor_woven: {
    id: 'armor_woven',
    name: 'Rompi Tenun Wulan',
    kind: 'armor',
    rarity: 'common',
    note: 'Ditenun Tetua Wulan sendiri. Hangat, dan lebih kuat dari tampaknya.',
    mods: [
      { stat: 'def', flat: 3, source: 'Rompi Tenun Wulan' },
      { stat: 'maxHp', flat: 2, source: 'Rompi Tenun Wulan' },
    ],
  },
  armor_emberplate: {
    id: 'armor_emberplate',
    name: 'Zirah Bara',
    kind: 'armor',
    rarity: 'epic',
    note: 'Lempengnya masih terasa hangat, seperti baru keluar dari tempa.',
    mods: [
      { stat: 'def', flat: 7, source: 'Zirah Bara' },
      { stat: 'maxHp', flat: 5, source: 'Zirah Bara' },
      { stat: 'speed', pct: -3, source: 'Zirah Bara' },
    ],
  },
  gloves_grip: {
    id: 'gloves_grip',
    name: 'Sarung Tangan Pemburu',
    kind: 'gloves',
    rarity: 'uncommon',
    note: 'Jahitan di telapaknya membuat pegangan tidak licin walau berkeringat.',
    mods: [
      { stat: 'crit', flat: 3, source: 'Sarung Tangan Pemburu' },
      { stat: 'atk', flat: 1, source: 'Sarung Tangan Pemburu' },
    ],
  },
  boots_soft: {
    id: 'boots_soft',
    name: 'Sepatu Lunak Hutan',
    kind: 'boots',
    rarity: 'common',
    note: 'Solnya dari kulit lembut — langkahmu hampir tidak terdengar.',
    mods: [{ stat: 'speed', pct: 6, source: 'Sepatu Lunak Hutan' }],
  },
  boots_striding: {
    id: 'boots_striding',
    name: 'Sepatu Langkah Panjang',
    kind: 'boots',
    rarity: 'rare',
    note: 'Entah bagaimana, jarak selalu terasa lebih pendek dengan ini.',
    mods: [
      { stat: 'speed', pct: 10, source: 'Sepatu Langkah Panjang' },
      { stat: 'def', flat: 1, source: 'Sepatu Langkah Panjang' },
    ],
  },
  amulet_firefly: {
    id: 'amulet_firefly',
    name: 'Kalung Kunang-kunang',
    kind: 'accessory',
    rarity: 'uncommon',
    note: 'Berkedip pelan, mengikuti napasmu.',
    mods: [
      { stat: 'mastery', flat: 18, source: 'Kalung Kunang-kunang' },
      { stat: 'lanternRange', pct: 6, source: 'Kalung Kunang-kunang' },
    ],
  },
  ring_thorn: {
    id: 'ring_thorn',
    name: 'Cincin Duri',
    kind: 'accessory',
    rarity: 'rare',
    note: 'Menusuk sedikit setiap kali kamu menggenggam senjata. Kamu jadi lebih fokus.',
    mods: [
      { stat: 'critDmg', flat: 20, source: 'Cincin Duri' },
      { stat: 'lifesteal', flat: 2, source: 'Cincin Duri' },
    ],
  },
  charm_still: {
    id: 'charm_still',
    name: 'Jimat Hening',
    kind: 'accessory',
    rarity: 'epic',
    note: 'Batu sungai yang dipoles arus selama bertahun-tahun.',
    mods: [
      { stat: 'maxHp', flat: 6, source: 'Jimat Hening' },
      { stat: 'def', flat: 2, source: 'Jimat Hening' },
    ],
  },

  // ── Lantern Cores: element + passive, one per implemented element ──
  core_ember: {
    id: 'core_ember',
    name: 'Inti Bara',
    kind: 'lantern',
    rarity: 'rare',
    element: 'api',
    passive: 'emberGuard',
    note: 'Bara kecil yang tidak pernah dingin. Perisai Bara: damage masuk −12% di bawah setengah HP.',
    mods: [
      { stat: 'atk', pct: 15, element: 'api', source: 'Inti Bara' },
      { stat: 'mastery', flat: 24, source: 'Inti Bara' },
    ],
  },
  core_tide: {
    id: 'core_tide',
    name: 'Inti Pasang',
    kind: 'lantern',
    rarity: 'rare',
    element: 'air',
    passive: 'tideMend',
    note: 'Berisik pelan seperti air di kejauhan. Pasang Pemulih: tiap musuh tumbang memberi 1 HP.',
    mods: [
      { stat: 'atk', pct: 15, element: 'air', source: 'Inti Pasang' },
      { stat: 'maxHp', flat: 4, source: 'Inti Pasang' },
    ],
  },
  core_storm: {
    id: 'core_storm',
    name: 'Inti Badai',
    kind: 'lantern',
    rarity: 'epic',
    element: 'petir',
    passive: 'stormEdge',
    note: 'Rambutmu berdiri kalau dipegang terlalu lama. Mata Badai: serangan berat +20% kritis.',
    mods: [
      { stat: 'atk', pct: 18, element: 'petir', source: 'Inti Badai' },
      { stat: 'crit', flat: 5, source: 'Inti Badai' },
    ],
  },
  core_frost: {
    id: 'core_frost',
    name: 'Inti Beku',
    kind: 'lantern',
    rarity: 'epic',
    element: 'es',
    passive: 'frostWard',
    note: 'Menggigit telapak tangan. Tameng Beku: musuh yang memukulmu melambat sebentar.',
    mods: [
      { stat: 'atk', pct: 18, element: 'es', source: 'Inti Beku' },
      { stat: 'def', flat: 3, source: 'Inti Beku' },
    ],
  },

  // ── consumables & materials ──
  potion_small: {
    id: 'potion_small',
    name: 'Rebusan Daun Terang',
    kind: 'consumable',
    rarity: 'common',
    note: 'Pahit. Memulihkan 6 HP.',
    mods: [],
    stack: 9,
    heal: 6,
  },
  shard_dawn: {
    id: 'shard_dawn',
    name: 'Serpih Fajar',
    kind: 'material',
    rarity: 'uncommon',
    note: 'Pecahan cahaya yang mengeras. Terasa hangat di kantong.',
    mods: [],
    stack: 99,
  },
  monster_hide: {
    id: 'monster_hide',
    name: 'Kulit Lendir Kering',
    kind: 'material',
    rarity: 'common',
    note: 'Anehnya berguna untuk menambal apa pun.',
    mods: [],
    stack: 99,
  },
};

export const itemDef = (id: string): ItemDef | undefined => ITEMS[id];

/** Is this item something that goes in a slot (as opposed to a material or a potion)? */
export function isEquipment(def: ItemDef): boolean {
  return EQUIP_SLOTS.some((s) => s.kind === def.kind);
}

/** Which slots this item can go into (accessories fit two). */
export function slotsFor(def: ItemDef): EquipSlot[] {
  return EQUIP_SLOTS.filter((s) => s.kind === def.kind).map((s) => s.id);
}

/**
 * The item's modifiers **at a given rarity** — this is where rarity stops being cosmetic.
 *
 * Flat values are scaled and rounded (a +3 DEF helmet is +8 at Mythic, not +7.5, because a stat
 * sheet full of halves reads as noise); percentages keep one decimal.
 */
export function itemMods(def: ItemDef, rarity: Rarity = def.rarity): Modifier[] {
  const { scale } = rarityMeta(rarity);
  return def.mods.map((m) => ({
    ...m,
    flat: m.flat === undefined ? undefined : Math.round(m.flat * scale),
    pct: m.pct === undefined ? undefined : Math.round(m.pct * scale * 10) / 10,
  }));
}

/** A one-line power score, so the inventory can show "is this better?" without a spreadsheet. */
export function itemScore(def: ItemDef, rarity: Rarity = def.rarity): number {
  let score = 0;
  for (const m of itemMods(def, rarity)) {
    const weight = m.stat === 'maxHp' ? 1 : m.stat === 'mastery' ? 0.25 : m.stat === 'atk' ? 2 : 1.5;
    score += Math.abs(m.flat ?? 0) * weight * Math.sign(m.flat ?? 1) + (m.pct ?? 0) * 0.4;
  }
  return Math.round(score * 10) / 10;
}
