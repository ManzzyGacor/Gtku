import Phaser from 'phaser';

/**
 * Smooth follow camera with look-ahead, world clamping and integer-pixel screen shake.
 * We drive scroll ourselves (instead of startFollow) so shake and pixel snapping are exact.
 */
export class CameraRig {
  private sx = 0;
  private sy = 0;
  private shakeMag = 0;
  private shakeT = 0;
  private shakeDur = 0.0001;
  private lookX = 0;
  private lookY = 0;
  smoothing = 8;

  constructor(
    private readonly cam: Phaser.Cameras.Scene2D.Camera,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {}

  shake(mag: number, dur = 0.18): void {
    if (mag >= this.shakeMag * (this.shakeT / this.shakeDur)) {
      this.shakeMag = mag;
      this.shakeT = dur;
      this.shakeDur = dur;
    }
  }

  private clampAxis(v: number, view: number, world: number): number {
    if (world <= view) return (world - view) / 2;
    return Math.max(0, Math.min(world - view, v));
  }

  snap(x: number, y: number): void {
    const w = this.cam.width;
    const h = this.cam.height;
    this.sx = this.clampAxis(x - w / 2, w, this.worldW);
    this.sy = this.clampAxis(y - h / 2, h, this.worldH);
    this.apply(0);
  }

  update(dt: number, x: number, y: number, vx = 0, vy = 0): void {
    const w = this.cam.width;
    const h = this.cam.height;
    // look ahead in the movement direction
    const k = 1 - Math.exp(-dt * 3);
    this.lookX += (Math.max(-26, Math.min(26, vx * 0.3)) - this.lookX) * k;
    this.lookY += (Math.max(-16, Math.min(16, vy * 0.22)) - this.lookY) * k;
    const tx = this.clampAxis(x + this.lookX - w / 2, w, this.worldW);
    const ty = this.clampAxis(y + this.lookY - h / 2 - 6, h, this.worldH);
    const f = 1 - Math.exp(-dt * this.smoothing);
    this.sx += (tx - this.sx) * f;
    this.sy += (ty - this.sy) * f;
    this.apply(dt);
  }

  private apply(dt: number): void {
    let ox = 0;
    let oy = 0;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const m = this.shakeMag * (this.shakeT / this.shakeDur);
      ox = Math.round((Math.random() * 2 - 1) * m);
      oy = Math.round((Math.random() * 2 - 1) * m);
    }
    this.cam.setScroll(Math.round(this.sx) + ox, Math.round(this.sy) + oy);
  }

  get view(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.cam.scrollX, this.cam.scrollY, this.cam.width, this.cam.height);
  }
}
