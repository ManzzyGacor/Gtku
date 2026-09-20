/**
 * Export every generated sheet to .preview/<key>.png (+ .json frame map) so art can be inspected/edited outside the game.
 * Also writes upscaled `<key>@Nx.png` previews. Usage: npm run assets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildAllSheets } from '../src/art/index';
import { encodePng, upscale } from './png';

const out = new URL('../.preview/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

for (const sheet of buildAllSheets()) {
  writeFileSync(`${out}${sheet.key}.png`, encodePng(sheet.pixmap));
  writeFileSync(
    `${out}${sheet.key}.json`,
    JSON.stringify({ key: sheet.key, w: sheet.pixmap.w, h: sheet.pixmap.h, frames: sheet.frames }, null, 1),
  );
  const z = sheet.pixmap.w > 300 ? 3 : 4;
  writeFileSync(`${out}${sheet.key}@${z}x.png`, encodePng(upscale(sheet.pixmap, z, 0x24203a)));
  console.log(`${sheet.key}: ${sheet.pixmap.w}x${sheet.pixmap.h}, ${Object.keys(sheet.frames).length} frames`);
}
