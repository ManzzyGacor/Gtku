/**
 * Download Manager and the "Data Dunia Diperlukan" prompt (docs/OVERHAUL.md §4 "Streaming &
 * Download Manager").
 *
 * Both read the same `DataSource`, so the prompt that stops you at the forest's edge and the
 * manager in Settings can never disagree about what is downloaded. Every number shown is live:
 * the status comes from the installed markers, the progress from the bytes actually received, and
 * the storage line from `navigator.storage.estimate()`.
 */
import { formatBytes } from '../core/download/manifest';
import type { DataStatus } from '../core/download/gate';
import { el, injectStyle, onTap } from './dom';

export interface DataAreaView {
  id: string;
  name: string;
  status: DataStatus;
  /** Total size of the area's data. */
  bytes: number;
  /** Bytes in hand right now (mid-download, or what a resume would start from). */
  done: number;
  error?: string | undefined;
  /** The core area is never asked for; it downloads by itself. */
  core: boolean;
}

export interface DataSource {
  readonly available: boolean;
  manifestError(): string | null;
  areas(): Promise<DataAreaView[]>;
  download(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  storage(): Promise<{ usage: number; quota: number; persisted: boolean | null }>;
  requestPersist(): Promise<boolean | null>;
  /** Subscribe to changes (progress, status). Returns an unsubscribe. */
  subscribe(fn: () => void): () => void;
}

const STATUS_LABEL: Record<DataStatus, string> = {
  terpasang: 'Terpasang',
  belum: 'Belum diunduh',
  'versi-baru': 'Versi baru tersedia',
  mengunduh: 'Mengunduh…',
  gagal: 'Gagal',
};

const CSS = `
.lm-dm { position: fixed; inset: 0; z-index: 98; display: none; pointer-events: auto;
  background: rgba(8, 6, 16, 0.86); font: 12px/1.5 ui-monospace, monospace; color: #e7e0ff; }
.lm-dm.on { display: flex; align-items: stretch; justify-content: center; }
.lm-dm-card { width: min(640px, 100%); display: flex; flex-direction: column; border-radius: 6px; overflow: hidden;
  margin: calc(8px + var(--lm-sat, 0px)) calc(8px + var(--lm-sar, 0px)) calc(8px + var(--lm-sab, 0px)) calc(8px + var(--lm-sal, 0px));
  background: rgba(20, 16, 38, 0.97); border: 1px solid #3a2f5e; }
.lm-dm-top { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #3a2f5e; }
.lm-dm-title { flex: 1; color: #ffd98a; letter-spacing: 2px; }
.lm-dm-body { flex: 1; overflow-y: auto; padding: 6px 10px 12px; }
.lm-dm-area { padding: 8px 0 10px; border-bottom: 1px solid rgba(58, 47, 94, 0.6); }
.lm-dm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lm-dm-name { flex: 1; min-width: 8em; }
.lm-dm-name small { display: block; color: #8189a8; }
.lm-dm-status { color: #b7f0b7; }
.lm-dm-status.warn { color: #ffd15a; }
.lm-dm-status.bad { color: #ff8a7a; }
.lm-dm-bar { height: 8px; margin-top: 6px; border-radius: 4px; background: #140f26; overflow: hidden;
  border: 1px solid rgba(154, 140, 214, 0.35); }
.lm-dm-bar > div { height: 100%; width: 0; background: linear-gradient(90deg, #5aa9ff, #8befeb); transition: width 160ms linear; }
.lm-dm-btn { min-height: 40px; min-width: 84px; padding: 0 12px; border-radius: 4px; cursor: pointer; font: inherit;
  color: #f2e2c2; background: #241c44; border: 1px solid rgba(255, 217, 138, 0.45); touch-action: manipulation; }
.lm-dm-btn:active { background: #ffb82e; color: #1a1430; }
.lm-dm-btn.danger { color: #ffc0c0; border-color: rgba(255, 120, 140, 0.5); }
.lm-dm-note { color: #8189a8; font-size: 11px; margin-top: 4px; white-space: pre-line; }
.lm-dm-storage { padding: 8px 0; color: #cfc6ff; }

/* the prompt at an area's edge */
.lm-dr { position: fixed; inset: 0; z-index: 92; display: none; pointer-events: auto;
  background: rgba(6, 4, 14, 0.6); font: 13px/1.5 ui-monospace, monospace; color: #e7e0ff; }
.lm-dr.on { display: flex; align-items: center; justify-content: center; }
.lm-dr-card { width: min(460px, calc(100vw - 32px)); padding: 14px 16px; border-radius: 8px;
  background: linear-gradient(180deg, rgba(30, 24, 56, 0.97), rgba(14, 11, 28, 0.98));
  border: 1px solid rgba(255, 217, 138, 0.45); animation: lm-dr-in 200ms ease both; }
@keyframes lm-dr-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.lm-dr-title { color: #ffd98a; letter-spacing: 2px; margin-bottom: 4px; }
.lm-dr-btns { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
`;

const pct = (done: number, total: number): number => (total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0);

export class DownloadManager {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private open = false;
  private unsubscribe: (() => void) | null = null;
  private status = '';

  constructor(
    private readonly source: DataSource,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-dm', CSS);
    this.root = el('div');
    this.root.className = 'lm-dm';
    const card = el('div');
    card.className = 'lm-dm-card';
    const top = el('div');
    top.className = 'lm-dm-top';
    const title = el('div', {}, 'DATA DUNIA');
    title.className = 'lm-dm-title';
    const close = el('button', {}, 'TUTUP');
    close.className = 'lm-dm-btn';
    onTap(close, () => this.close());
    top.append(title, close);
    this.body = el('div');
    this.body.className = 'lm-dm-body';
    card.append(top, this.body);
    this.root.appendChild(card);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) this.root.addEventListener(type, (e) => e.stopPropagation());
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.root.classList.add('on');
    this.unsubscribe = this.source.subscribe(() => void this.render());
    void this.render();
  }

  close(): void {
    this.open = false;
    this.root.classList.remove('on');
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async render(): Promise<void> {
    if (!this.open) return;
    const areas = await this.source.areas();
    const storage = await this.source.storage();
    this.body.innerHTML = '';

    if (!this.source.available) {
      this.body.appendChild(note('Browser ini tidak bisa menyimpan data dunia (Cache Storage tidak tersedia).\nGame tetap bisa dimainkan: tanah dipanggang langsung di HP.'));
      return;
    }
    const err = this.source.manifestError();
    if (err) this.body.appendChild(note(`Daftar data belum bisa dibaca: ${err}\nArea yang sudah terpasang tetap bisa dipakai.`));

    for (const a of areas) this.body.appendChild(this.areaRow(a));

    const st = el('div');
    st.className = 'lm-dm-storage';
    const free = storage.quota > 0 ? storage.quota - storage.usage : 0;
    st.textContent = storage.quota > 0
      ? `Penyimpanan: terpakai ${formatBytes(storage.usage)} dari ${formatBytes(storage.quota)} (sisa ${formatBytes(free)})`
      : 'Penyimpanan: browser tidak memberi angka kapasitas';
    this.body.appendChild(st);

    const persist = el('div');
    persist.className = 'lm-dm-row';
    const label = el('div', {}, storage.persisted === null
      ? 'Penyimpanan permanen: tidak didukung browser ini'
      : storage.persisted
        ? 'Penyimpanan permanen: diizinkan (data tidak akan dihapus otomatis)'
        : 'Penyimpanan permanen: belum — browser boleh menghapus data saat ruang sempit');
    label.className = 'lm-dm-name';
    persist.appendChild(label);
    if (storage.persisted === false) {
      persist.appendChild(this.button('MINTA IZIN', async () => {
        const ok = await this.source.requestPersist();
        this.status = ok ? 'Izin penyimpanan permanen diberikan.' : 'Browser menolak (biasanya diberikan otomatis setelah situs sering dipakai).';
      }));
    }
    this.body.appendChild(persist);
    if (this.status) this.body.appendChild(note(this.status));
  }

  private areaRow(a: DataAreaView): HTMLDivElement {
    const box = el('div');
    box.className = 'lm-dm-area';
    const row = el('div');
    row.className = 'lm-dm-row';
    const name = el('div');
    name.className = 'lm-dm-name';
    name.append(el('span', {}, a.name), el('small', {}, `${formatBytes(a.bytes)}${a.core ? ' · data inti, diunduh otomatis' : ''}`));
    const status = el('div', {}, STATUS_LABEL[a.status]);
    status.className = `lm-dm-status${a.status === 'gagal' ? ' bad' : a.status === 'terpasang' ? '' : ' warn'}`;
    row.append(name, status);

    if (a.status === 'belum' || a.status === 'versi-baru') {
      row.appendChild(this.button(a.status === 'versi-baru' ? 'PERBARUI' : 'UNDUH', () => this.source.download(a.id)));
    } else if (a.status === 'gagal') {
      row.appendChild(this.button('COBA LAGI', () => this.source.download(a.id)));
    } else if (a.status === 'terpasang') {
      const del = this.button('HAPUS', () => this.source.remove(a.id));
      del.classList.add('danger');
      row.appendChild(del);
    }
    box.appendChild(row);

    const bar = el('div');
    bar.className = 'lm-dm-bar';
    const fill = el('div');
    fill.style.width = `${a.status === 'terpasang' ? 100 : pct(a.done, a.bytes).toFixed(1)}%`;
    bar.appendChild(fill);
    box.appendChild(bar);
    const done = a.status === 'terpasang' ? a.bytes : a.done;
    box.appendChild(note(`${formatBytes(done)} dari ${formatBytes(a.bytes)}${a.error ? `\n${a.error}` : ''}`));
    return box;
  }

  private button(label: string, run: () => Promise<unknown>): HTMLButtonElement {
    const b = el('button', {}, label);
    b.className = 'lm-dm-btn';
    onTap(b, () => {
      void run()
        .catch((e: unknown) => {
          this.status = `Gagal: ${String((e as Error)?.message ?? e)}`;
        })
        .finally(() => void this.render());
      void this.render();
    });
    return b;
  }

  destroy(): void {
    this.close();
    this.root.remove();
  }
}

function note(text: string): HTMLDivElement {
  const d = el('div', {}, text);
  d.className = 'lm-dm-note';
  return d;
}

/**
 * "Data Dunia Diperlukan": shown when the hero reaches the edge of an area whose data is not on the
 * phone yet. It says what is needed and how big it is, downloads it in place with a progress bar,
 * and gets out of the way the moment it is done.
 */
export class DataRequired {
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private area: DataAreaView | null = null;
  private unsubscribe: (() => void) | null = null;
  onClose: () => void = () => undefined;

  constructor(
    private readonly source: DataSource,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-dm', CSS);
    this.root = el('div');
    this.root.className = 'lm-dr';
    this.card = el('div');
    this.card.className = 'lm-dr-card';
    this.root.appendChild(this.card);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) this.root.addEventListener(type, (e) => e.stopPropagation());
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.area !== null;
  }

  get areaId(): string | null {
    return this.area?.id ?? null;
  }

  async show(areaId: string): Promise<void> {
    const areas = await this.source.areas();
    this.area = areas.find((a) => a.id === areaId) ?? null;
    if (!this.area) return;
    this.root.classList.add('on');
    this.unsubscribe?.();
    this.unsubscribe = this.source.subscribe(() => void this.refresh());
    this.draw();
  }

  private async refresh(): Promise<void> {
    if (!this.area) return;
    const areas = await this.source.areas();
    const next = areas.find((a) => a.id === this.area?.id);
    if (!next) return;
    this.area = next;
    if (next.status === 'terpasang') {
      this.close();
      return;
    }
    this.draw();
  }

  private draw(): void {
    const a = this.area;
    if (!a) return;
    this.card.innerHTML = '';
    const title = el('div', {}, 'DATA DUNIA DIPERLUKAN');
    title.className = 'lm-dr-title';
    this.card.appendChild(title);
    this.card.appendChild(el('div', {}, `${a.name} butuh data tambahan sebelum bisa dimasuki.`));
    this.card.appendChild(note(`Ukuran: ${formatBytes(a.bytes)}. Cukup sekali — setelah itu tersimpan di HP.`));

    const bar = el('div');
    bar.className = 'lm-dm-bar';
    const fill = el('div');
    fill.style.width = `${pct(a.done, a.bytes).toFixed(1)}%`;
    bar.appendChild(fill);
    this.card.appendChild(bar);
    const busy = a.status === 'mengunduh';
    this.card.appendChild(note(busy ? `Mengunduh ${formatBytes(a.done)} dari ${formatBytes(a.bytes)}…` : a.error ? `Gagal: ${a.error}` : `${formatBytes(a.done)} dari ${formatBytes(a.bytes)}`));

    const btns = el('div');
    btns.className = 'lm-dr-btns';
    if (!busy) {
      const go = el('button', {}, a.status === 'gagal' ? 'COBA LAGI' : 'UNDUH');
      go.className = 'lm-dm-btn';
      onTap(go, () => {
        void this.source.download(a.id).catch(() => undefined);
        void this.refresh();
      });
      btns.appendChild(go);
    }
    const later = el('button', {}, busy ? 'LANJUT DI LATAR' : 'NANTI');
    later.className = 'lm-dm-btn';
    onTap(later, () => this.close());
    btns.appendChild(later);
    this.card.appendChild(btns);
  }

  close(): void {
    this.area = null;
    this.root.classList.remove('on');
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.onClose();
  }

  destroy(): void {
    this.close();
    this.root.remove();
  }
}
