// Node module-resolution hook: redirect the `phaser` import to our lightweight mock (used by the smoke test only).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'phaser') {
    return { url: new URL('./phaser-mock.ts', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
