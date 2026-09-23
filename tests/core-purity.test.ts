/**
 * Guard for the rule that makes the 3D overhaul possible (docs/OVERHAUL.md §3):
 * `src/core/**` is the game logic and must not know about any renderer. It may import only
 * itself and `src/config`. Break that and this test tells you which line did it.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { test } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const CORE = join(ROOT, 'src/core');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Every `from '…'` / `import('…')` specifier in a file, with its line number. */
function specifiers(src: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  src.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[1], line: i + 1 });
  });
  return out;
}

const FILES = walk(CORE);

test('src/core has files and none of them import a renderer', () => {
  assert.ok(FILES.length >= 20, `expected the moved logic, found ${FILES.length} files`);
  const banned = ['phaser', 'three'];
  const bad: string[] = [];
  for (const file of FILES) {
    for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
      const pkg = spec.startsWith('.') ? '' : spec.split('/')[0];
      if (banned.includes(pkg)) bad.push(`${relative(ROOT, file)}:${line} imports "${spec}"`);
    }
  }
  assert.deepEqual(bad, [], `src/core must stay renderer-free:\n${bad.join('\n')}`);
});

test('src/core only reaches into src/core and src/config', () => {
  const bad: string[] = [];
  for (const file of FILES) {
    const dir = posix.dirname(relative(ROOT, file).split('\\').join('/'));
    for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue; // bare packages are covered by the test above
      const target = posix.normalize(posix.join(dir, spec));
      const ok = target.startsWith('src/core/') || target === 'src/config';
      if (!ok) bad.push(`${relative(ROOT, file)}:${line} reaches outside: "${spec}" → ${target}`);
    }
  }
  assert.deepEqual(bad, [], `src/core must not depend on art or rendering:\n${bad.join('\n')}`);
});

test('the logic that Fase 0 was supposed to move actually lives in src/core now', () => {
  const rel = FILES.map((f) => relative(ROOT, f).split('\\').join('/'));
  for (const expected of [
    'src/core/world/worldgen.ts',
    'src/core/world/collision.ts',
    'src/core/world/source.ts',
    'src/core/entities/HeroCore.ts',
    'src/core/entities/enemies.ts',
    'src/core/systems/quest.ts',
    'src/core/systems/puzzleLogic.ts',
    'src/core/systems/daynight.ts',
    'src/core/state/GameState.ts',
  ]) {
    assert.ok(rel.includes(expected), `${expected} is missing`);
  }
});
