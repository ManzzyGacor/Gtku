/**
 * The settings menu, built on the fake DOM together with every other overlay — because the bug
 * this file exists for was not in the settings menu alone.
 *
 * On the phone, Pengaturan opened to the word "PENGATURAN" and nothing else. The rows were all
 * built; the header row carried the class `lm-title`, which the *title screen's* stylesheet also
 * styles as its full-screen, fixed, opaque root. The header grew over the whole panel. Nothing threw,
 * nothing was missing from the DOM, and a test that only counted rows would have passed.
 *
 * So besides "every group and every setting is there and works", this file resolves the CSS the
 * browser would apply to each element of the panel — from every stylesheet the UI injects, not just
 * the panel's own — and asserts the things that make a panel usable: nothing inside it escapes to
 * `position: fixed`, and the list is a scroll container that can actually scroll.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = { innerWidth: 2318, innerHeight: 759, devicePixelRatio: 2.75, addEventListener() {}, removeEventListener() {} };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const doc = installDom();

const { settings, RANGES } = await import('../src/core/settings');
const { DebugUi } = await import('../src/ui/DebugUi');
const { TitleScreen } = await import('../src/ui/TitleScreen');
const { PauseMenu } = await import('../src/ui/PauseMenu');
const { CharacterPanel } = await import('../src/ui/CharacterPanel');
const { Hud } = await import('../src/ui/Hud');
const { Dialogue } = await import('../src/ui/Dialogue');
const { ROWS } = await import('../src/ui/SettingsPanel');
const { saveGame, loadGame, hasSave, wipeSave } = await import('../src/core/save');
void CharacterPanel;

// every overlay that injects a stylesheet, so the cascade below sees all of them at once
const debug = new DebugUi(doc.body as unknown as HTMLElement);
let titleOpened = 0;
const title = new TitleScreen(doc.body as unknown as HTMLElement, {
  settings: () => {
    titleOpened++;
    debug.openSettings();
  },
});
// built only for their stylesheets
const others = [new Hud(doc.body as unknown as HTMLElement), new Dialogue(doc.body as unknown as HTMLElement)];
const pause = new PauseMenu(
  {
    resume: () => undefined,
    openSheet: () => undefined,
    openSettings: () => debug.openSettings(),
    saveAndQuit: () => undefined,
    weapons: () => [],
    skills: () => [],
    quest: () => [],
    map: () => null,
  },
  doc.body as unknown as HTMLElement,
);
void title;
void others;

const panelRoot = (): FakeEl => walkEls(doc.body).find((e) => e.classes.has('lm-set'))!;
const close = (): void => {
  const btn = walkEls(panelRoot()).find((e) => e.tagName === 'BUTTON' && e.textContent === 'Tutup')!;
  btn.tap();
};

beforeEach(() => {
  if (debug.settingsOpen) close();
  settings.set('textScale', 2);
  settings.set('buttonScale', 1.3);
});

// ───────────────────────── a tiny cascade ─────────────────────────

interface Rule {
  sheet: string;
  selector: string;
  decls: Map<string, string>;
}

/** Every rule of every stylesheet in <head>, deduplicated by stylesheet id. */
function rules(): Rule[] {
  const out: Rule[] = [];
  const seen = new Set<string>();
  for (const s of doc.head.childNodes) {
    if (s.tagName !== 'STYLE' || seen.has(s.id)) continue;
    seen.add(s.id);
    const css = s.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    // flatten @media / @keyframes: their inner rules are either conditional or not rules at all
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const decls = new Map<string, string>();
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':');
        if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
      }
      for (const sel of m[1].split(',')) out.push({ sheet: s.id, selector: sel.trim(), decls });
    }
  }
  return out;
}

/** One compound selector (`button.lm-x.on`) against one element. */
function compound(part: string, e: FakeEl): boolean {
  const tag = /^[a-z]+/i.exec(part)?.[0];
  if (tag && tag !== '*' && tag.toUpperCase() !== e.tagName) return false;
  const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (!tag && classes.length === 0) return false;
  return classes.every((c) => e.classes.has(c));
}

/**
 * A real selector match, right to left, with descendant and child combinators — enough for every
 * selector these stylesheets use. State pseudo-classes (`:active`, `:disabled`) and keyframe steps
 * are skipped; sibling combinators are treated as descendant (over-matching is the safe side here).
 */
function matches(sel: string, e: FakeEl): boolean {
  if (/^\d|^from$|^to$/.test(sel) || sel.includes(':')) return false;
  const tokens = sel.replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/).filter(Boolean);
  const walk = (i: number, node: FakeEl | null): boolean => {
    if (!node || !compound(tokens[i], node)) return false;
    if (i === 0) return true;
    const comb = tokens[i - 1];
    if (comb === '>') return walk(i - 2, node.parentNode);
    const next = comb === '+' || comb === '~' ? i - 2 : i - 1;
    for (let up = node.parentNode; up; up = up.parentNode) if (walk(next, up)) return true;
    return false;
  };
  return walk(tokens.length - 1, e);
}

function computed(e: FakeEl, all: Rule[]): Map<string, { value: string; from: string }> {
  const out = new Map<string, { value: string; from: string }>();
  for (const r of all) if (matches(r.selector, e)) for (const [k, v] of r.decls) out.set(k, { value: v, from: `${r.sheet} ${r.selector}` });
  return out;
}

// ───────────────────────── tests ─────────────────────────

test('opening Settings shows every group, and every group has working rows', () => {
  debug.openSettings();
  assert.equal(debug.settingsOpen, true);
  const root = panelRoot();
  assert.ok(root.classes.has('on'), 'the overlay is shown');

  const heads = walkEls(root).filter((e) => e.classes.has('lm-set-head')).map((e) => e.textContent);
  for (const group of ['Grafik', 'Kamera', 'Kontrol', 'Tampilan', 'Audio', 'Combat', 'Cutscene', 'Data'])
    assert.ok(heads.includes(group), `group ${group} is shown (have: ${heads.join(', ')})`);

  // each header is followed by at least one real row before the next header
  const body = walkEls(root).find((e) => e.classes.has('lm-set-body'))!;
  let current = '';
  const perGroup = new Map<string, number>();
  for (const c of body.childNodes) {
    if (c.classes.has('lm-set-head')) current = c.textContent;
    else if (c.classes.has('lm-set-row')) perGroup.set(current, (perGroup.get(current) ?? 0) + 1);
  }
  for (const h of heads) assert.ok((perGroup.get(h) ?? 0) > 0, `${h} has rows`);
  assert.ok((perGroup.get('Grafik') ?? 0) >= 10, 'preset plus the individual graphics settings');

  // one jump chip per group
  const chips = walkEls(root).filter((e) => e.classes.has('lm-set-chip')).map((e) => e.textContent);
  assert.deepEqual(chips, heads);
});

test('every numeric setting has a row, and its buttons change it', () => {
  debug.openSettings();
  const rows = walkEls(panelRoot()).filter((e) => e.classes.has('lm-set-row'));
  const rowFor = (label: string): FakeEl | undefined => rows.find((r) => r.childNodes[0]?.childNodes[0]?.textContent === label);

  const covered = new Set(ROWS.filter((r) => 'key' in r).map((r) => (r as { key: string }).key));
  for (const key of Object.keys(RANGES)) assert.ok(covered.has(key), `${key} has a row`);

  for (const row of ROWS) {
    if (row.kind !== 'number' && row.kind !== 'switch') continue;
    const line = rowFor(row.label);
    assert.ok(line, `row ${row.label} is built`);
    const buttons = walkEls(line!).filter((e) => e.tagName === 'BUTTON');
    const before = settings.get(row.key);
    if (row.kind === 'switch') {
      buttons[0].tap();
      assert.notEqual(settings.get(row.key), before, `${row.label} toggles`);
      buttons[0].tap();
      assert.equal(settings.get(row.key), before);
      continue;
    }
    const r = RANGES[row.key];
    const [minus, , plus] = [buttons[0], null, buttons[1]];
    (before < r.max ? plus : minus).tap();
    assert.notEqual(settings.get(row.key), before, `${row.label} moves`);
    settings.set(row.key, before);
  }
});

test('the preset row cycles AUTO through Sangat Rendah to Ultra', () => {
  debug.openSettings();
  settings.set('presetAuto', true);
  const line = walkEls(panelRoot()).find((e) => e.classes.has('lm-set-row') && e.textContent.startsWith('Preset'))!;
  const [, next] = walkEls(line).filter((e) => e.tagName === 'BUTTON');
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    const val = walkEls(line).find((e) => e.classes.has('lm-set-val'))!;
    seen.push(val.textContent);
    next.tap();
  }
  assert.deepEqual(seen, ['AUTO', 'Sangat Rendah', 'Rendah', 'Sedang', 'Tinggi', 'Ultra']);
  settings.set('presetAuto', true);
});

test('no element inside the panel is styled out of it by any stylesheet', () => {
  /*
   * The regression itself: resolve every rule from every injected stylesheet against every element
   * in the panel. Only the overlay root may be `position: fixed`; anything else that is has been
   * taken over by some other component's CSS and will cover the panel.
   */
  debug.openSettings();
  const all = rules();
  assert.ok(all.some((r) => r.sheet === 'lm-ui-title'), 'the title screen stylesheet is in the cascade');
  const root = panelRoot();
  const bad: string[] = [];
  for (const e of walkEls(root)) {
    if (e === root) continue;
    const c = computed(e, all);
    const pos = c.get('position');
    if (pos && pos.value === 'fixed') bad.push(`${[...e.classes].join('.')} "${e.textContent.slice(0, 20)}" is position:fixed via ${pos.from}`);
    const z = c.get('z-index');
    if (z) bad.push(`${[...e.classes].join('.')} has a z-index via ${z.from}`);
    for (const [k, v] of c) if (!v.from.startsWith('lm-ui-set ') && k !== 'display') bad.push(`${[...e.classes].join('.')}: ${k} from ${v.from}`);
  }
  assert.deepEqual(bad, []);
});

test('the list scrolls on a 759-pixel-tall screen with text 2x and buttons 1.3x', () => {
  debug.openSettings();
  const all = rules();
  const body = walkEls(panelRoot()).find((e) => e.classes.has('lm-set-body'))!;
  const c = computed(body, all);
  assert.equal(c.get('overflow-y')?.value, 'auto', 'the body is the scroll container');
  // a flex child without min-height 0 grows to its content and is clipped instead of scrolling
  assert.equal(c.get('min-height')?.value, '0', 'the body can shrink below its content');
  assert.match(c.get('flex')?.value ?? '', /^1/, 'and takes the height that is left');
  const card = computed(walkEls(panelRoot()).find((e) => e.classes.has('lm-set-card'))!, all);
  assert.equal(card.get('overflow')?.value, 'hidden');
  assert.equal(card.get('flex-direction')?.value, 'column');

  // the fixed chrome above and below the list leaves most of the screen to the list itself
  const px = (sel: string, prop: string): number => Number.parseFloat(all.find((r) => r.selector === sel)?.decls.get(prop) ?? '0');
  const chrome = px('.lm-set-btn', 'min-height') + 12 + px('.lm-set-chip', 'min-height') + 12 + 30;
  const usable = 759 - 16 - 18;
  assert.ok(usable - chrome > usable * 0.6, `list gets ${usable - chrome}px of ${usable}`);

  // the panel's text does not scale with the dialogue text setting, so 2x cannot push it off
  assert.ok(!/textScale|--lm-text/.test(all.filter((r) => r.sheet === 'lm-ui-set').map((r) => [...r.decls.values()].join()).join()));
});

test('Settings opens from the title screen and from the pause menu — the same panel', () => {
  const titleBtn = walkEls(doc.body).find((e) => e.classes.has('lm-title-btn') && e.textContent === 'PENGATURAN');
  assert.ok(titleBtn, 'the main menu has PENGATURAN');
  titleBtn!.tap();
  assert.equal(titleOpened, 1);
  assert.equal(debug.settingsOpen, true);
  close();
  assert.equal(debug.settingsOpen, false);

  pause.openMenu();
  const entry = walkEls(doc.body).find((e) => e.tagName === 'BUTTON' && e.textContent.includes('Pengaturan') && !e.classes.has('lm-gear'));
  assert.ok(entry, 'the pause menu has Pengaturan');
  entry!.tap();
  assert.equal(debug.settingsOpen, true);
  assert.equal(walkEls(doc.body).filter((e) => e.classes.has('lm-set')).length, 1, 'one settings panel for both');
});

test('Reset save asks twice, and a wiped save stays wiped', () => {
  saveGame({ v: 1 } as never);
  const hadSave = store.size;
  assert.ok(hadSave > 0);
  debug.openSettings();
  const panel = (debug as unknown as { panel: { confirm: (m: string) => boolean; reload: () => void; resetSave(): void } }).panel;
  let reloads = 0;
  panel.reload = () => void reloads++;

  // refused at the second question: nothing is deleted
  let asked = 0;
  panel.confirm = () => ++asked < 2;
  panel.resetSave();
  assert.equal(asked, 2);
  assert.equal(store.size, hadSave, 'save untouched');
  assert.equal(reloads, 0);

  panel.confirm = () => true;
  panel.resetSave();
  assert.equal(reloads, 1);
  assert.equal(hasSave(), false);
  // the pagehide save that follows the reload must not bring it back
  assert.equal(saveGame({ v: 1 } as never), false);
  assert.equal(loadGame(), null);
  void wipeSave;
});
