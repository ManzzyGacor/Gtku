/**
 * In-game settings menu (docs/OVERHAUL.md, Fase 0 §6).
 *
 * A DOM overlay, deliberately: it survives the renderer swap, scrolls natively on a phone, and gives
 * the player the one tool this project depends on — "Salin laporan", which turns what they see on
 * their phone into text a developer can read.
 *
 * Rows are data. Anything not wired to real game state is left out entirely rather than shown as a
 * dead control (audio volumes wait for Batch 5).
 */
import { formatErrors, recentErrors } from '../core/errors';
import { PROFILES, probeDevice, profileOf } from '../core/graphics';
import { buildReport, copyText } from '../core/report';
import { DEFAULTS, PRESET_IDS, RANGES, settings, type NumericKey, type PresetId, type Settings } from '../core/settings';
import type { DiagnosticsSource } from './diagnostics';
import { el, injectStyle, onTap } from './dom';

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'toggle'; label: string; key: 'bloom' | 'fpsCounter'; hint?: string }
  | { kind: 'number'; label: string; key: NumericKey; fmt: (v: number) => string }
  | { kind: 'choice'; label: string; key: 'preset'; hint?: string }
  | { kind: 'renderer'; label: string; hint: string }
  | { kind: 'action'; label: string; button: string; run: (panel: SettingsPanel) => void; note?: () => string };

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const mult = (v: number): string => `${v.toFixed(1)}x`;

const ROWS: Row[] = [
  { kind: 'header', label: 'Grafik' },
  { kind: 'choice', label: 'Preset', key: 'preset', hint: 'AUTO menyesuaikan sendiri dari FPS' },
  { kind: 'toggle', label: 'Bloom', key: 'bloom', hint: 'Cahaya mekar; matikan bila berat' },
  { kind: 'number', label: 'Skala render', key: 'renderScale', fmt: pct },
  { kind: 'header', label: 'Kamera (mode 3D)' },
  { kind: 'number', label: 'Sudut kamera', key: 'camPitch', fmt: (v) => `${v}\u00b0` },
  { kind: 'number', label: 'Jarak / zoom', key: 'camZoom', fmt: mult },
  {
    kind: 'action',
    label: 'Reset kamera',
    button: 'Reset',
    note: () => `Kembali ke ${DEFAULTS.camPitch}\u00b0 dan ${DEFAULTS.camZoom.toFixed(2)}x`,
    run: () => settings.reset(['camPitch', 'camZoom']),
  },
  { kind: 'header', label: 'Kontrol & teks' },
  { kind: 'number', label: 'Ukuran joystick', key: 'stickScale', fmt: mult },
  { kind: 'number', label: 'Joystick kiri-kanan', key: 'stickX', fmt: pct },
  { kind: 'number', label: 'Joystick atas-bawah', key: 'stickY', fmt: pct },
  { kind: 'number', label: 'Ukuran tombol', key: 'buttonScale', fmt: mult },
  { kind: 'number', label: 'Ukuran teks', key: 'textScale', fmt: (v) => `${v}x` },
  { kind: 'header', label: 'Mesin tampilan' },
  { kind: 'renderer', label: 'Renderer', hint: 'Mengganti akan memuat ulang halaman' },
  { kind: 'header', label: 'Diagnostik' },
  { kind: 'toggle', label: 'Penghitung FPS', key: 'fpsCounter', hint: 'Bisa juga lewat ?fps=1' },
  {
    kind: 'action',
    label: 'Salin laporan',
    button: 'Salin',
    note: () => 'Perangkat, FPS, preset, dan error terakhir',
    run: (p) => void p.copyReport(),
  },
  {
    kind: 'action',
    label: 'Uji performa',
    button: 'Ukur',
    note: () => 'A/B ~15 dtk: mematikan satu fitur per giliran',
    run: (p) => p.startProbe(),
  },
  {
    kind: 'action',
    label: 'Error terakhir',
    button: 'Lihat',
    note: () => {
      const n = recentErrors().length;
      return n === 0 ? 'Belum ada error' : `${n} error tercatat`;
    },
    run: (p) => p.showErrors(),
  },
];

const CSS = `
.lm-ov { position: fixed; inset: 0; z-index: 85; display: none; background: rgba(9, 7, 18, 0.72);
         font: 13px/1.45 ui-monospace, monospace; color: #e7e0ff; -webkit-tap-highlight-color: transparent; }
.lm-ov.on { display: flex; align-items: stretch; justify-content: center; }
.lm-card { width: 100%; max-width: 460px; margin: 8px; display: flex; flex-direction: column;
           background: rgba(20, 16, 38, 0.95); border: 1px solid #3a2f5e; border-radius: 6px; overflow: hidden; }
.lm-top { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #3a2f5e; }
.lm-title { flex: 1; color: #ffd98a; letter-spacing: 1px; font-size: 14px; }
.lm-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 4px 0 10px; }
.lm-head { padding: 9px 10px 3px; color: #a795ff; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
.lm-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; }
.lm-row + .lm-row { border-top: 1px solid rgba(58, 47, 94, 0.5); }
.lm-label { flex: 1; min-width: 0; }
.lm-hint { display: block; color: #8189a8; font-size: 10.5px; }
.lm-val { min-width: 92px; text-align: center; color: #ffe9a8; }
.lm-btn { border: 1px solid #6a7094; background: #241c44; color: #e7e0ff; border-radius: 4px;
          padding: 5px 9px; min-width: 34px; font: inherit; cursor: pointer; touch-action: manipulation; }
.lm-btn:active { background: #ffb82e; color: #1a1430; }
.lm-btn.wide { min-width: 68px; }
.lm-locked { opacity: 0.5; }
.lm-lockmsg { color: #ffb04a; font-size: 10.5px; }
.lm-note { padding: 8px 10px; color: #8189a8; font-size: 10.5px; border-top: 1px solid #3a2f5e; }
.lm-dump { margin: 0; padding: 8px 10px; white-space: pre-wrap; word-break: break-word;
           font-size: 11px; color: #cfc6ff; background: #0f0b1c; max-height: 46vh; overflow: auto; }
.lm-gear { position: fixed; right: 4px; top: 4px; z-index: 80; width: 34px; height: 34px; padding: 0;
           border: 1px solid #6a7094; background: rgba(20, 16, 38, 0.8); color: #ffd98a; border-radius: 17px;
           font: 17px/1 ui-monospace, monospace; cursor: pointer; touch-action: manipulation; }
`;

export class SettingsPanel {
  private overlay: HTMLDivElement;
  private body: HTMLDivElement;
  private note: HTMLDivElement;
  private dump: HTMLPreElement | null = null;
  private refreshers: (() => void)[] = [];
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: () => void;
  open = false;
  /** Called whenever the panel opens or closes, so the game can pause. */
  onOpenChange: (open: boolean) => void = () => undefined;

  constructor(
    parent: HTMLElement,
    private readonly source: () => DiagnosticsSource,
  ) {
    injectStyle('lm-ui', CSS);
    this.overlay = el('div');
    this.overlay.className = 'lm-ov';
    const card = el('div');
    card.className = 'lm-card';

    const top = el('div');
    top.className = 'lm-top';
    const title = el('div', {}, 'PENGATURAN');
    title.className = 'lm-title';
    const close = el('button', {}, 'Tutup');
    close.className = 'lm-btn wide';
    onTap(close, () => this.setOpen(false));
    top.append(title, close);

    this.body = el('div');
    this.body.className = 'lm-body';
    this.note = el('div', {}, '');
    this.note.className = 'lm-note';

    card.append(top, this.body, this.note);
    this.overlay.appendChild(card);
    // A tap on the dimmed backdrop closes; taps inside must not fall through to the canvas.
    this.overlay.addEventListener('pointerup', (e) => {
      if (e.target === this.overlay) this.setOpen(false);
    });
    card.addEventListener('pointerdown', (e) => e.stopPropagation());
    card.addEventListener('pointerup', (e) => e.stopPropagation());
    parent.appendChild(this.overlay);

    this.build();
    this.unsubscribe = settings.on(() => this.refresh());
    this.refresh();
  }

  // ───────────────────────── building ─────────────────────────

  private build(): void {
    for (const row of ROWS) {
      if (row.kind === 'header') {
        const h = el('div', {}, row.label);
        h.className = 'lm-head';
        this.body.appendChild(h);
        continue;
      }
      const line = el('div');
      line.className = 'lm-row';
      const label = el('div');
      label.className = 'lm-label';
      label.appendChild(el('span', {}, row.label));
      const hint = el('span');
      hint.className = 'lm-hint';
      label.appendChild(hint);
      line.appendChild(label);

      const locked = 'key' in row && settings.isLocked(row.key as keyof Settings);
      if (locked) line.classList.add('lm-locked');

      if (row.kind === 'toggle') {
        const btn = el('button', {}, '');
        btn.className = 'lm-btn wide';
        if (!locked) onTap(btn, () => settings.set(row.key, !settings.get(row.key)));
        line.appendChild(btn);
        this.refreshers.push(() => {
          btn.textContent = settings.get(row.key) ? 'Nyala' : 'Mati';
          hint.textContent = locked ? 'dipaksa dari URL' : (row.hint ?? '');
          if (locked) hint.className = 'lm-hint lm-lockmsg';
        });
      } else if (row.kind === 'number') {
        const minus = el('button', {}, '−');
        minus.className = 'lm-btn';
        const val = el('div', {}, '');
        val.className = 'lm-val';
        const plus = el('button', {}, '+');
        plus.className = 'lm-btn';
        if (!locked) {
          onTap(minus, () => settings.step(row.key, -1));
          onTap(plus, () => settings.step(row.key, +1));
        }
        line.append(minus, val, plus);
        this.refreshers.push(() => {
          const v = settings.get(row.key);
          val.textContent = row.fmt(v);
          const r = RANGES[row.key];
          minus.disabled = locked || v <= r.min;
          plus.disabled = locked || v >= r.max;
          hint.textContent = locked ? 'dipaksa dari URL' : '';
        });
      } else if (row.kind === 'choice') {
        const prev = el('button', {}, '◂');
        prev.className = 'lm-btn';
        const val = el('div', {}, '');
        val.className = 'lm-val';
        const next = el('button', {}, '▸');
        next.className = 'lm-btn';
        if (!locked) {
          onTap(prev, () => this.cyclePreset(-1));
          onTap(next, () => this.cyclePreset(+1));
        }
        line.append(prev, val, next);
        this.refreshers.push(() => {
          const auto = settings.get('presetAuto');
          const cur = profileOf(settings.get('preset'));
          val.textContent = auto ? 'AUTO' : cur.name;
          hint.className = locked ? 'lm-hint lm-lockmsg' : 'lm-hint';
          hint.textContent = locked ? 'dipaksa dari URL' : auto ? `sekarang: ${cur.name} — ${row.hint ?? ''}` : cur.note;
        });
      } else if (row.kind === 'renderer') {
        const btn = el('button', {}, '');
        btn.className = 'lm-btn wide';
        const rlocked = settings.isLocked('renderer');
        if (rlocked) line.classList.add('lm-locked');
        else onTap(btn, () => this.switchRenderer());
        line.appendChild(btn);
        this.refreshers.push(() => {
          btn.textContent = settings.get('renderer') === '3d' ? '3D (baru)' : '2D (lama)';
          hint.className = rlocked ? 'lm-hint lm-lockmsg' : 'lm-hint';
          hint.textContent = rlocked ? 'dipaksa dari URL' : row.hint;
        });
      } else {
        const btn = el('button', {}, row.button);
        btn.className = 'lm-btn wide';
        onTap(btn, () => row.run(this));
        line.appendChild(btn);
        this.refreshers.push(() => {
          hint.textContent = row.note?.() ?? '';
        });
      }
      this.body.appendChild(line);
    }
  }

  /**
   * Flip between the 2D and 3D builds. They cannot be hot-swapped (different scene graphs, different
   * loops), so the page reloads — which is also the only way to be sure nothing of the old one lingers.
   */
  private switchRenderer(): void {
    settings.set('renderer', settings.get('renderer') === '3d' ? '2d' : '3d');
    if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload();
  }

  /** Cycle AUTO → Sangat Rendah → … → Ultra → AUTO. */
  private cyclePreset(dir: number): void {
    const order: (PresetId | 'auto')[] = ['auto', ...PRESET_IDS];
    const current: PresetId | 'auto' = settings.get('presetAuto') ? 'auto' : settings.get('preset');
    const i = order.indexOf(current);
    const pick = order[(i + dir + order.length) % order.length];
    if (pick === 'auto') {
      settings.set('presetAuto', true);
    } else {
      settings.set('presetAuto', false);
      settings.set('preset', pick);
    }
  }

  private refresh(): void {
    for (const fn of this.refreshers) fn();
    const src = this.source();
    const d = probeDevice();
    this.note.textContent = `${src.name} · ${d.screenW}x${d.screenH} · webgl2 ${d.webgl2 ? 'ya' : 'tidak'} · ${Object.keys(PROFILES).length} tingkat grafik`;
  }

  // ───────────────────────── actions ─────────────────────────

  /** Build the report and put it on the clipboard; if that is refused, show it to be selected by hand. */
  async copyReport(): Promise<void> {
    const src = this.source();
    const text = buildReport({
      device: probeDevice(),
      renderer: src.name,
      preset: settings.get('preset'),
      presetAuto: settings.get('presetAuto'),
      fpsAvg: src.fps().avg,
      fpsLow: src.fps().low,
      objects: src.objects(),
      settings: settings.all(),
      errors: recentErrors(),
      view: src.view(),
      url: typeof location !== 'undefined' ? location.href : '',
    });
    const extra = src.report?.() ?? [];
    const full = extra.length ? `${text}\n\n[RENDERER]\n${extra.join('\n')}` : text;
    const ok = await copyText(full);
    this.showDump(ok ? `Laporan tersalin ke clipboard. Tempel ke chat.\n\n${full}` : `Clipboard ditolak browser — pilih teks di bawah dan salin manual.\n\n${full}`);
  }

  /**
   * Start the renderer's on-device A/B measurement and poll it until it finishes. Measuring on the
   * phone is the only way to know what a frame really costs — there is no GPU on the dev machine.
   */
  startProbe(): void {
    const src = this.source();
    if (!src.startPerfProbe || !src.perfProbeStatus) {
      this.showDump('Renderer ini tidak punya uji performa (mode 2D).');
      return;
    }
    src.startPerfProbe();
    if (this.probeTimer !== null) clearInterval(this.probeTimer);
    this.probeTimer = setInterval(() => {
      const st = this.source().perfProbeStatus?.();
      if (!st) return;
      if (st.running) {
        this.showDump(`Mengukur… ${Math.round(st.progress * 100)}%\n${st.label}\n\nJangan gerakkan hero selama pengukuran.`);
        return;
      }
      if (this.probeTimer !== null) clearInterval(this.probeTimer);
      this.probeTimer = null;
      this.showDump(`Selesai. Tekan "Salin laporan" untuk mengirim hasil ini.\n\n${st.lines.join('\n')}`);
    }, 400);
  }

  showErrors(): void {
    const lines = formatErrors();
    this.showDump(lines.length ? lines.slice().reverse().join('\n') : 'Belum ada error yang tercatat.');
  }

  private showDump(text: string): void {
    if (!this.dump) {
      this.dump = el('pre');
      this.dump.className = 'lm-dump';
      this.body.appendChild(this.dump);
    }
    this.dump.textContent = text;
    this.dump.scrollIntoView({ block: 'nearest' });
  }

  // ───────────────────────── open / close ─────────────────────────

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.overlay.classList.toggle('on', open);
    if (open) this.refresh();
    else if (this.dump) {
      this.dump.remove();
      this.dump = null;
    }
    this.onOpenChange(open);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  destroy(): void {
    if (this.probeTimer !== null) clearInterval(this.probeTimer);
    this.unsubscribe();
    this.overlay.remove();
  }
}
