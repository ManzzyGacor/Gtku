/**
 * Build the real `Game3D` in Node: a fake DOM for the overlay UI, a WebGL stub so Three.js can
 * *construct* a renderer, and an in-memory localStorage.
 *
 * Shared by every test that needs the whole game wired together (boot, tutorial, developer menu).
 * It cannot draw a frame — shader compilation needs a real GPU — and never pretends to; what it
 * proves is that the game can be built and that its wiring does what it says.
 */
import { installDom, type FakeDocument } from '../mocks/dom-mock';
import { makeGlStub } from '../mocks/gl-mock';

export interface GameHarness {
  doc: FakeDocument;
  store: Map<string, string>;
}

export function installGameEnv(search = ''): GameHarness {
  const doc = installDom();
  const store = new Map<string, string>();
  Object.assign(globalThis as Record<string, unknown>, {
    window: {
      innerWidth: 800,
      innerHeight: 380,
      devicePixelRatio: 2,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      location: { search },
    },
    location: { search, reload: () => undefined },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    screen: { orientation: {} },
  });
  const create = doc.createElement;
  doc.createElement = (tag: string) => {
    const node = create(tag);
    if (tag === 'canvas') {
      const raw = node as unknown as Record<string, unknown>;
      const original = raw.getContext as (t: string) => unknown;
      raw.getContext = (type: string) => (type.startsWith('webgl') ? makeGlStub() : original(type));
    }
    return node;
  };
  return { doc, store };
}

export function removeGameEnv(): void {
  for (const key of ['window', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'screen', 'document'])
    delete (globalThis as Record<string, unknown>)[key];
}

export type Game = InstanceType<Awaited<typeof import('../../src/render3d/Game3D')>['Game3D']>;

export async function bootGame(env: GameHarness, options: { continue: boolean }): Promise<Game> {
  const { Game3D } = await import('../../src/render3d/Game3D');
  return new Game3D(env.doc.body as unknown as HTMLElement, options);
}
