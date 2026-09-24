/**
 * The dialogue box (docs/OVERHAUL.md §4 "Cerita").
 *
 * Ported from the 2D `UIScene`, keeping the two things that gave it character: the **typewriter**
 * reveal and the **pixel-art portrait**, which comes straight from the same `buildNpcSheet` the
 * 2D game drew — the art pipeline is pure, so the portraits survive the renderer swap untouched.
 *
 * Tapping anywhere finishes the current page, then advances. While a dialogue is open the game
 * holds still and `input` is disabled, exactly as before.
 */
import { buildNpcSheet } from '../art/characters';
import { wrapText } from '../art/font';
import { input } from '../core/input';
import { settings } from '../core/settings';
import { el, injectStyle } from './dom';
import { pixmapToCanvas } from './pixmapImage';

export interface DialogueSpec {
  name: string;
  /** NPC look id, for the portrait. Omitted for signs. */
  look?: string;
  lines: string[];
  onDone?: () => void;
}

const CSS = `
.lm-dlg { position: fixed; left: 50%; bottom: calc(10px + var(--lm-sab, 0px)); transform: translateX(-50%); z-index: 72;
  width: min(560px, calc(100vw - 20px - var(--lm-sal, 0px) - var(--lm-sar, 0px))); display: none; padding: 9px 11px 11px;
  background: linear-gradient(180deg, rgba(26,20,48,0.95), rgba(15,11,28,0.96));
  border: 1px solid rgba(255,217,138,0.5); border-radius: 6px;
  font: 13px/1.5 ui-monospace, monospace; color: #f2e2c2; pointer-events: auto; touch-action: manipulation; }
.lm-dlg.on { display: flex; gap: 10px; }
.lm-dlg-portrait { flex: 0 0 auto; width: 60px; height: 60px; border-radius: 4px; overflow: hidden;
  background: rgba(15,11,28,0.8); border: 1px solid rgba(154,140,214,0.4); display: flex;
  align-items: flex-end; justify-content: center; }
.lm-dlg-portrait canvas { display: block; }
.lm-dlg-body { flex: 1 1 auto; min-width: 0; }
.lm-dlg-name { color: #ffd98a; margin-bottom: 3px; }
.lm-dlg-text { white-space: pre-line; min-height: 3em; }
.lm-dlg-more { text-align: right; color: #ffd98a; height: 1em; }
`;

/** Characters revealed per second. */
const TYPE_SPEED = 55;

export class Dialogue {
  private box: HTMLDivElement;
  private portraitBox: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private moreEl: HTMLDivElement;
  private portraits = new Map<string, HTMLCanvasElement>();

  private pages: string[] = [];
  private page = 0;
  private chars = 0;
  private spec: DialogueSpec | null = null;
  private blink = 0;
  open = false;
  /** Fires when a dialogue opens or closes, so the game can pause and resume. */
  onOpenChange: (open: boolean) => void = () => undefined;

  constructor(parent: HTMLElement = document.body) {
    injectStyle('lm-ui-dlg', CSS);
    this.box = el('div');
    this.box.className = 'lm-dlg';
    this.portraitBox = el('div');
    this.portraitBox.className = 'lm-dlg-portrait';
    const body = el('div');
    body.className = 'lm-dlg-body';
    this.nameEl = el('div');
    this.nameEl.className = 'lm-dlg-name';
    this.textEl = el('div');
    this.textEl.className = 'lm-dlg-text';
    this.moreEl = el('div', {}, '');
    this.moreEl.className = 'lm-dlg-more';
    body.append(this.nameEl, this.textEl, this.moreEl);
    this.box.append(this.portraitBox, body);
    parent.appendChild(this.box);

    // a tap anywhere on the box advances; the game layer forwards taps elsewhere too
    this.box.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.advance();
    });

    // the portraits are generated once and reused
    const sheet = buildNpcSheet();
    for (const [name, frame] of Object.entries(sheet.frames)) {
      if (!name.startsWith('portrait_')) continue;
      const sub = sheet.pixmap.sub(frame.x, frame.y, frame.w, frame.h);
      this.portraits.set(name.slice('portrait_'.length), pixmapToCanvas(sub, 3));
    }
  }

  show(spec: DialogueSpec): void {
    this.spec = spec;
    this.repaginate();
    this.page = 0;
    this.chars = 0;
    this.open = true;
    input.enabled = false;
    input.stick.x = 0;
    input.stick.y = 0;

    this.nameEl.textContent = spec.name;
    this.portraitBox.textContent = '';
    const art = spec.look ? this.portraits.get(spec.look) : undefined;
    if (art) this.portraitBox.appendChild(art);
    this.portraitBox.style.display = art ? 'flex' : 'none';
    this.textEl.textContent = '';
    this.box.classList.add('on');
    this.onOpenChange(true);
  }

  /** Split the script into pages that fit the box at the player's text size. */
  private repaginate(): void {
    const spec = this.spec;
    if (!spec) return;
    const scale = settings.get('textScale');
    // the pixel font's own metrics, so wrapping matches what is drawn
    const maxW = Math.floor((Math.min(window.innerWidth - 20, 560) - 100) / (scale * 0.9));
    const perPage = scale >= 3 ? 2 : 3;
    this.pages = [];
    for (const line of spec.lines) {
      const wrapped = wrapText(line, Math.max(18, maxW));
      for (let i = 0; i < wrapped.length; i += perPage) this.pages.push(wrapped.slice(i, i + perPage).join('\n'));
    }
    if (!this.pages.length) this.pages = [''];
  }

  /** Finish revealing the page, or move to the next one. */
  advance(): void {
    if (!this.open) return;
    const page = this.pages[this.page] ?? '';
    if (this.chars < page.length) {
      this.chars = page.length;
      return;
    }
    this.page += 1;
    this.chars = 0;
    if (this.page >= this.pages.length) this.close();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.box.classList.remove('on');
    input.enabled = true;
    input.clear();
    const done = this.spec?.onDone;
    this.spec = null;
    this.onOpenChange(false);
    done?.();
  }

  update(dt: number): void {
    if (!this.open) return;
    const page = this.pages[this.page] ?? '';
    if (this.chars < page.length) this.chars = Math.min(page.length, this.chars + dt * TYPE_SPEED);
    const shown = page.slice(0, Math.floor(this.chars));
    if (this.textEl.textContent !== shown) this.textEl.textContent = shown;
    this.blink += dt;
    const ready = this.chars >= page.length;
    const marker = ready && Math.floor(this.blink * 3) % 2 === 0 ? (this.page + 1 >= this.pages.length ? '■' : '▶') : '';
    if (this.moreEl.textContent !== marker) this.moreEl.textContent = marker;
    // keyboard / button advance
    if (input.consume('interact', 60) || input.consume('attack', 60)) this.advance();
  }

  destroy(): void {
    this.box.remove();
  }
}
