/**
 * Connecting a logged-in server account: who the server says this is, the save, and the sync.
 *
 * Runs between the login form and the main menu. It is **bounded**: whatever the network does, the
 * menu appears within `CONNECT_TIMEOUT_MS`. Offline is not an error — the game plays from the save
 * cached on this phone and syncs when the connection is back. Only a session the server has ended
 * sends the player back to the login form, with a message saying so.
 *
 * Dependencies are injected, so `tests/backend.test.ts` runs this against the real server app.
 */
import { API_ERROR_TEXT, type UserRole } from '../shared/api';
import type { DevServer } from './render3d/DevTools';
import type { AccountSession } from './core/account/auth';
import type { RemoteAuth } from './core/account/remote';
import { RemoteSaveStore, SaveSync } from './core/sync/saveSync';
import type { SaveData } from './core/state/GameState';

export const CONNECT_TIMEOUT_MS = 8000;

export interface CloudDeps {
  loadLocal(): SaveData | null;
  /** Replace the local save with the server's, without echoing it back up. */
  adopt(data: unknown): void;
  /** Every local save is handed here from now on (null to stop). */
  mirror(fn: ((data: SaveData) => void) | null): void;
  backup(accountId: string, data: unknown): void;
  notice(text: string): void;
  /** Schedule the periodic push; returns a stop function. */
  every(ms: number, fn: () => void): () => void;
  /** Called when the browser comes back online / the page is being hidden. */
  onOnline(fn: () => void): void;
  onHide(fn: () => void): void;
  now(): number;
}

export interface CloudResult {
  /** The role the server gave this account *just now*; null offline (no developer mode then). */
  role: UserRole | null;
  offline: boolean;
  /** Set when the server ended the session: the title goes back to the login form with this. */
  relogin?: string | undefined;
  sync?: SaveSync | undefined;
}

const OFFLINE_NOTE = 'Server tidak bisa dihubungi — kamu main dari save di HP ini. Progres disinkronkan otomatis saat online lagi.';

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

export async function connectCloud(auth: RemoteAuth, session: AccountSession, deps: CloudDeps, timeoutMs = CONNECT_TIMEOUT_MS): Promise<CloudResult> {
  deps.mirror(null);
  const me = await withTimeout(auth.me(), timeoutMs, 'offline' as const);
  if (me === 'logged-out') {
    await auth.logout();
    return { role: null, offline: false, relogin: 'Sesi akunmu sudah berakhir. Silakan masuk lagi.' };
  }

  const sync = new SaveSync(new RemoteSaveStore(auth), {
    backup: (data) => deps.backup(session.id, data),
    remoteWon: () => deps.notice('Progres dari perangkat lain lebih jauh. Muat ulang halaman untuk memakainya.'),
    loggedOut: () => deps.notice('Sesi akun berakhir. Muat ulang dan masuk lagi supaya progres tersinkron.'),
    rejected: (_reason, detail) => deps.notice(`Save ditolak server (${detail || 'isinya tidak wajar'}). Progres ini hanya tersimpan di HP.`),
  });
  // local first, always: from here on every save on this phone is also queued for the server
  deps.mirror((data) => sync.queue(data, deps.now()));
  const push = (force: boolean): void => void sync.tick(deps.now() / 1000, force);
  deps.every(5000, () => push(false));
  deps.onOnline(() => push(true));
  deps.onHide(() => push(true));

  if (me === 'offline') {
    deps.notice(OFFLINE_NOTE);
    return { role: null, offline: true, sync };
  }

  const local = deps.loadLocal();
  const newer = await withTimeout(sync.reconcile(local), timeoutMs, null);
  if (newer) deps.adopt(newer);
  return { role: me.role, offline: false, sync };
}

/**
 * The developer panel's line to the server: `POST /dev/action` with the account's token. Built only
 * after the server has said the role is "dev" in this session. A grant's reply carries the server's
 * new save, which `onSave` makes the truth on this phone.
 */
export function makeDevServer(auth: RemoteAuth, onSave: (save: { data: SaveData; rev: number }) => void): DevServer {
  return {
    act: async (action, save) => {
      const r = await auth.authed('/dev/action', 'POST', save ? { action, save } : { action });
      if (r === 'logged-out') return { ok: false, message: 'Sesi berakhir. Masuk lagi.' };
      if (!r.ok) {
        if (r.error === 'offline') return { ok: false, message: 'Server tidak bisa dihubungi.' };
        const msg = (r.body as { message?: unknown } | null)?.message;
        return { ok: false, message: typeof msg === 'string' ? msg : (API_ERROR_TEXT[r.error] ?? 'Ditolak server.') };
      }
      const body = r.body as { note?: string; save?: { data: SaveData; rev: number } | null };
      if (body.save) onSave(body.save);
      return { ok: true, note: body.note, save: body.save };
    },
  };
}
