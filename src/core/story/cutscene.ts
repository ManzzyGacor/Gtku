/**
 * The cutscene engine (docs/OVERHAUL.md §4 "Cutscene": dijalankan engine — kamera, dialog,
 * animasi, fade, cahaya, partikel, suara — **bukan video**, dan selalu ada tombol Skip).
 *
 * A cutscene is **data**: a list of steps on a timeline. This file knows how to run that list and
 * nothing about what the steps mean; every visible effect is handed to a hook the renderer
 * implements. That split is the whole point — adding a new cutscene means adding an entry to
 * `cutscenes.ts`, with no engine change at all, and it means the timeline can be tested in Node
 * without a GPU.
 *
 * **How the timeline works.** Each step starts, and the timeline then waits `hold` seconds before
 * starting the next one. `hold` defaults to the step's own duration, so a plain list reads
 * sequentially; setting `hold: 0` starts a step and moves on immediately, which is how a four
 * second camera drift runs *underneath* three lines of dialogue. One number, and no nested
 * parallel blocks to reason about.
 */

export type Ease = 'linear' | 'inOut' | 'out';

/** Shared by every step. */
interface Timed {
  /**
   * How long the timeline waits after starting this step, in seconds.
   * Defaults to the step's own duration; `0` means "start it and carry on".
   */
  hold?: number | undefined;
}

export type CutsceneStep =
  /** Dead air. Silence is a storytelling tool; this is how you spend it. */
  | ({ t: 'wait'; dur: number } & Timed)
  /**
   * A line of dialogue, revealed letter by letter. With `dur` it advances on its own that many
   * seconds after the text finishes; without one it waits for a tap.
   */
  | ({ t: 'say'; who?: string | undefined; look?: string | undefined; text: string; dur?: number | undefined } & Timed)
  /** Full-width caption over the letterbox: place names, time jumps, narration. */
  | ({ t: 'caption'; text: string; dur: number } & Timed)
  /** Fade the screen toward `color` (0 = clear, 1 = solid). */
  | ({ t: 'fade'; to: number; dur?: number | undefined; color?: number | undefined } & Timed)
  /** Move the camera. Any field left out is left alone. */
  | ({ t: 'camera'; x?: number | undefined; y?: number | undefined; pitch?: number | undefined; zoom?: number | undefined; dur?: number | undefined; ease?: Ease | undefined } & Timed)
  /** Override the world's lighting: `night` 0..1, plus an optional ambient tint. */
  | ({ t: 'light'; night?: number | undefined; tint?: [number, number, number] | undefined; dur?: number | undefined } & Timed)
  /** Move or pose an actor (the hero, an NPC, a prop the scene placed). */
  | ({ t: 'actor'; id: string; x?: number | undefined; y?: number | undefined; anim?: string | undefined; face?: number | undefined; dur?: number | undefined } & Timed)
  | ({ t: 'sfx'; id: string } & Timed)
  | ({ t: 'music'; id: string; fade?: number | undefined } & Timed)
  | ({ t: 'ambient'; id: string } & Timed)
  /** A named particle effect. The renderer owns the table of names. */
  | ({ t: 'fx'; kind: string; x?: number | undefined; y?: number | undefined; color?: number | undefined; big?: boolean | undefined } & Timed)
  | ({ t: 'shake'; amount: number; dur?: number | undefined } & Timed)
  /** Set a save flag, so the world can react to something the cutscene established. */
  | ({ t: 'flag'; set: string } & Timed);

export interface CutsceneDef {
  id: string;
  /** Shown on the skip button and in the Settings replay list. */
  title: string;
  /** Roughly how long it runs unskipped, for the replay list. Computed if absent. */
  steps: CutsceneStep[];
  /** Letterbox bars: cinematic for the intro, off for a short in-game beat. */
  letterbox?: boolean;
  /** Which music to hand back to the game when it ends (usually the area's own). */
  endMusic?: string;
}

export interface CameraSpec {
  x?: number | undefined;
  y?: number | undefined;
  pitch?: number | undefined;
  zoom?: number | undefined;
  dur: number;
  ease: Ease;
}

export interface LightSpec {
  night?: number | undefined;
  tint?: [number, number, number] | undefined;
  dur: number;
}

export interface ActorSpec {
  id: string;
  x?: number | undefined;
  y?: number | undefined;
  anim?: string | undefined;
  face?: number | undefined;
  dur: number;
}

export interface FxSpec {
  kind: string;
  x?: number | undefined;
  y?: number | undefined;
  color?: number | undefined;
  big?: boolean | undefined;
}

/**
 * Everything a cutscene can do to the world. The renderer implements these; the timeline only
 * decides when they happen.
 */
export interface CutsceneHooks {
  camera(spec: CameraSpec): void;
  fade(to: number, dur: number, color: number): void;
  light(spec: LightSpec): void;
  actor(spec: ActorSpec): void;
  sfx(id: string): void;
  music(id: string, fade: number): void;
  ambient(id: string): void;
  fx(spec: FxSpec): void;
  shake(amount: number, dur: number): void;
  flag(name: string): void;
}

/** What the overlay draws. Pure data, so the same state can be asserted in a test. */
export interface CutsceneView {
  /** Narration over the letterbox, or null. */
  caption: string | null;
  /** Speaker name, or null when nobody is speaking. */
  who: string | null;
  look: string | null;
  /** The line being revealed, already cut to the revealed length. */
  text: string;
  /** True once the whole line is out, i.e. a tap would advance rather than hurry. */
  complete: boolean;
  /** True when this line is waiting for a tap (no `dur`). */
  waiting: boolean;
  fade: number;
  fadeColor: number;
  letterbox: boolean;
}

export interface CutsceneOptions {
  /** Characters per second. Read through a function so the Settings slider applies live. */
  textSpeed?: (() => number) | undefined;
  /** `{nama}` and friends, substituted into every `say`/`caption`. */
  vars?: Record<string, string> | undefined;
}

const DEFAULT_TEXT_SPEED = 42;

/** Substitute `{key}` placeholders. Unknown keys are left alone rather than blanked. */
export function interpolate(text: string, vars: Record<string, string> | undefined): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

/** How long a step occupies the timeline when it does not say. */
function defaultHold(step: CutsceneStep): number {
  switch (step.t) {
    case 'wait':
      return step.dur;
    case 'caption':
      return step.dur;
    case 'fade':
      return step.dur ?? 0.6;
    case 'camera':
      return step.dur ?? 0;
    case 'light':
      return step.dur ?? 0;
    case 'actor':
      return step.dur ?? 0;
    case 'shake':
      return 0;
    case 'say':
      // the reveal time is not known until the text speed is, so `say` is handled by the player
      return 0;
    default:
      return 0;
  }
}

/** Estimated unskipped length, for the Settings replay list. */
export function cutsceneLength(def: CutsceneDef, textSpeed = DEFAULT_TEXT_SPEED): number {
  let total = 0;
  for (const step of def.steps) {
    if (step.hold !== undefined) {
      total += step.hold;
      continue;
    }
    if (step.t === 'say') total += step.text.length / textSpeed + (step.dur ?? 1.2);
    else total += defaultHold(step);
  }
  return Math.round(total);
}

export class CutscenePlayer {
  private index = -1;
  /** Seconds left before the next step starts. */
  private hold = 0;
  private caption: string | null = null;
  private captionLeft = 0;
  private line: { who: string | null; look: string | null; text: string; dur: number | undefined } | null = null;
  private revealed = 0;
  /** Set once the line is fully revealed and its `dur` has run out. */
  private lineDone = false;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeT = 0;
  private fadeDur = 0;
  private fadeColor = 0x000000;
  private finished = false;
  private skipped = false;

  constructor(
    readonly def: CutsceneDef,
    private readonly hooks: CutsceneHooks,
    private readonly opts: CutsceneOptions = {},
  ) {}

  get done(): boolean {
    return this.finished;
  }

  get wasSkipped(): boolean {
    return this.skipped;
  }

  private speed(): number {
    const v = this.opts.textSpeed?.() ?? DEFAULT_TEXT_SPEED;
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_TEXT_SPEED;
  }

  private text(raw: string): string {
    return interpolate(raw, this.opts.vars);
  }

  get view(): CutsceneView {
    const fade = this.fadeDur > 0
      ? this.fadeFrom + (this.fadeTo - this.fadeFrom) * Math.min(1, this.fadeT / this.fadeDur)
      : this.fadeTo;
    return {
      caption: this.caption,
      who: this.line?.who ?? null,
      look: this.line?.look ?? null,
      text: this.line ? this.line.text.slice(0, Math.floor(this.revealed)) : '',
      complete: !this.line || this.revealed >= this.line.text.length,
      waiting: !!this.line && this.line.dur === undefined && this.revealed >= this.line.text.length,
      fade: Math.max(0, Math.min(1, fade)),
      fadeColor: this.fadeColor,
      letterbox: this.def.letterbox !== false,
    };
  }

  /** Drive the timeline. Safe to call after it has finished. */
  update(dt: number): void {
    if (this.finished || !Number.isFinite(dt) || dt < 0) return;
    this.fadeT += dt;
    if (this.captionLeft > 0) {
      this.captionLeft -= dt;
      if (this.captionLeft <= 0) this.caption = null;
    }

    // reveal the current line, then count down its dwell
    if (this.line) {
      const len = this.line.text.length;
      if (this.revealed < len) {
        this.revealed = Math.min(len, this.revealed + this.speed() * dt);
      } else if (this.line.dur !== undefined) {
        this.line.dur -= dt;
        if (this.line.dur <= 0) {
          this.line = null;
          this.lineDone = true;
        }
      }
      // a line waiting for a tap holds the timeline
      if (this.line) return;
    }

    this.hold -= dt;
    let guard = 0;
    while (this.hold <= 0 && !this.finished && !this.line) {
      // A cutscene is authored data; a malformed one must not hang the game.
      if (++guard > 500) {
        this.finish();
        return;
      }
      const carry = this.hold;
      this.index++;
      if (this.index >= this.def.steps.length) {
        this.finish();
        return;
      }
      // How much of this frame is left over after the previous step's hold ran out. A line that
      // starts mid-frame has to begin revealing now, not on the next frame — otherwise a fast
      // text speed still shows an empty box for one frame per line.
      this.run(this.def.steps[this.index], Math.max(0, -carry));
      this.hold += carry;
    }
    void this.lineDone;
  }

  /** A tap: hurry the current line, or advance past it. */
  advance(): void {
    if (this.finished) return;
    if (!this.line) {
      // nothing to advance past: cut the current wait short
      this.hold = Math.min(this.hold, 0);
      return;
    }
    if (this.revealed < this.line.text.length) {
      this.revealed = this.line.text.length;
      return;
    }
    this.line = null;
    this.hold = 0;
  }

  /**
   * Jump to the end.
   *
   * Skipping must not leave the world half-posed, so every remaining step is applied with its
   * duration collapsed to zero: the camera, the lights and the flags all end up exactly where the
   * cutscene would have put them. Dialogue and waits are simply dropped.
   */
  skip(): void {
    if (this.finished) return;
    this.skipped = true;
    this.line = null;
    this.caption = null;
    for (let i = this.index + 1; i < this.def.steps.length; i++) {
      const step = this.def.steps[i];
      switch (step.t) {
        case 'camera':
          this.hooks.camera({ x: step.x, y: step.y, pitch: step.pitch, zoom: step.zoom, dur: 0, ease: 'linear' });
          break;
        case 'light':
          this.hooks.light({ night: step.night, tint: step.tint, dur: 0 });
          break;
        case 'actor':
          this.hooks.actor({ id: step.id, x: step.x, y: step.y, anim: step.anim, face: step.face, dur: 0 });
          break;
        case 'fade':
          this.fadeFrom = step.to;
          this.fadeTo = step.to;
          this.fadeDur = 0;
          this.fadeT = 0;
          this.fadeColor = step.color ?? this.fadeColor;
          this.hooks.fade(step.to, 0, this.fadeColor);
          break;
        case 'flag':
          this.hooks.flag(step.set);
          break;
        case 'music':
          this.hooks.music(step.id, 0);
          break;
        case 'ambient':
          this.hooks.ambient(step.id);
          break;
        default:
          // sfx, fx, shake, say, wait, caption: a skipped scene should be silent and still
          break;
      }
    }
    this.index = this.def.steps.length;
    this.finish();
  }

  private finish(): void {
    this.finished = true;
    this.line = null;
    this.caption = null;
  }

  private run(step: CutsceneStep, leftover = 0): void {
    switch (step.t) {
      case 'say': {
        const text = this.text(step.text);
        this.line = { who: step.who ? this.text(step.who) : null, look: step.look ?? null, text, dur: step.dur };
        this.revealed = Math.min(text.length, this.speed() * leftover);
        this.hold = step.hold ?? 0;
        return;
      }
      case 'caption':
        this.caption = this.text(step.text);
        this.captionLeft = step.dur;
        break;
      case 'fade':
        this.fadeFrom = this.view.fade;
        this.fadeTo = step.to;
        this.fadeDur = step.dur ?? 0.6;
        this.fadeT = 0;
        this.fadeColor = step.color ?? this.fadeColor;
        this.hooks.fade(step.to, this.fadeDur, this.fadeColor);
        break;
      case 'camera':
        this.hooks.camera({ x: step.x, y: step.y, pitch: step.pitch, zoom: step.zoom, dur: step.dur ?? 0, ease: step.ease ?? 'inOut' });
        break;
      case 'light':
        this.hooks.light({ night: step.night, tint: step.tint, dur: step.dur ?? 0 });
        break;
      case 'actor':
        this.hooks.actor({ id: step.id, x: step.x, y: step.y, anim: step.anim, face: step.face, dur: step.dur ?? 0 });
        break;
      case 'sfx':
        this.hooks.sfx(step.id);
        break;
      case 'music':
        this.hooks.music(step.id, step.fade ?? 1.5);
        break;
      case 'ambient':
        this.hooks.ambient(step.id);
        break;
      case 'fx':
        this.hooks.fx({ kind: step.kind, x: step.x, y: step.y, color: step.color, big: step.big });
        break;
      case 'shake':
        this.hooks.shake(step.amount, step.dur ?? 0.3);
        break;
      case 'flag':
        this.hooks.flag(step.set);
        break;
      case 'wait':
        break;
      default:
        break;
    }
    this.hold = step.hold ?? defaultHold(step);
  }
}
