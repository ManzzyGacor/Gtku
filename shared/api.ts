/**
 * The contract between the game and its server, imported by both sides.
 *
 * Only types, constants and pure validation live here — no Node, no DOM, no Mongo — so the browser
 * bundle and the Fastify server agree on one definition of a username, a role or a save envelope
 * instead of two that drift apart. Documented in docs/BACKEND.md.
 */

export type UserRole = 'player' | 'dev';

/** What the client may know about an account. Never a hash, never a token. */
export interface PublicUser {
  username: string;
  role: UserRole;
}

/** Login, register and refresh answer with this. The refresh token travels only as a cookie. */
export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: PublicUser;
}

export interface RegisterBody {
  username: string;
  password: string;
  email?: string | undefined;
}

export interface LoginBody {
  username: string;
  password: string;
}

/** A character's save as the server keeps it. */
export interface SaveEnvelope {
  /** The game's own save object (`SaveData`: hero, level, stats, bag, equipment, elements, quest, world). */
  data: unknown;
  /** Format version of `data` (`SaveData.v`). */
  saveVersion: number;
  /** Server revision, +1 on every accepted write. */
  rev: number;
  /** Server time of the write, epoch ms. */
  updatedAt: number;
}

export interface PutSaveBody {
  data: unknown;
  /** The revision this save was based on: 0 for "there was none". */
  baseRev: number;
  /** When the client wrote it locally, epoch ms — informational, the server never trusts it. */
  clientUpdatedAt?: number | undefined;
}

/** Every error the API returns, as `{ error: code }`. */
export type ApiErrorCode =
  | 'invalid_input'
  | 'invalid_username'
  | 'weak_password'
  | 'invalid_email'
  | 'username_taken'
  | 'username_reserved'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'unauthorized'
  | 'token_expired'
  | 'conflict'
  | 'save_too_large'
  | 'unsupported_save_version'
  | 'forbidden_origin'
  | 'forbidden'
  | 'save_rejected'
  | 'not_found'
  | 'server_error';

// ───────────────────────── rules, shared by the form and the server ─────────────────────────

/** 3–16 characters: letters, digits and underscore. Case is kept for display, ignored for uniqueness. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
/** The newest `SaveData.v` this server accepts. */
export const MAX_SAVE_VERSION = 2;
/** A save bigger than this is refused (today's saves are ~5–15 KB). */
export const MAX_SAVE_BYTES = 256 * 1024;

/**
 * Names nobody can register over the API — not even the first person to try. `manzzy` is the
 * developer account (made from the VPS with `npm run create-dev-account`); the rest are the names
 * people trust to be staff.
 */
export const PROTECTED_USERNAMES: readonly string[] = ['manzzy', 'admin', 'dev', 'moderator', 'gm', 'system'];

export const isProtectedUsername = (name: string): boolean => PROTECTED_USERNAMES.includes(name.trim().toLowerCase());

export const USERNAME_RULE_TEXT = 'Nama akun 3–16 karakter: huruf, angka, atau garis bawah (_).';
export const PASSWORD_RULE_TEXT = `Kata sandi ${PASSWORD_MIN}–${PASSWORD_MAX} karakter.`;

export function validUsername(name: unknown): name is string {
  return typeof name === 'string' && USERNAME_PATTERN.test(name);
}

export function validPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX;
}

/** Deliberately loose: one @, something on each side, a dot in the domain, no spaces, ≤ 254. */
export function validEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** What an error code means to a player, in Indonesian. */
export const API_ERROR_TEXT: Record<ApiErrorCode, string> = {
  invalid_input: 'Isian tidak lengkap atau tidak sah.',
  invalid_username: USERNAME_RULE_TEXT,
  weak_password: PASSWORD_RULE_TEXT,
  invalid_email: 'Alamat email tidak sah (boleh dikosongkan).',
  username_taken: 'Nama akun itu sudah dipakai. Pilih nama lain.',
  username_reserved: 'Nama akun itu dicadangkan.',
  invalid_credentials: 'Nama akun atau kata sandi salah.',
  rate_limited: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
  unauthorized: 'Sesi berakhir. Silakan masuk lagi.',
  token_expired: 'Sesi berakhir. Silakan masuk lagi.',
  conflict: 'Save di server lebih baru.',
  save_too_large: 'Save terlalu besar untuk disimpan di server.',
  unsupported_save_version: 'Versi save ini belum dikenal server.',
  forbidden_origin: 'Permintaan ditolak.',
  forbidden: 'Hanya untuk akun pengembang.',
  save_rejected: 'Save ditolak server karena isinya tidak wajar.',
  not_found: 'Tidak ditemukan.',
  server_error: 'Server sedang bermasalah. Coba lagi nanti.',
};
