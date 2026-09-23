/**
 * The "Salin laporan" report.
 *
 * Claude cannot see the game running, so this text *is* the bug report: device, renderer, FPS,
 * active preset, every setting and the last errors. `buildReport` is pure so its shape is testable;
 * `copyText` does the clipboard dance with fallbacks, because a phone browser may refuse
 * `navigator.clipboard` outside a secure context or a user gesture.
 */
import { GAME_VERSION } from '../config';
import type { LoggedError } from './errors';
import type { DeviceInfo } from './graphics';
import type { PresetId, Settings } from './settings';

export interface ReportInput {
  device: DeviceInfo;
  /** 'phaser2d' or 'three3d'. */
  renderer: string;
  preset: PresetId;
  presetAuto: boolean;
  fpsAvg: number;
  fpsLow: number;
  /** Live display objects, so a leak shows up as a number that only ever grows. */
  objects: number;
  settings: Readonly<Settings>;
  errors: readonly LoggedError[];
  /** Logical size of the pixel buffer. */
  view: { w: number; h: number };
  url: string;
}

const n1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '?');

export function buildReport(i: ReportInput): string {
  const d = i.device;
  const s = i.settings;
  const lines = [
    `Lentera Malam — laporan tes v${GAME_VERSION}`,
    `waktu: ${new Date().toISOString()}`,
    '',
    '[PERANGKAT]',
    `layar: ${d.screenW}x${d.screenH} px (dpr ${n1(d.dpr)})`,
    `buffer: ${i.view.w}x${i.view.h} px logis`,
    `core: ${d.cores || '?'}   memori: ${d.memoryGB ? `${d.memoryGB} GB` : '?'}`,
    `webgl2: ${d.webgl2 ? 'ya' : 'TIDAK'}   sentuh: ${d.touch ? 'ya' : 'tidak'}`,
    `ua: ${d.ua}`,
    '',
    '[PERFORMA]',
    `renderer: ${i.renderer}`,
    `fps rata-rata: ${n1(i.fpsAvg)}   terendah: ${n1(i.fpsLow)}`,
    `objek aktif: ${i.objects}`,
    `preset: ${i.preset}${i.presetAuto ? ' (AUTO)' : ' (dipilih manual)'}`,
    '',
    '[SETELAN]',
    `bloom: ${s.bloom ? 'on' : 'off'}   fps counter: ${s.fpsCounter ? 'on' : 'off'}`,
    `joystick: ukuran ${n1(s.stickScale)}x, posisi ${Math.round(s.stickX * 100)}%/${Math.round(s.stickY * 100)}%`,
    `tombol: ${n1(s.buttonScale)}x   teks: ${s.textScale}x`,
    `kamera: sudut ${s.camPitch}\u00b0, zoom ${s.camZoom.toFixed(2)}x`,
    `volume musik/sfx: ${n1(s.musicVol)}/${n1(s.sfxVol)}`,
    `cutscene sudah ditonton: ${s.cutsceneSeen ? 'ya' : 'belum'}`,
    '',
    '[URL]',
    i.url,
    '',
    `[ERROR TERAKHIR] (${i.errors.length})`,
    ...(i.errors.length ? i.errors.map((e) => `[${(e.at / 1000).toFixed(1)}s] ${e.where ? `${e.where}: ` : ''}${e.msg}`) : ['(tidak ada)']),
  ];
  return lines.join('\n');
}

/**
 * Copy `text` to the clipboard. Tries the async Clipboard API, then the old textarea +
 * `execCommand` trick which still works in Android WebView. Returns false if both fail —
 * the caller then shows the text so it can be selected by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    if (clip?.writeText) {
      await clip.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
