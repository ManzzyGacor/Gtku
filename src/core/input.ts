/**
 * Unified input hub: keyboard (WASD/arrows + J/K/L/E) and touch controls (written by UIScene) feed the same state.
 * Pure DOM, no Phaser, so gameplay code stays testable.
 */
export type Action = 'attack' | 'dodge' | 'skill' | 'interact' | 'swap';

const KEY_ACTIONS: Record<string, Action> = {
  KeyJ: 'attack',
  KeyZ: 'attack',
  Space: 'attack',
  KeyK: 'dodge',
  KeyX: 'dodge',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyL: 'skill',
  KeyC: 'skill',
  KeyE: 'interact',
  Enter: 'interact',
  // quick weapon swap: the plan asks for 1/2 on a keyboard and a button on a phone
  Digit1: 'swap',
  Digit2: 'swap',
  KeyQ: 'swap',
};

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class InputHub {
  private keys = new Set<string>();
  private pressedAt: Record<Action, number> = { attack: -1e9, dodge: -1e9, skill: -1e9, interact: -1e9, swap: -1e9 };
  private consumed: Record<Action, boolean> = { attack: true, dodge: true, skill: true, interact: true, swap: true };
  private heldAction: Record<Action, boolean> = { attack: false, dodge: false, skill: false, interact: false, swap: false };
  /** Analog stick from touch UI, each -1..1. */
  stick = { x: 0, y: 0 };
  /** When false (dialogue, cutscene) movement and combat input are ignored. */
  enabled = true;
  /** Last input method that produced input; UI uses it to show/hide touch controls. */
  lastDevice: 'keyboard' | 'touch' = 'keyboard';
  now: () => number = () => performance.now();
  /**
   * Keys that open UI rather than driving the hero: `I`/`Tab` for the character sheet, `Escape`/`P`
   * for the pause menu. The game sets this; the hub only routes the key, so `src/core` still knows
   * nothing about the panels themselves.
   */
  onMenu: (which: 'sheet' | 'pause') => void = () => undefined;

  constructor(target: Window | null = typeof window !== 'undefined' ? window : null) {
    target?.addEventListener('keydown', (e) => this.onKey(e, true));
    target?.addEventListener('keyup', (e) => this.onKey(e, false));
    target?.addEventListener('blur', () => this.reset());
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const act = KEY_ACTIONS[e.code];
    if (act || MOVE_KEYS[e.code]) {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
    }
    if (down) {
      if (e.repeat) return;
      if (e.code === 'KeyI' || e.code === 'Tab') {
        e.preventDefault();
        this.lastDevice = 'keyboard';
        this.onMenu('sheet');
        return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        this.lastDevice = 'keyboard';
        this.onMenu('pause');
        return;
      }
      this.keys.add(e.code);
      if (act) this.press(act);
    } else {
      this.keys.delete(e.code);
      if (act) this.heldAction[act] = false;
    }
  }

  reset(): void {
    this.keys.clear();
    this.stick.x = 0;
    this.stick.y = 0;
    for (const a of Object.keys(this.heldAction) as Action[]) this.heldAction[a] = false;
  }

  /** Movement vector, length ≤ 1. Keyboard is digital (normalised), touch is analog. */
  axis(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const m = MOVE_KEYS[k];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    if (x !== 0 || y !== 0) {
      const l = Math.hypot(x, y);
      return { x: x / l, y: y / l };
    }
    return { x: this.stick.x, y: this.stick.y };
  }

  press(a: Action): void {
    this.pressedAt[a] = this.now();
    this.consumed[a] = false;
    this.heldAction[a] = true;
  }

  release(a: Action): void {
    this.heldAction[a] = false;
  }

  isHeld(a: Action): boolean {
    return this.enabled && this.heldAction[a];
  }

  /** True once per press (within `bufferMs` after it happened). */
  consume(a: Action, bufferMs = 160): boolean {
    if (!this.enabled && a !== 'interact' && a !== 'swap') return false;
    if (this.consumed[a]) return false;
    if (this.now() - this.pressedAt[a] > bufferMs) {
      this.consumed[a] = true;
      return false;
    }
    this.consumed[a] = true;
    return true;
  }

  /** Forget any buffered press. */
  clear(a?: Action): void {
    if (a) this.consumed[a] = true;
    else for (const k of Object.keys(this.consumed) as Action[]) this.consumed[k] = true;
  }
}

export const input = new InputHub();
