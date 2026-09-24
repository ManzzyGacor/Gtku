/**
 * The character sheet and bag UI.
 *
 * The plan is explicit that fake UI is not allowed, so what is tested here is precisely that: the
 * panel reads live values from the `Character` and every button changes real state. It runs against
 * the fake DOM, so a "tap" is a real listener call on the element the player would touch.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installDom, walkEls, type FakeEl } from './mocks/dom-mock';

const doc = installDom();

const { CharacterPanel } = await import('../src/ui/CharacterPanel');
const { Character } = await import('../src/core/stats/character');
const { Inventory } = await import('../src/core/items/inventory');
const { ITEMS } = await import('../src/core/items/items');
const { formatStat } = await import('../src/core/stats/stats');

interface Harness {
  panel: InstanceType<typeof CharacterPanel>;
  character: InstanceType<typeof Character>;
  root: FakeEl;
  changes: number;
  used: string[];
  toggles: boolean[];
}

function harness(): Harness {
  const parent = doc.createElement('div');
  const character = new Character(new Inventory(6));
  const state = { changes: 0, used: [] as string[], toggles: [] as boolean[] };
  const panel = new CharacterPanel(
    character,
    {
      changed: () => state.changes++,
      use: (def) => state.used.push(def.id),
    },
    parent as unknown as HTMLElement,
  );
  panel.onToggle = (open) => state.toggles.push(open);
  return {
    panel,
    character,
    root: parent,
    get changes() {
      return state.changes;
    },
    get used() {
      return state.used;
    },
    get toggles() {
      return state.toggles;
    },
  } as Harness;
}

/** Find the tappable element whose text starts with `text`. */
function button(root: FakeEl, text: string): FakeEl {
  const found = walkEls(root).find((e) => e.tagName === 'BUTTON' && (e.textContent ?? '').startsWith(text));
  assert.ok(found, `no button starting with "${text}" (had: ${walkEls(root).filter((e) => e.tagName === 'BUTTON').map((e) => e.textContent).join(' | ')})`);
  return found;
}

const texts = (root: FakeEl): string => walkEls(root).map((e) => e.textContent ?? '').join(' ');

test('the sheet opens and closes, and reports it so the game can pause', () => {
  const h = harness();
  assert.equal(h.panel.isOpen, false);
  h.panel.toggle();
  assert.equal(h.panel.isOpen, true);
  assert.deepEqual(h.toggles, [true]);
  h.panel.toggle();
  assert.equal(h.panel.isOpen, false);
  assert.deepEqual(h.toggles, [true, false]);
  // closing twice must not fire twice — the game would double-save
  h.panel.hide();
  assert.deepEqual(h.toggles, [true, false]);
});

test('it refuses to open when the game says no (dead hero)', () => {
  const parent = doc.createElement('div');
  const panel = new CharacterPanel(
    new Character(),
    { changed: () => undefined, use: () => undefined, blocked: () => true },
    parent as unknown as HTMLElement,
  );
  panel.showPanel();
  assert.equal(panel.isOpen, false);
});

test('the character tab shows the eight real slots and the live stats', () => {
  const h = harness();
  h.panel.showPanel();
  const shown = texts(h.root);
  for (const label of ['Senjata', 'Kepala', 'Badan', 'Tangan', 'Kaki', 'Aksesori 1', 'Aksesori 2', 'Inti Lentera'])
    assert.ok(shown.includes(label), `slot "${label}" missing`);
  assert.ok(shown.includes('kosong'), 'empty slots say so');

  // the numbers are the character's own, not a copy
  assert.ok(shown.includes(formatStat('atk', h.character.stats.atk)), `ATK ${h.character.stats.atk} not shown`);
  assert.ok(shown.includes('Level 1'), shown.slice(0, 120));
});

test('equipping from the bag changes the character and tells the game', () => {
  const h = harness();
  h.character.inventory.add('sword_dawn');
  h.panel.showPanel();
  const atkBefore = h.character.stats.atk;

  // tap into the bag, select the item, equip it
  button(h.root, 'TAS').tap();
  const cells = walkEls(h.root).filter((e) => e.classes.has('lm-cell'));
  assert.ok(cells.length >= 6, `expected the grid, got ${cells.length} cells`);
  const filled = cells.find((c) => c.classes.has('has'))!;
  assert.ok(filled, 'the sword must be in the grid');
  filled.tap();

  const detail = texts(h.root);
  assert.ok(detail.includes('Pedang Fajar'), 'the detail sheet names it');
  assert.ok(detail.includes('Langka'), 'and gives its rarity');
  assert.ok(detail.includes('Serangan'), 'and what it does');

  button(h.root, 'PAKAI').tap();
  assert.equal(h.character.inventory.equipped.weapon?.id, 'sword_dawn', 'really equipped');
  assert.ok(h.changes > 0, 'the game was told to re-resolve and save');
  assert.ok(h.character.stats.atk > atkBefore, 'and the stats actually changed');
});

test('an accessory offers both slots by name', () => {
  const h = harness();
  h.character.inventory.add('ring_thorn');
  h.panel.showPanel();
  button(h.root, 'TAS').tap();
  walkEls(h.root).find((e) => e.classes.has('lm-cell') && e.classes.has('has'))!.tap();
  button(h.root, 'PAKAI → AKSESORI 1').tap();
  assert.equal(h.character.inventory.equipped.accessory1?.id, 'ring_thorn');
});

test('unequipping works from the character tab, and says so when the bag is full', () => {
  const h = harness();
  h.character.inventory.add('helm_stone');
  h.character.inventory.equip(0);
  h.character.refresh();
  h.panel.showPanel();

  // fill every remaining cell
  h.character.inventory.add('shard_dawn', 99 * 6);
  assert.equal(h.character.inventory.full, true);
  h.panel.render();

  const slot = walkEls(h.root).find((e) => e.classes.has('lm-slot') && (e.textContent ?? '').includes('Helm Batu'))!;
  assert.ok(slot, 'the worn helm is listed');
  slot.tap();
  button(h.root, 'LEPAS').tap();
  assert.equal(h.character.inventory.equipped.helmet?.id, 'helm_stone', 'still worn: there was nowhere to put it');
  assert.ok(texts(h.root).includes('Tas penuh'), 'and the player is told why');

  // make room and try again
  h.character.inventory.remove('shard_dawn', 99);
  h.panel.render();
  walkEls(h.root).find((e) => e.classes.has('lm-slot') && (e.textContent ?? '').includes('Helm Batu'))!.tap();
  button(h.root, 'LEPAS').tap();
  assert.equal(h.character.inventory.equipped.helmet, undefined, 'now it comes off');
});

test('a potion is used, not equipped, and leaves the bag', () => {
  const h = harness();
  h.character.inventory.add('potion_small', 2);
  h.panel.showPanel();
  button(h.root, 'TAS').tap();
  walkEls(h.root).find((e) => e.classes.has('lm-cell') && e.classes.has('has'))!.tap();
  assert.ok(texts(h.root).includes('Rebusan'), 'the potion is selected');
  button(h.root, 'PAKAI').tap();
  assert.deepEqual(h.used, ['potion_small'], 'the game applies the effect');
  assert.equal(h.character.inventory.countOf('potion_small'), 1, 'one was consumed');
});

test('dropping an item removes the whole stack', () => {
  const h = harness();
  h.character.inventory.add('shard_dawn', 5);
  h.panel.showPanel();
  button(h.root, 'TAS').tap();
  walkEls(h.root).find((e) => e.classes.has('lm-cell') && e.classes.has('has'))!.tap();
  button(h.root, 'BUANG').tap();
  assert.equal(h.character.inventory.countOf('shard_dawn'), 0);
});

test('the category chips filter the grid', () => {
  const h = harness();
  h.character.inventory.add('shard_dawn', 3);
  h.character.inventory.add('core_frost');
  h.panel.showPanel();
  button(h.root, 'TAS').tap();

  button(h.root, 'Inti Lentera').tap();
  let cells = walkEls(h.root).filter((e) => e.classes.has('lm-cell'));
  assert.equal(cells.length, 1, 'only the core');
  button(h.root, 'Bahan').tap();
  cells = walkEls(h.root).filter((e) => e.classes.has('lm-cell'));
  assert.equal(cells.length, 1, 'only the material');
  button(h.root, 'Ramuan').tap();
  assert.ok(texts(h.root).includes('Tidak ada apa-apa'), 'an empty category says so rather than looking broken');
  button(h.root, 'Semua').tap();
  cells = walkEls(h.root).filter((e) => e.classes.has('lm-cell'));
  assert.equal(cells.length, 6, 'the whole grid, empty cells included');
});

test('a Lantern Core shows its element bonus and its passive in words', () => {
  const h = harness();
  h.character.inventory.add('core_ember');
  h.character.inventory.equip(0);
  h.character.refresh();
  h.panel.showPanel();
  const shown = texts(h.root);
  assert.ok(shown.includes('Inti Bara'), 'the core is named');
  assert.ok(shown.includes('Perisai Bara'), 'and its passive is spelled out');
  assert.ok(shown.includes(ITEMS.core_ember.note.slice(0, 20)), 'with its description');
});

test('the EXP bar and level follow the character', () => {
  const h = harness();
  h.character.addExp(5);
  h.panel.showPanel();
  assert.ok(texts(h.root).includes(`${h.character.exp}/${h.character.expNeeded} EXP`), texts(h.root).slice(0, 160));
  h.character.addExp(9999);
  h.panel.render();
  assert.ok(texts(h.root).includes(`Level ${h.character.level}`), 'the level is live');
});

test('destroy leaves nothing in the DOM', () => {
  const h = harness();
  h.panel.showPanel();
  assert.ok(walkEls(h.root).length > 5);
  h.panel.destroy();
  assert.equal(h.root.childNodes.length, 0);
});
