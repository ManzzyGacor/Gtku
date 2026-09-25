/**
 * How much JavaScript a frame of the real game costs, stage by stage — measured in Node, with the
 * real Game3D (the GL stub builds everything; only the final draw is skipped, since there is no
 * GPU here). Run: npx tsx --expose-gc scripts/frame-bench.ts
 *
 * Node on this VPS is several times faster than a phone's JavaScript, so the absolute numbers are
 * a floor; what matters is *which* stage is heavy and whether frames allocate.
 */
import { bootGame, installGameEnv } from '../tests/helpers/game';
import { STAGES } from '../src/core/perf';
import { input } from '../src/core/input';

const env = installGameEnv();
(globalThis as Record<string, unknown>).performance ??= { now: () => Date.now() };
const game = await bootGame(env, { continue: false });
game.pixels.render = () => undefined;
game.setTimeOfDay(19 / 24); // the report's conditions: the village at 19:00

const FRAMES = Number(process.argv[2] ?? 1200);
const dt = 1 / 60;
const gc = (globalThis as { gc?: () => void }).gc;
// walk around the plaza: stick in a slow circle
let t = 0;
const frameMs: number[] = [];
gc?.();
const heap0 = process.memoryUsage().heapUsed;
for (let i = 0; i < FRAMES; i++) {
  t += dt;
  input.stick.x = Math.cos(t * 0.5);
  input.stick.y = Math.sin(t * 0.5);
  const a = performance.now();
  game.step(dt);
  frameMs.push(performance.now() - a);
}
const heap1 = process.memoryUsage().heapUsed;
frameMs.sort((x, y) => x - y);
const mean = frameMs.reduce((s, x) => s + x, 0) / frameMs.length;
console.log(`frames ${FRAMES}  JS per frame: mean ${mean.toFixed(2)} ms  p50 ${frameMs[FRAMES >> 1].toFixed(2)}  p95 ${frameMs[Math.floor(FRAMES * 0.95)].toFixed(2)}  max ${frameMs[FRAMES - 1].toFixed(1)}`);
console.log(`stages (smoothed ms): ${STAGES.map((s, i) => `${s} ${game.stages.ms[i].toFixed(2)} (peak ${game.stages.peak[i].toFixed(1)})`).join(', ')}`);
console.log(`heap growth over the run: ${((heap1 - heap0) / 1024 / FRAMES).toFixed(1)} KB per frame (without gc in between)`);
console.log(`chunks: ${JSON.stringify(game.scene3d.stats())}`);
game.dispose();
process.exit(0);
