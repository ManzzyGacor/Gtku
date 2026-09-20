/**
 * Adaptive quality: watches the smoothed FPS and steps effects down when the device can't hold ~60 fps.
 * Level 2 = everything, 1 = no bloom, 0 = fewer particles + lightmap every 2nd frame.
 * Override for testing with `?q=0|1|2` in the URL.
 */
export type QualityLevel = 0 | 1 | 2;

export class Quality {
  level: QualityLevel = 2;
  private samples: number[] = [];
  private timer = 0;
  private bad = 0;
  private locked = false;
  onChange: (level: QualityLevel) => void = () => undefined;

  constructor() {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('q') : null;
    if (q === '0' || q === '1' || q === '2') {
      this.level = Number(q) as QualityLevel;
      this.locked = true;
    }
  }

  /** Call once per frame with real delta seconds. */
  update(dt: number): void {
    if (this.locked || dt <= 0 || dt > 0.5) return;
    this.samples.push(1 / dt);
    if (this.samples.length > 90) this.samples.shift();
    this.timer += dt;
    if (this.timer < 2) return;
    this.timer = 0;
    if (this.samples.length < 60) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg < 46 && this.level > 0) {
      this.bad++;
      if (this.bad >= 2) {
        this.level = (this.level - 1) as QualityLevel;
        this.bad = 0;
        this.samples.length = 0;
        this.onChange(this.level);
      }
    } else this.bad = 0;
  }
}
