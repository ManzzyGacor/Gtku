/**
 * Export the 3D textures to .preview/textures.png so they can actually be looked at.
 * Run: npx tsx scripts/preview-textures.ts [zoom]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildGreyboxTextures, SIZE } from '../src/art/greybox';
import { Pixmap } from '../src/art/pixmap';
import { encodePng, upscale } from './png';

const zoom = Number(process.argv[2] ?? 4);
const tex = buildGreyboxTextures();
const names = Object.keys(tex);
const cols = 4;
const rows = Math.ceil(names.length / cols);
// two tiles across and down per cell, so tiling seams are visible
const cell = SIZE * 2 + 2;
const sheet = new Pixmap(cols * cell, rows * cell);
names.forEach((name, i) => {
  const pm = tex[name as keyof typeof tex];
  const cx = (i % cols) * cell;
  const cy = Math.floor(i / cols) * cell;
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) sheet.blit(pm, cx + tx * SIZE, cy + ty * SIZE);
});
mkdirSync('.preview', { recursive: true });
writeFileSync('.preview/textures.png', encodePng(upscale(sheet, zoom)));
console.log(`${names.length} tekstur ${SIZE}x${SIZE} (2x2 tile per sel) → .preview/textures.png @${zoom}x`);
console.log(names.join('  '));
