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

/* character + vitals, top left, clear of the notch */
.lm-vitals { position: absolute; left: calc(6px + var(--lm-sal, 0px)); top: calc(6px + var(--lm-sat, 0px));
  display: flex; gap: 6px; padding: 5px 7px 6px; align-items: center; }
.lm-face { position: relative; width: 26px; height: 26px; border-radius: 4px; flex: 0 0 auto;
  background: linear-gradient(160deg, #3e5dc1, #1c2354); border: 1px solid rgba(255,248,230,0.5);
  display: flex; align-items: center; justify-content: center; font-size: 15px; }
/* the level sits on the portrait, like every RPG the plan is aiming at */
.lm-lvl { position: absolute; right: -4px; bottom: -5px; min-width: 14px; padding: 0 2px;
  background: #1a1430; border: 1px solid #ffd98a; border-radius: 3px; color: #ffd98a;
  font-size: 9px; line-height: 11px; text-align: center; }
.lm-bar.exp { height: 4px; }
.lm-fill.exp { background: linear-gradient(180deg, #c9b3ff, #7a5cd8); }
.lm-bars { display: flex; flex-direction: column; gap: 3px; }
.lm-bar { position: relative; width: 104px; height: 9px; background: #140f26;
  border: 1px solid rgba(154,140,214,0.5); border-radius: 2px; overflow: hidden; }
.lm-fill, .lm-trail { position: absolute; inset: 0 auto 0 0; height: 100%; transition: width 90ms linear; }
.lm-trail { background: #ffe066; opacity: 0.55; }
.lm-fill.hp { background: linear-gradient(180deg, #f1996b, #b8403f); }
.lm-fill.en { background: linear-gradient(180deg, #8befeb, #2673ac); }
.lm-bar > span { position: absolute; inset: 0; text-align: center; font-size: 9px; line-height: 9px; }

/*
 * Quest objective, top centre.
 *
 * The width limit is in ch rather than vw: on a 2318px-wide phone 46vw is over a thousand pixels of
 * single-line text, which nobody can read while playing. The clamp also keeps it from colliding
 * with the vitals on the left and the minimap on the right when the text size is turned up.
 */
.lm-quest { position: absolute; left: 50%; top: calc(6px + var(--lm-sat, 0px)); transform: translateX(-50%);
  max-width: min(42ch, 40vw); padding: 4px 9px; white-space: pre-line; text-align: center; }
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
.lm-hint { position: absolute; left: 50%; bottom: calc(58px + var(--lm-sab, 0px)); transform: translateX(-50%);
  padding: 3px 9px; opacity: 0; transition: opacity 140ms linear; color: #ffe9a8; }

/*
 * The two buttons in the top-right strip, next to the gear and the bag.
 *
 * They are position:fixed and outside the pointer-events:none HUD layer, because everything
 * else in the HUD must let taps fall through to the game underneath.
 */
.lm-pausebtn { position: fixed; right: calc(120px + var(--lm-sar, 0px)); top: calc(4px + var(--lm-sat, 0px));
  z-index: 80; pointer-events: auto; width: 34px; height: 34px; padding: 0;
  border: 1px solid #6a7094; border-radius: 17px; background: rgba(20,16,38,0.8); color: #e7e0ff;
  font: 14px/1 ui-monospace, monospace; cursor: pointer; touch-action: manipulation; }
.lm-pausebtn:active { background: #ffb82e; color: #1a1430; }

/* fullscreen, the only thing here you can tap */
.lm-full { position: fixed; right: calc(44px + var(--lm-sar, 0px)); top: calc(4px + var(--lm-sat, 0px));
  z-index: 80; pointer-events: auto;
  width: 34px; height: 34px; padding: 0; border: 1px solid #6a7094; border-radius: 17px;
  background: rgba(20,16,38,0.8); color: #ffd98a; font: 15px/1 ui-monospace, monospace;
  cursor: pointer; touch-action: manipulation; }

/*
 * Notifications that slide in from the right: loot, a quest step, a level, an element.
 *
 * Stacked rather than replacing each other, because killing a boss can produce three at once and
 * a single slot would drop two of them. They animate with transform and opacity only -- both are
 * compositor properties, so a popup never costs a layout pass mid-fight.
 */
.lm-pops { position: absolute; right: calc(8px + var(--lm-sar, 0px)); top: calc(96px + var(--lm-sat, 0px));
  display: flex; flex-direction: column; gap: 5px; align-items: flex-end; max-width: 46vw; }
.lm-pop { display: flex; align-items: center; gap: 7px; padding: 5px 9px 6px; border-radius: 5px;
  background: linear-gradient(180deg, rgba(30,24,56,0.92), rgba(14,10,28,0.94));
  border: 1px solid rgba(154,140,214,0.5); border-left-width: 3px;
  animation: lm-pop-in 260ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  transition: opacity 320ms linear, transform 320ms ease; }
.lm-pop.out { opacity: 0; transform: translateX(26px); }
.lm-pop .ic { font-size: 15px; line-height: 1; }
.lm-pop .tx { min-width: 0; }
.lm-pop .tx b { display: block; font-weight: normal; color: #fff8e6; }
.lm-pop .tx small { display: block; color: #a79dc4; font-size: 10px; }
@keyframes lm-pop-in { from { opacity: 0; transform: translateX(34px); } to { opacity: 1; transform: none; } }

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
  private expFill: HTMLDivElement;
  private levelBadge: HTMLDivElement;
  private quest: HTMLDivElement;
  private bossBox: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossFill: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private fullBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private pops: HTMLDivElement;
  private popList: { node: HTMLDivElement; left: number }[] = [];
  /** Tapped the pause button. Wired by the game to open the pause menu. */
  onPause: () => void = () => undefined;
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

    const expBar = el('div');
    expBar.className = 'lm-bar exp';
    this.expFill = el('div');
    this.expFill.className = 'lm-fill exp';
    expBar.append(this.expFill);

    this.levelBadge = el('div', {}, '1');
    this.levelBadge.className = 'lm-lvl';
    face.appendChild(this.levelBadge);

    bars.append(hpBar, enBar, expBar);
    vitals.append(face, bars);

    this.pops = el('div');
    this.pops.className = 'lm-pops';

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

    this.root.append(vitals, this.quest, this.bossBox, this.pops, this.bannerEl, this.toastEl, this.hintEl);

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

    this.pauseBtn = el('button', {}, '\u2630');
    this.pauseBtn.className = 'lm-pausebtn';
    this.pauseBtn.title = 'Jeda (Esc)';
    onTap(this.pauseBtn, () => this.onPause());
    parent.append(this.root, this.fullBtn, this.pauseBtn);
    this.applyTextScale();
  }

  /**
   * Hide the whole HUD (a cutscene, or the pause menu).
   *
   * `visibility` rather than `display`, so the floating-damage pool keeps its layout and does not
   * have to be rebuilt when the HUD comes back.
   */
  setVisible(on: boolean): void {
    this.root.style.visibility = on ? 'visible' : 'hidden';
    this.fullBtn.style.display = on ? 'block' : 'none';
    this.pauseBtn.style.display = on ? 'block' : 'none';
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

  /**
   * Level and EXP (Batch 4). The badge sits on the portrait and the bar under the vitals, so the
   * player sees progress without opening anything. Diffed, because this is called every frame.
   */
  setLevel(level: number, exp: number, needed: number): void {
    const text = String(level);
    if (this.levelBadge.textContent !== text) this.levelBadge.textContent = text;
    const ratio = needed > 0 ? Math.max(0, Math.min(1, exp / needed)) : 1;
    const width = `${(ratio * 100).toFixed(1)}%`;
    if (this.expFill.style.width !== width) this.expFill.style.width = width;
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

  /**
   * A notification card: loot picked up, a quest step, a level, an element unlocked.
   *
   * These stack instead of overwriting one another — beating the boss fires a level, a drop and a
   * quest step in the same frame, and a single banner would silently eat two of them. The oldest
   * is retired when the stack gets long, so a fight cannot bury the screen.
   */
  popup(spec: { icon: string; title: string; sub?: string; color?: string; seconds?: number }): void {
    const node = el('div');
    node.className = 'lm-pop';
    if (spec.color) node.style.borderLeftColor = spec.color;
    const ic = el('div', {}, spec.icon);
    ic.className = 'ic';
    const tx = el('div');
    tx.className = 'tx';
    tx.appendChild(el('b', {}, spec.title));
    if (spec.sub) tx.appendChild(el('small', {}, spec.sub));
    node.append(ic, tx);
    this.pops.appendChild(node);
    this.popList.push({ node, left: spec.seconds ?? 3.4 });
    while (this.popList.length > 4) {
      const oldest = this.popList.shift();
      oldest?.node.remove();
    }
  }

  /** Age the notification stack. Called from the HUD's own update. */
  private updatePopups(dt: number): void {
    for (let i = this.popList.length - 1; i >= 0; i--) {
      const p = this.popList[i];
      p.left -= dt;
      if (p.left <= 0.32 && !p.node.classList.contains('out')) p.node.classList.add('out');
      if (p.left <= 0) {
        p.node.remove();
        this.popList.splice(i, 1);
      }
    }
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
    this.updatePopups(dt);
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
    this.pauseBtn.remove();
  }
}
