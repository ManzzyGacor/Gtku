/** HUD / touch-control art: round buttons, joystick, icons. */
import { P } from './palette';
import { Pixmap, type Color } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

export const UI_SHEET_KEY = 'ui';

function disc(size: number, fill: Color, fillA: number, rim: Color, rimA: number, rimW = 2): Pixmap {
  const pm = new Pixmap(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d > c) continue;
      if (d > c - rimW) pm.set(x, y, rim, rimA);
      else pm.set(x, y, fill, fillA);
    }
  return pm;
}

function icon(draw: (pm: Pixmap) => void, size = 16): Pixmap {
  const pm = new Pixmap(size, size);
  draw(pm);
  pm.outline(P.ink0);
  return pm;
}

const sword = (pm: Pixmap): void => {
  pm.line(3, 12, 12, 3, P.s5);
  pm.line(4, 12, 12, 4, P.s6);
  pm.line(2, 13, 4, 11, P.o4);
  pm.line(4, 8, 8, 12, P.y3);
  pm.line(5, 8, 8, 11, P.y4);
  pm.set(13, 2, P.white);
};

const roll = (pm: Pixmap): void => {
  for (let a = 30; a < 330; a += 8) {
    const r = (a * Math.PI) / 180;
    pm.set(Math.round(8 + Math.cos(r) * 5), Math.round(8 + Math.sin(r) * 5), P.cream);
    pm.set(Math.round(8 + Math.cos(r) * 4.5), Math.round(8 + Math.sin(r) * 4.5), P.cream);
  }
  pm.tri(11, 1, 14, 6, 8, 5, P.cream);
};

const burst = (pm: Pixmap): void => {
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const len = i % 2 ? 4 : 7;
    pm.line(8, 8, Math.round(8 + Math.cos(a) * len), Math.round(8 + Math.sin(a) * len), i % 2 ? P.y3 : P.y4);
  }
  pm.ellipse(8, 8, 2.6, 2.6, P.y5);
};

const talk = (pm: Pixmap): void => {
  pm.rect(2, 2, 12, 8, P.cream);
  pm.set(2, 2, 0, 0);
  pm.set(13, 2, 0, 0);
  pm.tri(4, 10, 8, 10, 4, 14, P.cream);
  for (const x of [5, 8, 11]) pm.set(x, 6, P.ink2);
};

const heart = (pm: Pixmap, full: boolean): void => {
  const c1 = full ? P.r3 : P.ink3;
  const c2 = full ? P.r4 : P.ink3;
  pm.ellipse(4.5, 4, 3, 2.6, c1);
  pm.ellipse(10.5, 4, 3, 2.6, c1);
  pm.tri(1.5, 5.5, 13.5, 5.5, 7.5, 12, c1);
  if (full) {
    pm.set(3, 3, c2);
    pm.set(4, 2, c2);
  }
};

const fullscreen = (pm: Pixmap): void => {
  for (const [x, y, dx, dy] of [[2, 2, 1, 1], [13, 2, -1, 1], [2, 13, 1, -1], [13, 13, -1, -1]] as const) {
    pm.hline(dx > 0 ? x : x - 3, y, 4, P.cream);
    pm.vline(x, dy > 0 ? y : y - 3, 4, P.cream);
  }
};

const pause = (pm: Pixmap): void => {
  pm.rect(4, 3, 3, 10, P.cream);
  pm.rect(9, 3, 3, 10, P.cream);
};

export function buildUiSheet(): Sheet {
  const sb = new SheetBuilder(UI_SHEET_KEY, 256, 1);
  sb.add('joy_base', disc(56, P.ink1, 90, P.cream, 130, 2));
  sb.add('joy_knob', disc(26, P.cream, 200, P.white, 230, 2));
  for (const s of [48, 36, 30, 26]) {
    sb.add(`btn_${s}`, disc(s, P.ink1, 150, P.cream, 200, 2));
    sb.add(`btn_${s}_down`, disc(s, P.y3, 170, P.white, 240, 2));
  }
  sb.add('ic_sword', icon(sword));
  sb.add('ic_roll', icon(roll));
  sb.add('ic_burst', icon(burst));
  sb.add('ic_talk', icon(talk));
  sb.add('ic_fullscreen', icon(fullscreen));
  sb.add('ic_pause', icon(pause));
  sb.add('heart_full', icon((pm) => heart(pm, true)));
  sb.add('heart_empty', icon((pm) => heart(pm, false)));
  // 1px white pixel and small glow for tinting
  sb.add('px', new Pixmap(1, 1).set(0, 0, 0xffffff));
  return sb.build();
}
