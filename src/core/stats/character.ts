/**
 * The character sheet: the one object that turns *level + equipment + buffs* into the numbers the
 * game actually uses, and the only thing combat needs to know about progression.
 *
 * It exists so that `Game3D` never has to remember to recompute anything: change the level or swap
 * a helmet, call `refresh()`, and the hero's max HP, walking speed, lantern range and every damage
 * calculation follow. The sheet is also the single place that knows about the Lantern Core's
 * passive, so a passive is a named rule in one file rather than a special case sprinkled around.
 */
import type { ElementId } from '../combat/elements';
import { Inventory } from '../items/inventory';
import { passiveMeta, type PassiveId } from '../items/items';
import { gainExp, levelMods, MAX_LEVEL, expForNext, type LevelUp, type Progress } from '../progression';
import { HERO_BASE, resolveStats, type Modifier, type StatBlock } from './stats';

export interface SourceLine {
  label: string;
  mods: Modifier[];
}

export class Character {
  readonly inventory: Inventory;
  level = 1;
  exp = 0;
  /** Temporary modifiers from buffs/debuffs; cleared when they expire. */
  private buffs: { mods: Modifier[]; label: string; until: number }[] = [];
  private cached: StatBlock = { ...HERO_BASE };
  private cachedMods: Modifier[] = [];
  private clock = 0;

  constructor(inventory = new Inventory()) {
    this.inventory = inventory;
    this.refresh();
  }

  get stats(): StatBlock {
    return this.cached;
  }

  /** Every modifier currently in effect, including element-specific ones. */
  get mods(): readonly Modifier[] {
    return this.cachedMods;
  }

  get progress(): Progress {
    return { level: this.level, exp: this.exp };
  }

  /** EXP still needed for the next level, or 0 at the cap. */
  get expNeeded(): number {
    return this.level >= MAX_LEVEL ? 0 : expForNext(this.level);
  }

  /** The element the equipped Lantern Core empowers, if any. */
  get coreElement(): ElementId | undefined {
    return this.inventory.lanternCore()?.def.element;
  }

  get passive(): PassiveId | undefined {
    return this.inventory.lanternCore()?.def.passive;
  }

  get passiveLabel(): string | null {
    const id = this.passive;
    return id ? (passiveMeta(id)?.label ?? null) : null;
  }

  /** Recompute the sheet. Cheap, but not free — call it on a change, not every frame. */
  refresh(): void {
    const mods: Modifier[] = [...levelMods(this.level), ...this.inventory.equippedMods()];
    for (const b of this.buffs) mods.push(...b.mods);
    this.cachedMods = mods;
    this.cached = resolveStats(HERO_BASE, mods);
  }

  /** Where each number came from, for the character screen. */
  sources(): SourceLine[] {
    const out: SourceLine[] = [{ label: `Level ${this.level}`, mods: levelMods(this.level) }];
    for (const line of this.inventory.equippedMods()) {
      const label = line.source ?? 'Perlengkapan';
      const found = out.find((o) => o.label === label);
      if (found) found.mods.push(line);
      else out.push({ label, mods: [line] });
    }
    for (const b of this.buffs) out.push({ label: b.label, mods: b.mods });
    return out;
  }

  /** Award EXP. Returns the levels gained so the HUD can celebrate them. */
  addExp(amount: number): LevelUp[] {
    const { progress, levels } = gainExp(this.progress, amount);
    this.level = progress.level;
    this.exp = progress.exp;
    if (levels.length) this.refresh();
    return levels;
  }

  /** A timed buff or debuff. `seconds` of 0 means "until removed by label". */
  addBuff(label: string, mods: Modifier[], seconds: number): void {
    this.buffs = this.buffs.filter((b) => b.label !== label);
    this.buffs.push({ label, mods, until: seconds > 0 ? this.clock + seconds : Infinity });
    this.refresh();
  }

  removeBuff(label: string): void {
    const before = this.buffs.length;
    this.buffs = this.buffs.filter((b) => b.label !== label);
    if (this.buffs.length !== before) this.refresh();
  }

  /** Advance the buff clock. Only refreshes on the frame something actually expires. */
  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.clock += dt;
    if (!this.buffs.some((b) => b.until <= this.clock)) return;
    this.buffs = this.buffs.filter((b) => b.until > this.clock);
    this.refresh();
  }

  // ── Lantern Core passives, each read at the one moment it matters ──

  /** `emberGuard`: less damage taken while badly hurt. Returns the multiplier to apply. */
  incomingMultiplier(hp: number, maxHp: number): number {
    return this.passive === 'emberGuard' && hp <= maxHp / 2 ? 0.88 : 1;
  }

  /** `tideMend`: HP back per kill. */
  healPerKill(): number {
    return this.passive === 'tideMend' ? 1 : 0;
  }

  /** `stormEdge`: extra crit chance on the heavy finisher, in percentage points. */
  heavyCritBonus(): number {
    return this.passive === 'stormEdge' ? 20 : 0;
  }

  /** `frostWard`: seconds of slow applied to whoever hits us. */
  retaliationSlow(): number {
    return this.passive === 'frostWard' ? 1.2 : 0;
  }

  toJSON(): { level: number; exp: number; inventory: ReturnType<Inventory['toJSON']> } {
    return { level: this.level, exp: this.exp, inventory: this.inventory.toJSON() };
  }

  load(data: { level?: unknown; exp?: unknown; inventory?: unknown } | null | undefined): void {
    const level = typeof data?.level === 'number' && Number.isFinite(data.level) ? Math.floor(data.level) : 1;
    const exp = typeof data?.exp === 'number' && Number.isFinite(data.exp) ? Math.floor(data.exp) : 0;
    this.level = Math.max(1, Math.min(MAX_LEVEL, level));
    this.exp = Math.max(0, exp);
    this.inventory.load((data?.inventory ?? null) as Parameters<Inventory['load']>[0]);
    this.buffs = [];
    this.refresh();
    // A save written before the level cap dropped, or hand-edited, could hold more EXP than the
    // level needs; fold it in rather than leaving a bar that is permanently past full.
    if (this.expNeeded > 0 && this.exp >= this.expNeeded) this.addExp(0);
  }
}
