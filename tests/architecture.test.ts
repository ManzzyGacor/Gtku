/**
 * Guards the layering the 3D overhaul depends on (docs/OVERHAUL.md §3, §7):
 *
 *   src/core     game logic — knows about no renderer at all
 *   src/art      pure pixel-art pipeline — no renderer either
 *   src/ui       overlay UI — must survive the renderer swap, so neither engine
 *   src/render3d Three.js only (the only renderer; the 2D one was removed once every feature
 *                had moved across — see docs/PROGRESS.md and the tag `v0.2-2d-final`)
 *
 * Break any of those and this test names the line that did it.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/** Bare package names imported by a folder's files, with the offending line. */
function packageImports(dir: string): { file: string; line: number; pkg: string; spec: string }[] {
  const out: { file: string; line: number; pkg: string; spec: string }[] = [];
  for (const file of walk(join(ROOT, dir))) {
    for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) continue;
      out.push({ file: relative(ROOT, file), line, pkg: spec.split('/')[0], spec });
    }
  }
  return out;
}

/** Relative imports of a folder's files, resolved to repo-relative paths. */
function localTargets(dir: string): { file: string; line: number; target: string; spec: string }[] {
  const out: { file: string; line: number; target: string; spec: string }[] = [];
  for (const file of walk(join(ROOT, dir))) {
    const from = posix.dirname(relative(ROOT, file).split('\\').join('/'));
    for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      out.push({ file: relative(ROOT, file), line, target: posix.normalize(posix.join(from, spec)), spec });
    }
  }
  return out;
}

test('src/core has files and none of them import a renderer', () => {
  assert.ok(FILES.length >= 20, `expected the moved logic, found ${FILES.length} files`);
  const banned = new Set(['phaser', 'three']);
  const bad: string[] = [];
  for (const file of FILES) {
    for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
      const pkg = spec.startsWith('.') ? '' : spec.split('/')[0];
      if (banned.has(pkg)) bad.push(`${relative(ROOT, file)}:${line} imports "${spec}"`);
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
  const rel = new Set(FILES.map((f) => relative(ROOT, f).split('\\').join('/')));
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
    assert.ok(rel.has(expected), `${expected} is missing`);
  }
});

test('src/art stays a pure pixel pipeline: no renderer, no UI', () => {
  const bad = packageImports('src/art')
    .filter((i) => i.pkg === 'phaser' || i.pkg === 'three')
    .map((i) => `${i.file}:${i.line} imports "${i.spec}"`);
  assert.deepEqual(bad, [], `src/art must not import a renderer:\n${bad.join('\n')}`);
  const reaching = localTargets('src/art')
    .filter((i) => !i.target.startsWith('src/art/') && !i.target.startsWith('src/core/') && i.target !== 'src/config')
    .map((i) => `${i.file}:${i.line} → ${i.target}`);
  assert.deepEqual(reaching, [], `src/art may only use src/art, src/core and src/config:\n${reaching.join('\n')}`);
});

test('src/ui survives the renderer swap: it imports neither Phaser nor Three', () => {
  const bad = packageImports('src/ui')
    .filter((i) => i.pkg === 'phaser' || i.pkg === 'three')
    .map((i) => `${i.file}:${i.line} imports "${i.spec}"`);
  assert.deepEqual(bad, [], `the overlay UI must stay renderer-agnostic:\n${bad.join('\n')}`);
  const reaching = localTargets('src/ui')
    .filter((i) => i.target.startsWith('src/render2d/') || i.target.startsWith('src/render3d/'))
    .map((i) => `${i.file}:${i.line} → ${i.target}`);
  assert.deepEqual(reaching, [], `src/ui must not reach into a renderer:\n${reaching.join('\n')}`);
});

test('the renderer is the only place Three.js appears, and nothing imports Phaser any more', () => {
  const three = packageImports('src/render3d').filter((i) => i.pkg === 'three');
  assert.ok(three.length > 0, 'src/render3d is the Three.js build');

  // Phaser is gone: not a dependency, not an import, not a folder.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.phaser, undefined, 'phaser must not be a dependency');
  assert.equal(pkg.devDependencies?.phaser, undefined);
  assert.equal(existsSync(join(ROOT, 'src/render2d')), false, 'src/render2d is gone');

  const stray: string[] = [];
  for (const dir of ['src', 'tests', 'scripts']) {
    for (const file of walk(join(ROOT, dir))) {
      for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
        if (spec === 'phaser' || spec.startsWith('phaser/')) stray.push(`${relative(ROOT, file)}:${line}`);
      }
    }
  }
  assert.deepEqual(stray, [], `nothing may import phaser:\n${stray.join('\n')}`);
});

test('the world plan is renderer-free so the 3D layout can be tested in Node', () => {
  const pkgs = packageImports('src/render3d').filter((i) => i.file.endsWith('worldPlan.ts'));
  assert.deepEqual(pkgs.map((i) => i.spec), [], 'worldPlan.ts must not import three');
});
