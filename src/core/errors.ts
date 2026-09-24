/**
 * Error panel + error history.
 *
 * There are no devtools on a phone, so uncaught errors are shown on screen *and* kept in a small
 * ring buffer. The settings menu's "Salin laporan" button pastes that buffer into the report, which
 * is the only way a bug found on the device can reach the developer.
 */

export interface LoggedError {
  /** ms since page load, so the report shows when it happened relative to play time. */
  at: number;
  msg: string;
  where: string;
}

const MAX_KEPT = 12;
const log: LoggedError[] = [];
let listener: (() => void) | null = null;

const now = (): number => (typeof performance !== 'undefined' ? Math.round(performance.now()) : 0);

/** Record a problem we caught ourselves (a failed filter, a missing asset, a blocked API). */
export function recordError(msg: string, where = ''): void {
  const last = log[log.length - 1];
  if (last && last.msg === msg && last.where === where) return; // don't let one repeating error flood the buffer
  log.push({ at: now(), msg: String(msg).slice(0, 300), where });
  if (log.length > MAX_KEPT) log.shift();
  listener?.();
}

/** Newest last. */
export function recentErrors(): readonly LoggedError[] {
  return log;
}

export function clearErrors(): void {
  log.length = 0;
  listener?.();
}

/** Called whenever the log changes, so the HUD can show an "ada error" marker. */
export function onErrorLogged(fn: (() => void) | null): void {
  listener = fn;
}

/** Human-readable lines for the report / the settings menu. */
export function formatErrors(): string[] {
  return log.map((e) => `[${(e.at / 1000).toFixed(1)}s] ${e.where ? `${e.where}: ` : ''}${e.msg}`);
}

export function installErrorOverlay(): void {
  const el = typeof document !== 'undefined' ? document.getElementById('err') : null;

  const hide = (): void => {
    if (el) el.style.display = 'none';
  };
  // Registered once, with `once: false`, instead of reassigning `el.onclick` inside `show()`:
  // `show()` runs again on every error, so an assignment there would pile up work and could
  // silently replace whatever else was listening on the overlay.
  el?.addEventListener('click', hide);

  const show = (): void => {
    if (!el) return;
    el.style.display = 'block';
    el.textContent = `${[...formatErrors()].reverse().join('\n')}\n\n(ketuk untuk menutup)`;
  };

  const capture = (msg: string, where: string): void => {
    recordError(msg, where);
    show();
  };

  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => capture(e.message, `${e.filename?.split('/').pop() ?? '?'}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason as { stack?: string } | undefined;
    capture(String(r?.stack ?? r), 'promise');
  });
}
