/**
 * What a cutscene looks like: letterbox bars, a caption, the dialogue line, a fade layer, and a
 * **Skip button that is always there** (docs/OVERHAUL.md §4: "Selalu ada tombol Skip").
 *
 * A DOM overlay rather than something drawn in the scene, for the same reason the HUD is: real
 * text at any size, native tap handling, and it sits *above* everything including the fade, so a
 * fade to black really is black.
 *
 * Phone-first details that matter here:
 *  • the safe-area insets are respected, so the Skip button never lands under a notch or the
 *    rounded corner of a 2318x759 screen;
 *  • tapping anywhere advances the line, except on the Skip button itself;
 *  • the text size follows the player's own setting, and the letterbox bars are sized in `vh` so
 *    they stay proportional on a very wide screen instead of eating it.
 */
import { settings } from '../core/settings';
import type { CutsceneView } from '../core/story/cutscene';
import { el, injectStyle, onTap } from './dom';

const CSS = `
.lm-cs { position: fixed; inset: 0; z-index: 94; display: none; pointer-events: auto;
  font: 13px/1.55 ui-monospace, monospace; color: #f2e2c2; touch-action: manipulation;
  -webkit-user-select: none; user-select: none; }
.lm-cs.on { display: block; }

/* the bars. Proportional to height so a very wide screen does not get letterboxed into a slit. */
.lm-cs-bar { position: absolute; left: 0; right: 0; height: 9vh; background: #07060c;
  transition: height 260ms ease; pointer-events: none; }
.lm-cs-bar.top { top: 0; }
.lm-cs-bar.bot { bottom: 0; }
.lm-cs.plain .lm-cs-bar { height: 0; }

/* full-screen fade, above the bars so a fade to black covers them too */
.lm-cs-fade { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }

/* narration, centred, with room for the bars */
.lm-cs-caption { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  max-width: min(78vw, 760px); text-align: center; color: #e7e0ff; letter-spacing: 1px;
  text-shadow: 0 2px 10px rgba(0,0,0,0.9); opacity: 0; transition: opacity 320ms ease;
  white-space: pre-line; }
.lm-cs-caption.on { opacity: 1; }

/* the spoken line, in the lower third but above the bottom bar and the safe area */
.lm-cs-line { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(9vh + 14px + env(safe-area-inset-bottom, 0px));
  width: min(720px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
  padding: 9px 12px 10px; border-radius: 6px; opacity: 0; transition: opacity 180ms ease;
  background: linear-gradient(180deg, rgba(22,17,42,0.92), rgba(11,8,22,0.95));
  border: 1px solid rgba(255,217,138,0.4); }
.lm-cs-line.on { opacity: 1; }
.lm-cs-who { color: #ffd98a; margin-bottom: 2px; }
.lm-cs-text { white-space: pre-line; min-height: 2.6em; }
.lm-cs-more { text-align: right; color: #ffd98a; height: 1em; opacity: 0.85; }

/* Skip: top-right, clear of the notch, and a real 44px target */
.lm-cs-skip { position: absolute; z-index: 2;
  top: calc(6px + env(safe-area-inset-top, 0px));
  right: calc(8px + env(safe-area-inset-right, 0px));
  min-width: 96px; min-height: 40px; padding: 0 14px; border-radius: 20px; cursor: pointer;
  font: inherit; letter-spacing: 2px; color: #e7e0ff; pointer-events: auto;
  background: rgba(12,10,24,0.72); border: 1px solid rgba(231,224,255,0.45); }
.lm-cs-skip:active { background: #ffb82e; color: #1a1430; }
`;

export class CutsceneOverlay {
  private root: HTMLDivElement;
  private fade: HTMLDivElement;
  private caption: HTMLDivElement;
  private lineBox: HTMLDivElement;
  private whoEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private moreEl: HTMLDivElement;
  private skipBtn: HTMLButtonElement;
  private blink = 0;
  private shownText = '';

  /** Tap anywhere that is not the Skip button. */
  onAdvance: () => void = () => undefined;
  onSkip: () => void = () => undefined;

  constructor(parent: HTMLElement = document.body) {
    injectStyle('lm-ui-cs', CSS);
    this.root = el('div');
    this.root.className = 'lm-cs';

    const top = el('div');
    top.className = 'lm-cs-bar top';
    const bot = el('div');
    bot.className = 'lm-cs-bar bot';

    this.fade = el('div');
    this.fade.className = 'lm-cs-fade';

    this.caption = el('div');
    this.caption.className = 'lm-cs-caption';

    this.lineBox = el('div');
    this.lineBox.className = 'lm-cs-line';
    this.whoEl = el('div');
    this.whoEl.className = 'lm-cs-who';
    this.textEl = el('div');
    this.textEl.className = 'lm-cs-text';
    this.moreEl = el('div');
    this.moreEl.className = 'lm-cs-more';
    this.lineBox.append(this.whoEl, this.textEl, this.moreEl);

    this.skipBtn = el('button', {}, 'LEWATI »');
    this.skipBtn.className = 'lm-cs-skip';
    onTap(this.skipBtn, () => this.onSkip());

    this.root.append(top, bot, this.fade, this.caption, this.lineBox, this.skipBtn);
    // The tap-to-advance listener lives on the root, and the button stops its own taps, so the
    // two never fight over the same touch.
    this.root.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this.onAdvance();
    });
    parent.appendChild(this.root);
    this.applyTextScale();
  }

  /** The player's text size applies here too — a cutscene is mostly reading. */
  applyTextScale(): void {
    const scale = 0.85 + settings.get('textScale') * 0.18;
    this.root.style.fontSize = `${(13 * scale).toFixed(1)}px`;
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
    if (on) this.applyTextScale();
  }

  /** Draw one frame of the player's view. Diffed, because this runs every frame. */
  render(view: CutsceneView, dt: number): void {
    this.blink += dt;
    this.root.classList.toggle('plain', view.letterbox === false);

    const fade = view.fade.toFixed(3);
    if (this.fade.style.opacity !== fade) this.fade.style.opacity = fade;
    const colour = `#${(view.fadeColor >>> 0).toString(16).padStart(6, '0')}`;
    if (this.fade.style.background !== colour) this.fade.style.background = colour;

    if (view.caption) {
      if (this.caption.textContent !== view.caption) this.caption.textContent = view.caption;
      this.caption.classList.add('on');
    } else {
      this.caption.classList.remove('on');
    }

    if (view.who || view.text) {
      this.lineBox.classList.add('on');
      const who = view.who ?? '';
      if (this.whoEl.textContent !== who) this.whoEl.textContent = who;
      this.whoEl.style.display = who ? 'block' : 'none';
      if (this.shownText !== view.text) {
        this.shownText = view.text;
        this.textEl.textContent = view.text;
      }
      // the blinking marker only appears once the line is fully out
      const more = view.complete ? (Math.floor(this.blink * 2) % 2 === 0 ? '▼' : '') : '';
      if (this.moreEl.textContent !== more) this.moreEl.textContent = more;
    } else {
      this.lineBox.classList.remove('on');
      this.shownText = '';
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
