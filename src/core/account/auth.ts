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

/** Who is logged in. `id` is what saves are filed under; `name` is what the screens show. */
export interface AccountSession {
  id: string;
  name: string;
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
  | 'server';

export type AuthResult = { ok: true; session: AccountSession } | { ok: false; error: AuthErrorCode; message: string };

export interface AuthAdapter {
  readonly kind: AuthKind;
  /** `email` is optional and only meaningful to a server (password reset); the local adapter ignores it. */
  register(username: string, password: string, email?: string): Promise<AuthResult>;
  login(username: string, password: string): Promise<AuthResult>;
  logout(): Promise<void>;
  /** The remembered session, if any — read synchronously so the title can skip the login form. */
  current(): AccountSession | null;
}

/** 3–20 characters: lowercase letters, digits and underscore. Case-insensitive on input. */
export const USERNAME_RULE = 'Nama akun 3–20 huruf kecil, angka, atau garis bawah (_).';
export const PASSWORD_MIN = 8;
export const PASSWORD_RULE = `Kata sandi minimal ${PASSWORD_MIN} karakter.`;

export function normalizeUsername(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function validUsername(name: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(name);
}

/**
 * The only password rule is length. Composition rules ("one digit, one symbol") make passwords
 * harder to remember without making them meaningfully harder to guess; a long one is what helps.
 * An upper bound stops a pasted novel from being hashed.
 */
export function validPassword(pw: string): boolean {
  return typeof pw === 'string' && pw.length >= PASSWORD_MIN && pw.length <= 256;
}

export const fail = (error: AuthErrorCode, message: string): AuthResult => ({ ok: false, error, message });
