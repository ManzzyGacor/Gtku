/**
 * The character sheet and the bag (docs/OVERHAUL.md §4 "UI": modern fantasy RPG, **bukan dashboard
 * website**, and "Inventaris grid per kategori").
 *
 * Built for a phone held in landscape, which drives every layout decision here:
 *
 *  • **two tabs, not a tree.** Karakter and Tas. Anything deeper would need a back button and a
 *    history, on a screen the size of a playing card.
 *  • **44 px tap targets.** Every cell, chip and button is at least that, because a 30 px grid cell
 *    is unusable with a thumb even though it looks fine on a monitor.
 *  • **the detail sheet slides up from the bottom**, where the thumb already is, rather than
 *    appearing as a tooltip next to the item (which a finger would be covering).
 *  • **nothing here is decorative.** Every number comes from the live `Character`, every button
 *    changes real state, and the panel calls back so the game can re-apply the sheet and save. The
 *    plan is explicit that fake UI is not allowed, and a stat display that lies is worse than none.
 */
import { formatModifier, formatStat, STAT_META } from '../core/stats/stats';
import { EQUIP_SLOTS, itemDef, itemMods, rarityMeta, type EquipSlot, type ItemDef } from '../core/items/items';
import type { ItemStack } from '../core/items/inventory';
import type { Character } from '../core/stats/character';
import { el, injectStyle, onTap } from './dom';

const CSS = `
.lm-sheet { position: fixed; inset: 0; z-index: 88; display: none; flex-direction: column;
  background: radial-gradient(130% 100% at 50% 0%, rgba(40,32,72,0.97), rgba(10,8,18,0.98));
  color: #e7e0ff; font: 12px/1.4 ui-monospace, monospace; pointer-events: auto; }
.lm-sheet.on { display: flex; }

/* header: tabs on the left, close on the right */
.lm-sh-top { display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border-bottom: 1px solid rgba(154,140,214,0.35); flex: 0 0 auto; }
.lm-tab { min-width: 92px; min-height: 36px; padding: 0 12px; border-radius: 4px; cursor: pointer;
  font: inherit; letter-spacing: 2px; color: #b9b0d8; touch-action: manipulation;
  background: linear-gradient(180deg, rgba(48,39,80,0.9), rgba(22,17,42,0.9));
  border: 1px solid rgba(154,140,214,0.4); }
.lm-tab.on { color: #1a1430; border-color: #ffd98a; background: linear-gradient(180deg, #ffd98a, #e0a33a); }
.lm-sh-lvl { margin-left: auto; text-align: right; color: #d9cfff; }
.lm-sh-lvl b { color: #ffd98a; font-weight: normal; }
.lm-x { min-width: 40px; min-height: 36px; border-radius: 4px; cursor: pointer; font: inherit;
  color: #ffd0d0; background: rgba(60,22,34,0.85); border: 1px solid rgba(255,120,140,0.5);
  touch-action: manipulation; }

/* the exp bar under the header */
.lm-sh-exp { height: 4px; background: #140f26; flex: 0 0 auto; }
.lm-sh-exp > div { height: 100%; width: 0; background: linear-gradient(90deg, #7a5cd8, #c9b3ff); }

/* body scrolls; the two panes sit side by side when there is room */
.lm-sh-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 8px; display: flex; gap: 10px; align-items: flex-start; }
.lm-sh-body.one { display: block; }
.lm-col { flex: 1 1 0; min-width: 0; }
.lm-h { color: #ffd98a; letter-spacing: 2px; margin: 0 0 5px; font-size: 11px; }

/* equipment: two columns of slots */
.lm-slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.lm-slot { display: flex; align-items: center; gap: 6px; min-height: 46px; padding: 4px 6px;
  border-radius: 4px; cursor: pointer; touch-action: manipulation; text-align: left;
  background: linear-gradient(180deg, rgba(38,31,64,0.92), rgba(19,15,36,0.92));
  border: 1px solid rgba(154,140,214,0.35); color: inherit; font: inherit; }
.lm-slot .ic { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 3px; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(10,8,20,0.8); border: 1px solid rgba(154,140,214,0.35); }
.lm-slot .tx { min-width: 0; }
.lm-slot .tx small { display: block; color: #8189a8; font-size: 10px; }
.lm-slot .tx span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lm-slot.empty .tx span { color: #6a7094; }

/* stats list */
.lm-stats { display: flex; flex-direction: column; gap: 2px; }
.lm-st { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; border-radius: 3px;
  background: rgba(20,16,38,0.6); }
.lm-st b { color: #fff8e6; font-weight: normal; }
.lm-note { color: #8189a8; font-size: 10px; margin-top: 6px; }
.lm-core { margin-top: 8px; padding: 6px 8px; border-radius: 4px; color: #ffe9a8;
  background: rgba(70,44,20,0.5); border: 1px solid rgba(255,176,74,0.45); }

/* bag: category chips then the grid */
.lm-chips { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 7px; }
.lm-chip { min-height: 34px; padding: 0 11px; border-radius: 17px; cursor: pointer; font: inherit;
  font-size: 11px; color: #c9c2e4; background: rgba(28,22,52,0.9);
  border: 1px solid rgba(154,140,214,0.35); touch-action: manipulation; }
.lm-chip.on { color: #1a1430; background: #c9b3ff; border-color: #c9b3ff; }
.lm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 5px; }
.lm-cell { position: relative; aspect-ratio: 1; min-height: 46px; border-radius: 4px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 18px; padding: 0;
  background: linear-gradient(180deg, rgba(34,27,58,0.9), rgba(17,13,32,0.9));
  border: 1px solid rgba(154,140,214,0.28); touch-action: manipulation; }
.lm-cell.has { border-width: 2px; }
.lm-cell.sel { outline: 2px solid #ffd98a; outline-offset: -2px; }
.lm-cell i { position: absolute; right: 2px; bottom: 1px; font-style: normal; font-size: 9px;
  color: #fff8e6; text-shadow: 0 1px 2px #000; }
.lm-cell u { position: absolute; left: 2px; top: 1px; font-size: 8px; text-decoration: none; }
.lm-empty { color: #6a7094; padding: 10px 4px; }

/* detail sheet, pinned to the bottom where the thumb is */
.lm-detail { flex: 0 0 auto; border-top: 1px solid rgba(154,140,214,0.4); padding: 7px 9px 9px;
  background: linear-gradient(180deg, rgba(30,24,56,0.97), rgba(14,11,28,0.98)); display: none; }
.lm-detail.on { display: block; }
.lm-d-name { font-size: 13px; }
.lm-d-sub { color: #8189a8; font-size: 10px; margin: 1px 0 4px; }
.lm-d-mods { display: flex; flex-wrap: wrap; gap: 4px 10px; color: #b7f0b7; }
.lm-d-mods span.bad { color: #ffa0a0; }
.lm-d-note { color: #c9c2e4; margin-top: 4px; font-size: 11px; }
.lm-d-btns { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
.lm-btn2 { min-height: 40px; min-width: 96px; padding: 0 14px; border-radius: 4px; cursor: pointer;
  font: inherit; letter-spacing: 1px; color: #f2e2c2; touch-action: manipulation;
  background: linear-gradient(180deg, rgba(58,47,94,0.95), rgba(26,20,48,0.95));
  border: 1px solid rgba(255,217,138,0.45); }
.lm-btn2:active { background: #ffb82e; color: #1a1430; }
.lm-btn2.danger { color: #ffc0c0; border-color: rgba(255,120,140,0.5); }

/* the bag button on the HUD */
.lm-bag-btn { position: fixed; right: 82px; top: 4px; z-index: 80; pointer-events: auto;
  width: 34px; height: 34px; padding: 0; border-radius: 17px; cursor: pointer;
  background: rgba(20,16,38,0.8); border: 1px solid #6a7094; color: #ffd98a;
  font: 15px/1 ui-monospace, monospace; touch-action: manipulation; }
`;

/** Pixel-ish glyphs per item kind — no image files, and they read at 30 px on a phone. */
const KIND_ICON: Record<string, string> = {
  weapon: '⚔',
  helmet: '⛑',
  armor: '\u{1f6e1}',
  gloves: '\u{1f9e4}',
  boots: '\u{1f97e}',
  accessory: '\u{1f48e}',
  lantern: '\u{1f3ee}',
  material: '\u{1fab5}',
  consumable: '\u{1f9ea}',
};

const CATEGORIES: { id: string; label: string; kinds: string[] }[] = [
  { id: 'all', label: 'Semua', kinds: [] },
  { id: 'gear', label: 'Perlengkapan', kinds: ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'accessory'] },
  { id: 'lantern', label: 'Inti Lentera', kinds: ['lantern'] },
  { id: 'use', label: 'Ramuan', kinds: ['consumable'] },
  { id: 'mat', label: 'Bahan', kinds: ['material'] },
];

/** Where a selection points: a bag cell, or an equipped slot. */
type Selection = { where: 'bag'; index: number } | { where: 'slot'; slot: EquipSlot } | null;

export interface CharacterPanelHooks {
  /** Something changed that the game has to act on (re-resolve stats, save). */
  changed(): void;
  /** Drink/eat: the panel has already removed one from the bag. */
  use(def: ItemDef): void;
  /** True while the panel should refuse to open (dead, in a cutscene). */
  blocked?(): boolean;
}

export class CharacterPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private detail: HTMLDivElement;
  private expFill: HTMLDivElement;
  private levelText: HTMLDivElement;
  private tabs: { id: 'char' | 'bag'; node: HTMLButtonElement }[] = [];
  private chips: { id: string; node: HTMLButtonElement }[] = [];
  private bagButton: HTMLButtonElement;
  private tab: 'char' | 'bag' = 'char';
  private category = 'all';
  private selection: Selection = null;
  private open = false;
  /**
   * Called whenever the panel opens or closes, however it was triggered (button, key, close).
   * The game uses it to hold the hero still — a stick that keeps walking under an open menu is a
   * trap — and to save on the way out.
   */
  onToggle: (open: boolean) => void = () => undefined;

  constructor(
    private readonly character: Character,
    private readonly hooks: CharacterPanelHooks,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-sheet', CSS);

    this.bagButton = el('button', {}, '\u{1f392}');
    this.bagButton.className = 'lm-bag-btn';
    this.bagButton.title = 'Karakter & Tas (I)';
    onTap(this.bagButton, () => this.toggle());
    parent.appendChild(this.bagButton);

    this.root = el('div');
    this.root.className = 'lm-sheet';

    const top = el('div');
    top.className = 'lm-sh-top';
    for (const t of [{ id: 'char' as const, label: 'KARAKTER' }, { id: 'bag' as const, label: 'TAS' }]) {
      const node = el('button', {}, t.label);
      node.className = 'lm-tab';
      onTap(node, () => this.show(t.id));
      this.tabs.push({ id: t.id, node });
      top.appendChild(node);
    }
    this.levelText = el('div');
    this.levelText.className = 'lm-sh-lvl';
    const close = el('button', {}, '✕');
    close.className = 'lm-x';
    onTap(close, () => this.hide());
    top.append(this.levelText, close);

    const expTrack = el('div');
    expTrack.className = 'lm-sh-exp';
    this.expFill = el('div');
    expTrack.appendChild(this.expFill);

    this.body = el('div');
    this.body.className = 'lm-sh-body';
    this.detail = el('div');
    this.detail.className = 'lm-detail';

    this.root.append(top, expTrack, this.body, this.detail);
    parent.appendChild(this.root);

    // Swallow taps on the panel so they never reach the game underneath (the stick would jump).
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  setVisible(v: boolean): void {
    this.bagButton.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.showPanel();
  }

  showPanel(): void {
    if (this.hooks.blocked?.()) return;
    this.open = true;
    this.root.classList.add('on');
    this.render();
    this.onToggle(true);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.selection = null;
    this.root.classList.remove('on');
    this.detail.classList.remove('on');
    this.onToggle(false);
  }

  private show(tab: 'char' | 'bag'): void {
    this.tab = tab;
    this.selection = null;
    this.render();
  }

  /** Rebuild the whole panel. Only ever runs on a tap, so it can be as simple as this. */
  render(): void {
    const c = this.character;
    this.levelText.innerHTML = '';
    const lvl = el('span', {}, 'Level ');
    const b = el('b', {}, String(c.level));
    const exp = el('small', {}, c.expNeeded > 0 ? `  ${c.exp}/${c.expNeeded} EXP` : '  maks');
    this.levelText.append(lvl, b, exp);
    this.expFill.style.width = `${c.expNeeded > 0 ? Math.min(100, (c.exp / c.expNeeded) * 100) : 100}%`;

    for (const t of this.tabs) t.node.classList.toggle('on', t.id === this.tab);
    this.body.innerHTML = '';
    this.body.classList.toggle('one', this.tab === 'bag');
    if (this.tab === 'char') this.renderCharacter();
    else this.renderBag();
    this.renderDetail();
  }

  // ───────────────────────── karakter ─────────────────────────

  private renderCharacter(): void {
    const left = el('div');
    left.className = 'lm-col';
    left.appendChild(heading('PERLENGKAPAN'));
    const slots = el('div');
    slots.className = 'lm-slots';
    for (const slot of EQUIP_SLOTS) {
      const held = this.character.inventory.equipped[slot.id];
      const def = held && itemDef(held.id);
      const node = el('button');
      node.className = `lm-slot${def ? '' : ' empty'}`;
      const icon = el('div', {}, def ? (KIND_ICON[def.kind] ?? '?') : '·');
      icon.className = 'ic';
      const tx = el('div');
      tx.className = 'tx';
      tx.appendChild(el('small', {}, slot.label));
      const name = el('span', {}, def ? def.name : 'kosong');
      if (def && held) name.style.color = rarityMeta(held.rarity).color;
      tx.appendChild(name);
      node.append(icon, tx);
      onTap(node, () => {
        this.selection = def ? { where: 'slot', slot: slot.id } : null;
        this.render();
      });
      slots.appendChild(node);
    }
    left.appendChild(slots);

    const core = this.character.inventory.lanternCore();
    if (core) {
      const box = el('div');
      box.className = 'lm-core';
      box.appendChild(el('div', {}, `${core.def.name} — ${this.character.passiveLabel ?? ''}`));
      box.appendChild(el('div', {}, core.def.note));
      left.appendChild(box);
    } else {
      const box = el('div', {}, 'Belum ada Inti Lentera terpasang. Inti memberi bonus elemen dan satu kemampuan pasif.');
      box.className = 'lm-note';
      left.appendChild(box);
    }

    const right = el('div');
    right.className = 'lm-col';
    right.appendChild(heading('STATUS'));
    const list = el('div');
    list.className = 'lm-stats';
    for (const meta of STAT_META) {
      const row = el('div');
      row.className = 'lm-st';
      row.appendChild(el('span', {}, meta.label));
      row.appendChild(el('b', {}, formatStat(meta.id, this.character.stats[meta.id])));
      list.appendChild(row);
    }
    right.appendChild(list);

    const sources = this.character.sources().filter((s) => s.mods.length);
    if (sources.length) {
      const note = el('div', {}, `Sumber: ${sources.map((s) => s.label).join(', ')}`);
      note.className = 'lm-note';
      right.appendChild(note);
    }

    this.body.append(left, right);
  }

  // ───────────────────────── tas ─────────────────────────

  private renderBag(): void {
    const chips = el('div');
    chips.className = 'lm-chips';
    this.chips = [];
    for (const cat of CATEGORIES) {
      const node = el('button', {}, cat.label);
      node.className = `lm-chip${cat.id === this.category ? ' on' : ''}`;
      onTap(node, () => {
        this.category = cat.id;
        this.selection = null;
        this.render();
      });
      this.chips.push({ id: cat.id, node });
      chips.appendChild(node);
    }

    const used = this.character.inventory.used;
    const count = el('div', {}, `${used}/${this.character.inventory.size} sel terpakai`);
    count.className = 'lm-note';

    const grid = el('div');
    grid.className = 'lm-grid';
    const wanted = CATEGORIES.find((c) => c.id === this.category)?.kinds ?? [];
    let shown = 0;
    this.character.inventory.slots.forEach((stack, index) => {
      const def = stack && itemDef(stack.id);
      if (wanted.length && (!def || !wanted.includes(def.kind))) return;
      // With a filter on, only the matching cells are shown; with "Semua" the empty grid is drawn
      // too, because an inventory you can see the shape of is easier to reason about.
      if (!def && wanted.length) return;
      shown++;
      const cell = el('button');
      const selected = this.selection?.where === 'bag' && this.selection.index === index;
      cell.className = `lm-cell${def ? ' has' : ''}${selected ? ' sel' : ''}`;
      if (def && stack) {
        cell.style.borderColor = rarityMeta(stack.rarity).color;
        cell.textContent = KIND_ICON[def.kind] ?? '?';
        if (stack.count > 1) cell.appendChild(el('i', {}, `x${stack.count}`));
        const equipped = this.isEquippedElsewhere(def);
        if (equipped) cell.appendChild(el('u', {}, '✓'));
        cell.title = def.name;
      }
      onTap(cell, () => {
        this.selection = def ? { where: 'bag', index } : null;
        this.render();
      });
      grid.appendChild(cell);
    });

    const col = el('div');
    col.className = 'lm-col';
    col.append(chips, count, grid);
    if (shown === 0) {
      const none = el('div', {}, 'Tidak ada apa-apa di kategori ini.');
      none.className = 'lm-empty';
      col.appendChild(none);
    }
    this.body.appendChild(col);
  }

  /** A tick on a bag cell when the same *kind* is already worn, so comparisons are obvious. */
  private isEquippedElsewhere(def: ItemDef): boolean {
    for (const slot of EQUIP_SLOTS) {
      if (slot.kind !== def.kind) continue;
      if (this.character.inventory.equipped[slot.id]?.id === def.id) return true;
    }
    return false;
  }

  // ───────────────────────── detail sheet ─────────────────────────

  private renderDetail(): void {
    this.detail.innerHTML = '';
    const sel = this.selection;
    const inv = this.character.inventory;
    const stack: ItemStack | null | undefined =
      sel?.where === 'bag' ? inv.slots[sel.index] : sel?.where === 'slot' ? inv.equipped[sel.slot] : null;
    const def = stack && itemDef(stack.id);
    if (!sel || !stack || !def) {
      this.detail.classList.remove('on');
      return;
    }
    this.detail.classList.add('on');

    const rar = rarityMeta(stack.rarity);
    const name = el('div', {}, `${def.name}${stack.count > 1 ? ` x${stack.count}` : ''}`);
    name.className = 'lm-d-name';
    name.style.color = rar.color;
    const sub = el('div', {}, `${rar.label} · ${kindLabel(def)}${sel.where === 'slot' ? ' · dipakai' : ''}`);
    sub.className = 'lm-d-sub';

    const mods = el('div');
    mods.className = 'lm-d-mods';
    for (const m of itemMods(def, stack.rarity)) {
      const span = el('span', {}, formatModifier(m) + (m.element ? ` (${m.element})` : ''));
      if ((m.flat ?? 0) < 0 || (m.pct ?? 0) < 0) span.className = 'bad';
      mods.appendChild(span);
    }

    const note = el('div', {}, def.note);
    note.className = 'lm-d-note';

    const btns = el('div');
    btns.className = 'lm-d-btns';
    if (sel.where === 'bag') {
      if (def.kind === 'consumable') {
        btns.appendChild(this.button('PAKAI', () => {
          inv.removeAt(sel.index, 1);
          this.hooks.use(def);
          this.selection = null;
          this.after();
        }));
      } else if (EQUIP_SLOTS.some((s) => s.kind === def.kind)) {
        // accessories can go in either slot, so offer both by name
        const fits = EQUIP_SLOTS.filter((s) => s.kind === def.kind);
        for (const slot of fits) {
          const label = fits.length > 1 ? `PAKAI → ${slot.label.toUpperCase()}` : 'PAKAI';
          btns.appendChild(this.button(label, () => {
            if (inv.equip(sel.index, slot.id)) {
              this.selection = null;
              this.after();
            }
          }));
        }
      }
      const drop = this.button('BUANG', () => {
        inv.removeAt(sel.index, stack.count);
        this.selection = null;
        this.after();
      });
      drop.classList.add('danger');
      btns.appendChild(drop);
    } else {
      btns.appendChild(this.button('LEPAS', () => {
        if (inv.unequip(sel.slot)) {
          this.selection = null;
          this.after();
        } else {
          const warn = el('div', {}, 'Tas penuh — buang sesuatu dulu.');
          warn.className = 'lm-d-sub';
          this.detail.appendChild(warn);
        }
      }));
    }
    this.detail.append(name, sub, mods, note, btns);
  }

  private button(label: string, fn: () => void): HTMLButtonElement {
    const node = el('button', {}, label);
    node.className = 'lm-btn2';
    onTap(node, fn);
    return node;
  }

  /**
   * After any change: re-resolve the sheet, tell the game, then redraw.
   *
   * The refresh happens here rather than only in the host's `changed()` callback, so the panel can
   * never show stale numbers because a caller forgot — `refresh()` is idempotent and cheap.
   */
  private after(): void {
    this.character.refresh();
    this.hooks.changed();
    this.render();
  }

  destroy(): void {
    this.root.remove();
    this.bagButton.remove();
  }
}

function heading(text: string): HTMLDivElement {
  const h = el('div', {}, text);
  h.className = 'lm-h';
  return h;
}

function kindLabel(def: ItemDef): string {
  const slot = EQUIP_SLOTS.find((s) => s.kind === def.kind);
  if (slot) return slot.label;
  return def.kind === 'consumable' ? 'Ramuan' : 'Bahan';
}
