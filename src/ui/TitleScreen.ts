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
import { unlockAudio } from '../core/audio';
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

export class TitleScreen {
  private root: HTMLDivElement;
  private resolve: ((c: TitleChoice) => void) | null = null;

  constructor(parent: HTMLElement = document.body) {
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

    this.root.append(name, sub, menu, this.nameBox, foot);
    parent.appendChild(this.root);
    this.menu = menu;
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
