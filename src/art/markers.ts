/**
 * The quest markers that float above an NPC's head: `!` when they have something for you and `?`
 * when they are waiting on you. Drawn with the pixel font so they match every other glyph in the
 * game, then outlined so they stay readable against grass, stone or night.
 */
import { glyphRows } from './font';
import { P } from './palette';
import { Pixmap } from './pixmap';

export type MarkerId = 'quest' | 'turnin';

const CHAR: Record<MarkerId, { ch: string; color: number }> = {
  quest: { ch: '!', color: P.y4 },
  turnin: { ch: '?', color: P.k3 },
};

/** A glyph blown up to `scale`, on a rounded dark badge with a coloured rim. */
function marker(ch: string, color: number, scale = 3): Pixmap {
  const rows = glyphRows(ch) ?? glyphRows('!')!;
  const gw = rows[0].length;
  const gh = rows.length;
  const pad = 4;
  const w = gw * scale + pad * 2;
  const h = gh * scale + pad * 2;
  const pm = new Pixmap(w, h);

  // badge: a soft dark disc so the glyph never fights the scenery behind it
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rx = w / 2;
  const ry = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1) continue;
      pm.set(x, y, d > 0.72 ? color : P.ink0, d > 0.72 ? 235 : 205);
    }

  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      if (rows[gy][gx] !== '#') continue;
      pm.rect(pad + gx * scale, pad + gy * scale, scale, scale, color);
    }
  return pm;
}

export function buildMarkerTextures(): Record<MarkerId, Pixmap> {
  return {
    quest: marker(CHAR.quest.ch, CHAR.quest.color),
    turnin: marker(CHAR.turnin.ch, CHAR.turnin.color),
  };
}
