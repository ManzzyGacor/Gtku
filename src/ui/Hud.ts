/**
 * The heads-up display (docs/OVERHAUL.md §4 "UI").
 *
 * A DOM overlay, like the settings menu: it survived the 2D→3D swap unchanged, it gets crisp text
 * at any size for free, and it costs the renderer nothing. Layout follows the plan — character and
 * HP top-left, quest objective top-centre, minimap top-right, and the touch controls own the
 * bottom corners.
 *
 * Nothing here is interactive except the fullscreen button, so the whole layer is
 * `pointer-events: none` and taps fall straight through to the game.
 */
import { el, injectStyle, onTap } from './dom';
import { settings } from '../core/settings';

const CSS = `
.lm-hud { position: fixed; inset: 0; z-index: 66; pointer-events: none;
  font: 12px/1.35 ui-monospace, monospace; color: #e7e0ff; text-shadow: 0 1px 0 rgba(9,7,18,0.9); }
.lm-panel { background: linear-gradient(180deg, rgba(26,20,48,0.86), rgba(15,11,28,0.86));
  border: 1px solid rgba(154,140,214,0.45); border-radius: 5px; box-shadow: 0 2px 0 rgba(9,7,18,0.5); }

/* character + vitals, top left */
.lm-vitals { position: absolute; left: 6px; top: 6px; display: flex; gap: 6px; padding: 5px 7px 6px; align-items: center; }
.lm-face { width: 26px; height: 26px; border-radius: 4px; flex: 0 0 auto;
  background: linear-gradient(160deg, #3e5dc1, #1c2354); border: 1px solid rgba(255,248,230,0.5);
  display: flex; align-items: center; justify-content: center; font-size: 15px; }
.lm-bars { display: flex; flex-direction: column; gap: 3px; }
.lm-bar { position: relative; width: 104px; height: 9px; background: #140f26;
  border: 1px solid rgba(154,140,214,0.5); border-radius: 2px; overflow: hidden; }
.lm-fill, .lm-trail { position: absolute; inset: 0 auto 0 0; height: 100%; transition: width 90ms linear; }
.lm-trail { background: #ffe066; opacity: 0.55; }
.lm-fill.hp { background: linear-gradient(180deg, #f1996b, #b8403f); }
.lm-fill.en { background: linear-gradient(180deg, #8befeb, #2673ac); }
.lm-bar > span { position: absolute; inset: 0; text-align: center; font-size: 9px; line-height: 9px; }

/* quest objective, top centre */
.lm-quest { position: absolute; left: 50%; top: 6px; transform: translateX(-50%); max-width: 46vw;
  padding: 4px 9px; white-space: pre-line; }
.lm-quest b { color: #ffd98a; font-weight: normal; }

/* boss bar, just under the objective */
.lm-boss { position: absolute; left: 50%; top: 58px; transform: translateX(-50%); width: min(300px, 60vw);
  padding: 3px 5px 5px; display: none; text-align: center; }
.lm-boss .lm-bar { width: 100%; height: 11px; }
.lm-boss .lm-fill { background: linear-gradient(180deg, #a795ff, #4a3aaf); }
.lm-bossname { color: #d8cfff; font-size: 11px; margin-bottom: 3px; }

/* transient messages */
.lm-banner { position: absolute; left: 50%; top: 26%; transform: translate(-50%, -50%);
  font-size: 22px; letter-spacing: 2px; color: #ffd98a; opacity: 0; transition: opacity 320ms linear; }
.lm-toast { position: absolute; left: 50%; bottom: 86px; transform: translateX(-50%);
  padding: 4px 10px; opacity: 0; transition: opacity 220ms linear; max-width: 70vw; text-align: center; }
.lm-hint { position: absolute; left: 50%; bottom: 58px; transform: translateX(-50%);
  padding: 3px 9px; opacity: 0; transition: opacity 140ms linear; color: #ffe9a8; }

/* fullscreen, the only thing here you can tap */
.lm-full { position: fixed; right: 44px; top: 4px; z-index: 80; pointer-events: auto;
  width: 34px; height: 34px; padding: 0; border: 1px solid #6a7094; border-radius: 17px;
  background: rgba(20,16,38,0.8); color: #ffd98a; font: 15px/1 ui-monospace, monospace;
  cursor: pointer; touch-action: manipulation; }

/* floating combat text */
.lm-float { position: absolute; transform: translate(-50%, -50%); font-weight: bold;
  pointer-events: none; opacity: 0; will-change: transform, opacity; }
`;

/** One pooled floating number. */
interface Floater {
  node: HTMLDivElement;
  /** World position it rose from, in world units. */
  x: number;
  y: number;
  z: number;
  life: number;
  max: number;
}

/** Projects a world point (units) to viewport CSS pixels. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean } | null;

const FLOATERS = 18;

export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpTrail: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private enFill: HTMLDivElement;
  private quest: HTMLDivElement;
  private bossBox: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossFill: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private fullBtn: HTMLButtonElement;
  private floaters: Floater[] = [];
  private floaterNext = 0;

  private trailHp = 1;
  private hp = 1;
  private maxHp = 1;
  private bannerT = 0;
  private toastT = 0;
  private bossRatio: number | null = null;
  private bossTrail = 1;

  constructor(parent: HTMLElement = document.body) {
    injectStyle('lm-ui-hud', CSS);
    this.root = el('div');
    this.root.className = 'lm-hud';

    const vitals = el('div');
    vitals.className = 'lm-panel lm-vitals';
    const face = el('div', {}, '⚔');
    face.className = 'lm-face';
    const bars = el('div');
    bars.className = 'lm-bars';

    const hpBar = el('div');
    hpBar.className = 'lm-bar';
    this.hpTrail = el('div');
    this.hpTrail.className = 'lm-trail';
    this.hpFill = el('div');
    this.hpFill.className = 'lm-fill hp';
    this.hpText = el('span', {}, '');
    hpBar.append(this.hpTrail, this.hpFill, this.hpText);

    const enBar = el('div');
    enBar.className = 'lm-bar';
    this.enFill = el('div');
    this.enFill.className = 'lm-fill en';
    enBar.append(this.enFill);

    bars.append(hpBar, enBar);
    vitals.append(face, bars);

    this.quest = el('div');
    this.quest.className = 'lm-panel lm-quest';

    this.bossBox = el('div');
    this.bossBox.className = 'lm-panel lm-boss';
    this.bossName = el('div', {}, '');
    this.bossName.className = 'lm-bossname';
    const bossBar = el('div');
    bossBar.className = 'lm-bar';
    this.bossFill = el('div');
    this.bossFill.className = 'lm-fill';
    bossBar.append(this.bossFill);
    this.bossBox.append(this.bossName, bossBar);

    this.bannerEl = el('div');
    this.bannerEl.className = 'lm-banner';
    this.toastEl = el('div');
    this.toastEl.className = 'lm-panel lm-toast';
    this.hintEl = el('div');
    this.hintEl.className = 'lm-panel lm-hint';

    this.root.append(vitals, this.quest, this.bossBox, this.bannerEl, this.toastEl, this.hintEl);

    for (let i = 0; i < FLOATERS; i++) {
      const node = el('div');
      node.className = 'lm-float';
      this.root.appendChild(node);
      this.floaters.push({ node, x: 0, y: 0, z: 0, life: 0, max: 1 });
    }

    this.fullBtn = el('button', {}, '⛶');
    this.fullBtn.className = 'lm-full';
    this.fullBtn.setAttribute('aria-label', 'Layar penuh');
    onTap(this.fullBtn, () => void this.toggleFullscreen());

    parent.append(this.root, this.fullBtn);
    this.applyTextScale();
  }

  /** The text-size setting applies to the HUD too. */
  applyTextScale(): void {
    const scale = 0.85 + settings.get('textScale') * 0.18;
    this.root.style.fontSize = `${(12 * scale).toFixed(1)}px`;
  }

  // ───────────────────────── vitals ─────────────────────────

  setHp(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = Math.max(1, maxHp);
  }

  /** 0..1 — the skill's readiness, shown as the blue bar. */
  setEnergy(ratio: number): void {
    this.enFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  // ───────────────────────── text ─────────────────────────

  setQuest(title: string, lines: string[]): void {
    const body = lines.join('\n');
    const wanted = `${title}\n${body}`;
    if (this.quest.dataset.text === wanted) return;
    this.quest.dataset.text = wanted;
    this.quest.textContent = '';
    const b = el('b', {}, title);
    this.quest.append(b, document.createTextNode(body ? `\n${body}` : ''));
    this.quest.style.display = title || body ? 'block' : 'none';
  }

  banner(text: string, seconds = 2.6): void {
    this.bannerEl.textContent = text;
    this.bannerT = seconds;
    this.bannerEl.style.opacity = '1';
  }

  toast(text: string, seconds = 2.4): void {
    this.toastEl.textContent = text;
    this.toastT = seconds;
    this.toastEl.style.opacity = '1';
  }

  setHint(text: string | null): void {
    if (text) {
      if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
      this.hintEl.style.opacity = '1';
    } else {
      this.hintEl.style.opacity = '0';
    }
  }

  setBoss(name: string | null, ratio = 1): void {
    if (name === null) {
      this.bossRatio = null;
      this.bossBox.style.display = 'none';
      return;
    }
    if (this.bossRatio === null) this.bossTrail = 1;
    if (this.bossName.textContent !== name) this.bossName.textContent = name;
    this.bossRatio = ratio;
    this.bossBox.style.display = 'block';
  }

  // ───────────────────────── floating combat text ─────────────────────────

  /**
   * A damage or heal number that rises from a world position. Pooled: a busy fight reuses the
   * same handful of elements instead of churning the DOM.
   */
  float(x: number, y: number, z: number, text: string, color: string, big = false): void {
    const f = this.floaters[this.floaterNext % this.floaters.length];
    this.floaterNext++;
    f.x = x;
    f.y = y;
    f.z = z;
    f.life = big ? 0.95 : 0.75;
    f.max = f.life;
    f.node.textContent = text;
    f.node.style.color = color;
    f.node.style.fontSize = big ? '18px' : '13px';
    f.node.style.opacity = '1';
  }

  // ───────────────────────── per frame ─────────────────────────

  update(dt: number, project: Projector): void {
    // HP: the fill snaps, the trail lags behind it so a big hit reads as a big hit
    const ratio = Math.max(0, Math.min(1, this.hp / this.maxHp));
    this.trailHp += (ratio - this.trailHp) * Math.min(1, dt * (ratio < this.trailHp ? 2.4 : 12));
    this.hpFill.style.width = `${ratio * 100}%`;
    this.hpTrail.style.width = `${Math.max(0, this.trailHp) * 100}%`;
    const label = `${Math.ceil(this.hp)}/${this.maxHp}`;
    if (this.hpText.textContent !== label) this.hpText.textContent = label;
    this.hpFill.style.filter = ratio < 0.3 ? 'brightness(1.25)' : '';

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.style.opacity = '0';
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }

    if (this.bossRatio !== null) {
      this.bossTrail += (this.bossRatio - this.bossTrail) * Math.min(1, dt * (this.bossRatio < this.bossTrail ? 2 : 10));
      this.bossFill.style.width = `${Math.max(0, this.bossTrail) * 100}%`;
    }

    for (const f of this.floaters) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.node.style.opacity = '0';
        continue;
      }
      const t = 1 - f.life / f.max;
      const p = project(f.x, f.y + t * 0.9, f.z);
      if (!p || !p.visible) {
        f.node.style.opacity = '0';
        continue;
      }
      f.node.style.left = `${p.x}px`;
      f.node.style.top = `${p.y}px`;
      f.node.style.opacity = String(Math.min(1, f.life * 3));
    }
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o?.lock?.('landscape').catch(() => undefined);
    } catch {
      /* a browser that refuses fullscreen is not an error worth showing */
    }
  }

  destroy(): void {
    this.root.remove();
    this.fullBtn.remove();
  }
}
