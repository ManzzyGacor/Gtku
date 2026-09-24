/**
 * Crop and magnify part of a reference image so it can be studied closely.
 * Run: npx tsx scripts/crop-reference.ts <in.png> <x> <y> <w> <h> [zoom] [out.png]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng, upscale } from './png';

const [, , file, xs, ys, ws, hs, zs, out] = process.argv;
if (!file) {
  console.error('usage: crop-reference.ts <in.png> <x> <y> <w> <h> [zoom] [out.png]');
  process.exit(1);
}
const src = decodePng(readFileSync(file));
const x = Number(xs ?? 0);
const y = Number(ys ?? 0);
const w = Math.min(Number(ws ?? src.w), src.w - x);
const h = Math.min(Number(hs ?? src.h), src.h - y);
const zoom = Number(zs ?? 1);
const dest = out ?? '.preview/crop.png';
mkdirSync(dest.replace(/\/[^/]+$/, '') || '.', { recursive: true });
const crop = src.sub(x, y, w, h);
writeFileSync(dest, encodePng(zoom > 1 ? upscale(crop, zoom) : crop));
console.log(`${file} ${src.w}x${src.h} → ${dest} (${w}x${h} @${zoom}x from ${x},${y})`);
