/**
 * Original 5x7 proportional pixel font (glyphs hand-authored as ASCII art). Each glyph is baked with a 1px ink outline
 * so text stays readable on any background. Baseline is row 6; descenders use rows 7-8.
 */
import { P } from './palette';
import { Pixmap } from './pixmap';
import { SheetBuilder, type Sheet } from './sheet';

const GLYPH_ROWS = 9;
const PAD = 1;
export const FONT_CELL_H = GLYPH_ROWS + PAD * 2;
export const FONT_LINE_H = FONT_CELL_H + 1;
export const SPACE_W = 3;

/** Rows separated by "/". `#` = ink. Missing rows are padded with blanks. */
const G: Record<string, string> = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '###/.#./.#./.#./.#./.#./###',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '//.###./....#/.####/#...#/.####',
  b: '#..../#..../####./#...#/#...#/#...#/####.',
  c: '//.###./#..../#..../#...#/.###.',
  d: '....#/....#/.####/#...#/#...#/#...#/.####',
  e: '//.###./#...#/#####/#..../.###.',
  f: '..##/.#../###./.#../.#../.#../.#..',
  g: '//.####/#...#/#...#/#...#/.####/....#/.###.',
  h: '#..../#..../####./#...#/#...#/#...#/#...#',
  i: '.#./.../##./.#./.#./.#./###',
  j: '..#./..../.##./..#./..#./..#./..#./#.#./.#..',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.',
  l: '##./.#./.#./.#./.#./.#./.##',
  m: '//##.#./#.#.#/#.#.#/#.#.#/#.#.#',
  n: '//####./#...#/#...#/#...#/#...#',
  o: '//.###./#...#/#...#/#...#/.###.',
  p: '//####./#...#/#...#/#...#/####./#..../#....',
  q: '//.####/#...#/#...#/#...#/.####/....#/....#',
  r: '..../..../#.##/##../#.../#.../#...',
  s: '//.####/#..../.###./....#/####.',
  t: '..../.#../###./.#../.#../.#.#/..#.',
  u: '//#...#/#...#/#...#/#..##/.##.#',
  v: '//#...#/#...#/#...#/.#.#./..#..',
  w: '//#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '//#...#/.#.#./..#../.#.#./#...#',
  y: '//#...#/#...#/#...#/.####/....#/.###.',
  z: '//#####/...#./..#../.#.../#####',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '..#../.##../..#../..#../..#../..#../.###.',
  '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '####./....#/....#/.###./....#/....#/####.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '.###./#..../#..../####./#...#/#...#/.###.',
  '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/....#/.###.',
  '.': '../../../../../##/##',
  ',': '../../../../##/.#/#.',
  ':': '../##/##/../##/##',
  ';': '../##/##/../##/.#/#.',
  '!': '#/#/#/#/#/././#',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  "'": '#/#/.',
  '"': '#.#/#.#',
  '-': '.../.../.../###',
  '+': '.../.../.#./###/.#.',
  '=': '..../..../####/..../####',
  '/': '..#/..#/.#./.#./.#./#../#..',
  '(': '.#/#./#./#./#./#./.#',
  ')': '#./.#/.#/.#/.#/.#/#.',
  '[': '##/#./#./#./#./#./##',
  ']': '##/.#/.#/.#/.#/.#/##',
  '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##',
  '*': '...../#.#.#/.###./#.#.#',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
  _: '///////#####',
  '<': '..#/.#./#../.#./..#',
  '>': '#../.#./..#/.#./#..',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.',
  '#': '.#.#./#####/.#.#./#####/.#.#.',
  '|': '#/#/#/#/#/#/#',
  '~': '...../.#..#/#.##./.....',
};

export interface GlyphMetrics {
  /** Pixel width of the glyph body (without outline padding). */
  w: number;
}

export function glyphRows(ch: string): string[] | null {
  const spec = G[ch];
  if (spec === undefined) return null;
  const raw = spec.split('/');
  const w = Math.max(...raw.map((r) => r.length));
  const rows = raw.map((r) => (r === '' ? '.'.repeat(w) : r));
  while (rows.length < GLYPH_ROWS) rows.push('.'.repeat(w));
  return rows;
}

export const FONT_CHARS = Object.keys(G).concat([' ']);

/** Advance width in px (1x) for a character. */
export function charAdvance(ch: string): number {
  if (ch === ' ') return SPACE_W;
  const rows = glyphRows(ch) ?? glyphRows('?')!;
  return rows[0].length + PAD * 2;
}

/** Width of a string at 1x in px. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charAdvance(ch);
  return w;
}

/** Greedy word wrap using real glyph metrics. Returns lines. */
export function wrapText(s: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate) <= maxWidth || !line) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Bake one glyph (white fill + ink outline) into a pixmap of size (w+2, 11). */
function bakeGlyph(rows: string[]): Pixmap {
  const w = rows[0].length;
  const pm = new Pixmap(w + PAD * 2, FONT_CELL_H);
  const body = new Pixmap(w + PAD * 2, FONT_CELL_H);
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < w; x++) if (rows[y][x] === '#') body.set(x + PAD, y + PAD, 0xffffff);
  body.outline(P.ink0, true);
  pm.blit(body, 0, 0);
  return pm;
}

export const FONT_SHEET_KEY = 'font';

export function buildFontSheet(): Sheet {
  const sb = new SheetBuilder(FONT_SHEET_KEY, 256, 0);
  for (const ch of Object.keys(G)) sb.add(`g${ch.charCodeAt(0)}`, bakeGlyph(glyphRows(ch)!));
  return sb.build();
}
