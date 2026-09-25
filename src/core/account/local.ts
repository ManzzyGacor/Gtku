/**
 * Accounts stored on this device only (until the backend of Batch 7 exists).
 *
 * **What this is not.** It is not security against anyone holding the phone: the accounts live in
 * the browser's storage, which the owner of the device can read, edit or wipe. The register screen
 * says exactly that. What it *does* do properly:
 *
 *  • **the password is never stored.** Only a salted PBKDF2-SHA-256 hash (Web Crypto, 310 000
 *    iterations, 16-byte random salt per account). People reuse passwords; a plaintext one in
 *    localStorage would leak their password for everything else to anyone who opened the dev tools.
 *  • **the comparison is constant-time**, and repeated failures back off (in memory, per name).
 *  • **each account has its own save** (see `core/save.ts` `setSaveScope`), so two people sharing a
 *    phone do not overwrite each other.
 *
 * Crypto and storage are injected, so the whole thing runs in a test.
 */
import { readRaw, writeRaw, removeRaw } from '../storage';
import { fail, normalizeUsername, PASSWORD_RULE, USERNAME_RULE, validPassword, validUsername, type AccountSession, type AuthAdapter, type AuthResult } from './auth';

export const ACCOUNTS_KEY = 'lentera-malam/accounts/v1';
export const SESSION_KEY = 'lentera-malam/session/v1';
export const PBKDF2_ITERATIONS = 310_000;

interface StoredAccount {
  name: string;
  salt: string;
  hash: string;
  iter: number;
  created: number;
}

export interface LocalAuthDeps {
  subtle: SubtleCrypto;
  random(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
  now(): number;
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** Iterations for new accounts; tests lower it. Existing accounts keep their own. */
  iterations?: number | undefined;
}

export function browserAuthDeps(): LocalAuthDeps | null {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.getRandomValues !== 'function') return null;
  return {
    subtle: crypto.subtle,
    random: (b) => crypto.getRandomValues(b),
    now: () => Date.now(),
    read: (k) => readRaw(k),
    write: (k, v) => writeRaw(k, v),
    remove: (k) => removeRaw(k),
  };
}

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Equal-length comparison that does not stop at the first difference. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export class LocalAuth implements AuthAdapter {
  readonly kind = 'local' as const;
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly deps: LocalAuthDeps) {}

  private accounts(): Record<string, StoredAccount> {
    try {
      const raw = this.deps.read(ACCOUNTS_KEY);
      const v = raw ? (JSON.parse(raw) as unknown) : {};
      return v && typeof v === 'object' ? (v as Record<string, StoredAccount>) : {};
    } catch {
      return {};
    }
  }

  private async derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await this.deps.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await this.deps.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
    return new Uint8Array(bits);
  }

  /** A local account is always a player: only the server grants a role, never a name. */
  private roleOf(_id: string): 'player' {
    return 'player';
  }

  async checkUsername(username: string): Promise<{ available: boolean; message: string }> {
    const id = normalizeUsername(username);
    if (!validUsername(id)) return { available: false, message: USERNAME_RULE };
    return this.accounts()[id] ? { available: false, message: 'Nama itu sudah terdaftar di HP ini.' } : { available: true, message: 'Nama tersedia.' };
  }

  private startSession(id: string, name: string): AccountSession {
    const session: AccountSession = { id, name, kind: 'local', role: this.roleOf(id), since: this.deps.now() };
    this.deps.write(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async register(username: string, password: string): Promise<AuthResult> {
    const id = normalizeUsername(username);
    if (!validUsername(id)) return fail('nama-tidak-sah', USERNAME_RULE);
    if (!validPassword(password)) return fail('sandi-lemah', PASSWORD_RULE);
    const all = this.accounts();
    if (all[id]) return fail('nama-dipakai', 'Nama akun itu sudah terdaftar di perangkat ini. Pilih nama lain, atau masuk.');
    const salt = this.deps.random(new Uint8Array(16));
    const iter = this.deps.iterations ?? PBKDF2_ITERATIONS;
    const hash = await this.derive(password, salt, iter);
    all[id] = { name: id, salt: b64(salt), hash: b64(hash), iter, created: this.deps.now() };
    if (!this.deps.write(ACCOUNTS_KEY, JSON.stringify(all))) return fail('penyimpanan', 'Browser menolak menyimpan akun (mode privat atau penyimpanan penuh).');
    return { ok: true, session: this.startSession(id, id) };
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const id = normalizeUsername(username);
    const now = this.deps.now();
    const f = this.failures.get(id);
    if (f && f.until > now) return fail('terkunci', `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((f.until - now) / 1000)} detik.`);
    const acc = this.accounts()[id];
    // the same work whether or not the account exists, so the answer's timing does not tell which
    const salt = acc ? unb64(acc.salt) : this.deps.random(new Uint8Array(16));
    const hash = await this.derive(String(password ?? ''), salt, acc?.iter ?? this.deps.iterations ?? PBKDF2_ITERATIONS);
    if (!acc || !sameBytes(hash, unb64(acc.hash))) {
      const count = (f?.count ?? 0) + 1;
      // five free tries, then 5 s, 10 s, 20 s… capped at five minutes
      const wait = count >= 5 ? Math.min(300_000, 5000 * 2 ** (count - 5)) : 0;
      this.failures.set(id, { count, until: now + wait });
      return fail('salah', 'Nama akun atau kata sandi salah.');
    }
    this.failures.delete(id);
    return { ok: true, session: this.startSession(id, acc.name) };
  }

  async logout(): Promise<void> {
    this.deps.remove(SESSION_KEY);
  }

  current(): AccountSession | null {
    try {
      const raw = this.deps.read(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<AccountSession>;
      if (typeof s.id !== 'string' || typeof s.name !== 'string' || !this.accounts()[s.id]) return null;
      return { id: s.id, name: s.name, kind: 'local', role: this.roleOf(s.id), since: typeof s.since === 'number' ? s.since : 0 };
    } catch {
      return null;
    }
  }
}
