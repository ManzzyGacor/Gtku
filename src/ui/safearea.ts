/**
 * Where the screen actually is.
 *
 * On a phone in landscape the notch and the rounded corners are on the *sides*, and the gesture bar
 * is along the bottom — so a button placed at "right: 8px" can land under a camera cutout and a
 * joystick at the bottom edge can fight the system's swipe-up. The browser tells us how much to
 * stay clear of through `env(safe-area-inset-*)`, but only if the page asked to cover that area in
 * the first place (`viewport-fit=cover` in index.html).
 *
 * CSS can use the `env()` values directly. This module exists for the parts that position with
 * JavaScript — the touch controls compute pixel coordinates — and it reads them the only way they
 * can be read: by letting the browser resolve them as padding on a probe element.
 */
import { el, injectStyle } from './dom';

const CSS = `
:root {
  --lm-sat: env(safe-area-inset-top, 0px);
  --lm-sar: env(safe-area-inset-right, 0px);
  --lm-sab: env(safe-area-inset-bottom, 0px);
  --lm-sal: env(safe-area-inset-left, 0px);
}
.lm-safe-probe { position: fixed; top: 0; left: 0; width: 0; height: 0; visibility: hidden;
  pointer-events: none;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
           env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
`;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let probe: HTMLDivElement | null = null;
let cached: Insets | null = null;

function ensureProbe(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (probe?.isConnected) return probe;
  injectStyle('lm-ui-safe', CSS);
  probe = el('div');
  probe.className = 'lm-safe-probe';
  document.body.appendChild(probe);
  return probe;
}

const px = (v: string): number => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The insets in CSS pixels. Cached, because reading them forces a style resolve and the touch
 * controls ask on every layout; `invalidateInsets()` drops the cache on resize and rotation.
 */
export function safeInsets(): Insets {
  if (cached) return cached;
  const node = ensureProbe();
  if (!node || typeof getComputedStyle !== 'function') {
    cached = { top: 0, right: 0, bottom: 0, left: 0 };
    return cached;
  }
  const s = getComputedStyle(node);
  cached = {
    top: px(s.paddingTop),
    right: px(s.paddingRight),
    bottom: px(s.paddingBottom),
    left: px(s.paddingLeft),
  };
  return cached;
}

export function invalidateInsets(): void {
  cached = null;
}
