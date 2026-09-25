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

/** The `lm-*` class names a stylesheet gives rules to (the classes in its selectors). */
function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\$\{[^}]*\}/g, '0');
  const re = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    for (const c of sel.matchAll(/\.(lm-[\w-]+)/g)) out.add(c[1]);
  }
  return out;
}

test('no two stylesheets style the same class name', () => {
  /*
   * Every overlay injects its own global stylesheet, so a class name is global too. The settings
   * menu called its header row `lm-title` — the title screen's full-screen, fixed, gradient-painted
   * root. On the phone the settings header grew to cover the whole viewport: "PENGATURAN" in the
   * middle, and not one setting visible underneath it. Nothing type-checks class names.
   */
  const owner = new Map<string, string>();
  const clash: string[] = [];
  for (const file of [...files('src/ui'), ...files('src/render3d')]) {
    const src = readFileSync(file, 'utf8');
    const sheets = templates(src).filter((t) => t.body.includes('{') && /\.lm-/.test(t.body));
    // boot3d's small inline sheet is passed straight to injectStyle
    for (const m of src.matchAll(/injectStyle\(\s*'[\w-]+',\s*`([\s\S]*?)`/g)) sheets.push({ name: 'inline', body: m[1] });
    for (const t of sheets) {
      const where = `${file} ${t.name}`;
      for (const c of selectorClasses(t.body)) {
        const prev = owner.get(c);
        if (prev && !prev.startsWith(`${file} `)) clash.push(`.${c}: ${prev} and ${where}`);
        else owner.set(c, where);
      }
    }
  }
  assert.ok(owner.has('lm-title') && owner.size > 50, `parser found ${owner.size} classes`);
  assert.deepEqual(clash, [], `one class name, two stylesheets — the later one silently restyles the other's element:\n${clash.join('\n')}`);
});
