/**
 * Who gets the developer menu, and how it is unlocked.
 *
 * Two doors, both asked for: `?debug=1` in the URL, or tapping the version number in Settings five
 * times. And one wall: **neither door exists in a release build.** `import.meta.env.DEV` is a
 * compile-time constant, so in `vite build` output the whole check folds to `false` and the menu's
 * code is never even loaded — it is not hidden, it is absent.
 *
 * The one exception is a deliberate staging build (`VITE_DEV_TOOLS=1 npm run build`), for testing
 * a production bundle on the phone. A normal release never sets it.
 */

/** True when this build is allowed to offer the developer menu at all. */
export function devToolsBuild(env: { DEV?: boolean; VITE_DEV_TOOLS?: string } = import.meta.env): boolean {
  return env.DEV === true || env.VITE_DEV_TOOLS === '1';
}

/** `?debug=1` (or `?debug=on`) asks for it straight away. */
export function debugRequested(search: string): boolean {
  const v = new URLSearchParams(search).get('debug');
  return v === '1' || v === 'on' || v === 'true';
}

/**
 * Five taps on the version number, each within `window` seconds of the previous one.
 *
 * A time window rather than a plain counter: five taps spread over an evening of fiddling with
 * the settings should not open a developer menu by accident.
 */
export class TapUnlock {
  private count = 0;
  private last = -Infinity;

  constructor(
    private readonly needed = 5,
    private readonly window = 1.5,
  ) {}

  /** Register a tap at time `now` (seconds). Returns true on the tap that unlocks. */
  tap(now: number): boolean {
    this.count = now - this.last <= this.window ? this.count + 1 : 1;
    this.last = now;
    if (this.count >= this.needed) {
      this.count = 0;
      return true;
    }
    return false;
  }

  /** How many more taps are needed, for a "2 lagi..." hint. */
  get remaining(): number {
    return Math.max(0, this.needed - this.count);
  }
}
