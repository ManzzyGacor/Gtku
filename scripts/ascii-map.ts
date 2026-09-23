/**
 * Prints the world as ASCII, one character per N tiles. The only way to sanity-check the layout
 * without a GPU: paths, water, cave tunnels and the arena all have to read correctly here first.
 * Run: npx tsx scripts/ascii-map.ts [step]
 */
import { WORLD_TILES_H, WORLD_TILES_W } from '../src/config';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { T } from '../src/core/world/tiles';

const CH: Record<number, string> = {
  [T.GRASS]: '.', [T.FLOWERS]: ',', [T.FOREST]: '#', [T.DIRT]: '-', [T.COBBLE]: '=',
  [T.SAND]: ':', [T.WATER]: '~', [T.SHALLOW]: 'w', [T.CAVE]: ' ', [T.WALL]: 'X',
  [T.BRIDGE_H]: 'B', [T.BRIDGE_V]: 'B', [T.ARENA]: 'A',
};

const step = Number(process.argv[2] ?? 3);
const world = new GeneratedWorld();
const m = world.markers;

/** Most interesting tile in the sample block, so thin features (paths, bridges) survive. */
const PRIORITY: number[] = [T.BRIDGE_H, T.ARENA, T.COBBLE, T.DIRT, T.WATER, T.SHALLOW, T.SAND, T.CAVE, T.FLOWERS, T.GRASS, T.FOREST, T.WALL];

const marks = new Map<string, string>();
function put(x: number, y: number, ch: string): void {
  marks.set(`${Math.floor(x / step)},${Math.floor(y / step)}`, ch);
}
put(m.playerStart.x / 16, m.playerStart.y / 16, '@');
put(m.lantern.x / 16, m.lantern.y / 16, 'L');
for (const cp of m.checkpoints) put(cp.x / 16, cp.y / 16, 'S');
put(m.puzzle.rock.tx, m.puzzle.rock.ty, 'R');
put(m.puzzle.plate.tx, m.puzzle.plate.ty, 'P');
put(m.puzzle.gate.tx, m.puzzle.gate.ty, 'G');
put(m.boss.door.tx, m.boss.door.ty, 'D');
put(m.boss.spawn.x / 16, m.boss.spawn.y / 16, '!');
for (let cy = 0; cy < WORLD_TILES_H / 16; cy++)
  for (let cx = 0; cx < WORLD_TILES_W / 16; cx++) {
    for (const n of world.chunk(cx, cy).npcs) put(n.x / 16, n.y / 16, 'N');
    for (const s of world.chunk(cx, cy).spawns) if (s.kind !== 'boss') put(s.x / 16, s.y / 16, 'e');
  }

const lines: string[] = [];
for (let y = 0; y < WORLD_TILES_H; y += step) {
  let line = '';
  for (let x = 0; x < WORLD_TILES_W; x += step) {
    const mark = marks.get(`${Math.floor(x / step)},${Math.floor(y / step)}`);
    if (mark) {
      line += mark;
      continue;
    }
    let best = -1;
    for (let dy = 0; dy < step; dy++)
      for (let dx = 0; dx < step; dx++) {
        const t = world.tileAt(x + dx, y + dy);
        const rank = PRIORITY.indexOf(t);
        if (best < 0 || rank < PRIORITY.indexOf(best)) best = t;
      }
    line += CH[best] ?? '?';
  }
  lines.push(line);
}
console.log(`${WORLD_TILES_W}x${WORLD_TILES_H} tiles, ${step} tiles per character`);
console.log(lines.join('\n'));
console.log('@ start  L lantern  S shrine/checkpoint  R rock  P plate  G gate  D boss door  ! boss  N npc  e enemy');
console.log('= plaza  - path  B bridge  ~ water  w shallow  : sand  . grass  , flowers  # forest  X wall  (blank) cave  A arena');
