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
import { GAME_VERSION } from '../config';
import { TapUnlock } from '../core/devtools';

/** Loaded on demand by `toggleCombat` — see the comment there. */
let tuning: typeof import('../core/entities/combatTuning') | null = null;
/**
 * The cutscene library, loaded on demand for the replay list.
 *
 * Same reasoning as the combat tuning above: the scripts and the timeline are several kilobytes of
 * story that the entry chunk — the one holding up the title screen — has no business carrying for
 * a list most players open once.
 */
type StoryModule = {
  CUTSCENES: (typeof import('../core/story/cutscenes'))['CUTSCENES'];
  REPLAYABLE: string[];
  length: (typeof import('../core/story/cutscene'))['cutsceneLength'];
};
let story: StoryModule | null = null;
import { PROFILES, probeDevice, profileOf } from '../core/graphics';
import { buildReport, copyText } from '../core/report';
import { DEFAULTS, GFX_KEYS, NAME_FALLBACK, PRESET_IDS, RANGES, sanitizeName, settings, type NumericKey, type PresetId, type Settings } from '../core/settings';
import type { DiagnosticsSource } from './diagnostics';
import { el, injectStyle, onTap } from './dom';
import { wipeSave } from '../core/save';
import { wipeWorldData } from '../core/download/wipe';

type Row =
  | { kind: 'header'; label: string; id: string }
  | { kind: 'toggle'; label: string; key: 'bloom' | 'fpsCounter'; hint?: string }
  | { kind: 'number'; label: string; key: NumericKey; fmt: (v: number) => string; hint?: string }
  /** A numeric 0/1 setting shown as one Nyala/Mati button (the per-component graphics caps). */
  | { kind: 'switch'; label: string; key: NumericKey; hint?: string }
  | { kind: 'choice'; label: string; key: 'preset'; hint?: string }
  | { kind: 'action'; label: string; button: string; run: (panel: SettingsPanel) => void; note?: () => string; danger?: boolean; opensCombat?: boolean };

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const mult = (v: number): string => `${v.toFixed(1)}x`;
const off = (fmt: (v: number) => string) => (v: number): string => (v === 0 ? 'Mati' : fmt(v));

/**
 * Every setting, in the order the player reads them. The `id` of each header is also its jump chip
 * at the top of the panel: on a 759-pixel-tall phone the list is several screens long, and "Audio"
 * should be one tap away, not a long scroll past the graphics.
 */
export const ROWS: Row[] = [
  { kind: 'header', label: 'Grafik', id: 'grafik' },
  { kind: 'choice', label: 'Preset', key: 'preset', hint: 'AUTO menyesuaikan sendiri dari FPS' },
  { kind: 'number', label: 'Skala render', key: 'renderScale', fmt: pct, hint: 'Lebih rendah = lebih ringan, pixel tetap sama' },
  { kind: 'toggle', label: 'Bloom', key: 'bloom', hint: 'Cahaya mekar' },
  { kind: 'number', label: 'Partikel', key: 'gfxParticles', fmt: off(pct), hint: 'Kunang-kunang dan kabut melayang' },
  { kind: 'number', label: 'Angin rumput', key: 'gfxWind', fmt: off(pct), hint: 'Rumput dan daun bergoyang' },
  { kind: 'number', label: 'Lampu dinamis', key: 'gfxLights', fmt: off((v) => `${v}`), hint: 'Lampu yang ikut bergerak' },
  { kind: 'switch', label: 'Grain tanah', key: 'gfxDetail', hint: 'Tekstur halus di tanah' },
  { kind: 'switch', label: 'Air beriak', key: 'gfxWater', hint: 'Permukaan air bergerak' },
  { kind: 'switch', label: 'Jarak pandang ekstra', key: 'gfxDistance', hint: 'Memuat dunia sedikit di luar layar' },
  { kind: 'switch', label: 'Outline pixel', key: 'gfxOutline', hint: 'Garis tepi khas pixel-art' },
  {
    kind: 'action',
    label: 'Kembalikan grafik',
    button: 'Reset',
    note: () => 'Semua komponen kembali mengikuti preset',
    run: () => settings.reset([...GFX_KEYS, 'bloom', 'renderScale']),
  },

  { kind: 'header', label: 'Kamera', id: 'kamera' },
  { kind: 'number', label: 'Sudut kamera', key: 'camPitch', fmt: (v) => `${v}\u00b0` },
  { kind: 'number', label: 'Jarak / zoom', key: 'camZoom', fmt: mult },
  {
    kind: 'action',
    label: 'Reset kamera',
    button: 'Reset',
    note: () => `Kembali ke ${DEFAULTS.camPitch}\u00b0 dan ${DEFAULTS.camZoom.toFixed(2)}x`,
    run: () => settings.reset(['camPitch', 'camZoom']),
  },

  { kind: 'header', label: 'Kontrol', id: 'kontrol' },
  { kind: 'number', label: 'Ukuran joystick', key: 'stickScale', fmt: mult },
  { kind: 'number', label: 'Joystick kiri-kanan', key: 'stickX', fmt: pct },
  { kind: 'number', label: 'Joystick atas-bawah', key: 'stickY', fmt: pct },
  { kind: 'number', label: 'Ukuran tombol', key: 'buttonScale', fmt: mult },
  {
    kind: 'action',
    label: 'Reset kontrol',
    button: 'Reset',
    note: () => 'Joystick dan tombol ke posisi & ukuran bawaan',
    run: () => settings.reset(['stickScale', 'stickX', 'stickY', 'buttonScale']),
  },

  { kind: 'header', label: 'Tampilan', id: 'tampilan' },
  { kind: 'number', label: 'Ukuran teks', key: 'textScale', fmt: (v) => `${v}x` },
  { kind: 'number', label: 'Kecepatan teks dialog', key: 'textSpeed', fmt: (v) => `${v}/dtk` },
  {
    kind: 'action',
    label: 'Nama karakter',
    button: 'Ubah',
    note: () => settings.get('playerName') || `Belum diatur (${NAME_FALLBACK})`,
    run: (p) => p.askName(),
  },
  { kind: 'toggle', label: 'Penghitung FPS', key: 'fpsCounter', hint: 'Bisa juga lewat ?fps=1' },

  { kind: 'header', label: 'Audio', id: 'audio' },
  { kind: 'number', label: 'Musik', key: 'musicVol', fmt: off(pct) },
  { kind: 'number', label: 'Suasana', key: 'ambientVol', fmt: off(pct) },
  { kind: 'number', label: 'Tempur', key: 'combatVol', fmt: off(pct) },
  { kind: 'number', label: 'Efek', key: 'sfxVol', fmt: off(pct) },
  { kind: 'number', label: 'Antarmuka', key: 'uiVol', fmt: off(pct) },

  { kind: 'header', label: 'Combat', id: 'combat' },
  {
    kind: 'action',
    label: 'Setelan Combat',
    button: 'Buka',
    note: () => (tuning?.isTuned() ? 'Ada nilai yang sudah kamu ubah' : 'Kombo, busur, jangkauan, getaran'),
    run: (p) => p.toggleCombat(),
    opensCombat: true,
  },

  { kind: 'header', label: 'Cutscene', id: 'cutscene' },
  {
    kind: 'action',
    label: 'Putar ulang cutscene',
    button: 'Pilih',
    note: () => (story ? `${story.REPLAYABLE.length} adegan tersimpan` : 'Adegan cerita yang sudah ditonton'),
    run: (p) => p.showCutscenes(),
  },

  { kind: 'header', label: 'Data', id: 'data' },
  {
    kind: 'action',
    label: 'Download Manager',
    button: 'Buka',
    note: () => 'Status tiap area, unduh/hapus, dan sisa penyimpanan',
    run: (p) => p.openDownloads(),
  },
  {
    kind: 'action',
    label: 'Hapus data dunia',
    button: 'Hapus',
    danger: true,
    note: () => 'Semua area yang sudah diunduh. Progres TIDAK ikut terhapus.',
    run: (p) => void p.wipeWorld(),
  },
  {
    kind: 'action',
    label: 'Reset save',
    button: 'Reset',
    danger: true,
    note: () => 'Menghapus progres permainan. Tidak bisa dibatalkan.',
    run: (p) => p.resetSave(),
  },

  { kind: 'header', label: 'Diagnostik', id: 'diagnostik' },
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
/*
 * Every class here is namespaced lm-set-*, because an injected stylesheet is global. This panel
 * once named its header lm-title, which is also the title screen's root: position fixed, inset 0,
 * an opaque gradient. The header grew over the whole viewport and the player saw "PENGATURAN" and
 * nothing else. tests/source.test.ts now fails on any class two stylesheets both style.
 *
 * Above the title screen (90), the pause menu (86) and the character sheet (88), because it can be
 * opened from all three. The whole layering, so the next panel does not have to guess:
 *
 *   66 HUD        70 kontrol sentuh   72 dialog      80 tombol sudut (gear/tas/jeda/fullscreen)
 *   86 menu jeda  87 lapak pedagang  88 lembar karakter  90 layar judul  91 tombol Layar Penuh  92 data diperlukan
 *   94 overlay cutscene
 *   96 pengaturan (ini)  97 mode pengembang  98 download manager  99 panel error (index.html)
 */
.lm-set { position: fixed; inset: 0; z-index: 96; display: none; background: rgba(9, 7, 18, 0.72);
          font: 13px/1.45 ui-monospace, monospace; color: #e7e0ff; -webkit-tap-highlight-color: transparent; }
.lm-set.on { display: flex; align-items: stretch; justify-content: center; }
.lm-set-card { width: 100%; max-width: 560px; min-height: 0; display: flex; flex-direction: column;
           margin: calc(8px + var(--lm-sat, 0px)) calc(8px + var(--lm-sar, 0px)) calc(8px + var(--lm-sab, 0px)) calc(8px + var(--lm-sal, 0px));
           background: rgba(20, 16, 38, 0.97); border: 1px solid #3a2f5e; border-radius: 6px; overflow: hidden; }
.lm-set-top { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #3a2f5e; }
.lm-set-title { flex: 1; color: #ffd98a; letter-spacing: 1px; font-size: 14px; }
.lm-set-jump { flex: none; display: flex; gap: 6px; padding: 6px 10px; overflow-x: auto; border-bottom: 1px solid #3a2f5e;
               -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.lm-set-chip { flex: none; min-height: 34px; padding: 0 11px; border-radius: 17px; border: 1px solid #4a3f78;
               background: #1c1638; color: #cfc6ff; font: inherit; font-size: 12px; cursor: pointer; touch-action: manipulation; }
.lm-set-chip:active { background: #ffb82e; color: #1a1430; }
/* min-height 0 is what lets a flex child scroll: without it the body grows to its content, the
   card clips it, and the lower half of the list can never be reached on a short screen */
.lm-set-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
               -webkit-overflow-scrolling: touch; touch-action: pan-y; padding: 4px 0 10px; }
.lm-set-head { padding: 12px 10px 3px; color: #a795ff; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
.lm-set-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.lm-set-row + .lm-set-row { border-top: 1px solid rgba(58, 47, 94, 0.5); }
.lm-set-label { flex: 1; min-width: 0; }
.lm-set-hint { display: block; color: #8189a8; font-size: 10.5px; }
.lm-set-val { min-width: 84px; text-align: center; color: #ffe9a8; }
.lm-set-btn { border: 1px solid #6a7094; background: #241c44; color: #e7e0ff; border-radius: 4px;
          padding: 5px 9px; min-width: 44px; min-height: 44px; font: inherit; cursor: pointer;
          touch-action: manipulation; }
.lm-set-btn:active { background: #ffb82e; color: #1a1430; }
.lm-set-btn:disabled { opacity: 0.35; }
.lm-set-btn.wide { min-width: 72px; }
.lm-set-btn.danger { border-color: #b0504a; color: #ffb0a8; }
.lm-set-locked { opacity: 0.5; }
.lm-set-lockmsg { color: #ffb04a; font-size: 10.5px; }
.lm-set-note { flex: none; padding: 6px 10px; color: #8189a8; font-size: 10.5px; border-top: 1px solid #3a2f5e; }
.lm-set-dump { margin: 0; padding: 8px 10px; white-space: pre-wrap; word-break: break-word;
           font-size: 11px; color: #cfc6ff; background: #0f0b1c; max-height: 46vh; overflow: auto; }
.lm-gear { position: fixed; right: calc(4px + var(--lm-sar, 0px)); top: calc(4px + var(--lm-sat, 0px)); z-index: 80; width: 34px; height: 34px; padding: 0;
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
  private combatBox!: HTMLDivElement;
  private combatBuilt = false;
  private unsubscribe: () => void;
  open = false;
  /** Called whenever the panel opens or closes, so the game can pause. */
  onOpenChange: (open: boolean) => void = () => undefined;

  constructor(
    parent: HTMLElement,
    private readonly source: () => DiagnosticsSource,
  ) {
    injectStyle('lm-ui-set', CSS);
    this.overlay = el('div');
    this.overlay.className = 'lm-set';
    const card = el('div');
    card.className = 'lm-set-card';

    const top = el('div');
    top.className = 'lm-set-top';
    const title = el('div', {}, 'PENGATURAN');
    title.className = 'lm-set-title';
    const close = el('button', {}, 'Tutup');
    close.className = 'lm-set-btn wide';
    onTap(close, () => this.setOpen(false));
    top.append(title, close);

    // one chip per group: a tap scrolls that group to the top of the list
    const jump = el('div');
    jump.className = 'lm-set-jump';
    for (const row of ROWS) {
      if (row.kind !== 'header') continue;
      const chip = el('button', {}, row.label);
      chip.className = 'lm-set-chip';
      onTap(chip, () => this.jumpTo(row.id));
      jump.appendChild(chip);
    }

    this.body = el('div');
    this.body.className = 'lm-set-body';
    this.note = el('div', {}, '');
    this.note.className = 'lm-set-note';

    this.combatBox = el('div', { display: 'none' });
    this.combatBox.className = 'lm-set-combat';
    card.append(top, jump, this.body, this.note);
    this.overlay.appendChild(card);
    // A tap on the dimmed backdrop closes; taps inside must not fall through to the canvas.
    this.overlay.addEventListener('pointerup', (e) => {
      if (e.target === this.overlay) this.setOpen(false);
    });
    card.addEventListener('pointerdown', (e) => e.stopPropagation());
    card.addEventListener('pointerup', (e) => e.stopPropagation());
    parent.appendChild(this.overlay);

    this.build();
    this.buildVersion();
    this.unsubscribe = settings.on(() => this.refresh());
    this.refresh();
  }

  /** Fired on the fifth quick tap on the version line. */
  onDevUnlock: () => void = () => undefined;
  private readonly taps = new TapUnlock(5, 1.5);

  /**
   * The version line at the bottom of Settings — and the hidden door to the developer menu.
   *
   * Five quick taps. It says nothing about being tappable, because for a player it is only a
   * version number; the door is for the person testing on a phone with no URL bar to type
   * `?debug=1` into. After the second tap it counts down, so the tester knows it is working.
   */
  private buildVersion(): void {
    const row = el('div', {}, `Lentera Malam v${GAME_VERSION}`);
    row.className = 'lm-set-note lm-set-version';
    onTap(row, () => {
      const now = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
      if (this.taps.tap(now)) {
        row.textContent = `Lentera Malam v${GAME_VERSION}`;
        this.onDevUnlock();
        return;
      }
      const left = this.taps.remaining;
      row.textContent = left <= 3 ? `Lentera Malam v${GAME_VERSION}  (${left} lagi)` : `Lentera Malam v${GAME_VERSION}`;
    });
    this.body.appendChild(row);
  }

  // ───────────────────────── building ─────────────────────────

  private build(): void {
    for (const row of ROWS) {
      if (row.kind === 'header') {
        const h = el('div', {}, row.label);
        h.className = 'lm-set-head';
        this.heads.set(row.id, h);
        this.body.appendChild(h);
        continue;
      }
      const line = el('div');
      line.className = 'lm-set-row';
      const label = el('div');
      label.className = 'lm-set-label';
      label.appendChild(el('span', {}, row.label));
      const hint = el('span');
      hint.className = 'lm-set-hint';
      label.appendChild(hint);
      line.appendChild(label);

      const locked = 'key' in row && settings.isLocked(row.key as keyof Settings);
      if (locked) line.classList.add('lm-set-locked');

      if (row.kind === 'toggle') {
        const btn = el('button', {}, '');
        btn.className = 'lm-set-btn wide';
        if (!locked) onTap(btn, () => settings.set(row.key, !settings.get(row.key)));
        line.appendChild(btn);
        this.refreshers.push(() => {
          btn.textContent = settings.get(row.key) ? 'Nyala' : 'Mati';
          hint.textContent = locked ? 'dipaksa dari URL' : (row.hint ?? '');
          if (locked) hint.className = 'lm-set-hint lm-set-lockmsg';
        });
      } else if (row.kind === 'number') {
        const minus = el('button', {}, '−');
        minus.className = 'lm-set-btn';
        const val = el('div', {}, '');
        val.className = 'lm-set-val';
        const plus = el('button', {}, '+');
        plus.className = 'lm-set-btn';
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
          hint.textContent = locked ? 'dipaksa dari URL' : (row.hint ?? '');
        });
      } else if (row.kind === 'switch') {
        const btn = el('button', {}, '');
        btn.className = 'lm-set-btn wide';
        const r = RANGES[row.key];
        if (!locked) onTap(btn, () => settings.set(row.key, settings.get(row.key) > r.min ? r.min : r.max));
        line.appendChild(btn);
        this.refreshers.push(() => {
          btn.textContent = settings.get(row.key) > r.min ? 'Nyala' : 'Mati';
          hint.textContent = row.hint ?? '';
        });
      } else if (row.kind === 'choice') {
        const prev = el('button', {}, '◂');
        prev.className = 'lm-set-btn';
        const val = el('div', {}, '');
        val.className = 'lm-set-val';
        const next = el('button', {}, '▸');
        next.className = 'lm-set-btn';
        if (!locked) {
          onTap(prev, () => this.cyclePreset(-1));
          onTap(next, () => this.cyclePreset(+1));
        }
        line.append(prev, val, next);
        this.refreshers.push(() => {
          const auto = settings.get('presetAuto');
          const cur = profileOf(settings.get('preset'));
          val.textContent = auto ? 'AUTO' : cur.name;
          hint.className = locked ? 'lm-set-hint lm-set-lockmsg' : 'lm-set-hint';
          hint.textContent = locked ? 'dipaksa dari URL' : auto ? `sekarang: ${cur.name} — ${row.hint ?? ''}` : cur.note;
        });
      } else {
        const btn = el('button', {}, row.button);
        btn.className = row.danger ? 'lm-set-btn wide danger' : 'lm-set-btn wide';
        onTap(btn, () => row.run(this));
        line.appendChild(btn);
        this.refreshers.push(() => {
          hint.textContent = row.note?.() ?? '';
        });
      }
      this.body.appendChild(line);
      // the combat tuning rows unfold right under their button, not at the bottom of the list
      if (row.kind === 'action' && row.opensCombat) this.body.appendChild(this.combatBox);
    }
  }

  /** Bring a group's header to the top of the list. */
  jumpTo(id: string): void {
    const h = this.heads.get(id);
    if (!h) return;
    h.scrollIntoView({ block: 'start' });
  }

  /** Every group header, by id; the jump chips and the tests use it. */
  readonly heads = new Map<string, HTMLElement>();

  /**
   * A native confirmation, for the two actions that destroy something. Native because it cannot be
   * mis-tapped through, and because it works the same on every WebView. Absent (tests, some
   * embedded browsers) it answers no: a destructive action never runs unconfirmed.
   */
  confirm: (message: string) => boolean = (message) => (typeof confirm === 'function' ? confirm(message) : false);

  /** Reload after a reset; replaceable in tests. */
  reload: () => void = () => {
    if (typeof location !== 'undefined') location.reload();
  };

  /** "Hapus data dunia": every downloaded area. The save and the settings are untouched. */
  async wipeWorld(): Promise<void> {
    if (!this.confirm('Hapus semua data dunia yang sudah diunduh?\nProgres permainan tidak ikut terhapus.')) return;
    const ok = await wipeWorldData();
    this.showDump(ok ? 'Data dunia dihapus. Memuat ulang…' : 'Tidak ada data dunia tersimpan. Memuat ulang…');
    // whatever the running world had decoded in memory goes with the page
    this.reload();
  }

  /** "Reset save", asked twice: it cannot be undone and there is no cloud copy yet. */
  resetSave(): void {
    if (!this.confirm('Hapus progres permainan?\nLevel, item, quest, dan posisi akan hilang.')) return;
    if (!this.confirm('Yakin? Ini tidak bisa dibatalkan.')) return;
    wipeSave();
    this.showDump('Save dihapus. Memuat ulang…');
    this.reload();
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
   * Show or hide the combat tuning rows.
   *
   * Every timing that decides how a swing feels lives in `combatTuning.ts`, and the only way to
   * judge those numbers is to change one and swing again — on the phone, without a code editor.
   * The rows are built the first time they are opened, because there are a few dozen of them.
   */
  toggleCombat(): void {
    if (!tuning) {
      // The tuning descriptors reach into HeroCore, i.e. into the game's entity code. Importing
      // that from the settings menu would drag the whole combat model into the entry chunk and
      // delay the title screen for a debug panel most sessions never open.
      void import('../core/entities/combatTuning').then((m) => {
        tuning = m;
        this.toggleCombat();
      });
      return;
    }
    if (!this.combatBuilt) {
      this.combatBuilt = true;
      const { COMBAT_TUNABLES, resetCombatTuning, saveCombatTuning } = tuning;
      const reset = el('div');
      reset.className = 'lm-set-row';
      const label = el('div');
      label.className = 'lm-set-label';
      label.appendChild(el('span', {}, 'Kembalikan semua'));
      const hint = el('span', {}, 'Ke angka bawaan');
      hint.className = 'lm-set-hint';
      label.appendChild(hint);
      const btn = el('button', {}, 'Reset');
      btn.className = 'lm-set-btn wide';
      onTap(btn, () => {
        resetCombatTuning();
        this.refresh();
      });
      reset.append(label, btn);
      this.combatBox.appendChild(reset);

      for (const tune of COMBAT_TUNABLES) {
        const line = el('div');
        line.className = 'lm-set-row';
        const lab = el('div');
        lab.className = 'lm-set-label';
        lab.appendChild(el('span', {}, tune.label));
        line.appendChild(lab);
        const minus = el('button', {}, '\u2212');
        minus.className = 'lm-set-btn';
        const val = el('div', {}, '');
        val.className = 'lm-set-val';
        const plus = el('button', {}, '+');
        plus.className = 'lm-set-btn';
        const nudge = (dir: number): void => {
          const next = Math.max(tune.min, Math.min(tune.max, Math.round((tune.get() + tune.step * dir) / tune.step) * tune.step));
          tune.set(Number(next.toFixed(4)));
          saveCombatTuning();
          this.refresh();
        };
        onTap(minus, () => nudge(-1));
        onTap(plus, () => nudge(1));
        line.append(minus, val, plus);
        this.combatBox.appendChild(line);
        this.refreshers.push(() => {
          const v = tune.get();
          val.textContent = `${v % 1 === 0 ? v : v.toFixed(2)}${tune.unit ? ` ${tune.unit}` : ''}`;
          minus.disabled = v <= tune.min;
          plus.disabled = v >= tune.max;
        });
      }
    }
    const open = this.combatBox.style.display === 'none';
    this.combatBox.style.display = open ? 'block' : 'none';
    if (open) {
      this.refresh();
      this.combatBox.scrollIntoView({ block: 'nearest' });
    }
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
    this.showDump(lines.length ? [...lines].reverse().join('\n') : 'Belum ada error yang tercatat.');
  }

  /** Open the Download Manager on top of Settings. */
  openDownloads(): void {
    const src = this.source();
    if (!src.openDownloads) {
      this.showDump('Download Manager tersedia setelah dunia dimuat.');
      return;
    }
    src.openDownloads();
  }

  /**
   * Ask for the character's name.
   *
   * A prompt rather than a text field in the row, because the settings list is a column of
   * +/- buttons and a keyboard opening inside it on a phone pushes everything around. `prompt` is
   * plain, it is native, and it is the one place in this UI where that is the right trade.
   */
  askName(): void {
    const current = settings.get('playerName');
    const next = typeof prompt === 'function' ? prompt('Nama karaktermu:', current) : null;
    if (next === null) return;
    settings.set('playerName', sanitizeName(next));
    this.refresh();
  }

  /**
   * The cutscene replay list.
   *
   * Every scene stays available once it has been watched — a story you cannot revisit is a story
   * you have to take notes on. Scenes not yet reached are listed as locked rather than hidden, so
   * the list also says how much there is.
   */
  showCutscenes(): void {
    if (!story) {
      void Promise.all([import('../core/story/cutscenes'), import('../core/story/cutscene')]).then(([s, engine]) => {
        story = { CUTSCENES: s.CUTSCENES, REPLAYABLE: s.REPLAYABLE, length: engine.cutsceneLength };
        this.showCutscenes();
      });
      return;
    }
    const { CUTSCENES, REPLAYABLE, length: cutsceneLength } = story;
    const src = this.source();
    const lines = REPLAYABLE.map((id) => {
      const def = CUTSCENES[id];
      if (!def) return '';
      const seen = src.cutsceneSeen?.(id) ?? false;
      const mins = Math.floor(cutsceneLength(def) / 60);
      const secs = cutsceneLength(def) % 60;
      const len = mins > 0 ? `${mins} mnt ${secs} dtk` : `${secs} dtk`;
      return `${seen ? '\u25b6' : '\u25cb'} ${def.title} (${len})${seen ? '' : ' \u2014 belum ditonton'}`;
    }).filter(Boolean);

    this.showDump([...lines, '', 'Ketuk tombol di bawah untuk memutar ulang adegan pertama.'].join('\n'));
    if (!src.playCutscene) return;
    const play = el('button', {}, 'PUTAR ULANG');
    play.className = 'lm-set-btn wide';
    onTap(play, () => {
      src.playCutscene?.(REPLAYABLE[0]);
      this.setOpen(false);
    });
    this.dump?.appendChild(play);
  }

  private showDump(text: string): void {
    if (!this.dump) {
      this.dump = el('pre');
      this.dump.className = 'lm-set-dump';
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
