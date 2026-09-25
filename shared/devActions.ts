/**
 * Every developer action, as data the server can check (docs/BACKEND.md "Mode Pengembang").
 *
 * Two kinds:
 *  • **grants** change the save — items, level, EXP, coins, elements, stats, resets. The server
 *    applies them to the save and hands the result back; the game only adopts what it is given.
 *  • **session tools** change only what is on screen right now — god mode, teleport, time, weather,
 *    spawning, the reaction log. The server authorises and logs them; the game runs them after the
 *    server said yes.
 *
 * Either way the request goes through `POST /dev/action`, which refuses any account whose role in
 * the database is not "dev". Parsing is strict: an unknown action or parameter is refused.
 */
import { DEV_STAT_IDS, DEV_STAT_MAX, ELEMENT_IDS, ITEM_BY_ID, MAX_COINS, MAX_LEVEL, RARITY_IDS, type DevStatId, type ElementId, type Rarity } from './catalog';

export type DevGrant =
  | { type: 'give_item'; item: string; rarity: Rarity; count: number }
  | { type: 'give_all_cores' }
  | { type: 'give_kit' }
  | { type: 'set_coins'; amount: number }
  | { type: 'set_level'; level: number }
  | { type: 'add_exp'; amount: number }
  | { type: 'unlock_elements' }
  | { type: 'set_elements'; primary: ElementId | null; secondary: ElementId | null }
  | { type: 'set_stats'; stats: Partial<Record<DevStatId, number>> }
  | { type: 'reset_cutscenes' }
  | { type: 'reset_save' };

export type DevTool =
  | { type: 'god'; on: boolean }
  | { type: 'teleport'; to: string }
  | { type: 'time'; to: 'pagi' | 'siang' | 'sore' | 'malam' }
  | { type: 'weather'; to: string }
  | { type: 'spawn'; kind: 'slime' | 'archer' | 'bat' | 'boss' | 'dummy' }
  | { type: 'clear_spawns' }
  | { type: 'heal' }
  | { type: 'event'; id: string | null }
  | { type: 'reaction_log'; on: boolean };

export type DevAction = DevGrant | DevTool;

export const GRANT_TYPES: ReadonlySet<string> = new Set([
  'give_item',
  'give_all_cores',
  'give_kit',
  'set_coins',
  'set_level',
  'add_exp',
  'unlock_elements',
  'set_elements',
  'set_stats',
  'reset_cutscenes',
  'reset_save',
]);

export const isGrant = (a: DevAction): a is DevGrant => GRANT_TYPES.has(a.type);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const shortId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]{1,32}$/.test(v);
const el = (v: unknown): v is ElementId | null => v === null || ELEMENT_IDS.includes(v as ElementId);
const onlyKeys = (o: Record<string, unknown>, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

/** A developer action from untrusted JSON, or null if anything about it is off. */
export function parseDevAction(raw: unknown): DevAction | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const r = raw;
  const only = (...keys: string[]): boolean => onlyKeys(r, ['type', ...keys]);
  switch (r.type) {
    case 'give_item':
      return only('item', 'rarity', 'count') && typeof r.item === 'string' && ITEM_BY_ID.has(r.item) && RARITY_IDS.includes(r.rarity as Rarity) && intIn(r.count, 1, 99)
        ? { type: 'give_item', item: r.item, rarity: r.rarity as Rarity, count: r.count }
        : null;
    case 'give_all_cores':
    case 'give_kit':
    case 'unlock_elements':
    case 'reset_cutscenes':
    case 'reset_save':
    case 'clear_spawns':
    case 'heal':
      return only() ? ({ type: r.type } as DevAction) : null;
    case 'set_coins':
      return only('amount') && intIn(r.amount, 0, MAX_COINS) ? { type: 'set_coins', amount: r.amount } : null;
    case 'set_level':
      return only('level') && intIn(r.level, 1, MAX_LEVEL) ? { type: 'set_level', level: r.level } : null;
    case 'add_exp':
      return only('amount') && intIn(r.amount, 1, 10_000_000) ? { type: 'add_exp', amount: r.amount } : null;
    case 'set_elements':
      return only('primary', 'secondary') && el(r.primary) && el(r.secondary) && (r.primary === null || r.primary !== r.secondary)
        ? { type: 'set_elements', primary: r.primary, secondary: r.secondary }
        : null;
    case 'set_stats': {
      if (!only('stats') || !isObj(r.stats)) return null;
      const stats: Partial<Record<DevStatId, number>> = {};
      for (const [k, v] of Object.entries(r.stats)) {
        if (!DEV_STAT_IDS.includes(k as DevStatId) || typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > DEV_STAT_MAX) return null;
        stats[k as DevStatId] = v;
      }
      return { type: 'set_stats', stats };
    }
    case 'god':
    case 'reaction_log':
      return only('on') && typeof r.on === 'boolean' ? ({ type: r.type, on: r.on } as DevAction) : null;
    case 'teleport':
      return only('to') && shortId(r.to) ? { type: 'teleport', to: r.to } : null;
    case 'time':
      return only('to') && ['pagi', 'siang', 'sore', 'malam'].includes(r.to as string) ? { type: 'time', to: r.to as 'pagi' } : null;
    case 'weather':
      return only('to') && shortId(r.to) ? { type: 'weather', to: r.to } : null;
    case 'spawn':
      return only('kind') && ['slime', 'archer', 'bat', 'boss', 'dummy'].includes(r.kind as string) ? { type: 'spawn', kind: r.kind as 'slime' } : null;
    case 'event':
      return only('id') && (r.id === null || shortId(r.id)) ? { type: 'event', id: r.id } : null;
    default:
      return null;
  }
}
