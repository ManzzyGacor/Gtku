/** Why is the rock not moving? Prints the rock lane and what blocks it. */
import { TILE } from '../src/config';
import { GeneratedWorld } from '../src/core/world/worldgen';
import { Collision } from '../src/core/world/collision';
import { T } from '../src/core/world/tiles';

const world = new GeneratedWorld();
const col = new Collision(world);
const p = world.markers.puzzle;
console.log('rock', p.rock, 'plate', p.plate);
let line = '';
for (let tx = p.rock.tx - 1; tx <= p.plate.tx + 2; tx++) {
  const t = world.tileAt(tx, p.rock.ty);
  line += col.solidTile(tx, p.rock.ty) ? 'X' : t === T.CAVE ? '.' : t === T.ARENA ? 'A' : '?';
}
console.log(`row y=${p.rock.ty} (x ${p.rock.tx - 1}..${p.plate.tx + 2}):`, line);
let col2 = '';
for (let ty = p.rock.ty - 1; ty <= p.plate.ty + 2; ty++) {
  const t = world.tileAt(p.plate.tx, ty);
  col2 += col.solidTile(p.plate.tx, ty) ? 'X' : t === T.CAVE ? '.' : '?';
}
console.log(`col x=${p.plate.tx} (y ${p.rock.ty - 1}..${p.plate.ty + 2}):`, col2);
console.log('hero start for east push:', p.rock.tx * TILE + 8 - 15, p.rock.ty * TILE + 8 + 4);
