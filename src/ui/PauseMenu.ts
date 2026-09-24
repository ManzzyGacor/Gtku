/**
 * The pause menu (docs/OVERHAUL.md §4 "UI": Lanjut, Inventaris, Karakter, Senjata, Skill, Quest,
 * Peta, Pengaturan, Simpan/Keluar).
 *
 * Every entry shows **real state**. That is the whole design constraint here: the plan forbids UI
 * that is not connected to the game, so there is no "Skill" screen listing abilities that do not
 * exist — there is one that lists the skill the hero actually has, with the numbers the combat code
 * uses, and says plainly that the rest are not implemented yet. A menu that lies about what the
 * game contains is worse than a short menu.
 *
 * Laid out for a wide phone held in landscape: the entries are a column down the left at a 44px
 * touch height, and the content opens beside them rather than replacing them, so a 2318x759 screen
 * is used instead of being padded out.
 */
import { el, injectStyle, onTap } from './dom';
import { blurAllowed } from './fx';

const CSS = `
.lm-pause { position: fixed; inset: 0; z-index: 86; display: none;
  background: rgba(8, 6, 16, 0.82);
  font: 13px/1.5 ui-monospace, monospace; color: #e7e0ff; pointer-events: auto; }
.lm-pause.on { display: flex; }
.lm-pause.blur { backdrop-filter: blur(3px); }

.lm-pause-wrap { display: flex; gap: 10px; width: 100%; align-items: stretch;
  padding: calc(10px + var(--lm-sat, 0px)) calc(10px + var(--lm-sar, 0px))
           calc(10px + var(--lm-sab, 0px)) calc(10px + var(--lm-sal, 0px)); }

.lm-pause-side { flex: 0 0 auto; width: min(230px, 32vw); display: flex; flex-direction: column; gap: 5px;
  overflow-y: auto; -webkit-overflow-scrolling: touch; }
.lm-pause-title { color: #ffd98a; letter-spacing: 3px; font-size: 15px; padding: 2px 4px 6px; }
.lm-pause-item { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px;
  border-radius: 5px; cursor: pointer; font: inherit; text-align: left; color: #d9cfff;
  background: linear-gradient(180deg, rgba(44,36,74,0.9), rgba(20,16,38,0.9));
  border: 1px solid rgba(154,140,214,0.35); touch-action: manipulation;
  transition: transform 90ms ease, border-color 120ms ease, color 120ms ease; }
.lm-pause-item:active { transform: scale(0.97); }
.lm-pause-item.on { color: #1a1430; border-color: #ffd98a;
  background: linear-gradient(180deg, #ffd98a, #e0a33a); }
.lm-pause-item .k { width: 1.3em; text-align: center; opacity: 0.85; }
.lm-pause-item.quit { color: #ffc0c0; border-color: rgba(255,120,140,0.45); }

.lm-pause-main { flex: 1 1 auto; min-width: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 4px 10px 10px; border-radius: 6px;
  background: linear-gradient(180deg, rgba(26,20,48,0.72), rgba(14,10,28,0.78));
  border: 1px solid rgba(154,140,214,0.3); }
.lm-pause-h { color: #ffd98a; letter-spacing: 2px; font-size: 12px; margin: 8px 0 6px; }
.lm-pause-row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 7px;
  border-radius: 4px; background: rgba(18,14,34,0.6); margin-bottom: 3px; }
.lm-pause-row b { color: #fff8e6; font-weight: normal; }
.lm-pause-row.off { opacity: 0.55; }
.lm-pause-note { color: #8189a8; font-size: 11px; margin-top: 6px; white-space: pre-line; }
.lm-pause-map { display: block; image-rendering: pixelated; width: 100%; height: auto;
  border: 1px solid rgba(154,140,214,0.4); border-radius: 4px; background: #0b0816; }
.lm-pause-btn { min-height: 44px; min-width: 130px; padding: 0 16px; margin-top: 10px;
  border-radius: 5px; cursor: pointer; font: inherit; letter-spacing: 1px; color: #ffc0c0;
  background: rgba(60,22,34,0.9); border: 1px solid rgba(255,120,140,0.5); touch-action: manipulation; }
.lm-pause-btn:active { background: #ff5a4a; color: #1a1430; }
`;

/** What the menu needs from the game. Every one of these reads or writes live state. */
export interface PauseHooks {
  /** Close and hand control back. */
  resume(): void;
  /** Open the character sheet on a given tab. */
  openSheet(tab: 'char' | 'bag'): void;
  openSettings(): void;
  /** Save, then leave to the title screen. */
  saveAndQuit(): void;
  /** Live lines for the Senjata / Skill / Quest pages. */
  weapons(): InfoLine[];
  skills(): InfoLine[];
  quest(): InfoLine[];
  /** The whole-world map image plus where the hero is, in tiles. */
  map(): { atlas: HTMLCanvasElement; heroTx: number; heroTy: number; marks: { tx: number; ty: number; color: string }[] } | null;
}

export interface InfoLine {
  label: string;
  value: string;
  /** Rendered dimmed, for things that exist as data but are not implemented yet. */
  dim?: boolean | undefined;
  /** A free-form paragraph under the rows. */
  note?: string | undefined;
}

type PageId = 'weapons' | 'skills' | 'quest' | 'map';

interface Entry {
  id: string;
  label: string;
  /** Keyboard shortcut shown in the list. */
  key: string;
  run: (menu: PauseMenu) => void;
  quit?: boolean;
}

const ENTRIES: Entry[] = [
  { id: 'resume', label: 'LANJUT', key: 'Esc', run: (m) => m.close() },
  { id: 'bag', label: 'Inventaris', key: 'I', run: (m) => m.openSheet('bag') },
  { id: 'char', label: 'Karakter', key: 'C', run: (m) => m.openSheet('char') },
  { id: 'weapons', label: 'Senjata', key: '1', run: (m) => m.show('weapons') },
  { id: 'skills', label: 'Skill', key: '2', run: (m) => m.show('skills') },
  { id: 'quest', label: 'Quest', key: 'Q', run: (m) => m.show('quest') },
  { id: 'map', label: 'Peta', key: 'M', run: (m) => m.show('map') },
  { id: 'settings', label: 'Pengaturan', key: 'S', run: (m) => m.openSettings() },
  { id: 'quit', label: 'Simpan & Keluar', key: '', run: (m) => m.confirmQuit(), quit: true },
];

export class PauseMenu {
  private root: HTMLDivElement;
  private side: HTMLDivElement;
  private main: HTMLDivElement;
  private items = new Map<string, HTMLButtonElement>();
  private page: PageId = 'quest';
  private open = false;

  /** Fires on open/close so the game can pause and hide the HUD. */
  onToggle: (open: boolean) => void = () => undefined;

  constructor(
    private readonly hooks: PauseHooks,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-pause', CSS);
    this.root = el('div');
    this.root.className = 'lm-pause';

    const wrap = el('div');
    wrap.className = 'lm-pause-wrap';
    this.side = el('div');
    this.side.className = 'lm-pause-side';
    const title = el('div', {}, 'JEDA');
    title.className = 'lm-pause-title';
    this.side.appendChild(title);

    for (const entry of ENTRIES) {
      const node = el('button');
      node.className = `lm-pause-item${entry.quit ? ' quit' : ''}`;
      const k = el('span', {}, entry.key);
      k.className = 'k';
      node.append(k, el('span', {}, entry.label));
      onTap(node, () => entry.run(this));
      this.items.set(entry.id, node);
      this.side.appendChild(node);
    }

    this.main = el('div');
    this.main.className = 'lm-pause-main';

    wrap.append(this.side, this.main);
    this.root.appendChild(wrap);
    // taps inside the menu must never reach the game's stick underneath
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  openMenu(): void {
    if (this.open) return;
    this.open = true;
    // Blur is the one effect gated on the graphics preset: it is a full-screen filter, and on a
    // weak phone it is the difference between a menu that opens and a menu that stutters open.
    this.root.classList.toggle('blur', blurAllowed());
    this.root.classList.add('on');
    this.render();
    this.onToggle(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('on');
    this.onToggle(false);
    this.hooks.resume();
  }

  show(page: PageId): void {
    this.page = page;
    this.render();
  }

  openSheet(tab: 'char' | 'bag'): void {
    this.close();
    this.hooks.openSheet(tab);
  }

  openSettings(): void {
    this.close();
    this.hooks.openSettings();
  }

  /** Quitting saves first, so the button is honest about the order it does things in. */
  confirmQuit(): void {
    this.main.innerHTML = '';
    this.main.appendChild(heading('SIMPAN & KELUAR'));
    const note = el('div', {}, 'Progresmu disimpan lebih dulu, lalu game kembali ke layar judul.');
    note.className = 'lm-pause-note';
    const go = el('button', {}, 'SIMPAN & KELUAR');
    go.className = 'lm-pause-btn';
    onTap(go, () => this.hooks.saveAndQuit());
    this.main.append(note, go);
    for (const [, node] of this.items) node.classList.remove('on');
    this.items.get('quit')?.classList.add('on');
  }

  private render(): void {
    for (const [id, node] of this.items) node.classList.toggle('on', id === this.page);
    this.main.innerHTML = '';
    if (this.page === 'map') {
      this.renderMap();
      return;
    }
    const lines = this.page === 'weapons' ? this.hooks.weapons() : this.page === 'skills' ? this.hooks.skills() : this.hooks.quest();
    const titles: Record<PageId, string> = { weapons: 'SENJATA', skills: 'SKILL', quest: 'QUEST', map: 'PETA' };
    this.main.appendChild(heading(titles[this.page]));
    for (const line of lines) {
      if (line.note !== undefined && !line.label) {
        const note = el('div', {}, line.note);
        note.className = 'lm-pause-note';
        this.main.appendChild(note);
        continue;
      }
      const row = el('div');
      row.className = `lm-pause-row${line.dim ? ' off' : ''}`;
      row.append(el('span', {}, line.label), el('b', {}, line.value));
      this.main.appendChild(row);
      if (line.note) {
        const note = el('div', {}, line.note);
        note.className = 'lm-pause-note';
        this.main.appendChild(note);
      }
    }
  }

  /**
   * The full map: the minimap's own world atlas, scaled up.
   *
   * Drawn rather than described because a map is the one screen where a picture is the information.
   * It reuses the atlas the minimap already built at one pixel per tile, so opening this costs a
   * single `drawImage` instead of walking 32,768 tiles again.
   */
  private renderMap(): void {
    this.main.appendChild(heading('PETA'));
    const data = this.hooks.map();
    if (!data) {
      const note = el('div', {}, 'Peta belum tersedia.');
      note.className = 'lm-pause-note';
      this.main.appendChild(note);
      return;
    }
    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.className = 'lm-pause-map';
    canvas.width = data.atlas.width * scale;
    canvas.height = data.atlas.height * scale;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(data.atlas, 0, 0, canvas.width, canvas.height);
      const dot = (tx: number, ty: number, color: string, size: number): void => {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(tx * scale) - size, Math.round(ty * scale) - size, size * 2, size * 2);
      };
      for (const m of data.marks) dot(m.tx, m.ty, m.color, 3);
      dot(data.heroTx, data.heroTy, '#ffffff', 4);
    }
    this.main.appendChild(canvas);
    const note = el('div', {}, 'Putih: kamu. Kuning: tujuan quest. Jingga: altar istirahat. Merah: boss.');
    note.className = 'lm-pause-note';
    this.main.appendChild(note);
  }

  destroy(): void {
    this.root.remove();
  }
}

function heading(text: string): HTMLDivElement {
  const h = el('div', {}, text);
  h.className = 'lm-pause-h';
  return h;
}
