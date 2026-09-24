/**
 * The title screen (docs/OVERHAUL.md §4 "UI": Lanjutkan, Game Baru, …).
 *
 * Ported from the 2D `TitleScene`. A DOM overlay rather than a rendered scene, so the game can
 * decide whether to continue *before* the world is built — which is what lets a loaded save place
 * the hero and the day-night clock correctly on the very first frame.
 *
 * Kredit, Akun and the rest of the menu arrive with Batch 5/7; only what works is shown.
 */
import { clearSave, hasSave } from '../core/save';
// Imported from the engine rather than the barrel on purpose: the barrel pulls in the music and
// ambience schedulers, and the title screen lives in the entry chunk that has to arrive first.
import { unlockAudio } from '../core/audio/engine';
import { NAME_FALLBACK, sanitizeName, settings } from '../core/settings';
import { el, injectStyle, onTap } from './dom';

const CSS = `
.lm-title { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 18px; text-align: center;
  background: radial-gradient(120% 90% at 50% 40%, #241c44 0%, #120d22 55%, #08060f 100%);
  font: 14px/1.5 ui-monospace, monospace; color: #e7e0ff; }
.lm-title-name { font-size: clamp(30px, 8vw, 62px); letter-spacing: 6px; line-height: 1.05; }
.lm-title-name span { display: block; }
.lm-title-name .a { color: #ffd98a; }
.lm-title-name .b { color: #a795ff; }
.lm-title-sub { color: #d9cfff; opacity: 0.85; }
/* a boot failure needs its message readable, wrapped, and selectable so it can be copied */
.lm-title-status { color: #ffc0c0; white-space: pre-wrap; max-width: min(90vw, 620px);
  font-size: 11px; line-height: 1.5; user-select: text; -webkit-user-select: text; }
.lm-title-menu { display: flex; flex-direction: column; gap: 9px; width: min(260px, 70vw); }
.lm-title-btn { padding: 11px 14px; font: inherit; letter-spacing: 2px; cursor: pointer;
  color: #f2e2c2; border-radius: 5px; touch-action: manipulation;
  background: linear-gradient(180deg, rgba(58,47,94,0.9), rgba(26,20,48,0.9));
  border: 1px solid rgba(255,217,138,0.45); }
.lm-title-btn:active { background: #ffb82e; color: #1a1430; }
.lm-title-btn.ghost { border-color: rgba(154,140,214,0.4); color: #b9b0d8; }
.lm-title-foot { position: absolute; bottom: 10px; font-size: 11px; color: #8189a8; padding: 0 16px; }
/* naming the character, asked once at New Game */
.lm-title-name-ask { display: none; flex-direction: column; gap: 10px; align-items: center; }
.lm-title-name-ask.on { display: flex; }
.lm-title-input { width: min(280px, 74vw); min-height: 44px; padding: 0 12px; font: inherit;
  font-size: 15px; text-align: center; letter-spacing: 2px; border-radius: 5px; color: #fff8e6;
  background: rgba(12,9,26,0.9); border: 1px solid rgba(255,217,138,0.5); }
/* Akun / Kredit: a panel that slides up over the menu */
.lm-title-panel { display: none; flex-direction: column; gap: 12px; align-items: center;
  width: min(560px, 86vw); padding: 14px 16px; border-radius: 6px; text-align: left;
  background: rgba(14,10,28,0.92); border: 1px solid rgba(154,140,214,0.4);
  animation: lm-rise-in 220ms ease both; }
.lm-title-panel.on { display: flex; }
.lm-title-panel-body { white-space: pre-line; color: #d9cfff; font-size: 12px; line-height: 1.6; }
@keyframes lm-rise-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
/* a few embers drifting up, so the screen is not static */
.lm-ember { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #ffb04a;
  animation: lm-rise linear infinite; opacity: 0; }
@keyframes lm-rise {
  0% { transform: translateY(0); opacity: 0; }
  20% { opacity: 0.9; }
  100% { transform: translateY(-60vh); opacity: 0; }
}
`;

export interface TitleChoice {
  /** True when the player asked to continue a save. */
  continueGame: boolean;
}

/** The main menu's own panel, for Pengaturan / Akun / Kredit. */
export interface TitleHooks {
  /** Open the settings overlay (the same one the gear opens in game). */
  settings?(): void;
}

export class TitleScreen {
  private root: HTMLDivElement;
  private resolve: ((c: TitleChoice) => void) | null = null;

  constructor(parent: HTMLElement = document.body, private readonly hooks: TitleHooks = {}) {
    injectStyle('lm-ui-title', CSS);
    this.root = el('div');
    this.root.className = 'lm-title';

    const name = el('div');
    name.className = 'lm-title-name';
    const a = el('span', {}, 'LENTERA');
    a.className = 'a';
    const b = el('span', {}, 'MALAM');
    b.className = 'b';
    name.append(a, b);

    const sub = el('div', {}, 'Nyalakan kembali cahaya desa');
    sub.className = 'lm-title-sub';

    const menu = el('div');
    menu.className = 'lm-title-menu';
    const saved = hasSave();
    if (saved) {
      const cont = el('button', {}, 'LANJUTKAN');
      cont.className = 'lm-title-btn';
      onTap(cont, () => this.pick(true));
      menu.appendChild(cont);
    }
    const fresh = el('button', {}, 'MAIN BARU');
    fresh.className = `lm-title-btn${saved ? ' ghost' : ''}`;
    onTap(fresh, () => {
      if (saved && !this.confirmed) {
        this.confirmed = true;
        fresh.textContent = 'HAPUS SAVE & MULAI?';
        return;
      }
      clearSave();
      this.askName();
    });
    menu.appendChild(fresh);

    /*
     * The rest of the main menu (docs/OVERHAUL.md §4): Pengaturan, Akun, Kredit.
     *
     * Akun is honest about itself. The account system is Batch 7, and the plan is explicit that
     * nothing here may pretend to be connected — so the button exists, says what it will be, and
     * says when. A greyed-out button with no explanation just looks broken.
     */
    const settingsBtn = el('button', {}, 'PENGATURAN');
    settingsBtn.className = 'lm-title-btn ghost';
    onTap(settingsBtn, () => {
      unlockAudio();
      this.hooks.settings?.();
    });
    menu.appendChild(settingsBtn);

    const account = el('button', {}, 'AKUN');
    account.className = 'lm-title-btn ghost';
    onTap(account, () => {
      this.showPanel(
        'AKUN',
        'Belum tersedia.\n\nLogin, daftar, dan nama karakter yang tersimpan di server dijadwalkan di Batch 7. ' +
          'Sampai itu ada, progresmu disimpan di HP ini saja \u2014 lewat penyimpanan browser, bukan akun. ' +
          'Membersihkan data situs akan menghapusnya.',
      );
    });
    menu.appendChild(account);

    const credits = el('button', {}, 'KREDIT');
    credits.className = 'lm-title-btn ghost';
    onTap(credits, () => {
      this.showPanel(
        'KREDIT',
        'LENTERA MALAM\n\n' +
          'Kode, desain, dan seluruh pixel art dibuat khusus untuk proyek ini.\n' +
          'Semua gambar dihasilkan dari kode (src/art) dengan palet original.\n' +
          'Musik dan efek suara disintesis WebAudio (src/core/audio).\n' +
          'Cerita, nama, dan karakter original \u2014 naskahnya di docs/STORY.md.\n\n' +
          'Library: Three.js (MIT), TypeScript, Vite.\n' +
          'Belum ada aset pihak ketiga. Daftar lengkapnya di CREDITS.md.',
      );
    });
    menu.appendChild(credits);

    /*
     * Naming the character.
     *
     * Asked here rather than in a menu because this is the one moment it belongs to: a new game.
     * The story's script calls the hero Arka, but every line is written with `{nama}`, so whatever
     * is typed here is what the opening cutscene says. Skipping is allowed — "Pengembara" is a
     * perfectly good name for someone who will not say his own.
     */
    this.nameBox = el('div');
    this.nameBox.className = 'lm-title-name-ask';
    const prompt = el('div', {}, 'Siapa namamu?');
    prompt.className = 'lm-title-sub';
    this.nameInput = el('input');
    this.nameInput.className = 'lm-title-input';
    this.nameInput.setAttribute('maxlength', '14');
    this.nameInput.setAttribute('placeholder', NAME_FALLBACK);
    this.nameInput.setAttribute('autocomplete', 'off');
    this.nameInput.value = settings.get('playerName');
    const go = el('button', {}, 'MULAI');
    go.className = 'lm-title-btn';
    onTap(go, () => this.confirmName());
    this.nameInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.confirmName();
    });
    this.nameBox.append(prompt, this.nameInput, go);

    const foot = el('div', {}, 'Sentuh: joystick kiri, tombol kanan  |  Keyboard: WASD, J tebas, K geser, Q ganti senjata, E bicara');
    foot.className = 'lm-title-foot';

    for (let i = 0; i < 14; i++) {
      const ember = el('div');
      ember.className = 'lm-ember';
      ember.style.left = `${5 + Math.random() * 90}%`;
      ember.style.bottom = `${Math.random() * 30}%`;
      ember.style.animationDuration = `${5 + Math.random() * 7}s`;
      ember.style.animationDelay = `${Math.random() * 6}s`;
      this.root.appendChild(ember);
    }

    this.panel = el('div');
    this.panel.className = 'lm-title-panel';
    this.root.append(name, sub, menu, this.nameBox, this.panel, foot);
    parent.appendChild(this.root);
    this.menu = menu;
  }

  /** A simple text panel over the title, for Akun and Kredit. */
  private showPanel(title: string, body: string): void {
    this.menu.style.display = 'none';
    this.panel.innerHTML = '';
    const h = el('div', {}, title);
    h.className = 'lm-title-sub';
    h.style.color = '#ffd98a';
    h.style.letterSpacing = '3px';
    const text = el('div', {}, body);
    text.className = 'lm-title-panel-body';
    const back = el('button', {}, 'KEMBALI');
    back.className = 'lm-title-btn ghost';
    onTap(back, () => {
      this.panel.classList.remove('on');
      this.menu.style.display = 'flex';
    });
    this.panel.append(h, text, back);
    this.panel.classList.add('on');
  }

  private askName(): void {
    this.menu.style.display = 'none';
    this.nameBox.classList.add('on');
    // focus is best-effort: some mobile browsers refuse it outside a direct gesture
    try {
      this.nameInput.focus();
    } catch {
      /* ignore */
    }
  }

  private confirmName(): void {
    settings.set('playerName', sanitizeName(this.nameInput.value));
    this.nameBox.classList.remove('on');
    this.pick(false);
  }

  private confirmed = false;
  private menu: HTMLDivElement;
  private nameBox: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private panel: HTMLDivElement;
  private status: HTMLDivElement | null = null;

  private pick(continueGame: boolean): void {
    // the tap that dismisses the title is also the gesture that lets audio start
    unlockAudio();
    // The screen stays up until the world is ready: the renderer is a separate 730 kB chunk, and a
    // black screen while it arrives reads as a crash.
    this.menu.style.display = 'none';
    this.resolve?.({ continueGame });
    this.resolve = null;
  }

  /** Replace the menu with a line of status text (loading the world, or failing to). */
  setBusy(text: string): void {
    this.menu.style.display = 'none';
    if (!this.status) {
      this.status = el('div');
      this.status.className = 'lm-title-sub lm-title-status';
      this.root.appendChild(this.status);
    }
    this.status.textContent = text;
  }

  /** Take the title down, once there is something behind it. */
  close(): void {
    this.root.remove();
  }

  /** Resolves once the player has chosen. */
  choice(): Promise<TitleChoice> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  destroy(): void {
    this.root.remove();
  }
}
