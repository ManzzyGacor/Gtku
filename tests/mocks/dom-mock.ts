/**
 * A DOM small enough to run the overlay UI in Node. It records structure (children, style, text)
 * so the smoke test can assert what the settings menu built, without pulling in jsdom.
 */
import { makeCanvas } from './phaser-mock';

export interface FakeEl {
  tagName: string;
  style: Record<string, string>;
  childNodes: FakeEl[];
  parentNode: FakeEl | null;
  textContent: string;
  className: string;
  id: string;
  disabled: boolean;
  value: string;
  classes: Set<string>;
  listeners: Map<string, ((ev: unknown) => void)[]>;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  appendChild<T extends FakeEl>(c: T): T;
  append(...cs: FakeEl[]): void;
  removeChild(c: FakeEl): void;
  remove(): void;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  removeEventListener(type: string, fn: (ev: unknown) => void): void;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  scrollIntoView(): void;
  select(): void;
  setSelectionRange(): void;
  focus(): void;
  /** Fire a listener as if the player tapped it. */
  tap(): void;
}

export function makeElement(tag: string): FakeEl {
  const attrs = new Map<string, string>();
  const node = {
    tagName: tag.toUpperCase(),
    style: {} as Record<string, string>,
    childNodes: [] as FakeEl[],
    parentNode: null as FakeEl | null,
    textContent: '',
    id: '',
    disabled: false,
    value: '',
    classes: new Set<string>(),
    listeners: new Map<string, ((ev: unknown) => void)[]>(),
  } as FakeEl;

  // Real elements keep `className` and `classList` in sync; the tests rely on that.
  Object.defineProperty(node, 'className', {
    get: () => [...node.classes].join(' '),
    set: (v: string) => {
      node.classes.clear();
      for (const c of String(v).split(/\s+/).filter(Boolean)) node.classes.add(c);
    },
    enumerable: true,
  });

  node.classList = {
    add: (c) => void node.classes.add(c),
    remove: (c) => void node.classes.delete(c),
    toggle: (c, on) => {
      const want = on ?? !node.classes.has(c);
      if (want) node.classes.add(c);
      else node.classes.delete(c);
    },
    contains: (c) => node.classes.has(c),
  };
  node.appendChild = (c) => {
    node.childNodes.push(c);
    c.parentNode = node;
    return c;
  };
  node.append = (...cs) => {
    for (const c of cs) node.appendChild(c);
  };
  node.removeChild = (c) => {
    const i = node.childNodes.indexOf(c);
    if (i >= 0) node.childNodes.splice(i, 1);
    c.parentNode = null;
  };
  node.remove = () => node.parentNode?.removeChild(node);
  node.addEventListener = (type, fn) => {
    const list = node.listeners.get(type) ?? [];
    list.push(fn);
    node.listeners.set(type, list);
  };
  node.removeEventListener = (type, fn) => {
    const list = node.listeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  node.setAttribute = (k, v) => void attrs.set(k, v);
  node.getAttribute = (k) => attrs.get(k) ?? null;
  node.scrollIntoView = () => undefined;
  node.select = () => undefined;
  node.setSelectionRange = () => undefined;
  node.focus = () => undefined;
  node.tap = () => {
    for (const fn of node.listeners.get('pointerup') ?? []) fn({ preventDefault() {}, stopPropagation() {}, target: node });
  };
  return node;
}

/** Depth-first walk of an element tree. */
export function walkEls(root: FakeEl): FakeEl[] {
  const out = [root];
  for (const c of root.childNodes) out.push(...walkEls(c));
  return out;
}

/** Find the first descendant whose text matches. */
export function findByText(root: FakeEl, text: string): FakeEl | undefined {
  return walkEls(root).find((e) => e.textContent === text);
}

export interface FakeDocument {
  head: FakeEl;
  body: FakeEl;
  createElement(tag: string): FakeEl;
  getElementById(id: string): FakeEl | null;
  execCommand(cmd: string): boolean;
}

/** Install a fake `document` on globalThis and hand it back. */
export function installDom(): FakeDocument {
  const byId = new Map<string, FakeEl>();
  const doc: FakeDocument = {
    head: makeElement('head'),
    body: makeElement('body'),
    createElement: (tag) => (tag === 'canvas' ? (makeCanvas() as unknown as FakeEl) : makeElement(tag)),
    getElementById: (id) => byId.get(id) ?? null,
    execCommand: () => true,
  };
  (globalThis as Record<string, unknown>).document = doc;
  return doc;
}
