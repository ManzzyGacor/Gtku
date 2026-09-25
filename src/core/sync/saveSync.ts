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
import type { RemoteAuth } from '../account/remote';

export interface RemoteSave {
  data: unknown;
  rev: number;
  /** Server time of the last write, epoch ms: the tie-breaker when two saves are equally far along. */
  updatedAt: number;
}

export type PushResult = { ok: true; rev: number } | { ok: false; conflict: RemoteSave } | { ok: false; offline: true } | { ok: false; unauthorized: true };

export interface SaveStore {
  pull(): Promise<RemoteSave | null | 'offline' | 'unauthorized'>;
  push(data: unknown, baseRev: number, clientUpdatedAt: number): Promise<PushResult>;
}

/** `GET/PUT /save` on the server, through the account's access token (refreshed as needed). */
export class RemoteSaveStore implements SaveStore {
  constructor(private readonly auth: Pick<RemoteAuth, 'authed'>) {}

  async pull(): Promise<RemoteSave | null | 'offline' | 'unauthorized'> {
    const r = await this.auth.authed('/save', 'GET');
    if (r === 'logged-out') return 'unauthorized';
    if (r.ok) return r.status === 204 ? null : asRemote(r.body);
    return 'offline';
  }

  async push(data: unknown, baseRev: number, clientUpdatedAt: number): Promise<PushResult> {
    const r = await this.auth.authed('/save', 'PUT', { data, baseRev, clientUpdatedAt });
    if (r === 'logged-out') return { ok: false, unauthorized: true };
    if (r.ok) {
      const rev = (r.body as { rev?: unknown } | null)?.rev;
      return typeof rev === 'number' ? { ok: true, rev } : { ok: false, offline: true };
    }
    if (r.status === 409) {
      const current = asRemote((r.body as { current?: unknown } | null)?.current);
      // "conflict" with nothing stored means it was deleted meanwhile: start again from rev 0
      return { ok: false, conflict: current ?? { data: null, rev: 0, updatedAt: 0 } };
    }
    // a refused save (too large, unknown version) is not something retrying fixes; keep it local
    return { ok: false, offline: true };
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

/**
 * The conflict rule, by *version* (the revision tells us there is a conflict) and *progress*, with
 * *time* only as the tie-breaker: more progress wins; equally far along, the later write wins
 * (`localAt` is when this phone saved, `remote.updatedAt` when the server accepted theirs). The
 * loser is the backup. Progress first because phone clocks drift; a clock is fine for a tie.
 */
export function resolveConflict(local: unknown, remote: RemoteSave, localAt = 0): { winner: 'local' | 'remote'; backup: unknown } {
  const l = progressScore(local);
  const r = progressScore(remote.data);
  const localWins = l > r || (l === r && localAt > remote.updatedAt);
  return localWins ? { winner: 'local', backup: remote.data } : { winner: 'remote', backup: local };
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
  /** When the pending save was written on this phone, epoch ms. */
  private pendingAt = 0;
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
  queue(data: unknown, at = Date.now()): void {
    this.pending = data;
    this.pendingAt = at;
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
    const at = this.pendingAt;
    this.pending = undefined;
    this.inflight = true;
    try {
      const res = await this.store.push(data, this.rev, at);
      if (res.ok) {
        this.rev = res.rev;
        return;
      }
      if ('offline' in res) {
        this.offlineCount++;
        // keep it for the next try, unless something newer arrived meanwhile
        if (this.pending === undefined) this.queue(data, at);
        return;
      }
      if ('unauthorized' in res) {
        if (this.pending === undefined) this.queue(data, at);
        this.hooks.loggedOut();
        return;
      }
      const verdict = resolveConflict(data, res.conflict, at);
      if (res.conflict.data !== null) this.hooks.backup(verdict.backup);
      if (verdict.winner === 'local' || res.conflict.data === null) {
        // ours is further along (or theirs is gone): write it over theirs, based on their revision
        this.rev = res.conflict.rev;
        if (this.pending === undefined) this.queue(data, at);
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
  async reconcile(local: unknown, localAt = 0): Promise<unknown> {
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
    const verdict = resolveConflict(local, remote, localAt);
    this.hooks.backup(verdict.backup);
    if (verdict.winner === 'remote') return remote.data;
    this.queue(local, localAt);
    return null;
  }
}
