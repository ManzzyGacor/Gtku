/**
 * A WebGL2 context that exists but does nothing.
 *
 * Three.js only needs a *real* GL context to actually draw; building a `WebGLRenderer`, a scene, a
 * render target and every material in the game is pure JavaScript. This stub is enough to get the
 * renderer constructed, which is enough to construct `Game3D` — and that is the one part of the
 * codebase that had no test at all, because it needs a canvas.
 *
 * It is deliberately not a WebGL implementation: every unknown call returns an empty object, and
 * every unknown constant gets a unique number. Nothing here can verify rendering. What it verifies
 * is that the game can be *built* — the wiring, the order of construction, the settings, the save.
 */

/** Numbers handed out for `gl.SOME_CONSTANT`, so comparisons between them behave. */
const CONSTANTS: Record<string, number> = {};
let nextConstant = 1;

export function makeGlStub(): unknown {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_t, prop: string) {
      switch (prop) {
        case 'getShaderPrecisionFormat':
          return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
        case 'getContextAttributes':
          return () => ({ alpha: true, antialias: false, depth: true, stencil: false });
        // A null extension means "not supported", which every caller in Three already handles.
        case 'getExtension':
          return (name: string) => (name.includes('lose_context') ? { loseContext() {}, restoreContext() {} } : null);
        case 'getSupportedExtensions':
          return () => [];
        case 'getParameter':
          return (p: number) => {
            if (p === CONSTANTS.VERSION) return 'WebGL 2.0 (stub)';
            if (p === CONSTANTS.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00 (stub)';
            if (p === CONSTANTS.VENDOR || p === CONSTANTS.RENDERER) return 'stub';
            if (p === CONSTANTS.MAX_VIEWPORT_DIMS) return [16384, 16384];
            return 16384;
          };
        case 'getProgramParameter':
        case 'getShaderParameter':
          return () => 1;
        case 'getProgramInfoLog':
        case 'getShaderInfoLog':
          return () => '';
        case 'getError':
          return () => 0;
        case 'getUniformLocation':
          return () => ({});
        case 'getAttribLocation':
          return () => 0;
        case 'isContextLost':
          return () => false;
        default:
          break;
      }
      if (/^[A-Z0-9_]+$/.test(prop)) {
        CONSTANTS[prop] ??= nextConstant++;
        return CONSTANTS[prop];
      }
      return () => ({});
    },
  });
}
