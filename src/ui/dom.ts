/**
 * Minimal DOM helpers for the overlay UI (menus, debug panels).
 *
 * The overlay lives outside the game canvas on purpose: it is the one part of the UI that must keep
 * working unchanged while the renderer underneath is swapped from Phaser to Three.js
 * (docs/OVERHAUL.md §7), and a phone gives us real text rendering and native scrolling for free.
 */

export type Styles = Partial<CSSStyleDeclaration>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles: Styles = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Inject a stylesheet once, keyed by id. */
export function injectStyle(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const s = el('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}

/**
 * Wire a tap handler that works on a phone without the 300 ms click delay and without the tap
 * leaking through to the game canvas underneath.
 */
export function onTap(node: HTMLElement, fn: () => void): void {
  const handler = (ev: Event): void => {
    ev.preventDefault();
    ev.stopPropagation();
    fn();
  };
  node.addEventListener('pointerup', handler);
  node.addEventListener('click', (ev) => ev.stopPropagation());
}
