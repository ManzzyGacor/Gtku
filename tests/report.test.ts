/** Error history + the "Salin laporan" report text. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { clearErrors, formatErrors, onErrorLogged, recentErrors, recordError } from '../src/core/errors';
import { buildReport, type ReportInput } from '../src/core/report';
import { DEFAULTS } from '../src/core/settings';
import { GAME_VERSION } from '../src/config';

test('the error log keeps the last few entries and collapses a repeating one', () => {
  clearErrors();
  let notified = 0;
  onErrorLogged(() => notified++);
  recordError('boom', 'GameScene');
  recordError('boom', 'GameScene');
  recordError('boom', 'GameScene');
  assert.equal(recentErrors().length, 1, 'the same error in a row is recorded once');
  recordError('lain', 'UIScene');
  assert.equal(recentErrors().length, 2);
  assert.equal(notified, 2);

  for (let i = 0; i < 30; i++) recordError(`err ${i}`);
  assert.equal(recentErrors().length, 12, 'ring buffer caps the history');
  assert.equal(recentErrors()[11].msg, 'err 29', 'newest last');

  const lines = formatErrors();
  assert.equal(lines.length, 12);
  assert.match(lines[0], /^\[\d+\.\ds\] /);
  onErrorLogged(null);
  clearErrors();
  assert.equal(recentErrors().length, 0);
});

test('a very long error message is truncated instead of filling the report', () => {
  clearErrors();
  recordError('x'.repeat(5000), 'here');
  assert.equal(recentErrors()[0].msg.length, 300);
  clearErrors();
});

const INPUT: ReportInput = {
  device: { cores: 8, memoryGB: 4, screenW: 2340, screenH: 1080, dpr: 2.75, webgl2: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14)' },
  renderer: 'phaser2d',
  preset: 'medium',
  presetAuto: true,
  fpsAvg: 52.44,
  fpsLow: 39.1,
  objects: 214,
  settings: { ...DEFAULTS },
  errors: [{ at: 12345, msg: 'bloom tidak tersedia', where: 'GameScene.setupPost' }],
  view: { w: 480, h: 270 },
  url: 'https://game.varesa.mom/?fps=1',
};

test('the report carries everything a bug report needs', () => {
  const r = buildReport(INPUT);
  for (const needle of [
    `v${GAME_VERSION}`,
    '2340x1080',
    'dpr 2.8',
    '480x270 px logis',
    'core: 8',
    'memori: 4 GB',
    'webgl2: ya',
    'Android 14',
    'renderer: phaser2d',
    'fps rata-rata: 52.4',
    'terendah: 39.1',
    'objek aktif: 214',
    'preset: medium (AUTO)',
    'kamera: sudut 38\u00b0, zoom 1.00x',
    '?fps=1',
    'GameScene.setupPost: bloom tidak tersedia',
  ]) {
    assert.ok(r.includes(needle), `report is missing "${needle}":\n${r}`);
  }
});

test('the report is honest about a device without WebGL2, no errors and a pinned preset', () => {
  const r = buildReport({ ...INPUT, device: { ...INPUT.device, webgl2: false, cores: 0, memoryGB: 0 }, presetAuto: false, errors: [] });
  assert.ok(r.includes('webgl2: TIDAK'));
  assert.ok(r.includes('core: ?'));
  assert.ok(r.includes('memori: ?'));
  assert.ok(r.includes('(dipilih manual)'));
  assert.ok(r.includes('[ERROR TERAKHIR] (0)'));
  assert.ok(r.includes('(tidak ada)'));
});
