/**
 * The wandering merchant's stall (world event "Pedagang Keliling").
 *
 * Only draws what `ShopSource` says and only changes state through it: the coins are the
 * character's, the stock is the event's, and a purchase goes into the real bag. Nothing here is
 * decorative — the plan does not allow a shop that is only a picture of a shop.
 */
import { el, injectStyle, onTap } from './dom';

export interface ShopRow {
  name: string;
  note: string;
  rarityLabel: string;
  /** CSS colour of the rarity. */
  color: string;
  price: number;
  stock: number;
}

export interface ShopSource {
  title(): string;
  coins(): number;
  rows(): ShopRow[];
  /** Buy row `index`; returns the line to show ("… masuk tas", "Koin tidak cukup"). */
  buy(index: number): string;
  /** Seconds until the merchant leaves, for the header. */
  secondsLeft(): number;
}

const CSS = `
/*
 * Layer 87: above the pause menu (86), below the character sheet (88) so "is it better than what I
 * wear?" can be checked from here without closing the stall.
 */
.lm-shop { position: fixed; inset: 0; z-index: 87; display: none; align-items: center; justify-content: center;
  background: rgba(9,7,18,0.6); font: 12px/1.4 ui-monospace, monospace; color: #e7e0ff; pointer-events: auto; }
.lm-shop.on { display: flex; }
.lm-shop-card { width: min(520px, calc(100% - 16px - var(--lm-sal, 0px) - var(--lm-sar, 0px))); max-height: calc(100% - 16px - var(--lm-sat, 0px) - var(--lm-sab, 0px));
  display: flex; flex-direction: column; border-radius: 6px; overflow: hidden;
  background: linear-gradient(180deg, rgba(34,26,62,0.97), rgba(16,12,30,0.97)); border: 1px solid rgba(255,217,138,0.45);
  animation: lm-shop-in 200ms ease both; }
@keyframes lm-shop-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.lm-shop-top { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(154,140,214,0.35); }
.lm-shop-title { flex: 1; color: #ffd98a; letter-spacing: 1px; }
.lm-shop-coins { color: #ffe066; }
.lm-shop-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 0; }
.lm-shop-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; }
.lm-shop-row + .lm-shop-row { border-top: 1px solid rgba(58,47,94,0.6); }
.lm-shop-name { flex: 1; min-width: 0; }
.lm-shop-name small { display: block; color: #8189a8; font-size: 10.5px; }
.lm-shop-price { min-width: 64px; text-align: right; color: #ffe066; }
.lm-shop-btn { min-width: 72px; min-height: 44px; border-radius: 4px; cursor: pointer; font: inherit; touch-action: manipulation;
  color: #1a1430; background: #ffd98a; border: 1px solid #fff0c8; }
.lm-shop-btn:disabled { opacity: 0.4; }
.lm-shop-btn.x { min-width: 44px; color: #ffd0d0; background: rgba(60,22,34,0.85); border-color: rgba(255,120,140,0.5); }
.lm-shop-msg { flex: none; min-height: 1.4em; padding: 6px 10px; color: #b9e6a8; border-top: 1px solid rgba(154,140,214,0.35); }
`;

export class ShopPanel {
  private root: HTMLDivElement;
  private title: HTMLDivElement;
  private coins: HTMLDivElement;
  private list: HTMLDivElement;
  private msg: HTMLDivElement;
  private open = false;
  /** The game pauses while the stall is open. */
  onToggle: (open: boolean) => void = () => undefined;

  constructor(
    private readonly source: ShopSource,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-shop', CSS);
    this.root = el('div');
    this.root.className = 'lm-shop';
    const card = el('div');
    card.className = 'lm-shop-card';
    const top = el('div');
    top.className = 'lm-shop-top';
    this.title = el('div');
    this.title.className = 'lm-shop-title';
    this.coins = el('div');
    this.coins.className = 'lm-shop-coins';
    const close = el('button', {}, '✕');
    close.className = 'lm-shop-btn x';
    onTap(close, () => this.hide());
    top.append(this.title, this.coins, close);
    this.list = el('div');
    this.list.className = 'lm-shop-list';
    this.msg = el('div');
    this.msg.className = 'lm-shop-msg';
    card.append(top, this.list, this.msg);
    this.root.appendChild(card);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) this.root.addEventListener(type, (e) => e.stopPropagation());
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.msg.textContent = '';
    this.root.classList.add('on');
    this.render();
    this.onToggle(true);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('on');
    this.onToggle(false);
  }

  /** Redraw from the source (after a purchase, or when the countdown ticks). */
  render(): void {
    const left = Math.max(0, Math.ceil(this.source.secondsLeft()));
    this.title.textContent = `${this.source.title()} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    this.coins.textContent = `◉ ${this.source.coins()}`;
    this.list.innerHTML = '';
    const coins = this.source.coins();
    this.source.rows().forEach((row, i) => {
      const line = el('div');
      line.className = 'lm-shop-row';
      const name = el('div');
      name.className = 'lm-shop-name';
      const title = el('span', {}, row.name);
      title.style.color = row.color;
      name.append(title, el('small', {}, `${row.rarityLabel} · sisa ${row.stock} · ${row.note}`));
      const price = el('div', {}, `◉ ${row.price}`);
      price.className = 'lm-shop-price';
      const buy = el('button', {}, row.stock > 0 ? 'BELI' : 'HABIS');
      buy.className = 'lm-shop-btn';
      buy.disabled = row.stock <= 0 || coins < row.price;
      onTap(buy, () => {
        if (buy.disabled) return;
        this.msg.textContent = this.source.buy(i);
        this.render();
      });
      line.append(name, price, buy);
      this.list.appendChild(line);
    });
  }

  destroy(): void {
    this.root.remove();
  }
}
