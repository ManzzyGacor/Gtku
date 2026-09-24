/**
 * Elements, status effects and the reaction table (docs/OVERHAUL.md §4 "Elemen").
 *
 * All fifteen elements exist as **data** so quests, weapons and drops can already refer to them;
 * only four are `implemented` for now — Api, Air, Es, Petir — and the reaction table only pairs
 * those. Anything not implemented is marked, never faked.
 *
 * Pure logic: no renderer, no timers of its own. `StatusBag` is ticked by whoever owns the entity.
 */

export type ElementId =
  | 'fajar'
  | 'api'
  | 'air'
  | 'angin'
  | 'tanah'
  | 'petir'
  | 'es'
  | 'bayangan'
  | 'cahaya'
  | 'astral'
  | 'kabut'
  | 'kristal'
  | 'alam'
  | 'roh'
  | 'void';

export interface ElementDef {
  id: ElementId;
  name: string;
  /** Tint used for effects, damage numbers and UI. */
  color: number;
  /** False = declared for later batches; nothing in the game applies it yet. */
  implemented: boolean;
}

export const ELEMENTS: Record<ElementId, ElementDef> = {
  fajar: { id: 'fajar', name: 'Fajar', color: 0xffd98a, implemented: false },
  api: { id: 'api', name: 'Api', color: 0xff7a2e, implemented: true },
  air: { id: 'air', name: 'Air', color: 0x3f9fcf, implemented: true },
  angin: { id: 'angin', name: 'Angin', color: 0xb4dd6b, implemented: false },
  tanah: { id: 'tanah', name: 'Tanah', color: 0xa16e3f, implemented: false },
  petir: { id: 'petir', name: 'Petir', color: 0xffe066, implemented: true },
  es: { id: 'es', name: 'Es', color: 0x8befeb, implemented: true },
  bayangan: { id: 'bayangan', name: 'Bayangan', color: 0x281f45, implemented: false },
  cahaya: { id: 'cahaya', name: 'Cahaya', color: 0xfff8e6, implemented: false },
  astral: { id: 'astral', name: 'Astral', color: 0xa795ff, implemented: false },
  kabut: { id: 'kabut', name: 'Kabut', color: 0xd8cfff, implemented: false },
  kristal: { id: 'kristal', name: 'Kristal', color: 0x34c3cf, implemented: false },
  alam: { id: 'alam', name: 'Alam', color: 0x55a145, implemented: false },
  roh: { id: 'roh', name: 'Roh', color: 0x4ab7a3, implemented: false },
  void: { id: 'void', name: 'Void', color: 0x1a1430, implemented: false },
};

export const IMPLEMENTED_ELEMENTS: ElementId[] = (Object.keys(ELEMENTS) as ElementId[]).filter((id) => ELEMENTS[id].implemented);

// ───────────────────────── status effects ─────────────────────────

export type StatusId =
  | 'burn'
  | 'wet'
  | 'freeze'
  | 'shock'
  | 'poison'
  | 'bleed'
  | 'slow'
  | 'stun'
  | 'root'
  | 'blind'
  | 'silence'
  | 'fear'
  | 'mark'
  | 'expose'
  | 'shield'
  | 'regen';

export interface StatusDef {
  id: StatusId;
  name: string;
  color: number;
  /** Seconds a fresh application lasts. */
  duration: number;
  /** How many applications can stack. */
  maxStacks: number;
  /** Damage per tick, per stack. 0 = no damage over time. */
  tickDamage: number;
  /** Seconds between ticks. */
  tickEvery: number;
  /** Movement speed multiplier while active (1 = no effect). */
  speedMult: number;
  /** Cannot act at all while active. */
  disables: boolean;
  implemented: boolean;
}

const st = (id: StatusId, name: string, color: number, o: Partial<StatusDef> = {}): StatusDef => ({
  id,
  name,
  color,
  duration: 4,
  maxStacks: 1,
  tickDamage: 0,
  tickEvery: 0.5,
  speedMult: 1,
  disables: false,
  implemented: false,
  ...o,
});

export const STATUSES: Record<StatusId, StatusDef> = {
  burn: st('burn', 'Terbakar', 0xff7a2e, { duration: 4, maxStacks: 3, tickDamage: 0.5, tickEvery: 0.5, implemented: true }),
  wet: st('wet', 'Basah', 0x3f9fcf, { duration: 6, implemented: true }),
  freeze: st('freeze', 'Membeku', 0x8befeb, { duration: 1.6, disables: true, speedMult: 0, implemented: true }),
  shock: st('shock', 'Tersengat', 0xffe066, { duration: 2.5, maxStacks: 2, tickDamage: 0.8, tickEvery: 0.4, speedMult: 0.7, implemented: true }),
  poison: st('poison', 'Racun', 0x55a145, { duration: 6, maxStacks: 5, tickDamage: 0.4 }),
  bleed: st('bleed', 'Pendarahan', 0xb8403f, { duration: 5, maxStacks: 5, tickDamage: 0.6 }),
  slow: st('slow', 'Lambat', 0x6a7094, { speedMult: 0.6 }),
  stun: st('stun', 'Pingsan', 0xffb82e, { duration: 1.2, disables: true, speedMult: 0 }),
  root: st('root', 'Terakar', 0x8e5b33, { duration: 2, speedMult: 0 }),
  blind: st('blind', 'Buta', 0x281f45, { duration: 3 }),
  silence: st('silence', 'Bisu', 0xa795ff, { duration: 3 }),
  fear: st('fear', 'Takut', 0x531a2e, { duration: 2.5 }),
  mark: st('mark', 'Ditandai', 0xff99c0, { duration: 8 }),
  expose: st('expose', 'Terbuka', 0xf1996b, { duration: 5 }),
  shield: st('shield', 'Pelindung', 0x76cfe6, { duration: 6 }),
  regen: st('regen', 'Regenerasi', 0x82c24f, { duration: 6, tickDamage: -0.5 }),
};

/** Which status an element applies on hit, for the four implemented ones. */
export const ELEMENT_STATUS: Partial<Record<ElementId, StatusId>> = {
  api: 'burn',
  air: 'wet',
  es: 'freeze',
  petir: 'shock',
};

// ───────────────────────── reactions ─────────────────────────

export interface ReactionDef {
  id: string;
  name: string;
  /** The incoming element and the status already on the target. Order matters. */
  element: ElementId;
  on: StatusId;
  /** Multiplier applied to the hit's damage. */
  damageMult: number;
  /** Statuses removed by the reaction. */
  clears?: StatusId[];
  /** Statuses applied by the reaction (on top of the element's own). */
  applies?: StatusId[];
  /** Radius in px of an area burst, 0 for none. */
  burst: number;
  color: number;
  note: string;
}

/**
 * The four implemented elements, paired. Every reaction here is reachable in play, and the table
 * is the single source of truth — `react()` does nothing that is not written down here.
 */
export const REACTIONS: ReactionDef[] = [
  {
    id: 'lebur',
    name: 'Lebur',
    element: 'api',
    on: 'freeze',
    damageMult: 2,
    clears: ['freeze'],
    burst: 0,
    color: 0xff9b3a,
    note: 'Api mencairkan Es: beku hilang, damage dua kali.',
  },
  {
    id: 'uap',
    name: 'Uap',
    element: 'api',
    on: 'wet',
    damageMult: 1.4,
    clears: ['wet'],
    burst: 28,
    color: 0xd8cfff,
    note: 'Api bertemu Basah: ledakan uap kecil, basah menguap.',
  },
  {
    id: 'padam',
    name: 'Padam',
    element: 'air',
    on: 'burn',
    damageMult: 1.2,
    clears: ['burn'],
    burst: 0,
    color: 0x76cfe6,
    note: 'Air memadamkan Terbakar.',
  },
  {
    id: 'beku',
    name: 'Beku',
    element: 'es',
    on: 'wet',
    damageMult: 1.3,
    clears: ['wet'],
    applies: ['freeze'],
    burst: 0,
    color: 0x8befeb,
    note: 'Es membekukan yang Basah: langsung membeku.',
  },
  {
    id: 'hantar',
    name: 'Hantar',
    element: 'petir',
    on: 'wet',
    damageMult: 1.8,
    burst: 46,
    applies: ['shock'],
    color: 0xffe066,
    note: 'Petir menghantar lewat Basah: area listrik yang menyambar sekitarnya.',
  },
  {
    id: 'pecah',
    name: 'Pecah',
    element: 'petir',
    on: 'freeze',
    damageMult: 2.2,
    clears: ['freeze'],
    burst: 22,
    color: 0xd5fffa,
    note: 'Petir memecahkan yang Membeku.',
  },
];

// ───────────────────────── status bag ─────────────────────────

export interface ActiveStatus {
  id: StatusId;
  /** Seconds remaining. */
  left: number;
  stacks: number;
  /** Seconds until the next damage tick. */
  next: number;
}

export interface StatusTick {
  /** Damage to deal this tick (already summed over stacks). Negative = healing. */
  damage: number;
  /** Statuses that expired on this tick. */
  expired: StatusId[];
}

/**
 * The statuses on one entity. Ticked by its owner; knows nothing about rendering.
 * `resist` scales incoming durations — 1 means "no resistance", 0 means immune.
 */
export class StatusBag {
  private list: ActiveStatus[] = [];

  /** 0..1 per status; anything absent counts as 1 (no resistance). */
  constructor(private readonly resist: Partial<Record<StatusId, number>> = {}) {}

  get active(): readonly ActiveStatus[] {
    return this.list;
  }

  has(id: StatusId): boolean {
    return this.list.some((s) => s.id === id);
  }

  stacks(id: StatusId): number {
    return this.list.find((s) => s.id === id)?.stacks ?? 0;
  }

  /** Apply a status. Refreshes the duration and adds a stack up to the definition's limit. */
  apply(id: StatusId, durationMult = 1): boolean {
    const def = STATUSES[id];
    if (!def.implemented) return false;
    const r = this.resist[id] ?? 1;
    if (r <= 0) return false;
    const duration = def.duration * durationMult * r;
    if (duration <= 0) return false;
    const found = this.list.find((s) => s.id === id);
    if (found) {
      found.left = Math.max(found.left, duration);
      found.stacks = Math.min(def.maxStacks, found.stacks + 1);
      return true;
    }
    this.list.push({ id, left: duration, stacks: 1, next: def.tickEvery });
    return true;
  }

  clear(id: StatusId): void {
    this.list = this.list.filter((s) => s.id !== id);
  }

  clearAll(): void {
    this.list = [];
  }

  /** Slowest speed multiplier among the active statuses. */
  get speedMult(): number {
    let m = 1;
    for (const s of this.list) m = Math.min(m, STATUSES[s.id].speedMult);
    return m;
  }

  /** True while any active status takes control away entirely. */
  get disabled(): boolean {
    return this.list.some((s) => STATUSES[s.id].disables);
  }

  /** Advance time. Returns the damage owed this frame and anything that wore off. */
  tick(dt: number): StatusTick {
    let damage = 0;
    const expired: StatusId[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      const def = STATUSES[s.id];
      s.left -= dt;
      if (def.tickDamage !== 0) {
        s.next -= dt;
        while (s.next <= 0) {
          damage += def.tickDamage * s.stacks;
          s.next += def.tickEvery;
        }
      }
      if (s.left <= 0) {
        expired.push(s.id);
        this.list.splice(i, 1);
      }
    }
    return { damage, expired };
  }
}

export interface ReactionResult {
  /** Multiplier to apply to the hit's damage (1 when nothing reacted). */
  damageMult: number;
  /** The reaction that fired, if any. */
  reaction: ReactionDef | null;
}

/**
 * Apply `element` to a status bag and resolve any reaction.
 *
 * Order of business: look up a reaction against what is *already* on the target, apply its
 * clears and extra statuses, then apply the element's own status — so Petir on a Basah target
 * conducts (and re-applies Shock) rather than merely replacing the Wet.
 */
export function applyElement(bag: StatusBag, element: ElementId, durationMult = 1): ReactionResult {
  if (!ELEMENTS[element]?.implemented) return { damageMult: 1, reaction: null };

  const reaction = REACTIONS.find((r) => r.element === element && bag.has(r.on)) ?? null;
  if (reaction) {
    for (const id of reaction.clears ?? []) bag.clear(id);
    for (const id of reaction.applies ?? []) bag.apply(id, durationMult);
  }
  const own = ELEMENT_STATUS[element];
  // A reaction that explicitly cleared this element's own status must not have it put straight back.
  if (own && !(reaction?.clears ?? []).includes(own)) bag.apply(own, durationMult);
  return { damageMult: reaction?.damageMult ?? 1, reaction };
}
