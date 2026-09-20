import { buildFontSheet } from './font';
import { buildPropSheet } from './props';
import type { Sheet } from './sheet';
import { buildTileSheet } from './tiles';

/** Build every generated sheet (pure; no DOM). Order is irrelevant. */
export function buildAllSheets(): Sheet[] {
  return [buildTileSheet(), buildPropSheet(), buildFontSheet()];
}
