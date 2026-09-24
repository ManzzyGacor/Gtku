/**
 * DOM touch controls for the 3D renderer.
 *
 * Deliberately renderer-agnostic and separate from the Phaser HUD: this is the control layer the
 * 3D build uses now and the one the 2D HUD will eventually be replaced by (docs/OVERHAUL.md §7).
 * It writes into the same `input` hub the game logic already reads, so `HeroCore` cannot tell the
 * difference between a finger, a key and a test.
 *
 * The stick is **fixed**: the base stays at the position and size set in the settings menu, and only
 * the knob moves. A floating stick that appears under the thumb is fashionable and, on this game,
 * wrong — the player asked for a fixed one, and the reason holds up: with a fixed base your thumb
 * learns one spot and can find it without looking, which is what you need while something is
 * swinging at you. Touching anywhere in the left zone still grabs it, so nothing has to be hit
 * precisely; the knob simply moves relative to the base instead of the base moving to the thumb.
 */
import { unlockAudio } from '../core/audio';
import { input, type Action } from '../core/input';
import { settings } from '../core/settings';
import { el, injectStyle } from './dom';
import { safeInsets } from './safearea';

const BASE_R = 34;
const KNOB_R = 15;
/** Fraction of the screen width that belongs to the stick. */
const STICK_ZONE = 0.55;
const DEADZONE = 0.14;
/**
 * How far from the base a touch may land and still grab the stick, in base radii.
 *
 * Generous, because a thumb is not a mouse: you should not have to look down to find the ring. But
 * *bounded*, which matters now that the base no longer moves to meet the thumb — without a limit
 * the whole left half of the screen becomes one giant stick, and an accidental tap near the edge
 * reads as full tilt and sends the hero walking.
 */
const GRAB_RADII = 2.4;

const CSS = `
.lm-touch { position: fixed; inset: 0; z-index: 70; touch-action: none; }
.lm-stick-base, .lm-stick-knob { position: absolute; border-radius: 50%; pointer-events: none;
  transform: translate(-50%, -50%); transition: opacity 120ms linear; }
.lm-stick-base { border: 2px solid rgba(242, 226, 194, 0.55); background: rgba(26, 20, 48, 0.35); }
.lm-stick-knob { background: rgba(242, 226, 194, 0.8); border: 2px solid rgba(255, 248, 230, 0.9); }
.lm-act { position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
  display: flex; align-items: center; justify-content: center; touch-action: manipulation;
  border: 2px solid rgba(242, 226, 194, 0.7); background: rgba(26, 20, 48, 0.55);
  color: #f2e2c2; font: 11px/1 ui-monospace, monospace; letter-spacing: 0.5px; }
.lm-act.down { background: rgba(255, 184, 46, 0.85); color: #1a1430; }
/*
 * The active weapon is highlighted (docs/OVERHAUL.md §4 "UI").
 *
 * On the attack button, because that is the button whose behaviour changes: with the sword out it
 * is a combo, with the bow it is a draw. A warm ring for the sword, a cool one for the bow, so it
 * reads at a glance in the corner of the eye rather than needing to be looked at.
 */
.lm-act.melee { border-color: rgba(255, 209, 90, 0.95); box-shadow: 0 0 0 2px rgba(255, 209, 90, 0.22); }
.lm-act.ranged { border-color: rgba(124, 196, 255, 0.95); box-shadow: 0 0 0 2px rgba(124, 196, 255, 0.22); }
/* the bow's draw meter: a ring that fills as the string is pulled */
.lm-charge { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none;
  border: 3px solid rgba(124, 196, 255, 0.9); opacity: 0; }
`;

/** The buttons Fase 2 can honestly offer: both drive real `HeroCore` states. */
interface ActionButton {
  action: Action;
  label: string;
  /** Radius in px at scale 1. */
  r: number;
  /** Offset from the bottom-right corner at scale 1. */
  ox: number;
  oy: number;
  node: HTMLDivElement;
  pointerId: number;
}

const BUTTONS: { action: Action; label: string; r: number; ox: number; oy: number }[] = [
  { action: 'attack', label: 'TEBAS', r: 32, ox: 62, oy: 66 },
  { action: 'dodge', label: 'GESER', r: 24, ox: 132, oy: 44 },
  // quick weapon swap; the label shows what you are swapping *to*
  { action: 'swap', label: 'BUSUR', r: 22, ox: 60, oy: 134 },
  { action: 'skill', label: 'SKILL', r: 22, ox: 140, oy: 110 },
];

export class TouchControls {
  private root: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId = -1;
  private center = { x: 0, y: 0 };
  private buttons: ActionButton[] = [];
  private chargeRing!: HTMLDivElement;
  private unsubscribe: () => void;
  enabled = true;

  constructor(parent: HTMLElement = document.body) {
    injectStyle('lm-ui-touch', CSS);
    this.root = el('div');
    this.root.className = 'lm-touch';
    this.base = el('div');
    this.base.className = 'lm-stick-base';
    this.knob = el('div');
    this.knob.className = 'lm-stick-knob';
    this.root.append(this.base, this.knob);
    for (const b of BUTTONS) {
      const node = el('div', {}, b.label);
      node.className = 'lm-act';
      this.root.appendChild(node);
      this.buttons.push({ ...b, node, pointerId: -1 });
    }
    this.chargeRing = el('div');
    this.chargeRing.className = 'lm-charge';
    this.root.appendChild(this.chargeRing);
    parent.appendChild(this.root);

    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('pointercancel', (e) => this.onUp(e));
    this.root.addEventListener('lostpointercapture', (e) => this.onUp(e));

    this.unsubscribe = settings.on((key) => {
      if (key === 'stickScale' || key === 'stickX' || key === 'stickY' || key === 'buttonScale') this.layout();
    });
    this.layout();
  }

  private get radius(): number {
    return BASE_R * settings.get('stickScale');
  }

  /**
   * Put the stick back at its resting position and size, and place the action buttons.
   *
   * Everything here is clamped into the safe area rather than to the raw window: on a phone in
   * landscape the notch is on one side and the gesture bar along the bottom, so a button at
   * "8px from the right" can end up under a camera cutout, and a joystick on the bottom edge
   * fights the system's swipe-up. The insets also mean the layout differs left-to-right, which is
   * why each edge is computed separately instead of using one margin.
   */
  layout(): void {
    const safe = safeInsets();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = settings.get('stickScale');
    const r = BASE_R * scale;
    const k = KNOB_R * scale;
    const minX = safe.left + r + 6;
    const maxX = Math.max(minX, w * STICK_ZONE - r);
    const minY = safe.top + r + 6;
    const maxY = Math.max(minY, h - safe.bottom - r - 6);
    this.center = {
      x: Math.max(minX, Math.min(maxX, w * settings.get('stickX'))),
      y: Math.max(minY, Math.min(maxY, h * settings.get('stickY'))),
    };
    Object.assign(this.base.style, { width: `${r * 2}px`, height: `${r * 2}px` });
    Object.assign(this.knob.style, { width: `${k * 2}px`, height: `${k * 2}px` });
    this.place(this.center.x, this.center.y, 0, 0);
    this.setIdle(true);

    /*
     * Action buttons, anchored to the bottom-right *inside* the safe area.
     *
     * The offsets are scaled by the player's button size, so turning the buttons up moves them
     * further from the corner as well as making them bigger — otherwise a 1.8x button hangs off
     * the edge of the screen. Each one is then clamped so the whole circle stays on screen even
     * at the largest size on the shortest phone.
     */
    const bs = settings.get('buttonScale');
    const rightEdge = w - safe.right;
    const bottomEdge = h - safe.bottom;
    for (const b of this.buttons) {
      const br = b.r * bs;
      const cx = Math.min(rightEdge - br - 4, Math.max(w * 0.55, rightEdge - b.ox * bs));
      const cy = Math.min(bottomEdge - br - 4, Math.max(safe.top + br + 4, bottomEdge - b.oy * bs));
      Object.assign(b.node.style, {
        width: `${br * 2}px`,
        height: `${br * 2}px`,
        left: `${cx}px`,
        top: `${cy}px`,
        fontSize: `${Math.max(8, Math.round(9 * bs))}px`,
      });
    }
  }

  /**
   * Show the state of the weapons: what the swap button will switch to, and how far the bow is
   * drawn. Called every frame by the renderer; the DOM writes are two strings and an opacity.
   */
  setWeaponState(nextWeapon: string, charge: number, held: { label: string; ranged: boolean } | null = null): void {
    const swap = this.buttons.find((b) => b.action === 'swap');
    if (swap && swap.node.textContent !== nextWeapon) swap.node.textContent = nextWeapon;
    const attack = this.buttons.find((b) => b.action === 'attack');
    if (!attack) return;
    if (held) {
      if (attack.node.textContent !== held.label) attack.node.textContent = held.label;
      attack.node.classList.toggle('melee', !held.ranged);
      attack.node.classList.toggle('ranged', held.ranged);
    }
    const bs = settings.get('buttonScale');
    const r = (attack.r + 7) * bs * (0.75 + charge * 0.25);
    Object.assign(this.chargeRing.style, {
      left: attack.node.style.left,
      top: attack.node.style.top,
      width: `${r * 2}px`,
      height: `${r * 2}px`,
      opacity: charge > 0.02 ? String(0.35 + charge * 0.65) : '0',
      borderColor: charge >= 1 ? 'rgba(255, 224, 102, 0.95)' : 'rgba(124, 196, 255, 0.9)',
    });
  }

  /** Which action button is under a screen point, if any. */
  private hitButton(px: number, py: number): ActionButton | null {
    const bs = settings.get('buttonScale');
    for (const b of this.buttons) {
      const cx = parseFloat(b.node.style.left);
      const cy = parseFloat(b.node.style.top);
      if (Math.hypot(px - cx, py - cy) <= b.r * bs + 8) return b;
    }
    return null;
  }

  /** Press an action button as if tapped. Shared by pointer events and the tests. */
  pressButton(b: ActionButton, down: boolean, pointerId = -1): void {
    b.pointerId = down ? pointerId : -1;
    b.node.classList.toggle('down', down);
    if (down) input.press(b.action);
    else input.release(b.action);
  }

  /** The action buttons, for tests and for the HUD to reflect cooldowns later. */
  get actionButtons(): readonly ActionButton[] {
    return this.buttons;
  }

  private setIdle(idle: boolean): void {
    this.base.style.opacity = idle ? '0.35' : '0.9';
    this.knob.style.opacity = idle ? '0.4' : '1';
  }

  private place(cx: number, cy: number, kx: number, ky: number): void {
    this.base.style.left = `${cx}px`;
    this.base.style.top = `${cy}px`;
    this.knob.style.left = `${cx + kx}px`;
    this.knob.style.top = `${cy + ky}px`;
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    // Browsers only allow audio to start inside a real gesture; this is that gesture.
    unlockAudio();
    const hit = this.hitButton(e.clientX, e.clientY);
    if (hit) {
      input.lastDevice = 'touch';
      this.pressButton(hit, true, e.pointerId);
      return;
    }
    if (this.pointerId >= 0) return;
    if (e.clientX > window.innerWidth * STICK_ZONE) return;
    // Near enough to the fixed base to count as reaching for it.
    if (Math.hypot(e.clientX - this.center.x, e.clientY - this.center.y) > this.radius * GRAB_RADII) return;
    this.pointerId = e.pointerId;
    this.root.setPointerCapture?.(e.pointerId);
    input.lastDevice = 'touch';
    // The base does not move to meet the thumb: it stays where the player put it.
    this.setIdle(false);
    this.drag(e.clientX, e.clientY);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.drag(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent): void {
    for (const b of this.buttons) if (b.pointerId === e.pointerId) this.pressButton(b, false);
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    input.stick.x = 0;
    input.stick.y = 0;
    this.layout();
  }

  /**
   * Move the thumb to a screen position. Shared by pointer events and the tests.
   *
   * The base is fixed, so a thumb past the edge of the ring clamps the knob to the rim and keeps
   * reading as full tilt in that direction — you can slide well outside the circle and still be
   * walking, which is what makes a fixed stick usable without looking at it.
   */
  drag(px: number, py: number): void {
    const r = this.radius;
    let dx = px - this.center.x;
    let dy = py - this.center.y;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / r);
    if (m < DEADZONE) {
      input.stick.x = 0;
      input.stick.y = 0;
    } else {
      const k = (m - DEADZONE) / (1 - DEADZONE);
      input.stick.x = (dx / (m * r)) * k;
      input.stick.y = (dy / (m * r)) * k;
    }
    this.place(this.center.x, this.center.y, dx, dy);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
    if (!v) {
      input.stick.x = 0;
      input.stick.y = 0;
      for (const b of this.buttons) this.pressButton(b, false);
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
