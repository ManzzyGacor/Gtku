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
import { DEFAULTS, NAME_FALLBACK, PRESET_IDS, RANGES, sanitizeName, settings, type NumericKey, type PresetId, type Settings } from '../core/settings';
import type { DiagnosticsSource } from './diagnostics';
import { el, injectStyle, onTap } from './dom';

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'toggle'; label: string; key: 'bloom' | 'fpsCounter'; hint?: string }
  | { kind: 'number'; label: string; key: NumericKey; fmt: (v: number) => string }
  | { kind: 'choice'; label: string; key: 'preset'; hint?: string }
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
  { kind: 'number', label: 'Kecepatan teks', key: 'textSpeed', fmt: (v) => `${v}/dtk` },
  {
    kind: 'action',
    label: 'Nama karakter',
    button: 'Ubah',
    note: () => settings.get('playerName') || `Belum diatur (${NAME_FALLBACK})`,
    run: (p) => p.askName(),
  },
  { kind: 'header', label: 'Audio' },
  { kind: 'number', label: 'Musik', key: 'musicVol', fmt: pct },
  { kind: 'number', label: 'Suasana', key: 'ambientVol', fmt: pct },
  { kind: 'number', label: 'Tempur', key: 'combatVol', fmt: pct },
  { kind: 'number', label: 'Efek', key: 'sfxVol', fmt: pct },
  { kind: 'number', label: 'Antarmuka', key: 'uiVol', fmt: pct },
  { kind: 'header', label: 'Cerita' },
  {
    kind: 'action',
    label: 'Putar ulang cutscene',
    button: 'Pilih',
    note: () => (story ? `${story.REPLAYABLE.length} adegan tersimpan` : 'Adegan cerita yang sudah ditonton'),
    run: (p) => p.showCutscenes(),
  },
  { kind: 'header', label: 'Diagnostik' },
  { kind: 'toggle', label: 'Penghitung FPS', key: 'fpsCounter', hint: 'Bisa juga lewat ?fps=1' },
  {
    kind: 'action',
    label: 'Salin laporan',
    button: 'Salin',
    note: () => 'Perangkat, FPS, preset, dan error terakhir',
    run: (p) => void p.copyReport(),
  },
  { kind: 'header', label: 'Combat (mode debug)' },
  {
    kind: 'action',
    label: 'Setelan Combat',
    button: 'Buka',
    note: () => (tuning?.isTuned() ? 'Ada nilai yang sudah kamu ubah' : 'Durasi, langkah, jangkauan, getaran'),
    run: (p) => p.toggleCombat(),
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
 * Above the title screen (90), the pause menu (86) and the character sheet (88), because it can be
 * opened from all three. It was below the title screen, which meant tapping PENGATURAN in the main
 * menu opened it *behind* an opaque full-screen gradient: the panel was built, laid out and
 * completely invisible. The whole layering is written down in the table below so the next panel
 * does not have to guess.
 *
 *   66 HUD        70 kontrol sentuh   72 dialog      80 tombol sudut (gear/tas/jeda/fullscreen)
 *   86 menu jeda  88 lembar karakter  90 layar judul  94 overlay cutscene
 *   96 pengaturan (ini)               99 panel error (index.html)
 */
.lm-ov { position: fixed; inset: 0; z-index: 96; display: none; background: rgba(9, 7, 18, 0.72);
         font: 13px/1.45 ui-monospace, monospace; color: #e7e0ff; -webkit-tap-highlight-color: transparent; }
.lm-ov.on { display: flex; align-items: stretch; justify-content: center; }
.lm-card { width: 100%; max-width: 460px; display: flex; flex-direction: column;
           margin: calc(8px + var(--lm-sat, 0px)) calc(8px + var(--lm-sar, 0px)) calc(8px + var(--lm-sab, 0px)) calc(8px + var(--lm-sal, 0px));
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
          padding: 5px 9px; min-width: 40px; min-height: 40px; font: inherit; cursor: pointer;
          touch-action: manipulation; }
.lm-btn:active { background: #ffb82e; color: #1a1430; }
.lm-btn.wide { min-width: 68px; }
.lm-locked { opacity: 0.5; }
.lm-lockmsg { color: #ffb04a; font-size: 10.5px; }
.lm-note { padding: 8px 10px; color: #8189a8; font-size: 10.5px; border-top: 1px solid #3a2f5e; }
.lm-dump { margin: 0; padding: 8px 10px; white-space: pre-wrap; word-break: break-word;
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

    this.combatBox = el('div', { display: 'none' });
    this.combatBox.className = 'lm-combat';
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
      reset.className = 'lm-row';
      const label = el('div');
      label.className = 'lm-label';
      label.appendChild(el('span', {}, 'Kembalikan semua'));
      const hint = el('span', {}, 'Ke angka bawaan');
      hint.className = 'lm-hint';
      label.appendChild(hint);
      const btn = el('button', {}, 'Reset');
      btn.className = 'lm-btn wide';
      onTap(btn, () => {
        resetCombatTuning();
        this.refresh();
      });
      reset.append(label, btn);
      this.combatBox.appendChild(reset);

      for (const tune of COMBAT_TUNABLES) {
        const line = el('div');
        line.className = 'lm-row';
        const lab = el('div');
        lab.className = 'lm-label';
        lab.appendChild(el('span', {}, tune.label));
        line.appendChild(lab);
        const minus = el('button', {}, '\u2212');
        minus.className = 'lm-btn';
        const val = el('div', {}, '');
        val.className = 'lm-val';
        const plus = el('button', {}, '+');
        plus.className = 'lm-btn';
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
      this.body.appendChild(this.combatBox);
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
    play.className = 'lm-btn wide';
    onTap(play, () => {
      src.playCutscene?.(REPLAYABLE[0]);
      this.setOpen(false);
    });
    this.dump?.appendChild(play);
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
