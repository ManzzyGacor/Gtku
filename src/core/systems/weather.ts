/**
 * Weather, as a look.
 *
 * There is no weather *system* in the game yet — nothing changes it on its own; that belongs to
 * the world events planned for Batch 7 ("badai elemen"). What exists is the developer menu's switch,
 * and this table of what each state does to the scene, so that when the system arrives it drives
 * the same numbers the switch does.
 */
export type Weather = 'cerah' | 'berkabut' | 'hujan' | 'badai';

export interface WeatherLook {
  label: string;
  /** Multiplies the fog distances: below 1 pulls the fog in. */
  fogScale: number;
  /** Added to the colour grade's lift, to darken and cool the shadows. */
  tint: [number, number, number];
  /** Rain particles per second of screen, 0 for none. */
  rain: number;
  /** Ambience bed to use instead of the area's own, or null to leave it. */
  ambient: string | null;
}

export const WEATHER: Record<Weather, WeatherLook> = {
  cerah: { label: 'Cerah', fogScale: 1, tint: [0, 0, 0], rain: 0, ambient: null },
  berkabut: { label: 'Berkabut', fogScale: 0.45, tint: [0.02, 0.02, 0.03], rain: 0, ambient: null },
  hujan: { label: 'Hujan', fogScale: 0.7, tint: [0.0, 0.01, 0.04], rain: 0.6, ambient: 'storm-far' },
  badai: { label: 'Badai', fogScale: 0.5, tint: [0.0, 0.015, 0.06], rain: 1, ambient: 'storm' },
};

export const WEATHER_IDS = Object.keys(WEATHER) as Weather[];
