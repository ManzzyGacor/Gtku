/**
 * World events (docs/OVERHAUL.md §4 "Progresi": invasi monster, badai elemen, kabut misterius,
 * pedagang keliling — "juga lewat data").
 *
 * **Everything an event is, is data** (`WORLD_EVENTS`): when it may happen, how long it lasts, and
 * a list of *effects* — weather, an EXP or loot multiplier, an element that hits harder, monsters
 * to drive off, a merchant with stock, the minimap going dark. The game applies effects generically;
 * adding an event is adding an entry here, not writing code for it.
 *
 * **The director** decides when. Every `ROLL_EVERY` seconds of play it may start one event (never two
 * at once), respecting each event's conditions and cooldown, from a seeded random so a test can
 * replay a whole evening. It never starts one during the tutorial, a cutscene, or a boss fight —
 * an invasion in the middle of the prologue is not an event, it is a bug report.
 *
 * Pure: no renderer, no DOM. Its state goes into the save.
 */
import type { ElementId } from '../combat/elements';
import type { Rarity } from '../items/items';
import type { Weather } from './weather';

export type WorldEventId = 'invasi' | 'badai' | 'kabut' | 'pedagang' | 'purnama';

export interface ShopOffer {
  item: string;
  rarity: Rarity;
  /** Price in coins. */
  price: number;
  /** How many the merchant carries per visit. */
  stock: number;
}

export interface EventEffects {
  /** Weather while it lasts; the previous weather comes back after. */
  weather?: Weather | undefined;
  /** Multiplies every EXP gain. */
  expMult?: number | undefined;
  /** Multiplies the chance of loot from kills (extra rolls). */
  dropMult?: number | undefined;
  /** One of these is picked when the event starts; hits of that element deal `mult` times. */
  element?: { pool: ElementId[]; mult: number } | undefined;
  /** Monsters that come for the village. Clearing them all ends the event early with a reward. */
  invasion?: { kinds: ('slime' | 'archer' | 'bat')[]; count: number; reward: { exp: number; coins: number } } | undefined;
  /** A merchant stands in the plaza while it lasts. */
  merchant?: { offers: ShopOffer[] } | undefined;
  /** The minimap goes dark: in this fog even the map is lost. */
  hideMinimap?: boolean | undefined;
}

export interface WorldEventDef {
  id: WorldEventId;
  name: string;
  /** Under the banner when it starts. */
  intro: string;
  /** When it ends on its own. */
  outro: string;
  /** Seconds of play. */
  duration: number;
  /** Relative chance against the other eligible events. */
  weight: number;
  /** Seconds after it ends before it may come again. */
  cooldown: number;
  /** Only at night (true), only by day (false), or any time (undefined). */
  night?: boolean | undefined;
  /** Main quest stage it needs first (the invasion waits until the player can fight). */
  minQuestStage?: number | undefined;
  effects: EventEffects;
}

export const WORLD_EVENTS: Record<WorldEventId, WorldEventDef> = {
  invasi: {
    id: 'invasi',
    name: 'Invasi Monster',
    intro: 'Monster keluar dari kegelapan menuju Ravenhollow! Usir mereka.',
    outro: 'Para monster mundur ke hutan.',
    duration: 150,
    weight: 3,
    cooldown: 600,
    minQuestStage: 1,
    effects: {
      invasion: { kinds: ['slime', 'slime', 'archer', 'bat'], count: 7, reward: { exp: 80, coins: 60 } },
    },
  },
  badai: {
    id: 'badai',
    name: 'Badai Elemen',
    intro: 'Elemen dunia bergolak. Satu elemen kini menghantam jauh lebih keras.',
    outro: 'Badai mereda; elemen kembali tenang.',
    duration: 120,
    weight: 3,
    cooldown: 480,
    effects: {
      weather: 'badai',
      element: { pool: ['api', 'air', 'es', 'petir'], mult: 1.4 },
    },
  },
  kabut: {
    id: 'kabut',
    name: 'Kabut Misterius',
    intro: 'Kabut tebal turun. Peta tak bisa dibaca, tapi yang tersesat sering menemukan harta.',
    outro: 'Kabut terangkat.',
    duration: 110,
    weight: 2,
    cooldown: 540,
    night: true,
    effects: { weather: 'berkabut', hideMinimap: true, dropMult: 2 },
  },
  pedagang: {
    id: 'pedagang',
    name: 'Pedagang Keliling',
    intro: 'Seorang pedagang keliling singgah di alun-alun. Dagangannya tidak lama.',
    outro: 'Pedagang keliling melanjutkan perjalanan.',
    duration: 180,
    weight: 2,
    cooldown: 720,
    night: false,
    effects: {
      merchant: {
        offers: [
          { item: 'potion_small', rarity: 'common', price: 15, stock: 5 },
          { item: 'helm_stone', rarity: 'uncommon', price: 70, stock: 1 },
          { item: 'boots_striding', rarity: 'rare', price: 120, stock: 1 },
          { item: 'amulet_firefly', rarity: 'epic', price: 260, stock: 1 },
        ],
      },
    },
  },
  purnama: {
    id: 'purnama',
    name: 'Malam Purnama',
    intro: 'Bulan purnama menerangi dunia. Setiap pelajaran terasa lebih bermakna.',
    outro: 'Bulan purnama tertutup awan.',
    duration: 140,
    weight: 2,
    cooldown: 600,
    night: true,
    effects: { expMult: 1.5, weather: 'cerah' },
  },
};

export const WORLD_EVENT_IDS = Object.keys(WORLD_EVENTS) as WorldEventId[];

/** Seconds of play between rolls, and the chance that a roll starts anything. */
export const ROLL_EVERY = 90;
export const ROLL_CHANCE = 0.4;
/** Nothing in the first minutes of a session: let the player arrive. */
export const FIRST_ROLL_AFTER = 150;

export interface ActiveEvent {
  id: WorldEventId;
  /** Seconds left. */
  left: number;
  /** The element a storm picked. */
  element?: ElementId | undefined;
  /** Invasion progress. */
  defeated?: number | undefined;
  total?: number | undefined;
  /** Merchant stock left, by offer index. */
  stock?: number[] | undefined;
}

export interface EventStateJson {
  active: ActiveEvent | null;
  /** Seconds until the next roll. */
  next: number;
  /** Seconds of cooldown left, by event. */
  cooldowns: Partial<Record<WorldEventId, number>>;
}

/** What the game needs to know to decide whether an event may start now. */
export interface EventContext {
  night: boolean;
  questStage: number;
  /** Tutorial, cutscene, boss fight, dead: no events. */
  busy: boolean;
}

export type EventChange =
  | { type: 'start'; event: ActiveEvent; def: WorldEventDef }
  | { type: 'end'; event: ActiveEvent; def: WorldEventDef; cleared: boolean };

const eligible = (def: WorldEventDef, ctx: EventContext): boolean =>
  (def.night === undefined || def.night === ctx.night) && ctx.questStage >= (def.minQuestStage ?? 0);

export class WorldEventDirector {
  state: EventStateJson = { active: null, next: FIRST_ROLL_AFTER, cooldowns: {} };

  constructor(private readonly rand: () => number) {}

  get active(): ActiveEvent | null {
    return this.state.active;
  }

  get def(): WorldEventDef | null {
    return this.state.active ? WORLD_EVENTS[this.state.active.id] : null;
  }

  /** The active event's effects, or none. */
  get effects(): EventEffects {
    return this.def?.effects ?? NO_EFFECTS;
  }

  /** Advance by `dt` seconds of play. Returns what changed, if anything. */
  update(dt: number, ctx: EventContext): EventChange | null {
    if (!(dt > 0)) return null;
    const cds = this.state.cooldowns;
    for (const id of WORLD_EVENT_IDS) {
      const c = cds[id];
      if (c !== undefined) {
        const left = c - dt;
        if (left > 0) cds[id] = left;
        else delete cds[id];
      }
    }

    const a = this.state.active;
    if (a) {
      a.left -= dt;
      // an event that needs the day or the night ends when that changes, not an hour later
      const def = WORLD_EVENTS[a.id];
      if (a.left <= 0 || (def.night !== undefined && def.night !== ctx.night)) return this.end(false);
      return null;
    }

    if (ctx.busy) return null;
    this.state.next -= dt;
    if (this.state.next > 0) return null;
    this.state.next = ROLL_EVERY;
    if (this.rand() >= ROLL_CHANCE) return null;

    const pool = WORLD_EVENT_IDS.filter((id) => cds[id] === undefined && eligible(WORLD_EVENTS[id], ctx));
    const total = pool.reduce((s, id) => s + WORLD_EVENTS[id].weight, 0);
    if (total <= 0) return null;
    let r = this.rand() * total;
    for (const id of pool) {
      r -= WORLD_EVENTS[id].weight;
      if (r < 0) return this.start(id);
    }
    return this.start(pool[pool.length - 1]);
  }

  /** Start one now (also the developer menu's door). Ends whatever was running first. */
  start(id: WorldEventId): EventChange {
    if (this.state.active) this.end(false);
    const def = WORLD_EVENTS[id];
    const event: ActiveEvent = { id, left: def.duration };
    const fx = def.effects;
    if (fx.element) event.element = fx.element.pool[Math.floor(this.rand() * fx.element.pool.length) % fx.element.pool.length];
    if (fx.invasion) {
      event.defeated = 0;
      event.total = fx.invasion.count;
    }
    if (fx.merchant) event.stock = fx.merchant.offers.map((o) => o.stock);
    this.state.active = event;
    return { type: 'start', event, def };
  }

  /** End the running event: on its own (`cleared` false) or because the player won it. */
  end(cleared: boolean): EventChange | null {
    const event = this.state.active;
    if (!event) return null;
    const def = WORLD_EVENTS[event.id];
    this.state.active = null;
    this.state.cooldowns[event.id] = def.cooldown;
    this.state.next = Math.max(this.state.next, ROLL_EVERY);
    return { type: 'end', event, def, cleared };
  }

  /** An invader fell. Returns the end change when that was the last one. */
  noteInvaderDown(): EventChange | null {
    const a = this.state.active;
    if (!a || a.total === undefined) return null;
    a.defeated = Math.min(a.total, (a.defeated ?? 0) + 1);
    return a.defeated >= a.total ? this.end(true) : null;
  }

  /**
   * Buy offer `index` from the merchant. Returns what was bought, or why not — the coins are the
   * caller's (the character), so this only checks and takes stock.
   */
  buy(index: number, coins: number): { ok: true; offer: ShopOffer } | { ok: false; reason: 'tidak-ada' | 'habis' | 'koin' } {
    const a = this.state.active;
    const offers = a ? WORLD_EVENTS[a.id].effects.merchant?.offers : undefined;
    const offer = offers?.[index];
    if (!a || !offer || !a.stock) return { ok: false, reason: 'tidak-ada' };
    if ((a.stock[index] ?? 0) <= 0) return { ok: false, reason: 'habis' };
    if (coins < offer.price) return { ok: false, reason: 'koin' };
    a.stock[index]--;
    return { ok: true, offer };
  }

  toJSON(): EventStateJson {
    return structuredCloneSafe(this.state);
  }

  /** Load from a save, repairing anything that does not make sense rather than trusting it. */
  load(raw: unknown): void {
    const fresh: EventStateJson = { active: null, next: FIRST_ROLL_AFTER, cooldowns: {} };
    if (!raw || typeof raw !== 'object') {
      this.state = fresh;
      return;
    }
    const o = raw as Partial<EventStateJson>;
    fresh.next = num(o.next, 0, 3600, FIRST_ROLL_AFTER);
    if (o.cooldowns && typeof o.cooldowns === 'object')
      for (const id of WORLD_EVENT_IDS) {
        const c = (o.cooldowns as Record<string, unknown>)[id];
        if (typeof c === 'number' && Number.isFinite(c) && c > 0) fresh.cooldowns[id] = Math.min(c, 3600);
      }
    const a = o.active;
    if (a && typeof a === 'object' && typeof a.id === 'string' && a.id in WORLD_EVENTS) {
      const def = WORLD_EVENTS[a.id];
      const ev: ActiveEvent = { id: def.id, left: num(a.left, 0, def.duration, def.duration) };
      if (def.effects.element && typeof a.element === 'string' && def.effects.element.pool.includes(a.element)) ev.element = a.element;
      else if (def.effects.element) ev.element = def.effects.element.pool[0];
      if (def.effects.invasion) {
        ev.total = def.effects.invasion.count;
        ev.defeated = Math.round(num(a.defeated, 0, ev.total, 0));
      }
      if (def.effects.merchant) {
        const offers = def.effects.merchant.offers;
        ev.stock = offers.map((off, i) => Math.round(num(Array.isArray(a.stock) ? a.stock[i] : undefined, 0, off.stock, off.stock)));
      }
      if (ev.left > 0) fresh.active = ev;
    }
    this.state = fresh;
  }
}

const NO_EFFECTS: EventEffects = {};

/** A finite number clamped to [lo, hi], or the default. */
function num(v: unknown, lo: number, hi: number, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
