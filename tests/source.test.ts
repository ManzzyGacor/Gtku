/**
 * Guards on the source itself, for mistakes that type-check and lint cleanly but break at runtime
 * — or, worse, break the *build* in a place that points nowhere near the cause.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'vitest';

const files = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.ts')).map((n) => `${dir}/${n}`);

/** Every `const X = \`...\`;` template literal in a file, with its variable name. */
function templates(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /const (\w+) = `([\s\S]*?)`;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ name: m[1], body: m[2] });
  return out;
}

test('no backticks inside the CSS and GLSL template literals', () => {
  /*
   * This has bitten three times in one day, and each time the error was `TS1005: ',' expected` on a
   * *comment line* inside the block — nowhere near anything that looks wrong. A backtick used for
   * emphasis in a comment inside a template literal closes the literal, and everything after it is
   * parsed as code.
   *
   * Cheaper to assert than to keep rediscovering.
   */
  const bad: string[] = [];
  for (const file of [...files('src/ui'), ...files('src/render3d'), ...files('src/art')]) {
    const src = readFileSync(file, 'utf8');
    for (const t of templates(src)) {
      // only the big embedded-language blocks; a short interpolated string is not the risk here
      if (t.body.length < 120) continue;
      const line = t.body.split('\n').findIndex((l) => l.includes('`'));
      if (line >= 0) bad.push(`${file}: ${t.name} line ${line + 1}: ${t.body.split('\n')[line].trim()}`);
    }
  }
  assert.deepEqual(bad, [], `a backtick inside a template literal closes it:\n${bad.join('\n')}`);
});

test('every injected stylesheet has balanced braces and parentheses', () => {
  const bad: string[] = [];
  for (const file of files('src/ui')) {
    const src = readFileSync(file, 'utf8');
    for (const t of templates(src)) {
      if (!t.body.includes('{')) continue;
      const count = (re: RegExp): number => (t.body.match(re) ?? []).length;
      if (count(/\{/g) !== count(/\}/g)) bad.push(`${file}: ${t.name} braces`);
      if (count(/\(/g) !== count(/\)/g)) bad.push(`${file}: ${t.name} parens`);
    }
  }
  assert.deepEqual(bad, [], 'an unbalanced CSS block silently drops every rule after it');
});
