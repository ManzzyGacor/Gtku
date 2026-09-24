/**
 * Every number that decides how combat *feels*, in one place and adjustable at runtime.
 *
 * The developer plays on a phone and cannot read the code while playing, so "does this swing feel
 * stiff?" has to be answerable by dragging a value and trying again. These descriptors drive the
 * "Setelan Combat" panel; the values they point at are the same objects `HeroCore` reads every
 * frame, so a change takes effect on the next swing.
 */
import { readRaw, writeRaw } from '../storage';
import { ATTACKS, HERO_STATS } from './HeroCore';

const KEY = 'lentera-malam/combat/v1';

export interface Tunable {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Seconds, pixels, degrees… shown after the number. */
  unit: string;
  get(): number;
  set(v: number): void;
}

const t = (id: string, label: string, unit: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): Tunable => ({
  id,
  label,
  unit,
  min,
  max,
  step,
  get,
  set,
});

/** One group of tunables per swing, plus the shared feel numbers. */
function attackTunables(i: number, name: string): Tunable[] {
  const a = (): (typeof ATTACKS)[number] => ATTACKS[i];
  return [
    t(`a${i}.windup`, `${name}: ancang-ancang`, 's', 0.02, 0.4, 0.01, () => a().windup, (v) => (a().windup = v)),
    t(`a${i}.active`, `${name}: tebasan`, 's', 0.03, 0.3, 0.01, () => a().active, (v) => (a().active = v)),
    t(`a${i}.recover`, `${name}: pemulihan`, 's', 0.04, 0.6, 0.01, () => a().recover, (v) => (a().recover = v)),
    t(`a${i}.lunge`, `${name}: langkah maju`, 'px/s', 0, 400, 10, () => a().lunge, (v) => (a().lunge = v)),
    t(`a${i}.dmg`, `${name}: damage`, '', 1, 30, 1, () => a().dmg, (v) => (a().dmg = v)),
    t(`a${i}.range`, `${name}: jangkauan`, 'px', 12, 90, 2, () => a().range, (v) => (a().range = v)),
    t(`a${i}.knock`, `${name}: knockback`, 'px/s', 0, 400, 10, () => a().knock, (v) => (a().knock = v)),
  ];
}

export const COMBAT_TUNABLES: Tunable[] = [
  t('comboWindow', 'Jendela combo', 's', 0.05, 0.8, 0.01, () => HERO_STATS.comboWindow, (v) => (HERO_STATS.comboWindow = v)),
  t('holdTime', 'Tahan → serangan berat', 's', 0.1, 0.8, 0.02, () => HERO_STATS.holdTime, (v) => (HERO_STATS.holdTime = v)),
  t('turnRate', 'Putar saat ancang-ancang', '°/s', 0, 900, 30, () => HERO_STATS.attackTurnRate, (v) => (HERO_STATS.attackTurnRate = v)),
  t('steer', 'Gerak saat ancang-ancang', '%', 0, 60, 5, () => HERO_STATS.attackSteer * 100, (v) => (HERO_STATS.attackSteer = v / 100)),
  t('hitStop', 'Hit-stop', 'ms', 0, 200, 5, () => HERO_STATS.hitStopMs, (v) => (HERO_STATS.hitStopMs = v)),
  t('shake', 'Getaran kamera', 'px', 0, 12, 0.5, () => HERO_STATS.hitShake, (v) => (HERO_STATS.hitShake = v)),
  t('aimCone', 'Kerucut bidik otomatis', '°', 0, 120, 5, () => HERO_STATS.aimCone, (v) => (HERO_STATS.aimCone = v)),
  t('aimRange', 'Jarak bidik otomatis', 'px', 20, 140, 5, () => HERO_STATS.aimRange, (v) => (HERO_STATS.aimRange = v)),
  t('rollTime', 'Durasi guling', 's', 0.15, 0.7, 0.02, () => HERO_STATS.rollTime, (v) => (HERO_STATS.rollTime = v)),
  t('rollSpeed', 'Kecepatan guling', 'px/s', 80, 320, 10, () => HERO_STATS.rollSpeed, (v) => (HERO_STATS.rollSpeed = v)),
  t('rollCd', 'Jeda guling', 's', 0, 1.2, 0.05, () => HERO_STATS.rollCooldown, (v) => (HERO_STATS.rollCooldown = v)),
  ...attackTunables(0, 'Tebas 1'),
  ...attackTunables(1, 'Tebas 2'),
  ...attackTunables(2, 'Tebas 3'),
  ...attackTunables(3, 'Berat'),
];

/** Snapshot of the shipped values, so "reset" always has somewhere to go back to. */
const DEFAULTS: Record<string, number> = {};
for (const item of COMBAT_TUNABLES) DEFAULTS[item.id] = item.get();

export function resetCombatTuning(): void {
  for (const item of COMBAT_TUNABLES) item.set(DEFAULTS[item.id]);
  saveCombatTuning();
}

export function saveCombatTuning(): void {
  const out: Record<string, number> = {};
  for (const item of COMBAT_TUNABLES) if (item.get() !== DEFAULTS[item.id]) out[item.id] = item.get();
  writeRaw(KEY, JSON.stringify(out));
}

/** Apply any values the player tuned on a previous run. Silently ignores anything unrecognised. */
export function loadCombatTuning(): void {
  try {
    const raw = readRaw(KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    for (const item of COMBAT_TUNABLES) {
      const v = data[item.id];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      item.set(Math.max(item.min, Math.min(item.max, v)));
    }
  } catch {
    /* corrupt tuning file: keep the shipped values */
  }
}

export function isTuned(): boolean {
  return COMBAT_TUNABLES.some((item) => item.get() !== DEFAULTS[item.id]);
}
