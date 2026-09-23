/** Small always-on-top FPS readout: average, worst half-second, and the live object count. */
import { settings } from '../core/settings';
import type { DiagnosticsSource } from './diagnostics';
import { el } from './dom';

export class FpsMeterView {
  private node: HTMLDivElement;
  private acc = 0;

  constructor(parent: HTMLElement) {
    this.node = el('div', {
      position: 'fixed',
      left: '4px',
      top: '4px',
      zIndex: '80',
      padding: '2px 6px',
      background: 'rgba(15, 11, 28, 0.72)',
      color: '#ffe9a8',
      font: '11px/1.35 ui-monospace, monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      borderRadius: '3px',
      display: 'none',
    });
    parent.appendChild(this.node);
  }

  /** Call once per frame; the text itself only refreshes ~4x per second so it stays readable. */
  update(dt: number, src: DiagnosticsSource): void {
    const on = settings.get('fpsCounter');
    const want = on ? 'block' : 'none';
    if (this.node.style.display !== want) this.node.style.display = want;
    if (!on) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const { avg, low } = src.fps();
    const v = src.view();
    this.node.textContent = `${avg.toFixed(0)} fps  min ${low.toFixed(0)}\n${src.objects()} objek  ${v.w}x${v.h}`;
    this.node.style.color = avg < 30 ? '#ff8a7a' : avg < 45 ? '#ffb04a' : '#ffe9a8';
  }

  destroy(): void {
    this.node.remove();
  }
}
