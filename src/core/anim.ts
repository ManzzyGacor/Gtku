/** Tiny frame animator (no Phaser) so animation freezes cleanly with hit-stop and is unit-testable. */
export interface Clip {
  frames: string[];
  fps: number;
  loop: boolean;
}

export class Animator {
  private clip: Clip | null = null;
  private name = '';
  private t = 0;
  finished = false;

  get current(): string {
    return this.name;
  }

  play(name: string, clip: Clip, restart = false): void {
    if (this.name === name && !restart) return;
    this.name = name;
    this.clip = clip;
    this.t = 0;
    this.finished = false;
  }

  update(dt: number): void {
    if (!this.clip) return;
    this.t += dt;
    if (!this.clip.loop && this.t * this.clip.fps >= this.clip.frames.length) this.finished = true;
  }

  /** Frame index for the current time. */
  get index(): number {
    if (!this.clip) return 0;
    const i = Math.floor(this.t * this.clip.fps);
    return this.clip.loop ? i % this.clip.frames.length : Math.min(i, this.clip.frames.length - 1);
  }

  get frame(): string {
    return this.clip ? this.clip.frames[this.index] : '';
  }

  /** Let walk cycles keep their phase when switching between similar clips. */
  setTime(t: number): void {
    this.t = t;
  }
}
