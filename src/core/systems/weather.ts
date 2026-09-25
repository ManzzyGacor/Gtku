/**
 * Weather, as a look — and the pure rules behind it (fog distances, lightning timing, how wet the
 * ground is), so all of it is testable without a GPU.
 *
 * Weather changes during world events (Badai, Kabut) and from the developer menu; this table is
 * what each state does to the scene.
 *
 * **Why the fog is described "beyond the hero".** Three measures fog from the camera, and our
 * orthographic camera sits `CAMERA_DISTANCE` (70) away from the hero. The first version multiplied
 * the *whole* fog distance by a weather factor: fog ×0.45 put "fully fogged" at ~38 units from the
 * camera — well in front of the hero — so every pixel came out haze-grey. That was the "grey
 * screen" in rain, storm and fog, and (with the cave's own ×0.5) a good part of why the cave read
 * as a dark wash. Fog distances are now measured from the hero outward, in units of the view
 * radius, and scaled there: the hero always stands in thin fog, the far side of the screen in thick.
 */
export type Weather = 'cerah' | 'berkabut' | 'hujan' | 'badai';

export interface WeatherLook {
  label: string;
  /** Where the distance fog starts and ends, beyond the hero, in view radii (negative = in front). */
  fogNear: number;
  fogFar: number;
  /** Drifting ground mist, 0..1 (on top of the area's own). */
  mist: number;
  /** Added to the colour grade's lift, to cool the shadows. */
  tint: [number, number, number];
  /** Multiplies the colour grade's gain: < 1 darkens, but never to unreadable. */
  darken: number;
  /** Rain density 0..1, 0 for none. */
  rain: number;
  /** Sideways drift of the rain, world units per second (the wind). */
  wind: number;
  /** Mean seconds between lightning strikes, 0 for none. */
  lightning: number;
  /** Ambience bed to use instead of the area's own, or null to leave it. */
  ambient: string | null;
}

export const WEATHER: Record<Weather, WeatherLook> = {
  cerah: { label: 'Cerah', fogNear: 0.15, fogFar: 1.3, mist: 0, tint: [0, 0, 0], darken: 1, rain: 0, wind: 0, lightning: 0, ambient: null },
  berkabut: { label: 'Berkabut', fogNear: -0.3, fogFar: 0.85, mist: 0.75, tint: [0.02, 0.02, 0.03], darken: 0.97, rain: 0, wind: 0, lightning: 0, ambient: null },
  hujan: { label: 'Hujan', fogNear: 0, fogFar: 1.05, mist: 0.15, tint: [0.0, 0.01, 0.04], darken: 0.9, rain: 0.65, wind: 1.2, lightning: 0, ambient: 'rain' },
  badai: { label: 'Badai', fogNear: -0.1, fogFar: 0.95, mist: 0.25, tint: [0.0, 0.015, 0.06], darken: 0.8, rain: 1, wind: 4.5, lightning: 9, ambient: 'rain-heavy' },
};

export const WEATHER_IDS = Object.keys(WEATHER) as Weather[];

/** The fog at the hero may never be thicker than this (0 = clear, 1 = fully fogged). */
export const MAX_FOG_AT_HERO = 0.3;

/**
 * Final fog distances from the camera, for Three's linear fog.
 *
 * @param focus   distance from the camera to the hero (the orthographic camera's standoff)
 * @param radius  the view radius, world units
 * @param maxFar  the fog must be total before the loaded world ends (hides the streaming edge)
 * @param night   0..1; daylight pushes the fog further out
 * @param cave    0..1; underground the fog closes in — but never over the hero
 */
export function fogDistances(focus: number, radius: number, maxFar: number, look: WeatherLook, night: number, cave: number, out: [number, number]): [number, number] {
  const reach = (1 + (1 - clamp01(night)) * 0.45) * (1 - clamp01(cave) * 0.5);
  let near = look.fogNear * radius * reach;
  let far = Math.max(near + 4, look.fogFar * radius * reach);
  far = Math.min(far, Math.max(4, maxFar - focus));
  // never let the hero sink into the fog, whatever the table or the cave says
  const atHero = -near / Math.max(0.001, far - near);
  if (atHero > MAX_FOG_AT_HERO) near = -(MAX_FOG_AT_HERO * far) / (1 - MAX_FOG_AT_HERO);
  if (!(near < far)) near = far - 4;
  out[0] = focus + near;
  out[1] = focus + far;
  return out;
}

/** How fogged (0..1) a point at `depth` from the camera is under linear fog `near..far`. */
export function fogFactor(depth: number, near: number, far: number): number {
  return clamp01((depth - near) / Math.max(0.001, far - near));
}

/**
 * When lightning strikes. Pure: `rand` is passed in. `flash` is the brightness boost this frame
 * (0..1, a double flicker), `strikes` counts strikes so the caller can play thunder once per strike.
 */
export class Lightning {
  flash = 0;
  strikes = 0;
  /** Seconds until the thunder of the last strike is heard (−1 = none pending). */
  thunderIn = -1;
  private wait = 3;
  private t = -1;

  update(dt: number, mean: number, rand: () => number): void {
    const d = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;
    if (this.thunderIn >= 0) this.thunderIn -= d;
    if (this.t >= 0) {
      this.t += d;
      // two quick flashes, then fade: 0-0.06 on, 0.06-0.12 dim, 0.12-0.45 second flash fading
      this.flash = this.t < 0.06 ? 1 : this.t < 0.12 ? 0.25 : Math.max(0, 0.8 * (1 - (this.t - 0.12) / 0.33));
      if (this.t > 0.45) {
        this.t = -1;
        this.flash = 0;
      }
    }
    if (!(mean > 0)) return;
    this.wait -= d;
    if (this.wait <= 0) {
      this.strike(rand);
      this.wait = mean * (0.4 + rand() * 1.2);
    }
  }

  /** Strike now (the developer menu's button, or the timer). */
  strike(rand: () => number): void {
    this.t = 0;
    this.flash = 1;
    this.strikes++;
    // near or far: the thunder comes 0.2 - 1.6 s later
    this.thunderIn = 0.2 + rand() * 1.4;
  }

  /** Call after update: returns true exactly once when the pending thunder's time has come. */
  takeThunder(): boolean {
    if (this.thunderIn === -1 || this.thunderIn > 0) return false;
    this.thunderIn = -1;
    return true;
  }
}

/**
 * How wet the ground is (0..1): puddles fill over ~25 s of rain and dry over ~60 s after.
 * Returns the new wetness.
 */
export function wetnessStep(wet: number, rain: number, dt: number): number {
  const w = Number.isFinite(wet) ? wet : 0;
  const d = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const next = rain > 0.01 ? w + (d / 25) * (0.4 + rain) : w - d / 60;
  return clamp01(next);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
