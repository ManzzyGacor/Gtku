/**
 * Entry point.
 *
 * Deliberately tiny, and deliberately ordered:
 *
 *  1. the error overlay, so a failure in anything below is visible rather than a black screen;
 *  2. the debug overlay (settings, FPS), which is renderer-neutral and works while paused;
 *  3. the **title screen**, which lives in this chunk so it appears after ~20 kB instead of after
 *     the 730 kB the 3D renderer weighs;
 *  4. the renderer itself, fetched *while the title is on screen* and awaited only once the player
 *     has chosen. On a phone on mobile data that is the difference between a black screen for two
 *     seconds and a title screen straight away.
 *
 * The 2D (Phaser) renderer was removed once every one of its features had moved across — see the
 * inventory in docs/PROGRESS.md and the tag `v0.2-2d-final` if any of it is ever needed again.
 */
import { installErrorOverlay, recordError } from './core/errors';
import { safeInsets } from './ui/safearea';
import { ensureDebugUi } from './ui/DebugUi';
import { TitleScreen } from './ui/TitleScreen';
import { fullscreen } from './ui/fullscreen';
import { browserAuthDeps, LocalAuth } from './core/account/local';
import { RemoteAuth, type HttpFetch } from './core/account/remote';
import type { AccountSession, AuthAdapter } from './core/account/auth';
import { adoptSave, loadGame, setSaveMirror } from './core/save';
import { readRaw, writeRaw, removeRaw } from './core/storage';
import { connectCloud, makeDevServer } from './cloud';
import type { DevServer } from './render3d/DevTools';
import type { SaveSync } from './core/sync/saveSync';
import type { CoopAccess } from './render3d/Game3D';
import type { SaveData } from './core/state/GameState';

/**
 * Where accounts live: the Lentera Malam server (`server/`, docs/BACKEND.md) at api.varesa.mom.
 * `VITE_API_URL` points a build elsewhere; `VITE_API_URL=local` keeps accounts on the phone (for
 * testing without a server — the register form then says so). The URL is all the client knows
 * about the server: no key, no secret.
 */
const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://api.varesa.mom';

const browserFetch: HttpFetch = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers ?? {}, body: init.body ?? null, credentials: init.credentials, signal: init.signal ?? null });

let remote: RemoteAuth | null = null;

function makeAuth(): AuthAdapter | null {
  if (API_URL !== 'local') {
    remote = new RemoteAuth({
      base: API_URL.replace(/\/$/, ''),
      fetch: browserFetch,
      now: () => Date.now(),
      read: (k) => readRaw(k),
      write: (k, v) => writeRaw(k, v),
      remove: (k) => removeRaw(k),
    });
    return remote;
  }
  const deps = browserAuthDeps();
  // local accounts (tests without a server) are always players: only a server can grant a role
  return deps ? new LocalAuth(deps) : null;
}

/**
 * The developer panel's line to the server, when — and only when — the server said this account's
 * role is "dev" in this session. A role cached in storage never counts; neither does the name.
 */
let devServer: DevServer | undefined;
let cloudSync: SaveSync | undefined;
let coopAccess: CoopAccess | undefined;

/** A save the server wrote (developer grant, co-op loot): the truth on this phone and for the next sync. */
function serverSave(save: { data: SaveData; rev: number }): void {
  adoptSave(save.data);
  if (cloudSync) cloudSync.rev = save.rev;
}

async function onAccount(session: AccountSession | null): Promise<void | string> {
  setSaveMirror(null);
  devServer = undefined;
  cloudSync = undefined;
  coopAccess = undefined;
  if (!session || session.kind === 'local' || !remote) return undefined;
  const result = await connectCloud(remote, session, {
    loadLocal: () => loadGame(),
    adopt: (data) => void adoptSave(data),
    mirror: (fn) => setSaveMirror(fn),
    backup: (id, data) => void writeRaw(`lentera-malam/save-backup@${id}`, JSON.stringify(data)),
    notice: (text) => cloudNotice(text),
    every: (ms, fn) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    },
    onOnline: (fn) => window.addEventListener('online', fn),
    onHide: (fn) => window.addEventListener('pagehide', fn),
    now: () => Date.now(),
  });
  cloudSync = result.sync;
  if (result.role === 'dev') devServer = makeDevServer(remote, serverSave);
  const auth = remote;
  // co-op rides the same server: wss://api.varesa.mom/ws, the token in the first message
  coopAccess = {
    url: `${API_URL.replace(/\/$/, '').replace(/^http/, 'ws')}/ws`,
    token: async () => {
      const t = await auth.token();
      return t === 'offline' || t === 'logged-out' ? null : t;
    },
    developer: result.role === 'dev',
    onServerSave: serverSave,
    flush: async () => {
      await cloudSync?.tick(performance.now() / 1000, true);
    },
  };
  return result.relogin;
}

/** A line at the top of the screen for what sync cannot fix by itself. */
function cloudNotice(text: string): void {
  const box = document.createElement('div');
  box.textContent = text;
  Object.assign(box.style, {
    position: 'fixed', left: '50%', top: 'calc(46px + var(--lm-sat, 0px))', transform: 'translateX(-50%)', zIndex: '95',
    padding: '8px 12px', borderRadius: '6px', background: 'rgba(70,44,10,0.92)', color: '#ffe0a8', font: '12px ui-monospace, monospace',
    border: '1px solid rgba(255,176,74,0.6)', maxWidth: '86vw', textAlign: 'center', pointerEvents: 'none',
  });
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 9000);
}

installErrorOverlay();
// Resolve the notch/rounded-corner insets once, up front: every panel's CSS reads the custom
// properties this installs, and the touch controls read the numbers.
safeInsets();

// The settings menu, FPS counter and error panel live outside the canvas so they keep working
// unchanged while the renderer underneath changes (docs/OVERHAUL.md §7).
const debug = ensureDebugUi();

/** Drive the debug overlay from the page, not the game loop, so it also works while paused. */
function overlayFrame(now: number): void {
  debug.tick(now);
  requestAnimationFrame(overlayFrame);
}
requestAnimationFrame(overlayFrame);

const host = document.getElementById('game') ?? document.body;

async function boot(): Promise<void> {
  document.getElementById('boot-msg')?.remove();
  // turning the phone to landscape asks for fullscreen; a refusal shows the Layar Penuh button
  fullscreen().install();
  const title = new TitleScreen(document.body, {
    settings: () => debug.openSettings(),
    auth: makeAuth(),
    // a server account connects (bounded by a timeout) before the menu; a local one goes straight there
    account: (session) => (session?.kind === 'remote' ? onAccount(session) : void onAccount(session)),
    // the first tap is the gesture both of these need
    started: () => {
      void fullscreen().enter();
      void import('./core/audio').then(({ bus }) => bus.music('title', 2.5));
    },
  });
  // Start the download now, not after the tap: by the time anyone reads the menu it is usually in.
  const loading = import('./render3d/boot3d');
  /*
   * The 3D night fades in behind the menu once the renderer has arrived. It is thrown away before
   * the world is built, so the phone never holds two WebGL contexts at once.
   */
  let picked = false;
  let backdrop: { dispose(): void } | null = null;
  void loading
    .then((m) => {
      if (picked) return;
      backdrop = m.startTitleBackdrop(host);
      if (backdrop) title.setBackdrop(true);
    })
    .catch(() => undefined);
  const choice = await title.choice();
  picked = true;
  title.setBusy('Menyiapkan dunia…');
  try {
    const { startWorld } = await loading;
    title.setBackdrop(false);
    (backdrop as { dispose(): void } | null)?.dispose();
    backdrop = null;
    (window as unknown as { __game3d: unknown }).__game3d = startWorld(host, debug, choice.continueGame, { devServer, coop: coopAccess });
  } catch (e) {
    /*
     * Show what actually failed.
     *
     * The first version said only "Gagal memuat. Muat ulang halaman." — which is useless on a
     * phone, where there is no console to open, and it hid a real crash inside the world's
     * constructor for a whole release. The message and the first line of the stack go on screen,
     * and into the error ring so "Salin laporan" carries them too.
     */
    const err = e as Error;
    recordError(String(err?.stack ?? err?.message ?? e), 'boot');
    const where = String(err?.stack ?? '').split('\n')[1]?.trim() ?? '';
    title.setBusy(`Gagal memuat:\n${err?.message ?? String(e)}\n${where}\n\nMuat ulang halaman, atau kirim laporan dari menu Pengaturan.`);
    return;
  }
  title.close();
}

void boot();
