import { buildHeroSheet, buildNpcSheet } from './characters';
import { buildEnemySheet } from './enemies';
import { buildFontSheet } from './font';
import { buildFxSheet } from './fx';
import { buildPropSheet } from './props';
import type { Sheet } from './sheet';
import { buildTileSheet } from './tiles';
import { buildUiSheet } from './ui';

/** Build every generated sheet (pure; no DOM). Order is irrelevant. */
export function buildAllSheets(): Sheet[] {
  return [buildTileSheet(), buildPropSheet(), buildHeroSheet(), buildNpcSheet(), buildUiSheet(), buildEnemySheet(), buildFxSheet(), buildFontSheet()];
}
