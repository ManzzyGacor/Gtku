/**
 * The co-op wire protocol (docs/MULTIPLAYER.md), shared by the game and the server.
 *
 * JSON, but small: positions are whole pixels, angles whole degrees, stick axes −100..100. The
 * server never trusts a number from a client beyond "which buttons, which direction": damage, HP,
 * positions of enemies and loot are all the server's.
 *
 * Budget on a phone: the client sends at most `INPUT_HZ` inputs a second (only on change, plus a
 * heartbeat); the server sends `SNAP_HZ` snapshots, about 0.4–0.8 KB each for a full room — a few
 * kilobytes a second.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 4;
/** Simulation rate on the server. */
export const TICK_HZ = 20;
/** Snapshot rate to clients (every other tick). */
export const SNAP_HZ = 10;
/** Most inputs a client may send per second before the server starts dropping them. */
export const INPUT_HZ = 20;
/** Largest message the server accepts from a client, bytes. */
export const MAX_CLIENT_MESSAGE = 512;
/** Seconds a disconnected player keeps their place in the room. */
export const RECONNECT_GRACE = 30;
/** Seconds an empty room lives before it is closed. */
export const EMPTY_ROOM_GRACE = 30;
/** How far behind the newest snapshot the client draws everyone else, seconds. */
export const INTERP_DELAY = 0.15;

/** Room codes: 5 characters, no 0/O/1/I/L so they can be read aloud and typed on a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export const validCode = (c: unknown): c is string => typeof c === 'string' && c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));

/** Buttons, as bits. */
export const BTN_ATTACK = 1;
export const BTN_DODGE = 2;
export const BTN_SKILL = 4;

// ───────────────────────── client → server ─────────────────────────

export type ClientMsg =
  | { t: 'auth'; token: string; v: number }
  | { t: 'create' }
  | { t: 'quick' }
  | { t: 'join'; code: string }
  | { t: 'resume'; code: string; rtoken: string }
  | { t: 'ready'; on: boolean }
  | { t: 'start' }
  | { t: 'leave' }
  /** seq, stick x/y (−100..100), aim (whole degrees), buttons held (bits). */
  | { t: 'in'; s: number; x: number; y: number; a: number; b: number }
  | { t: 'ping'; c: number };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const keys = (o: Record<string, unknown>, allowed: string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));

/** A client message from raw text, or null. Strict: unknown types or fields are refused. */
export function parseClientMsg(text: string): ClientMsg | null {
  if (text.length > MAX_CLIENT_MESSAGE) return null;
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'auth':
      return keys(m, ['t', 'token', 'v']) && typeof m.token === 'string' && m.token.length < 2048 && int(m.v, 1, 1000) ? { t: 'auth', token: m.token, v: m.v } : null;
    case 'create':
    case 'quick':
    case 'start':
    case 'leave':
      return keys(m, ['t']) ? ({ t: m.t } as ClientMsg) : null;
    case 'join':
      return keys(m, ['t', 'code']) && validCode(m.code) ? { t: 'join', code: m.code } : null;
    case 'resume':
      return keys(m, ['t', 'code', 'rtoken']) && validCode(m.code) && typeof m.rtoken === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(m.rtoken)
        ? { t: 'resume', code: m.code, rtoken: m.rtoken }
        : null;
    case 'ready':
      return keys(m, ['t', 'on']) && typeof m.on === 'boolean' ? { t: 'ready', on: m.on } : null;
    case 'in':
      return keys(m, ['t', 's', 'x', 'y', 'a', 'b']) && int(m.s, 0, 2 ** 31) && int(m.x, -100, 100) && int(m.y, -100, 100) && int(m.a, -360, 360) && int(m.b, 0, 7)
        ? { t: 'in', s: m.s, x: m.x, y: m.y, a: m.a, b: m.b }
        : null;
    case 'ping':
      return keys(m, ['t', 'c']) && typeof m.c === 'number' && Number.isFinite(m.c) ? { t: 'ping', c: m.c } : null;
    default:
      return null;
  }
}

// ───────────────────────── server → client ─────────────────────────

export type RoomPhase = 'lobby' | 'fight' | 'won' | 'lost';

export interface LobbyPlayer {
  id: number;
  name: string;
  level: number;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

/**
 * A player in a snapshot: [id, x, y, aim°, hp, maxHp, state]. `state` 0 idle/moving, 1 attacking,
 * 2 rolling, 3 casting, 4 downed.
 */
export type SnapPlayer = [number, number, number, number, number, number, number];
/** The boss: [x, y, facing°, hp, maxHp, phase, action, actionT (tenths of s left)]. */
export type SnapBoss = [number, number, number, number, number, number, number, number];
/** A telegraph or projectile: [kind, x, y, a, b]. kinds: 1 slam (r=a, tenths left=b), 2 sweep (angle=a, tenths=b), 3 bolt. */
export type SnapThing = [number, number, number, number, number];
/** Something that happened: [kind, target, amount]. kinds: 1 damage to boss, 2 damage to player, 3 downed, 4 revived. */
export type SnapEvent = [number, number, number];

export type ServerMsg =
  | { t: 'hello'; you: number; name: string; dev: boolean }
  | { t: 'room'; code: string; public: boolean; phase: RoomPhase; players: LobbyPlayer[]; rtoken: string; you: number }
  | { t: 'snap'; k: number; ack: number; p: SnapPlayer[]; b: SnapBoss | null; z: SnapThing[]; e: SnapEvent[] }
  | { t: 'result'; won: boolean; exp: number; coins: number; items: { id: string; rarity: string; count: number }[]; save: { data: unknown; rev: number } | null }
  | { t: 'err'; code: CoopError }
  | { t: 'pong'; c: number; s: number };

export type CoopError =
  | 'auth_failed'
  | 'bad_message'
  | 'too_many_messages'
  | 'room_not_found'
  | 'room_full'
  | 'room_started'
  | 'not_host'
  | 'not_ready'
  | 'dev_private_only'
  | 'already_in_room'
  | 'resume_failed'
  | 'version';

export const COOP_ERROR_TEXT: Record<CoopError, string> = {
  auth_failed: 'Sesi akun tidak sah. Masuk lagi.',
  bad_message: 'Pesan tidak dikenal.',
  too_many_messages: 'Terlalu banyak pesan; koneksi diputus.',
  room_not_found: 'Room dengan kode itu tidak ada (atau sudah ditutup).',
  room_full: 'Room penuh (maksimal 4 pemain).',
  room_started: 'Pertarungan di room itu sudah dimulai.',
  not_host: 'Hanya pembuat room yang bisa memulai.',
  not_ready: 'Semua pemain harus siap dulu.',
  dev_private_only: 'Akun pengembang hanya boleh bermain di room privat.',
  already_in_room: 'Kamu sudah ada di sebuah room.',
  resume_failed: 'Tidak bisa kembali ke room (waktu habis atau room ditutup).',
  version: 'Versi game berbeda dengan server. Muat ulang halaman.',
};
