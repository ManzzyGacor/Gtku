/**
 * Accounts on the Lentera Malam server (`server/`, docs/BACKEND.md), behind the same `AuthAdapter`
 * the local accounts use — so the game, the title screen and every test that runs without a server
 * keep working unchanged.
 *
 * **Where the credentials live.**
 *  • The **access token** (15 minutes) is kept **in memory only** — a variable in this object. It
 *    is never written to localStorage, so a script that manages to read storage finds nothing.
 *  • The **refresh token** (30 days) is an `HttpOnly; Secure; SameSite=Strict` cookie on
 *    api.varesa.mom. JavaScript cannot read it at all; the browser sends it to `/auth/refresh`.
 *  • localStorage keeps only *who* was logged in (name, role) so the title can go straight to the
 *    menu, and so the game can be played offline from the local save.
 *
 * **Never frozen.** Every request has a timeout. A server that cannot be reached is reported as
 * such ("Server tidak bisa dihubungi…"), not as a wrong password, and never leaves a spinner up.
 */
import { API_ERROR_TEXT, type ApiErrorCode, type AuthResponse, type PublicUser } from '../../../shared/api';
import { fail, PASSWORD_RULE, USERNAME_RULE, validPassword, validUsername, type AccountSession, type AuthAdapter, type AuthResult } from './auth';

export const REMOTE_SESSION_KEY = 'lentera-malam/session-remote/v2';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type HttpFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; credentials: 'include'; signal?: AbortSignal | undefined },
) => Promise<HttpResponse>;

export interface RemoteAuthDeps {
  /** Base URL of the API, e.g. `https://api.varesa.mom`. */
  base: string;
  fetch: HttpFetch;
  now(): number;
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** Milliseconds before a request is given up on. */
  timeoutMs?: number | undefined;
}

export const UNREACHABLE = 'Server tidak bisa dihubungi. Periksa koneksi internetmu, lalu coba lagi.';

/** Server error codes → what the form's error codes are. */
const CODE: Partial<Record<ApiErrorCode, Parameters<typeof fail>[0]>> = {
  username_taken: 'nama-dipakai',
  invalid_username: 'nama-tidak-sah',
  weak_password: 'sandi-lemah',
  invalid_credentials: 'salah',
  rate_limited: 'terkunci',
  username_reserved: 'dicadangkan',
};

type Call = { ok: true; status: number; body: unknown } | { ok: false; status: number; error: ApiErrorCode | 'offline'; body: unknown };

export class RemoteAuth implements AuthAdapter {
  readonly kind = 'remote' as const;
  /** The access token: memory only. */
  private access: { token: string; expiresAt: number } | null = null;
  private refreshing: Promise<boolean | 'offline'> | null = null;

  constructor(private readonly deps: RemoteAuthDeps) {}

  /** One request with a timeout; never throws. */
  async call(path: string, method: string, body?: unknown, auth = false): Promise<Call> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.access) headers.Authorization = `Bearer ${this.access.token}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.deps.timeoutMs ?? 10_000) : null;
    try {
      const init: Parameters<HttpFetch>[1] = { method, headers, credentials: 'include', signal: ctrl?.signal };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await this.deps.fetch(`${this.deps.base}${path}`, init);
      let data: unknown = null;
      if (res.status !== 204) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }
      if (res.ok) return { ok: true, status: res.status, body: data };
      const err = (data as { error?: unknown } | null)?.error;
      return { ok: false, status: res.status, error: typeof err === 'string' ? (err as ApiErrorCode) : 'server_error', body: data };
    } catch {
      return { ok: false, status: 0, error: 'offline', body: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private accept(res: AuthResponse): AccountSession {
    this.access = { token: res.accessToken, expiresAt: this.deps.now() + res.expiresIn * 1000 };
    return this.remember(res.user);
  }

  private remember(user: PublicUser): AccountSession {
    const session: AccountSession = { id: user.username.toLowerCase(), name: user.username, role: user.role, kind: 'remote', since: this.deps.now() };
    // who, never how: no token goes to storage
    this.deps.write(REMOTE_SESSION_KEY, JSON.stringify({ id: session.id, name: session.name, role: session.role, since: session.since }));
    return session;
  }

  private toResult(r: Call): AuthResult {
    if (r.ok) {
      const b = r.body as Partial<AuthResponse> | null;
      if (!b || typeof b.accessToken !== 'string' || !b.user || typeof b.user.username !== 'string') return fail('server', 'Jawaban server tidak dikenali.');
      return { ok: true, session: this.accept(b as AuthResponse) };
    }
    if (r.error === 'offline') return fail('jaringan', UNREACHABLE);
    const code = CODE[r.error];
    const text = API_ERROR_TEXT[r.error] ?? `Server menolak permintaan (kode ${r.status}).`;
    return fail(code ?? 'server', text);
  }

  async register(username: string, password: string, email?: string): Promise<AuthResult> {
    const name = String(username ?? '').trim();
    if (!validUsername(name)) return fail('nama-tidak-sah', USERNAME_RULE);
    if (!validPassword(password)) return fail('sandi-lemah', PASSWORD_RULE);
    const body: Record<string, string> = { username: name, password };
    if (email && email.trim()) body.email = email.trim();
    return this.toResult(await this.call('/auth/register', 'POST', body));
  }

  async login(username: string, password: string): Promise<AuthResult> {
    return this.toResult(await this.call('/auth/login', 'POST', { username: String(username ?? '').trim(), password: String(password ?? '') }));
  }

  async logout(): Promise<void> {
    this.access = null;
    this.deps.remove(REMOTE_SESSION_KEY);
    // offline: the cookie is revoked next time, and this device has already forgotten the session
    await this.call('/auth/logout', 'POST');
  }

  current(): AccountSession | null {
    try {
      const raw = this.deps.read(REMOTE_SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<AccountSession>;
      if (typeof s.id !== 'string' || typeof s.name !== 'string') return null;
      return { id: s.id, name: s.name, role: s.role === 'dev' ? 'dev' : 'player', kind: 'remote', since: typeof s.since === 'number' ? s.since : 0 };
    } catch {
      return null;
    }
  }

  async checkUsername(username: string): Promise<{ available: boolean; message: string }> {
    const name = String(username ?? '').trim();
    if (!validUsername(name)) return { available: false, message: USERNAME_RULE };
    const r = await this.call(`/auth/check-username?username=${encodeURIComponent(name)}`, 'GET');
    if (!r.ok) return { available: false, message: r.error === 'offline' ? UNREACHABLE : API_ERROR_TEXT[r.error] ?? 'Tidak bisa memeriksa nama.' };
    const b = r.body as { available?: boolean; reason?: ApiErrorCode };
    return b.available ? { available: true, message: 'Nama tersedia.' } : { available: false, message: (b.reason && API_ERROR_TEXT[b.reason]) || 'Nama tidak tersedia.' };
  }

  /**
   * A valid access token, refreshing through the cookie when it is missing or about to expire.
   * 'offline' when the server cannot be reached (play on from the local save), 'logged-out' when
   * the server says the session is over.
   */
  async token(): Promise<string | 'offline' | 'logged-out'> {
    if (this.access && this.access.expiresAt - this.deps.now() > 30_000) return this.access.token;
    const ok = await this.refresh();
    if (ok === 'offline') return 'offline';
    return ok && this.access ? this.access.token : 'logged-out';
  }

  /** Trade the refresh cookie for a new access token (one at a time; concurrent callers share it). */
  async refresh(): Promise<boolean | 'offline'> {
    if (!this.refreshing) {
      this.refreshing = this.call('/auth/refresh', 'POST').then((r): boolean | 'offline' => {
        if (r.ok) {
          this.accept(r.body as AuthResponse);
          return true;
        }
        if (r.error === 'offline') return 'offline';
        // the server ended it (expired, revoked, logged out elsewhere)
        this.access = null;
        return false;
      });
    }
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  /** The server's current word on who this is (role included), or why not. */
  async me(): Promise<PublicUser | 'offline' | 'logged-out'> {
    const t = await this.token();
    if (t === 'offline' || t === 'logged-out') return t;
    const r = await this.call('/auth/me', 'GET', undefined, true);
    if (r.ok) {
      const user = r.body as PublicUser;
      this.remember(user);
      return user;
    }
    return r.error === 'offline' ? 'offline' : 'logged-out';
  }

  /** For the save sync: a request with the access token, retried once after a refresh on 401. */
  async authed(path: string, method: string, body?: unknown): Promise<Call | 'logged-out'> {
    const t = await this.token();
    if (t === 'offline') return { ok: false, status: 0, error: 'offline', body: null };
    if (t === 'logged-out') return 'logged-out';
    let r = await this.call(path, method, body, true);
    if (!r.ok && r.status === 401) {
      const again = await this.refresh();
      if (again !== true) return again === 'offline' ? { ok: false, status: 0, error: 'offline', body: null } : 'logged-out';
      r = await this.call(path, method, body, true);
      if (!r.ok && r.status === 401) return 'logged-out';
    }
    return r;
  }
}
