/**
 * Binds the cutscene timeline (`core/story/cutscene.ts`) to the 3D world.
 *
 * Everything the engine can ask for lands here: the camera pan, the lighting override, posing the
 * hero, named particle effects, sound, and the flags the story sets. The timeline itself stays
 * renderer-free, so this file is the *only* place that knows a cutscene is being drawn with
 * Three.js — swap the renderer and the scripts in `cutscenes.ts` keep working.
 */
import type { IsoCamera } from './IsoCamera';
import { bus, sfx as sfxTable } from '../core/audio';
import { dayTimeForNight } from '../core/systems/daynight';
import {
  CutscenePlayer,
  type ActorSpec,
  type CameraSpec,
  type CutsceneDef,
  type CutsceneHooks,
  type CutsceneView,
  type Ease,
  type FxSpec,
  type LightSpec,
} from '../core/story/cutscene';

/** What the cutscene needs from the game around it. Kept tiny on purpose. */
export interface CutsceneWorld {
  /** Freeze the day/night clock at this time, or `null` to hand it back to the game. */
  setDayTime(t: number | null): void;
  /** Extra tint on the ambient light, or `null` for none. */
  setTint(tint: [number, number, number] | null): void;
  /** Move or pose an actor. `hero` is the player; other ids are whatever the scene staged. */
  actor(spec: ActorSpec): void;
  /** A named particle effect — the table of names lives in the game, not in the script. */
  fx(spec: FxSpec): void;
  /** Set a save flag. */
  flag(name: string): void;
}

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
};

/** One tile is one world unit; cutscene scripts are written in world *pixels* like everything else. */
const u = (px: number): number => px / 16;

interface Pan {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  fromPitch: number;
  toPitch: number;
  fromZoom: number;
  toZoom: number;
  t: number;
  dur: number;
  ease: Ease;
}

export class Cutscene3D {
  private player: CutscenePlayer | null = null;
  private pan: Pan | null = null;
  /** Remembered so a finished cutscene can hand the camera back exactly as it found it. */
  private restore: { pitch: number; zoom: number } | null = null;

  constructor(
    private readonly camera: IsoCamera,
    private readonly world: CutsceneWorld,
  ) {}

  /** True while the scene is still playing: what gates input and the paused world. */
  get running(): boolean {
    return !!this.player && !this.player.done;
  }

  /**
   * True while a scene is loaded, *including* the frame it finished on.
   *
   * The distinction matters: `skip()` ends the timeline immediately, so without this the frame loop
   * would see `running === false`, skip its tidy-up, and never mark the scene as watched. The owner
   * keeps calling `update()` until it returns false, then calls `clear()`.
   */
  get active(): boolean {
    return !!this.player;
  }

  get view(): CutsceneView | null {
    return this.player?.view ?? null;
  }

  get id(): string | null {
    return this.player?.def.id ?? null;
  }

  get skipped(): boolean {
    return this.player?.wasSkipped ?? false;
  }

  /** Start a scene. `vars` fills the `{nama}` placeholders. */
  play(def: CutsceneDef, opts: { vars?: Record<string, string>; textSpeed?: () => number } = {}): void {
    this.restore = { pitch: this.camera.pitch, zoom: this.camera.zoom };
    this.pan = null;
    this.player = new CutscenePlayer(def, this.hooks(), { vars: opts.vars, textSpeed: opts.textSpeed });
  }

  /**
   * Advance the scene. Returns false once it is over, after putting the camera, the clock and the
   * player's own pitch/zoom back — a cutscene must not leave the game in its shot.
   */
  update(dt: number): boolean {
    const player = this.player;
    if (!player) return false;
    if (player.done) return false;
    player.update(dt);
    this.tickPan(dt);
    if (!player.done) return true;
    this.finish();
    return false;
  }

  advance(): void {
    this.player?.advance();
  }

  /**
   * The Skip button. The timeline applies the rest of the scene instantly, then we tidy up — but
   * the player object stays until `clear()`, so the frame loop still gets its one last turn.
   */
  skip(): void {
    const player = this.player;
    if (!player || player.done) return;
    player.skip();
    // a skipped pan should land, not freeze halfway
    if (this.pan) {
      this.pan.t = this.pan.dur;
      this.tickPan(0);
    }
    this.finish();
  }

  /** Let go of the finished scene. Called by the owner once it has done its own tidy-up. */
  clear(): void {
    this.player = null;
  }

  private finish(): void {
    this.pan = null;
    this.world.setDayTime(null);
    this.world.setTint(null);
    if (this.restore) this.camera.setOverride(null, null);
    this.restore = null;
  }

  private tickPan(dt: number): void {
    const pan = this.pan;
    if (!pan) return;
    pan.t = Math.min(pan.dur, pan.t + dt);
    const k = pan.dur > 0 ? EASES[pan.ease](pan.t / pan.dur) : 1;
    const x = pan.fromX + (pan.toX - pan.fromX) * k;
    const z = pan.fromZ + (pan.toZ - pan.fromZ) * k;
    const pitch = pan.fromPitch + (pan.toPitch - pan.fromPitch) * k;
    const zoom = pan.fromZoom + (pan.toZoom - pan.fromZoom) * k;
    if (pitch !== this.camera.pitch || zoom !== this.camera.zoom) this.camera.setOverride(pitch, zoom);
    this.camera.snap(x, z);
    if (pan.t >= pan.dur) this.pan = null;
  }

  private hooks(): CutsceneHooks {
    return {
      camera: (spec: CameraSpec) => this.startPan(spec),
      // The fade itself is drawn by the DOM overlay from `view.fade`; nothing to do in the scene.
      fade: () => undefined,
      light: (spec: LightSpec) => {
        if (spec.night !== undefined) this.world.setDayTime(dayTimeForNight(spec.night));
        if (spec.tint !== undefined) this.world.setTint(spec.tint ?? null);
      },
      actor: (spec) => this.world.actor(spec),
      sfx: (id) => playCue(id),
      music: (id, fade) => bus.music(id, fade),
      ambient: (id) => bus.ambient(id),
      fx: (spec) => this.world.fx(spec),
      shake: (amount, dur) => this.camera.shake(amount, dur),
      flag: (name) => this.world.flag(name),
    };
  }

  private startPan(spec: CameraSpec): void {
    const toX = spec.x !== undefined ? u(spec.x) : this.camera.target.x;
    const toZ = spec.y !== undefined ? u(spec.y) : this.camera.target.z;
    const toPitch = spec.pitch ?? this.camera.pitch;
    const toZoom = spec.zoom ?? this.camera.zoom;
    if (spec.dur <= 0) {
      this.pan = null;
      this.camera.setOverride(toPitch, toZoom);
      this.camera.snap(toX, toZ);
      return;
    }
    this.pan = {
      fromX: this.camera.target.x,
      fromZ: this.camera.target.z,
      toX,
      toZ,
      fromPitch: this.camera.pitch,
      toPitch,
      fromZoom: this.camera.zoom,
      toZoom,
      t: 0,
      dur: spec.dur,
      ease: spec.ease,
    };
  }
}

/**
 * Named sound cues a script can ask for.
 *
 * A script says `{ t: 'sfx', id: 'thunder' }`; this table decides what that means. Adding a cue is
 * one line here, and an unknown name is silently ignored rather than crashing a cutscene — a
 * missing sound is a much smaller problem than a scene that stops.
 */
function playCue(id: string): void {
  switch (id) {
    case 'thunder':
      sfxTable.thunder();
      break;
    case 'rain':
      sfxTable.rainBurst();
      break;
    case 'door':
      sfxTable.door();
      break;
    case 'glass':
      sfxTable.glass();
      break;
    case 'heartbeat':
      sfxTable.heartbeat();
      break;
    case 'lantern':
      sfxTable.lanternLight();
      break;
    case 'step':
      sfxTable.footstep();
      break;
    case 'hurt':
      sfxTable.hurt();
      break;
    case 'levelUp':
      sfxTable.levelUp();
      break;
    case 'pickup':
      sfxTable.pickup();
      break;
    default:
      break;
  }
}
