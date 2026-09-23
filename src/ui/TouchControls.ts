/**
 * DOM touch controls for the 3D renderer.
 *
 * Deliberately renderer-agnostic and separate from the Phaser HUD: this is the control layer the
 * 3D build uses now and the one the 2D HUD will eventually be replaced by (docs/OVERHAUL.md §7).
 * It writes into the same `input` hub the game logic already reads, so `HeroCore` cannot tell the
 * difference between a finger, a key and a test.
 *
 * The stick is *dynamic*: it appears wherever the thumb lands on the left side of the screen and
 * the base follows the thumb when it runs past the edge, which is what works on a phone held in
 * two hands. Its resting position and size come from the settings menu.
 */
import { input } from '../core/input';
import { settings } from '../core/settings';
import { el, injectStyle } from './dom';

const BASE_R = 34;
const KNOB_R = 15;
/** Fraction of the screen width that belongs to the stick. */
const STICK_ZONE = 0.55;
const DEADZONE = 0.14;

const CSS = `
.lm-touch { position: fixed; inset: 0; z-index: 70; touch-action: none; }
.lm-stick-base, .lm-stick-knob { position: absolute; border-radius: 50%; pointer-events: none;
  transform: translate(-50%, -50%); transition: opacity 120ms linear; }
.lm-stick-base { border: 2px solid rgba(242, 226, 194, 0.55); background: rgba(26, 20, 48, 0.35); }
.lm-stick-knob { background: rgba(242, 226, 194, 0.8); border: 2px solid rgba(255, 248, 230, 0.9); }
`;

export class TouchControls {
  private root: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId = -1;
  private center = { x: 0, y: 0 };
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
    parent.appendChild(this.root);

    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('pointercancel', (e) => this.onUp(e));
    this.root.addEventListener('lostpointercapture', (e) => this.onUp(e));

    this.unsubscribe = settings.on((key) => {
      if (key === 'stickScale' || key === 'stickX' || key === 'stickY') this.layout();
    });
    this.layout();
  }

  private get radius(): number {
    return BASE_R * settings.get('stickScale');
  }

  /** Put the stick back at its resting position and size. */
  layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = settings.get('stickScale');
    const r = BASE_R * scale;
    const k = KNOB_R * scale;
    this.center = {
      x: Math.max(r + 6, Math.min(w * STICK_ZONE - r, w * settings.get('stickX'))),
      y: Math.max(r + 6, Math.min(h - r - 6, h * settings.get('stickY'))),
    };
    Object.assign(this.base.style, { width: `${r * 2}px`, height: `${r * 2}px` });
    Object.assign(this.knob.style, { width: `${k * 2}px`, height: `${k * 2}px` });
    this.place(this.center.x, this.center.y, 0, 0);
    this.setIdle(true);
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
    if (!this.enabled || this.pointerId >= 0) return;
    if (e.clientX > window.innerWidth * STICK_ZONE) return;
    this.pointerId = e.pointerId;
    this.root.setPointerCapture?.(e.pointerId);
    input.lastDevice = 'touch';
    const r = this.radius;
    this.center = {
      x: Math.max(r, Math.min(window.innerWidth * STICK_ZONE, e.clientX)),
      y: Math.max(r, Math.min(window.innerHeight - r, e.clientY)),
    };
    this.setIdle(false);
    this.drag(e.clientX, e.clientY);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.drag(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    input.stick.x = 0;
    input.stick.y = 0;
    this.layout();
  }

  /** Shared by pointer events and the tests: move the thumb to a screen position. */
  drag(px: number, py: number): void {
    const r = this.radius;
    let dx = px - this.center.x;
    let dy = py - this.center.y;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      // Drag the base along so the thumb never runs out of room.
      dx = (dx / len) * r;
      dy = (dy / len) * r;
      this.center.x += px - this.center.x - dx;
      this.center.y += py - this.center.y - dy;
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
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
