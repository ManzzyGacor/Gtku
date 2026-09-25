/**
 * The debug/settings overlay as a unit: gear button, settings menu, FPS counter.
 * Owned by `main.ts` and independent of the renderer — it is handed a `DiagnosticsSource`
 * that the active renderer keeps up to date.
 */
import { onErrorLogged, recentErrors } from '../core/errors';
import { NULL_DIAGNOSTICS, type DiagnosticsSource } from './diagnostics';
import { el, onTap } from './dom';
import { FpsMeterView } from './FpsMeterView';
import { SettingsPanel } from './SettingsPanel';

export class DebugUi {
  private source: DiagnosticsSource = NULL_DIAGNOSTICS;
  private gear: HTMLButtonElement;
  private panel: SettingsPanel;
  private fps: FpsMeterView;
  private last = 0;

  constructor(parent: HTMLElement = document.body) {
    this.panel = new SettingsPanel(parent, () => this.source);
    this.panel.onOpenChange = (open) => {
      this.source.setPaused(open);
      this.gear.style.display = open ? 'none' : 'block';
    };
    this.fps = new FpsMeterView(parent);

    this.gear = el('button', {}, '⚙');
    this.gear.className = 'lm-gear';
    this.gear.setAttribute('aria-label', 'Pengaturan');
    onTap(this.gear, () => this.panel.toggle());
    parent.appendChild(this.gear);

    // A red gear is the only hint on a phone that something threw.
    onErrorLogged(() => this.markErrors());
    this.markErrors();
  }

  private markErrors(): void {
    const bad = recentErrors().length > 0;
    this.gear.style.borderColor = bad ? '#ff5a4a' : '#6a7094';
    this.gear.style.color = bad ? '#ff8a7a' : '#ffd98a';
  }

  /** Open the settings overlay from somewhere else (the pause menu's Pengaturan entry). */
  openSettings(): void {
    this.panel.setOpen(true);
  }

  /** Developer-only settings rows, shown on the server's word (boot3d.ts). */
  setDeveloper(on: boolean): void {
    this.panel.setDeveloper(on);
  }

  /** The active renderer calls this once it is running. */
  attach(source: DiagnosticsSource): void {
    this.source = source;
    if (this.panel.open) source.setPaused(true);
  }

  /** Drive the FPS readout from the host page's animation loop (independent of the game loop). */
  tick(nowMs: number): void {
    const dt = this.last ? Math.min(0.5, (nowMs - this.last) / 1000) : 0;
    this.last = nowMs;
    this.fps.update(dt, this.source);
  }

  /** Keyboard shortcut for desktop testing. */
  installKeyboardShortcut(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'F1') {
        e.preventDefault();
        this.panel.toggle();
      }
    });
  }

  get settingsOpen(): boolean {
    return this.panel.open;
  }

  destroy(): void {
    this.panel.destroy();
    this.fps.destroy();
    this.gear.remove();
    onErrorLogged(null);
  }
}

/** The one instance; renderers attach their diagnostics to it. */
export const debugUi = { current: null as DebugUi | null };

export function ensureDebugUi(): DebugUi {
  if (!debugUi.current) {
    debugUi.current = new DebugUi();
    debugUi.current.installKeyboardShortcut();
  }
  return debugUi.current;
}
