/**
 * The cutscene timeline.
 *
 * A cutscene is authored data, so the engine has to be forgiving of what the author wrote and
 * exact about when things happen. Both halves are checked here without a renderer: the hooks are
 * recorded, and the "view" the overlay would draw is plain data.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CutscenePlayer, cutsceneLength, interpolate, type CutsceneDef, type CutsceneHooks } from '../src/core/story/cutscene';

interface Log {
  camera: string[];
  fade: string[];
  light: string[];
  actor: string[];
  sfx: string[];
  music: string[];
  ambient: string[];
  fx: string[];
  shake: string[];
  flags: string[];
}

function harness(def: CutsceneDef, opts: { textSpeed?: number; vars?: Record<string, string> } = {}): { player: CutscenePlayer; log: Log } {
  const log: Log = { camera: [], fade: [], light: [], actor: [], sfx: [], music: [], ambient: [], fx: [], shake: [], flags: [] };
  const hooks: CutsceneHooks = {
    camera: (s) => log.camera.push(`${s.x ?? '-'},${s.y ?? '-'} p${s.pitch ?? '-'} z${s.zoom ?? '-'} d${s.dur}`),
    fade: (to, dur) => log.fade.push(`${to}@${dur}`),
    light: (s) => log.light.push(`n${s.night ?? '-'} d${s.dur}`),
    actor: (s) => log.actor.push(`${s.id}:${s.anim ?? '-'}@${s.x ?? '-'},${s.y ?? '-'}`),
    sfx: (id) => log.sfx.push(id),
    music: (id, fade) => log.music.push(`${id}@${fade}`),
    ambient: (id) => log.ambient.push(id),
    fx: (s) => log.fx.push(s.kind),
    shake: (a) => log.shake.push(String(a)),
    flag: (f) => log.flags.push(f),
  };
  return {
    player: new CutscenePlayer(def, hooks, { textSpeed: () => opts.textSpeed ?? 1000, vars: opts.vars }),
    log,
  };
}

/** Run the player for `seconds` at 60 fps. */
function run(player: CutscenePlayer, seconds: number): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) player.update(step);
}

test('steps run in order, and each one holds the timeline for its own duration', () => {
  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'sfx', id: 'a' },
      { t: 'wait', dur: 1 },
      { t: 'sfx', id: 'b' },
      { t: 'wait', dur: 1 },
      { t: 'sfx', id: 'c' },
    ],
  };
  const h = harness(def);
  h.player.update(0);
  assert.deepEqual(h.log.sfx, ['a'], 'the first step runs immediately');
  run(h.player, 0.5);
  assert.deepEqual(h.log.sfx, ['a'], 'and the wait is respected');
  run(h.player, 0.6);
  assert.deepEqual(h.log.sfx, ['a', 'b']);
  run(h.player, 1.1);
  assert.deepEqual(h.log.sfx, ['a', 'b', 'c']);
  assert.equal(h.player.done, true, 'the timeline ends after its last step');
});

test('`hold: 0` starts a step and carries on, which is how a pan runs under dialogue', () => {
  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'camera', x: 10, y: 20, dur: 4, hold: 0 },
      { t: 'sfx', id: 'during' },
    ],
  };
  const h = harness(def);
  h.player.update(1 / 60);
  assert.equal(h.log.camera.length, 1, 'the four second pan started');
  assert.deepEqual(h.log.sfx, ['during'], 'and the next step did not wait for it');
});

test('a line with `dur` advances by itself; one without waits for a tap', () => {
  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'say', who: 'Ibu', text: 'Arka...', dur: 0.5 },
      { t: 'say', text: 'Menunggu ketukan.' },
      { t: 'sfx', id: 'after' },
    ],
  };
  const h = harness(def, { textSpeed: 1000 });
  h.player.update(1 / 60);
  assert.equal(h.player.view.who, 'Ibu');
  assert.equal(h.player.view.text, 'Arka...', 'a fast text speed reveals it at once');
  assert.equal(h.player.view.waiting, false, 'it has a dwell, so it is not waiting for input');

  run(h.player, 0.7);
  assert.equal(h.player.view.text, 'Menunggu ketukan.', 'and it moved on by itself');
  assert.equal(h.player.view.waiting, true, 'this one waits');
  run(h.player, 5);
  assert.deepEqual(h.log.sfx, [], 'no amount of time advances a line that wants a tap');

  h.player.advance();
  h.player.update(1 / 60);
  assert.deepEqual(h.log.sfx, ['after']);
});

test('text reveals at the configured speed, and a tap hurries it rather than skipping it', () => {
  const def: CutsceneDef = { id: 'x', title: 'x', steps: [{ t: 'say', text: '0123456789' }] };
  const h = harness(def, { textSpeed: 10 });
  run(h.player, 0.5);
  assert.equal(h.player.view.text, '01234', 'ten characters a second, half a second in');
  assert.equal(h.player.view.complete, false);

  h.player.advance();
  assert.equal(h.player.view.text, '0123456789', 'the first tap completes the line');
  assert.equal(h.player.view.complete, true);
  assert.equal(h.player.done, false, 'and does not skip past it');

  h.player.advance();
  h.player.update(1 / 60);
  assert.equal(h.player.done, true, 'the second tap moves on');
});

test('the text speed is read live, so the Settings slider applies mid-cutscene', () => {
  let speed = 10;
  const def: CutsceneDef = { id: 'x', title: 'x', steps: [{ t: 'say', text: '0123456789012345678901234567890123456789' }] };
  const player = new CutscenePlayer(def, stubHooks(), { textSpeed: () => speed });
  run(player, 0.5);
  const slow = player.view.text.length;
  speed = 80;
  run(player, 0.5);
  assert.ok(player.view.text.length - slow > slow, 'raising the slider must speed up the line in progress');
});

test('`{nama}` is substituted, and an unknown placeholder is left visible rather than blanked', () => {
  assert.equal(interpolate('Halo {nama}!', { nama: 'Varesa' }), 'Halo Varesa!');
  assert.equal(interpolate('Halo {nama}!', {}), 'Halo {nama}!', 'a blank would look like a bug to the player');
  assert.equal(interpolate('Halo {nama}!', undefined), 'Halo {nama}!');

  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'caption', text: 'Rumah {nama}', dur: 1 },
      { t: 'say', who: 'Ayah', text: '{nama}, dengarkan aku.', dur: 1 },
    ],
  };
  const h = harness(def, { vars: { nama: 'Bara' } });
  h.player.update(1 / 60);
  assert.equal(h.player.view.caption, 'Rumah Bara');
  run(h.player, 1.1);
  assert.equal(h.player.view.text, 'Bara, dengarkan aku.');
});

test('fade interpolates over its duration and remembers its colour', () => {
  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'fade', to: 1, dur: 1, color: 0x112233, hold: 1.5 },
      { t: 'fade', to: 0, dur: 1 },
    ],
  };
  const h = harness(def);
  h.player.update(0);
  assert.equal(h.player.view.fadeColor, 0x112233);
  run(h.player, 0.5);
  const mid = h.player.view.fade;
  assert.ok(mid > 0.3 && mid < 0.8, `halfway through, got ${mid}`);
  run(h.player, 0.6);
  assert.ok(h.player.view.fade > 0.9, `fully faded before the next step, got ${h.player.view.fade}`);
  run(h.player, 1.6);
  assert.ok(h.player.view.fade < 0.1, `and back out again, got ${h.player.view.fade}`);
  assert.equal(h.player.view.fadeColor, 0x112233, 'a fade without a colour keeps the last one');
});

test('skipping leaves the world where the cutscene would have left it', () => {
  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'camera', x: 1, y: 1, dur: 2 },
      { t: 'say', text: 'panjang sekali', dur: 3 },
      { t: 'light', night: 0.9, dur: 2 },
      { t: 'actor', id: 'hero', x: 50, y: 60, anim: 'walk', dur: 2 },
      { t: 'camera', x: 99, y: 88, pitch: 30, zoom: 1.4, dur: 2 },
      { t: 'flag', set: 'intro_done' },
      { t: 'music', id: 'village' },
      { t: 'sfx', id: 'thunder' },
      { t: 'fade', to: 0, dur: 1 },
    ],
  };
  const h = harness(def);
  h.player.update(1 / 60);
  h.player.skip();

  assert.equal(h.player.done, true);
  assert.equal(h.player.wasSkipped, true);
  assert.deepEqual(h.log.flags, ['intro_done'], 'flags still get set — the story moved on');
  assert.equal(h.log.camera.at(-1), '99,88 p30 z1.4 d0', 'the camera ends where it should, instantly');
  assert.equal(h.log.light.at(-1), 'n0.9 d0');
  assert.equal(h.log.actor.at(-1), 'hero:walk@50,60', 'and the actors are posed');
  assert.deepEqual(h.log.music, ['village@0'], 'the music it hands over still starts');
  assert.deepEqual(h.log.sfx, [], 'but a skipped scene makes no noise');
  assert.equal(h.player.view.fade, 0, 'and the screen is not left black');
  assert.equal(h.player.view.who, null);
});

test('skipping twice, or updating afterwards, does nothing', () => {
  const def: CutsceneDef = { id: 'x', title: 'x', steps: [{ t: 'flag', set: 'a' }, { t: 'flag', set: 'b' }] };
  const h = harness(def);
  h.player.skip();
  h.player.skip();
  h.player.update(1);
  h.player.advance();
  assert.deepEqual(h.log.flags, ['a', 'b']);
});

test('a malformed cutscene cannot hang the game', () => {
  // five hundred zero-length steps in a row: the guard has to end it rather than spin
  const steps = Array.from({ length: 2000 }, () => ({ t: 'sfx' as const, id: 'tick' }));
  const h = harness({ id: 'x', title: 'x', steps });
  h.player.update(1 / 60);
  assert.equal(h.player.done, true, 'it bails out instead of looping forever');
  assert.ok(h.log.sfx.length <= 501);
});

test('an empty cutscene finishes immediately instead of blocking the game', () => {
  const h = harness({ id: 'x', title: 'x', steps: [] });
  h.player.update(1 / 60);
  assert.equal(h.player.done, true);
});

test('negative or non-finite dt is ignored', () => {
  const def: CutsceneDef = { id: 'x', title: 'x', steps: [{ t: 'wait', dur: 1 }, { t: 'sfx', id: 'a' }] };
  const h = harness(def);
  h.player.update(NaN);
  h.player.update(-5);
  h.player.update(Infinity);
  assert.deepEqual(h.log.sfx, [], 'a bad frame must not fast-forward the story');
});

test('the estimated length is in the right ballpark, for the replay list', () => {
  const def: CutsceneDef = {
    id: 'x',
    title: 'x',
    steps: [
      { t: 'wait', dur: 2 },
      { t: 'say', text: 'a'.repeat(42), dur: 1 },
      { t: 'fade', to: 1, dur: 1.5 },
    ],
  };
  // 2 + (42/42 + 1) + 1.5 = 5.5 -> 6
  assert.equal(cutsceneLength(def, 42), 6);
});

function stubHooks(): CutsceneHooks {
  return {
    camera: () => undefined,
    fade: () => undefined,
    light: () => undefined,
    actor: () => undefined,
    sfx: () => undefined,
    music: () => undefined,
    ambient: () => undefined,
    fx: () => undefined,
    shake: () => undefined,
    flag: () => undefined,
  };
}
