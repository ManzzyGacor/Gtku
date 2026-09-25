/**
 * Save sync with a server (docs/BACKEND.md). Inactive until a build has `VITE_API_URL` and the
 * player logs in to a remote account.
 *
 * **Local first, always.** The game keeps writing its save to this phone exactly as before; sync is
 * a mirror behind it. No save ever waits on the network, and playing offline loses nothing — the
 * next push carries the newest state.
 *
 * **Revisions, not timestamps.** Every save on the server has a revision number. A push says which
 * revision it was based on; if the server has moved on (another phone), it answers 409 with its
 * copy, and `resolveConflict` decides — by *progress*, not by clock, because phone clocks lie. The
 * losing copy is never thrown away: it is kept as a backup.
 *
 * Pure apart from the injected `fetch`; the clock is passed in, so tests drive it frame by frame.
 */
import type { HttpFetch } from '../account/remote';

export interface RemoteSave {
  data: unknown;
  rev: number;
  /** Server time of the last write, epoch ms (for display only — never for deciding). */
  updatedAt: number;
}

export type PushResult = { ok: true; rev: number } | { ok: false; conflict: RemoteSave } | { ok: false; offline: true } | { ok: false; unauthorized: true };

export interface SaveStore {
  pull(): Promise<RemoteSave | null | 'offline' | 'unauthorized'>;
  push(data: unknown, baseRev: number): Promise<PushResult>;
}

/** GET/PUT `/v1/save`, with the session cookie. */
export class RemoteSaveStore implements SaveStore {
  constructor(
    private readonly base: string,
    private readonly fetch: HttpFetch,
  ) {}

  async pull(): Promise<RemoteSave | null | 'offline' | 'unauthorized'> {
    try {
      const res = await this.fetch(`${this.base}/v1/save`, { method: 'GET', credentials: 'include' });
      if (res.status === 204 || res.status === 404) return null;
      if (res.status === 401) return 'unauthorized';
      if (!res.ok) return 'offline';
      return asRemote(await res.json());
    } catch {
      return 'offline';
    }
  }

  async push(data: unknown, baseRev: number): Promise<PushResult> {
    try {
      const res = await this.fetch(`${this.base}/v1/save`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, baseRev }),
        credentials: 'include',
      });
      const body = (await res.json().catch(() => null)) as { rev?: unknown; current?: unknown } | null;
      if (res.status === 409) {
        const current = asRemote(body?.current);
        return current ? { ok: false, conflict: current } : { ok: false, offline: true };
      }
      if (res.status === 401) return { ok: false, unauthorized: true };
      if (!res.ok || typeof body?.rev !== 'number') return { ok: false, offline: true };
      return { ok: true, rev: body.rev };
    } catch {
      return { ok: false, offline: true };
    }
  }
}

function asRemote(v: unknown): RemoteSave | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<RemoteSave>;
  if (typeof o.rev !== 'number' || !Number.isFinite(o.rev) || o.data === undefined) return null;
  return { data: o.data, rev: o.rev, updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0 };
}

/** A finite number, or 0. */
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * How far along a save is. The main quest dominates, then the level, then play time — so a save
 * that beat the boss always beats one that did not, whichever phone wrote it last.
 */
export function progressScore(save: unknown): number {
  if (!save || typeof save !== 'object') return -1;
  const s = save as { quest?: { stage?: unknown }; bossDefeated?: unknown; character?: { level?: unknown; exp?: unknown }; worldTime?: unknown };
  return (
    (s.bossDefeated === true ? 1 : 0) * 1e12 + n(s.quest?.stage) * 1e10 + n(s.character?.level) * 1e7 + Math.min(9e6, n(s.character?.exp)) + Math.min(1e6, n(s.worldTime)) / 1e7
  );
}

/** The conflict rule: more progress wins; the other copy is the backup. Ties go to the server. */
export function resolveConflict(local: unknown, remote: RemoteSave): { winner: 'local' | 'remote'; backup: unknown } {
  return progressScore(local) > progressScore(remote.data) ? { winner: 'local', backup: remote.data } : { winner: 'remote', backup: local };
}

export interface SaveSyncHooks {
  /** The server's copy won a conflict: the game should load it (the local one is in `backup`). */
  remoteWon(remote: RemoteSave): void;
  /** Keep a losing copy somewhere the player can get it back from. */
  backup(data: unknown): void;
  /** The session expired: log in again. */
  loggedOut(): void;
}

/** Seconds between pushes while playing: a save every few seconds must not become a request each. */
export const PUSH_EVERY = 20;

export class SaveSync {
  /** Revision the local save was last in step with. */
  rev = 0;
  private pending: unknown = undefined;
  private lastPush = -Infinity;
  private inflight = false;
  /** Pushes that failed for lack of network, for the report. */
  offlineCount = 0;
  /** Set when the server's copy won mid-game: nothing is pushed until the page reloads and loads it. */
  paused = false;

  constructor(
    private readonly store: SaveStore,
    private readonly hooks: SaveSyncHooks,
  ) {}

  /** A new local save exists; it goes up at the next opportunity. */
  queue(data: unknown): void {
    this.pending = data;
  }

  get hasPending(): boolean {
    return this.pending !== undefined;
  }

  /** Call every so often with the clock (seconds). Pushes when due; `force` ignores the interval. */
  async tick(now: number, force = false): Promise<void> {
    if (this.paused || this.inflight || this.pending === undefined) return;
    if (!force && now - this.lastPush < PUSH_EVERY) return;
    this.lastPush = now;
    const data = this.pending;
    this.pending = undefined;
    this.inflight = true;
    try {
      const res = await this.store.push(data, this.rev);
      if (res.ok) {
        this.rev = res.rev;
        return;
      }
      if ('offline' in res) {
        this.offlineCount++;
        // keep it for the next try, unless something newer arrived meanwhile
        if (this.pending === undefined) this.pending = data;
        return;
      }
      if ('unauthorized' in res) {
        this.pending = this.pending ?? data;
        this.hooks.loggedOut();
        return;
      }
      const verdict = resolveConflict(data, res.conflict);
      this.hooks.backup(verdict.backup);
      if (verdict.winner === 'local') {
        // ours is further along: write it over theirs, based on their revision
        this.rev = res.conflict.rev;
        this.pending = this.pending ?? data;
        this.lastPush = -Infinity;
      } else {
        this.rev = res.conflict.rev;
        this.pending = undefined;
        this.paused = true;
        this.hooks.remoteWon(res.conflict);
      }
    } finally {
      this.inflight = false;
    }
  }

  /**
   * On login: fetch the server's copy and decide against the local one. Returns the save the game
   * should start from (or null to keep the local one as it is).
   */
  async reconcile(local: unknown): Promise<unknown> {
    const remote = await this.store.pull();
    if (remote === 'offline') return null;
    if (remote === 'unauthorized') {
      this.hooks.loggedOut();
      return null;
    }
    if (remote === null) {
      // a new account on the server: this phone's progress is the first save
      if (local) this.queue(local);
      return null;
    }
    this.rev = remote.rev;
    if (!local) return remote.data;
    const verdict = resolveConflict(local, remote);
    this.hooks.backup(verdict.backup);
    if (verdict.winner === 'remote') return remote.data;
    this.queue(local);
    return null;
  }
}
