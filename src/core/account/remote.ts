/**
 * Accounts on a server (docs/BACKEND.md). Not active until a build is given `VITE_API_URL`.
 *
 * **The client holds no secret.** Login and register answer with an `HttpOnly; Secure;
 * SameSite=Strict` session cookie that JavaScript cannot read; every request after that simply sends
 * `credentials: 'include'`. What this file remembers locally is only *who* is logged in (id and
 * name, for the menu) — never a token, never the password. There is no API key in the bundle: the
 * API is public, and it is the session cookie that decides what a request may touch.
 *
 * `fetch` is injected, so the whole contract is tested against an in-memory fake of the API.
 */
import { fail, normalizeUsername, PASSWORD_RULE, USERNAME_RULE, validPassword, validUsername, type AccountSession, type AuthAdapter, type AuthResult } from './auth';

export const REMOTE_SESSION_KEY = 'lentera-malam/session-remote/v1';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type HttpFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; credentials: 'include' }) => Promise<HttpResponse>;

export interface RemoteAuthDeps {
  /** Base URL of the API, e.g. `https://game.varesa.mom/api`. */
  base: string;
  fetch: HttpFetch;
  now(): number;
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
}

/** The server's error codes (docs/BACKEND.md "Galat") mapped to what the screens say. */
const SERVER_ERRORS: Record<string, { code: Parameters<typeof fail>[0]; message: string }> = {
  username_taken: { code: 'nama-dipakai', message: 'Nama akun itu sudah dipakai. Pilih nama lain.' },
  invalid_username: { code: 'nama-tidak-sah', message: USERNAME_RULE },
  weak_password: { code: 'sandi-lemah', message: PASSWORD_RULE },
  invalid_credentials: { code: 'salah', message: 'Nama akun atau kata sandi salah.' },
  rate_limited: { code: 'terkunci', message: 'Terlalu banyak percobaan. Coba lagi sebentar lagi.' },
};

export class RemoteAuth implements AuthAdapter {
  readonly kind = 'remote' as const;

  constructor(private readonly deps: RemoteAuthDeps) {}

  private async post(path: string, body: unknown): Promise<AuthResult> {
    let res: HttpResponse;
    try {
      res = await this.deps.fetch(`${this.deps.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
    } catch {
      return fail('jaringan', 'Tidak bisa menghubungi server. Periksa koneksi internetmu.');
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const o = (data ?? {}) as { user?: { id?: unknown; name?: unknown }; error?: unknown };
    if (!res.ok) {
      const known = typeof o.error === 'string' ? SERVER_ERRORS[o.error] : undefined;
      return known ? fail(known.code, known.message) : fail('server', `Server menolak permintaan (kode ${res.status}).`);
    }
    if (typeof o.user?.id !== 'string' || typeof o.user.name !== 'string') return fail('server', 'Jawaban server tidak dikenali.');
    const session: AccountSession = { id: o.user.id, name: o.user.name, kind: 'remote', since: this.deps.now() };
    // who, not how: the cookie is the credential, and the page never sees it
    this.deps.write(REMOTE_SESSION_KEY, JSON.stringify(session));
    return { ok: true, session };
  }

  async register(username: string, password: string, email?: string): Promise<AuthResult> {
    const name = normalizeUsername(username);
    if (!validUsername(name)) return fail('nama-tidak-sah', USERNAME_RULE);
    if (!validPassword(password)) return fail('sandi-lemah', PASSWORD_RULE);
    const body: Record<string, string> = { username: name, password };
    if (email && email.trim()) body.email = email.trim();
    return this.post('/v1/auth/register', body);
  }

  async login(username: string, password: string): Promise<AuthResult> {
    return this.post('/v1/auth/login', { username: normalizeUsername(username), password: String(password ?? '') });
  }

  async logout(): Promise<void> {
    this.deps.remove(REMOTE_SESSION_KEY);
    try {
      await this.deps.fetch(`${this.deps.base}/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* offline: the cookie expires on its own, and this device has already forgotten the session */
    }
  }

  current(): AccountSession | null {
    try {
      const raw = this.deps.read(REMOTE_SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<AccountSession>;
      return typeof s.id === 'string' && typeof s.name === 'string' ? { id: s.id, name: s.name, kind: 'remote', since: typeof s.since === 'number' ? s.since : 0 } : null;
    } catch {
      return null;
    }
  }
}
