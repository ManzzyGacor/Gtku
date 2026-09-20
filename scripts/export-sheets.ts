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

// close-up of the first frames of a sheet for detailed inspection: npm run assets -- hero
const focus = process.argv[2];
if (focus) {
  const sheet = buildAllSheets().find((s) => s.key === focus);
  if (sheet) writeFileSync(`${out}${focus}-closeup.png`, encodePng(upscale(sheet.pixmap.sub(0, 0, Math.min(sheet.pixmap.w, 256), Math.min(sheet.pixmap.h, 70)), 6, 0x24203a)));
}
