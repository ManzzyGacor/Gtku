/**
 * The cutscene library — **data only**.
 *
 * Adding a scene means adding an entry here. The engine (`cutscene.ts`) runs whatever is in this
 * file and the renderer (`render3d/Cutscene3D.ts`) knows how to carry out each kind of step, so
 * nothing below needs engine changes, and none of it needs a GPU to be tested.
 *
 * The script is written against `docs/STORY.md`. Note the `{nama}` placeholders: the story calls
 * the hero Arka, but the player names their own character, so every line the player reads is
 * written with the placeholder and filled in at play time.
 */
import { NAME_FALLBACK, settings } from '../settings';
import type { CutsceneDef } from './cutscene';

/** The hero's name as the player set it, with a fallback so a line never prints a gap. */
export function playerName(): string {
  const raw = settings.get('playerName').trim();
  return raw || NAME_FALLBACK;
}

const TILE = 16;
/** Scripts are written in tiles because that is how the world reads on the map. */
const t = (tile: number): number => tile * TILE + TILE / 2;

/*
 * Where the opening is staged.
 *
 * `HOME` is the house on the western edge of the village — the family home in the script. `PLAZA`
 * is the square with the Great Lantern, which the camera looks down on for the establishing shot.
 * Both are real places in the generated world, so the scene is played in the world the player is
 * about to walk into rather than on a set built for it.
 */
const HOME = { x: t(17), y: t(57) };
const PLAZA = { x: t(34), y: t(65) };
const ROAD = { x: t(24), y: t(60) };

/**
 * "Malam Terakhir" — the prologue (docs/STORY.md).
 *
 * Roughly 100 seconds unskipped. The parents are only ever *heard*; that is not a shortcut, it is
 * the scene: the boy runs outside and there is nobody there.
 *
 * Two authoring notes worth knowing if you write the next one:
 *  • `hold: 0` starts a step and moves on, so the long camera drifts run underneath the dialogue;
 *  • a `say` with `dur` advances on its own, which is what lets the whole thing play hands-free
 *    while a tap still hurries it along.
 */
const INTRO: CutsceneDef = {
  id: 'intro',
  title: 'Malam Terakhir',
  letterbox: true,
  endMusic: 'night',
  steps: [
    // ── 1. black, rain, a date ──
    { t: 'fade', to: 1, dur: 0, color: 0x05040a },
    { t: 'light', night: 1 },
    { t: 'camera', x: PLAZA.x, y: PLAZA.y, pitch: 52, zoom: 0.72, dur: 0 },
    { t: 'ambient', id: 'storm' },
    { t: 'music', id: 'intro', fade: 3 },
    { t: 'wait', dur: 1.6 },
    { t: 'caption', text: 'Tujuh tahun yang lalu.', dur: 3.4 },
    { t: 'fade', to: 0.35, dur: 2.6, hold: 2.6 },

    // ── 2. the village from above, in a storm ──
    { t: 'sfx', id: 'thunder' },
    { t: 'shake', amount: 2.5, dur: 0.6 },
    { t: 'camera', x: ROAD.x, y: ROAD.y, pitch: 46, zoom: 0.8, dur: 9, ease: 'inOut', hold: 0 },
    { t: 'fade', to: 0, dur: 2.5, hold: 1.4 },
    { t: 'caption', text: 'Ravenhollow.', dur: 3, hold: 2.6 },
    { t: 'say', text: 'Malam itu hujan tidak berhenti.', dur: 1.8 },
    { t: 'say', text: 'Langit seperti menumpahkan seluruh isinya ke desa kecil itu.', dur: 1.6 },

    // ── 3. down to the family home ──
    { t: 'camera', x: HOME.x, y: HOME.y, pitch: 34, zoom: 1.35, dur: 8, ease: 'inOut', hold: 0 },
    { t: 'actor', id: 'hero', x: HOME.x, y: HOME.y + 26, anim: 'idle', dur: 0 },
    { t: 'wait', dur: 2 },
    { t: 'sfx', id: 'glass' },
    { t: 'shake', amount: 1.4, dur: 0.3 },
    { t: 'say', who: '{nama}', text: '...Ayah?', dur: 2.2 },
    { t: 'wait', dur: 1.2 },
    { t: 'say', text: 'Tidak ada jawaban. Hanya suara hujan.', dur: 1.8 },

    // ── 4. the lantern that should have been lit ──
    { t: 'camera', x: HOME.x, y: HOME.y + 8, pitch: 30, zoom: 1.7, dur: 5, ease: 'out', hold: 0 },
    { t: 'say', text: 'Setiap malam, Ayah selalu menyalakan lentera tua di ruang tengah.', dur: 1.8 },
    { t: 'fx', kind: 'dust', x: HOME.x, y: HOME.y + 10 },
    { t: 'say', text: 'Malam itu lenteranya padam.', dur: 2.4 },

    // ── 5. the open door, and the thing beside it ──
    { t: 'sfx', id: 'door' },
    { t: 'actor', id: 'hero', x: HOME.x + 8, y: HOME.y + 34, dur: 3, hold: 0 },
    { t: 'say', text: 'Pintu depan terbuka. Angin malam masuk membawa udara dingin.', dur: 1.9 },
    { t: 'say', text: 'Di lantai ada pecahan gelas.', dur: 1.7 },
    { t: 'say', text: 'Dan di dekat pintu, sebuah lentera kecil berwarna hitam dengan ukiran yang tidak ia kenal.', dur: 2 },
    { t: 'fx', kind: 'lantern-warm', x: HOME.x + 10, y: HOME.y + 36, color: 0x6a5f7a },
    { t: 'say', who: '{nama}', text: 'Hangat...', dur: 2 },
    { t: 'say', text: 'Padahal tidak ada api di dalamnya.', dur: 2.2 },

    // ── 6. a voice from outside ──
    { t: 'ambient', id: 'storm-far' },
    { t: 'sfx', id: 'heartbeat' },
    { t: 'say', who: 'Ibu', text: '{nama}...', dur: 2.6 },
    { t: 'camera', x: ROAD.x, y: ROAD.y + 10, pitch: 40, zoom: 1, dur: 4, ease: 'out', hold: 0 },
    { t: 'actor', id: 'hero', x: ROAD.x - 20, y: ROAD.y + 18, dur: 3.4, hold: 3.4 },
    { t: 'say', who: '{nama}', text: 'Ibu?!', dur: 1.6 },
    { t: 'say', text: 'Tidak ada siapa-siapa. Hanya jalan desa yang kosong.', dur: 2.4 },

    // ── 7. further away, and then his father ──
    { t: 'say', who: 'Ibu', text: '{nama}... jangan cari kami...', dur: 2.8 },
    { t: 'camera', pitch: 30, zoom: 1.5, dur: 6, ease: 'inOut', hold: 0 },
    { t: 'say', who: 'Ayah', text: 'Kalau lentera itu menyala...', dur: 2.6 },
    { t: 'wait', dur: 1.6 },
    { t: 'say', who: 'Ayah', text: '...berarti mereka sudah menemukanmu.', dur: 3 },

    // ── 8. the lantern lights itself ──
    { t: 'sfx', id: 'lantern' },
    { t: 'fx', kind: 'lantern-blue', big: true },
    { t: 'light', night: 1, tint: [0.02, 0.05, 0.14], dur: 1.2 },
    { t: 'shake', amount: 3, dur: 0.8 },
    { t: 'say', text: 'Untuk pertama kalinya, lentera itu menyala sendiri.', dur: 2.2 },
    { t: 'say', text: 'Apinya bukan kuning. Melainkan biru pucat.', dur: 2.6 },
    { t: 'fx', kind: 'lantern-blue', big: true },

    // ── 9. every light in the village goes out ──
    { t: 'sfx', id: 'thunder' },
    { t: 'fade', to: 1, dur: 2.2, color: 0x03030a, hold: 2.4 },
    { t: 'say', text: 'Dan pada saat yang sama, seluruh lampu di desa padam.', dur: 2.6 },
    { t: 'sfx', id: 'heartbeat' },
    { t: 'wait', dur: 1.8 },

    // ── 10. seven years later: hand the world back ──
    { t: 'caption', text: 'Tujuh tahun kemudian.', dur: 4, hold: 4 },
    { t: 'flag', set: 'intro_done' },
    { t: 'music', id: 'night', fade: 4 },
    { t: 'ambient', id: 'night' },
    { t: 'light', night: 0.82, dur: 3 },
    { t: 'camera', pitch: 38, zoom: 1, dur: 2, hold: 0 },
    { t: 'fade', to: 0, dur: 3, hold: 1 },
  ],
};

/** Every scene the game knows. Keyed by id; `playCutscene(id)` is the only way in. */
export const CUTSCENES: Record<string, CutsceneDef> = {
  intro: INTRO,
};

/** The ones offered in Settings → replay, in the order they happen in the story. */
export const REPLAYABLE: string[] = ['intro'];
