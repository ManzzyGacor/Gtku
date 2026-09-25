/**
 * The Mission Board's panel: make or join a co-op room, the lobby, and the result
 * (docs/MULTIPLAYER.md). Renderer-free: it only draws what a `CoopView` says and calls it back.
 *
 * During the fight itself the panel steps aside for a small party strip (names and HP), so the
 * arena stays visible; it comes back for the result.
 */
import { COOP_ERROR_TEXT, CODE_ALPHABET, CODE_LENGTH, type ClientMsg, type CoopError, type RoomPhase } from '../../shared/coop/protocol';
import type { CoopStatus, Result, RoomView } from '../core/coop/client';
import { el, injectStyle, onTap } from './dom';

/** What the panel needs from the co-op client (and the game). */
export interface CoopView {
  status: CoopStatus;
  room: RoomView | null;
  lastError: CoopError | null;
  result: Result | null;
  go(msg: ClientMsg): void;
  ready(on: boolean): void;
  start(): void;
  leave(): void;
}

export interface CoopPanelOptions {
  /** Why co-op cannot be used right now (no server account, offline), or null when it can. */
  unavailable: () => string | null;
  /** A developer account: public rooms are not offered. */
  developer: () => boolean;
  /** Item names for the result screen. */
  itemName: (id: string) => string;
  onClose: () => void;
}

const CSS = `
/* 87: over the pause menu, under the character sheet (same layer as the merchant's stall) */
.lm-coop { position: fixed; inset: 0; z-index: 87; display: none; align-items: center; justify-content: center;
  background: rgba(9,7,18,0.62); font: 12px/1.45 ui-monospace, monospace; color: #e7e0ff; pointer-events: auto; }
.lm-coop.on { display: flex; }
.lm-coop-card { width: min(460px, calc(100% - 16px - var(--lm-sal, 0px) - var(--lm-sar, 0px)));
  max-height: calc(100% - 16px - var(--lm-sat, 0px) - var(--lm-sab, 0px)); overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 6px;
  background: linear-gradient(180deg, rgba(34,26,62,0.97), rgba(16,12,30,0.97)); border: 1px solid rgba(255,217,138,0.45);
  animation: lm-coop-in 200ms ease both; }
@keyframes lm-coop-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.lm-coop-title { color: #ffd98a; letter-spacing: 2px; font-size: 13px; }
.lm-coop-note { color: #a79dc4; font-size: 11px; }
.lm-coop-err { color: #ff9a8a; min-height: 1.3em; }
.lm-coop-row { display: flex; gap: 6px; align-items: center; }
.lm-coop-btn { flex: 1; min-height: 44px; border-radius: 5px; cursor: pointer; font: inherit; letter-spacing: 1px; touch-action: manipulation;
  color: #f2e2c2; background: linear-gradient(180deg, rgba(58,47,94,0.9), rgba(26,20,48,0.9)); border: 1px solid rgba(255,217,138,0.45); }
.lm-coop-btn:disabled { opacity: 0.45; }
.lm-coop-btn.main { color: #1a1430; background: #ffd98a; }
.lm-coop-btn.ghost { border-color: rgba(154,140,214,0.4); color: #b9b0d8; }
.lm-coop-input { flex: 1; min-height: 44px; padding: 0 10px; font: inherit; font-size: 18px; letter-spacing: 6px; text-transform: uppercase;
  text-align: center; border-radius: 5px; color: #fff8e6; background: rgba(12,9,26,0.9); border: 1px solid rgba(255,217,138,0.5); }
.lm-coop-code { font-size: 28px; letter-spacing: 8px; color: #fff0c8; text-align: center; }
.lm-coop-p { display: flex; justify-content: space-between; padding: 6px 8px; border-radius: 4px; background: rgba(20,16,38,0.7); }
.lm-coop-p b { font-weight: normal; color: #fff8e6; }
.lm-coop-p .ok { color: #7cf07c; } .lm-coop-p .wait { color: #a79dc4; } .lm-coop-p .off { color: #ffb04a; }
/* during the fight: a small party strip, not a panel (81: its leave button sits above the touch layer) */
.lm-coop-party { position: fixed; z-index: 81; left: calc(8px + var(--lm-sal, 0px)); top: calc(92px + var(--lm-sat, 0px));
  display: none; flex-direction: column; gap: 3px; pointer-events: none; font: 11px/1.2 ui-monospace, monospace; color: #e7e0ff; }
.lm-coop-party.on { display: flex; }
.lm-coop-party .row { display: flex; align-items: center; gap: 5px; }
.lm-coop-party .bar { width: 64px; height: 5px; background: rgba(10,8,20,0.8); border-radius: 2px; overflow: hidden; }
.lm-coop-party .bar > i { display: block; height: 100%; background: #7cf07c; }
.lm-coop-party .leave { pointer-events: auto; align-self: flex-start; margin-top: 4px; min-height: 30px; padding: 0 10px; border-radius: 15px;
  font: inherit; color: #ffd0d0; background: rgba(60,22,34,0.85); border: 1px solid rgba(255,120,140,0.5); touch-action: manipulation; }
.lm-coop-status { position: fixed; z-index: 67; left: 50%; transform: translateX(-50%); top: calc(52px + var(--lm-sat, 0px));
  display: none; padding: 4px 10px; border-radius: 4px; background: rgba(70,44,10,0.9); color: #ffe0a8; font: 11px ui-monospace, monospace; pointer-events: none; }
.lm-coop-status.on { display: block; }
`;

export class CoopPanel {
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private party: HTMLDivElement;
  private statusLine: HTMLDivElement;
  private open = false;
  private code = '';
  private readyOn = false;

  constructor(
    private readonly view: CoopView,
    private readonly opts: CoopPanelOptions,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-coop', CSS);
    this.root = el('div');
    this.root.className = 'lm-coop';
    this.card = el('div');
    this.card.className = 'lm-coop-card';
    this.root.appendChild(this.card);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) this.root.addEventListener(type, (e) => e.stopPropagation());
    this.party = el('div');
    this.party.className = 'lm-coop-party';
    this.statusLine = el('div');
    this.statusLine.className = 'lm-coop-status';
    parent.append(this.root, this.party, this.statusLine);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The phase the room is in, or null outside a room. */
  get phase(): RoomPhase | null {
    return this.view.room?.phase ?? null;
  }

  show(): void {
    this.open = true;
    this.render();
  }

  /** Close the board (leaving any room). */
  close(): void {
    if (this.view.room || this.view.status === 'connecting') this.view.leave();
    this.open = false;
    this.readyOn = false;
    this.render();
    this.opts.onClose();
  }

  /** Redraw from the client's state. Called on every change. */
  render(): void {
    const v = this.view;
    const fighting = v.room?.phase === 'fight' && !v.result;
    this.root.classList.toggle('on', this.open && !fighting);
    this.party.classList.toggle('on', this.open && fighting);
    const reconnecting = v.status === 'reconnecting';
    this.statusLine.classList.toggle('on', this.open && reconnecting);
    this.statusLine.textContent = reconnecting ? 'Koneksi terputus — menyambung kembali…' : '';
    if (!this.open) return;
    if (fighting) return;
    const c = this.card;
    c.innerHTML = '';
    c.appendChild(this.text('PAPAN MISI · BAYANG KOLOSUS', 'lm-coop-title'));

    const blocked = this.opts.unavailable();
    if (blocked) {
      c.appendChild(this.text(blocked, 'lm-coop-note'));
      c.appendChild(this.row(this.btn('TUTUP', () => this.close(), 'ghost')));
      return;
    }
    if (v.result) return this.renderResult(v.result);
    if (v.room) return this.renderLobby(v.room);
    if (v.status === 'connecting') {
      c.appendChild(this.text('Menghubungkan ke server…', 'lm-coop-note'));
      c.appendChild(this.row(this.btn('BATAL', () => this.close(), 'ghost')));
      return;
    }
    this.renderMenu();
  }

  private renderMenu(): void {
    const c = this.card;
    c.appendChild(this.text('Lawan bayangan Kolosus bersama sampai 4 pemain. Dunia utamamu tetap pribadi; hanya pertarungan ini yang bersama.', 'lm-coop-note'));
    c.appendChild(this.row(this.btn('BUAT ROOM PRIVAT', () => this.view.go({ t: 'create' }), 'main')));
    const input = el('input');
    input.className = 'lm-coop-input';
    input.setAttribute('maxlength', String(CODE_LENGTH));
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', 'KODE');
    input.value = this.code;
    input.addEventListener('input', () => {
      this.code = [...input.value.toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, CODE_LENGTH);
      input.value = this.code;
    });
    const join = this.btn('GABUNG', () => {
      if (this.code.length === CODE_LENGTH) this.view.go({ t: 'join', code: this.code });
    });
    c.appendChild(this.row(input, join));
    if (this.opts.developer()) c.appendChild(this.text('Akun pengembang hanya bisa bermain di room privat.', 'lm-coop-note'));
    else c.appendChild(this.row(this.btn('CARI ROOM PUBLIK', () => this.view.go({ t: 'quick' }))));
    this.appendError();
    c.appendChild(this.row(this.btn('TUTUP', () => this.close(), 'ghost')));
  }

  private renderLobby(room: RoomView): void {
    const c = this.card;
    const me = room.players.find((p) => p.id === room.you);
    c.appendChild(this.text(room.public ? 'ROOM PUBLIK' : 'KODE ROOM', 'lm-coop-note'));
    c.appendChild(this.text(room.code, 'lm-coop-code'));
    if (!room.public) c.appendChild(this.text('Bagikan kode ini ke temanmu. Maksimal 4 pemain.', 'lm-coop-note'));
    for (const p of room.players) {
      const line = el('div');
      line.className = 'lm-coop-p';
      const who = el('span');
      who.appendChild(el('b', {}, `${p.host ? '★ ' : ''}${p.name}`));
      who.appendChild(el('span', {}, `  Lv ${p.level}${p.id === room.you ? ' (kamu)' : ''}`));
      const state = el('span', {}, !p.connected ? 'terputus' : p.host ? 'pembuat' : p.ready ? 'siap' : 'menunggu');
      state.className = !p.connected ? 'off' : p.ready || p.host ? 'ok' : 'wait';
      line.append(who, state);
      c.appendChild(line);
    }
    const buttons: HTMLElement[] = [];
    if (me?.host) {
      const allReady = room.players.every((p) => p.host || p.ready || !p.connected);
      const start = this.btn('MULAI', () => this.view.start(), 'main');
      start.disabled = !allReady;
      buttons.push(start);
    } else {
      buttons.push(
        this.btn(this.readyOn ? 'BATAL SIAP' : 'SIAP', () => {
          this.readyOn = !this.readyOn;
          this.view.ready(this.readyOn);
          this.render();
        }, this.readyOn ? '' : 'main'),
      );
    }
    buttons.push(this.btn('KELUAR ROOM', () => {
      this.view.leave();
      this.readyOn = false;
      this.render();
    }, 'ghost'));
    c.appendChild(this.row(...buttons));
    this.appendError();
  }

  private renderResult(r: Result): void {
    const c = this.card;
    c.appendChild(this.text(r.won ? 'MENANG!' : 'KALAH', 'lm-coop-code'));
    if (r.won) {
      c.appendChild(this.text(`+${r.exp} EXP · +${r.coins} koin`, 'lm-coop-note'));
      for (const it of r.items) c.appendChild(this.text(`✧ ${this.opts.itemName(it.id)}${it.count > 1 ? ` x${it.count}` : ''} (${it.rarity})`, ''));
      c.appendChild(this.text(r.save ? 'Hadiah sudah disimpan server ke progresmu.' : 'Hadiah tidak tersimpan: progresmu belum pernah tersinkron ke server.', 'lm-coop-note'));
    } else c.appendChild(this.text('Seluruh tim jatuh. Coba lagi dengan menghindari lingkaran merah dan berguling tepat waktu.', 'lm-coop-note'));
    c.appendChild(this.row(this.btn('KEMBALI KE DESA', () => this.close(), 'main')));
  }

  /** The strip shown during the fight: every player's name and HP. */
  setParty(rows: { name: string; hp: number; maxHp: number; down: boolean; you: boolean }[]): void {
    const key = rows.map((r) => `${r.name}${r.hp}${r.down}`).join('|');
    if (this.party.dataset.key === key) return;
    this.party.dataset.key = key;
    this.party.innerHTML = '';
    for (const r of rows) {
      const row = el('div');
      row.className = 'row';
      const bar = el('div');
      bar.className = 'bar';
      const fill = el('i');
      fill.style.width = `${Math.max(0, Math.min(100, (r.hp / Math.max(1, r.maxHp)) * 100))}%`;
      if (r.down) fill.style.background = '#ff5a4a';
      bar.appendChild(fill);
      row.append(bar, el('span', {}, `${r.name}${r.you ? ' ★' : ''}${r.down ? ' (jatuh)' : ''}`));
      this.party.appendChild(row);
    }
    // leaving mid-fight: the only tappable thing in the strip
    const leave = el('button', {}, 'KELUAR');
    leave.className = 'leave';
    onTap(leave, () => this.close());
    this.party.appendChild(leave);
  }

  private appendError(): void {
    const e = this.view.lastError;
    this.card.appendChild(this.text(e ? COOP_ERROR_TEXT[e] : '', 'lm-coop-err'));
  }

  private text(t: string, cls: string): HTMLDivElement {
    const d = el('div', {}, t);
    if (cls) d.className = cls;
    return d;
  }

  private row(...kids: HTMLElement[]): HTMLDivElement {
    const r = el('div');
    r.className = 'lm-coop-row';
    r.append(...kids);
    return r;
  }

  private btn(label: string, run: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', {}, label);
    b.className = `lm-coop-btn${cls ? ` ${cls}` : ''}`;
    onTap(b, () => {
      if (!b.disabled) run();
    });
    return b;
  }

  destroy(): void {
    this.root.remove();
    this.party.remove();
    this.statusLine.remove();
  }
}
