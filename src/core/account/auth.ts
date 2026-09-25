/**
 * Accounts: the interface every account backend implements, and the rules shared by all of them.
 *
 * Batch 7 will add a real server. Until then the only implementation is `LocalAuth`
 * (`local.ts`), which keeps accounts **on this device only** — and the screens say so, in words,
 * on the register form. Anything that talks to accounts goes through `AuthAdapter`, so swapping
 * the local adapter for a remote one is a change in one place (`docs/BACKEND.md`).
 *
 * Pure: no DOM, no fetch, no crypto here. The adapters bring their own.
 */

import { PASSWORD_MAX, PASSWORD_MIN as SHARED_PASSWORD_MIN, PASSWORD_RULE_TEXT, USERNAME_RULE_TEXT, validUsername as sharedValidUsername, type UserRole } from '../../../shared/api';

/** Who is logged in. `id` is what saves are filed under; `name` is what the screens show. */
export interface AccountSession {
  id: string;
  name: string;
  /**
   * What the account may do. For a server account this is **the server's answer** (`/auth/me`,
   * the login response) — the client only reads it. Absent = player.
   */
  role?: UserRole | undefined;
  /** Where the account lives, for the honest line on the menu ("di perangkat ini" / "di server"). */
  kind: AuthKind;
  /** Epoch ms of the login. */
  since: number;
}

export type AuthKind = 'local' | 'remote';

export type AuthErrorCode =
  | 'nama-tidak-sah'
  | 'sandi-lemah'
  | 'nama-dipakai'
  | 'salah'
  | 'terkunci'
  | 'penyimpanan'
  | 'jaringan'
  | 'server'
  | 'dicadangkan';

export type AuthResult = { ok: true; session: AccountSession } | { ok: false; error: AuthErrorCode; message: string };

export interface AuthAdapter {
  readonly kind: AuthKind;
  /** `email` is optional and only meaningful to a server (password reset); the local adapter ignores it. */
  register(username: string, password: string, email?: string): Promise<AuthResult>;
  login(username: string, password: string): Promise<AuthResult>;
  logout(): Promise<void>;
  /** The remembered session, if any — read synchronously so the title can skip the login form. */
  current(): AccountSession | null;
  /** Is this name free? Only a server knows for sure; the local adapter answers from this phone. */
  checkUsername?(username: string): Promise<{ available: boolean; message: string }>;
}

/** The rules are the server's (`shared/api.ts`), so the form and the API can never disagree. */
export const USERNAME_RULE = USERNAME_RULE_TEXT;
export const PASSWORD_MIN = SHARED_PASSWORD_MIN;
export const PASSWORD_RULE = PASSWORD_RULE_TEXT;

/** Names compare case-insensitively; the id an account is filed under is the lowercase form. */
export function normalizeUsername(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function validUsername(name: string): boolean {
  return sharedValidUsername(String(name ?? '').trim());
}

/**
 * The only password rule is length. Composition rules ("one digit, one symbol") make passwords
 * harder to remember without making them meaningfully harder to guess; a long one is what helps.
 */
export function validPassword(pw: string): boolean {
  return typeof pw === 'string' && pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX;
}

export const fail = (error: AuthErrorCode, message: string): AuthResult => ({ ok: false, error, message });
