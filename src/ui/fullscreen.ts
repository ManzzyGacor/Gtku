/**
 * Fullscreen and landscape, for a game played only on a phone held sideways.
 *
 * What the browsers allow, which decides the design:
 *
 *  • `requestFullscreen()` only works **inside a user gesture**. Rotating the phone is not one on
 *    most browsers, so "go fullscreen when the phone turns to landscape" is *attempted*, and when
 *    the browser refuses, a **Layar Penuh** button appears instead — a tap on it is a gesture.
 *    The title's "Sentuh untuk memulai" tap asks too, since it is the first gesture there is.
 *  • `screen.orientation.lock('landscape')` only works **while fullscreen**, and not at all on iOS.
 *    It is asked for right after entering, and a refusal is silent.
 *  • Entering or leaving fullscreen changes the viewport, sometimes a few hundred milliseconds
 *    after the event. Everything that sized itself to the window is told twice: at once, and again
 *    once Android has settled — the same treatment rotation gets in `core/lifecycle.ts`.
 *
 * DOM-only and injectable (`FullscreenTargets`), so the whole policy is tested without a browser.
 */
import { el, injectStyle, onTap } from './dom';

type Req = () => Promise<void> | void;

export interface FullscreenTargets {
  doc: {
    fullscreenElement?: Element | null;
    webkitFullscreenElement?: Element | null;
    documentElement: { requestFullscreen?: Req; webkitRequestFullscreen?: Req };
    exitFullscreen?: Req;
    webkitExitFullscreen?: Req;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
  win: { innerWidth: number; innerHeight: number; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void };
  orientation?: { lock?: (o: string) => Promise<void> } | undefined;
  later(fn: () => void, ms: number): void;
}

/** How long after a fullscreen change the viewport has usually settled. */
export const FULLSCREEN_SETTLE_MS = 350;

const CSS = `
/* above the title screen (90) so it can be tapped there, below everything opened from menus */
.lm-fsprompt { position: fixed; z-index: 91; left: 50%; transform: translateX(-50%);
  top: calc(6px + var(--lm-sat, 0px)); display: none; align-items: center; gap: 4px; pointer-events: auto;
  font: 12px/1 ui-monospace, monospace; }
.lm-fsprompt.on { display: flex; animation: lm-fs-in 260ms ease both; }
@keyframes lm-fs-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translateX(-50%); } }
.lm-fsprompt button { min-height: 38px; border-radius: 19px; cursor: pointer; touch-action: manipulation; font: inherit; }
.lm-fsprompt .go { padding: 0 16px; letter-spacing: 1px; color: #1a1430; background: #ffd98a; border: 1px solid #fff0c8; }
.lm-fsprompt .no { width: 38px; color: #b9b0d8; background: rgba(20,16,38,0.85); border: 1px solid #6a7094; }
`;

export class Fullscreen {
  private listeners = new Set<(active: boolean) => void>();
  private promptEl: HTMLDivElement | null = null;
  /** The player closed the prompt: leave them alone until the phone is turned again. */
  private dismissed = false;
  private wasLandscape: boolean;
  private installed = false;

  constructor(private readonly t: FullscreenTargets) {
    this.wasLandscape = this.landscape;
  }

  get supported(): boolean {
    const de = this.t.doc.documentElement;
    return typeof de.requestFullscreen === 'function' || typeof de.webkitRequestFullscreen === 'function';
  }

  get active(): boolean {
    return !!(this.t.doc.fullscreenElement ?? this.t.doc.webkitFullscreenElement);
  }

  get landscape(): boolean {
    return this.t.win.innerWidth > this.t.win.innerHeight;
  }

  /** Whether the Layar Penuh button is showing. */
  get prompting(): boolean {
    return !!this.promptEl?.classList.contains('on');
  }

  /** Called on every enter/exit (twice: at once, and after the viewport settles). */
  onChange(fn: (active: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ask for fullscreen, then for the landscape lock. True when fullscreen is on afterwards. */
  async enter(): Promise<boolean> {
    if (this.active) return true;
    const de = this.t.doc.documentElement;
    const req = de.requestFullscreen ?? de.webkitRequestFullscreen;
    if (!req) return false;
    try {
      await req.call(de);
    } catch {
      this.updatePrompt();
      return false;
    }
    try {
      await this.t.orientation?.lock?.('landscape');
    } catch {
      /* iOS, desktop, or a browser that only locks from an installed app: not an error */
    }
    this.updatePrompt();
    return this.active;
  }

  async exit(): Promise<void> {
    if (!this.active) return;
    const d = this.t.doc;
    const exit = d.exitFullscreen ?? d.webkitExitFullscreen;
    try {
      await exit?.call(d);
    } catch {
      /* already out */
    }
  }

  async toggle(): Promise<void> {
    if (this.active) await this.exit();
    else await this.enter();
  }

  /** Start watching: fullscreen changes, and the phone turning. */
  install(): this {
    if (this.installed) return this;
    this.installed = true;
    this.t.doc.addEventListener('fullscreenchange', this.changed);
    this.t.doc.addEventListener('webkitfullscreenchange', this.changed);
    this.t.win.addEventListener('resize', this.turned);
    this.t.win.addEventListener('orientationchange', this.turned);
    this.updatePrompt();
    return this;
  }

  dispose(): void {
    this.t.doc.removeEventListener('fullscreenchange', this.changed);
    this.t.doc.removeEventListener('webkitfullscreenchange', this.changed);
    this.t.win.removeEventListener('resize', this.turned);
    this.t.win.removeEventListener('orientationchange', this.turned);
    this.promptEl?.remove();
    this.promptEl = null;
    this.installed = false;
  }

  private changed = (): void => {
    const active = this.active;
    for (const fn of this.listeners) fn(active);
    this.t.later(() => {
      for (const fn of this.listeners) fn(this.active);
    }, FULLSCREEN_SETTLE_MS);
    this.updatePrompt();
  };

  /** Turned to landscape: try, and offer the button if the browser wants a tap first. */
  private turned = (): void => {
    const now = this.landscape;
    if (now === this.wasLandscape) return;
    this.wasLandscape = now;
    this.dismissed = false;
    if (now && !this.active && this.supported) void this.enter();
    this.updatePrompt();
  };

  private updatePrompt(): void {
    const want = this.supported && this.landscape && !this.active && !this.dismissed;
    if (want && !this.promptEl) this.buildPrompt();
    this.promptEl?.classList.toggle('on', want);
  }

  private buildPrompt(): void {
    if (typeof document === 'undefined') return;
    injectStyle('lm-ui-fs', CSS);
    const box = el('div');
    box.className = 'lm-fsprompt';
    const go = el('button', {}, '⛶ Layar Penuh');
    go.className = 'go';
    onTap(go, () => void this.enter());
    const no = el('button', {}, '✕');
    no.className = 'no';
    no.setAttribute('aria-label', 'Tutup');
    onTap(no, () => {
      this.dismissed = true;
      this.updatePrompt();
    });
    box.append(go, no);
    document.body.appendChild(box);
    this.promptEl = box;
  }
}

let shared: Fullscreen | null = null;

/** The one instance for the page, created on first use from the real browser objects. */
export function fullscreen(): Fullscreen {
  if (!shared) {
    const scr = typeof screen !== 'undefined' ? (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }) : undefined;
    shared = new Fullscreen({
      doc: document as unknown as FullscreenTargets['doc'],
      win: window as unknown as FullscreenTargets['win'],
      orientation: scr?.orientation,
      later: (fn, ms) => void setTimeout(fn, ms),
    });
  }
  return shared;
}
