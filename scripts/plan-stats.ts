/** Prints how much geometry the 3D plan produces per area. Run: npx tsx scripts/plan-stats.ts */
import { WORLD_TILES_H, WORLD_TILES_W } from '../src/config';
import { CAVE_X0, FOREST_X0 } from '../src/core/world/areas';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { groupShapes, planArea } from '../src/render3d/worldPlan';

const world = new GeneratedWorld();
const areas: [string, { x0: number; y0: number; x1: number; y1: number }][] = [
  ['Desa Lentera', { x0: 0, y0: 0, x1: FOREST_X0, y1: WORLD_TILES_H }],
  ['Hutan Bisik', { x0: FOREST_X0, y0: 0, x1: CAVE_X0, y1: WORLD_TILES_H }],
  ['Gua Kelam', { x0: CAVE_X0, y0: 0, x1: WORLD_TILES_W, y1: WORLD_TILES_H }],
  ['seluruh dunia', { x0: 0, y0: 0, x1: WORLD_TILES_W, y1: WORLD_TILES_H }],
];

for (const [name, rect] of areas) {
  const p = planArea(world, rect);
  const g = groupShapes(p.shapes);
  const groundMB = (p.chunks.length * 256 * 256 * 4) / 1e6;
  console.log(
    `${name.padEnd(14)} chunk=${String(p.chunks.length).padStart(3)}  instance=${String(p.shapes.length).padStart(6)}  ` +
      `grup=${String(g.length).padStart(2)}  lampu=${String(p.lights.length).padStart(4)}  tekstur tanah=${groundMB.toFixed(1)} MB`,
  );
}
