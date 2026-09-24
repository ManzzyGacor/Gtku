/** Persistent game state (pure data + helpers). Serialised to localStorage by `save.ts`. */

export interface QuestState {
  /** 0 = not started, 1 = talk to elder done / hunting, 2 = boss, 3 = return, 4 = complete */
  stage: number;
  kills: number;
}

/**
 * The save file.
 *
 * `v: 2` adds the character: level, EXP, the bag and the equipped slots (Batch 4). A `v: 1` save
 * has none of those fields and loads as a level 1 hero with an empty bag — see
 * `saveMigrate.ts`, which is also where the position is re-checked against the current world.
 */
export interface SaveData {
  v: 2;
  hero: { x: number; y: number; hp: number };
  checkpoint: string;
  worldTime: number;
  dayTime: number;
  killed: Record<string, number>;
  quest: QuestState;
  flags: Record<string, boolean>;
  puzzle: { solved: boolean };
  bossDefeated: boolean;
  /** Level, EXP, bag and equipment. Absent in a v1 save. */
  character?: CharacterJson | undefined;
}

/** What `Character.toJSON()` produces; typed here so the save shape is in one file. */
export interface CharacterJson {
  level: number;
  exp: number;
  inventory: {
    slots: ({ id: string; count: number; rarity: string } | null)[];
    equipped: Record<string, { id: string; count: number; rarity: string } | undefined>;
  };
}

/** The newest save version this build writes. */
export const SAVE_VERSION = 2;

export const RESPAWN_SECONDS = 300;
export const KILLS_NEEDED = 6;

export class GameState {
  worldTime = 0;
  /** 0..1 fraction of the day (0 = midnight, 0.5 = noon). */
  dayTime = 0.33;
  killed: Record<string, number> = {};
  quest: QuestState = { stage: 0, kills: 0 };
  flags: Record<string, boolean> = {};
  puzzleSolved = false;
  bossDefeated = false;
  checkpoint = 'cp_village';

  /** True while a spawn id is on its respawn timer (or permanently dead for the boss). */
  isDead(id: string): boolean {
    if (id === 'boss') return this.bossDefeated;
    const t = this.killed[id];
    return t !== undefined && this.worldTime - t < RESPAWN_SECONDS;
  }

  markKilled(id: string): void {
    this.killed[id] = this.worldTime;
  }

  toJSON(hero: { x: number; y: number; hp: number }, character?: CharacterJson): SaveData {
    return {
      v: 2,
      hero: { x: Math.round(hero.x), y: Math.round(hero.y), hp: hero.hp },
      checkpoint: this.checkpoint,
      worldTime: this.worldTime,
      dayTime: this.dayTime,
      killed: { ...this.killed },
      quest: { ...this.quest },
      flags: { ...this.flags },
      puzzle: { solved: this.puzzleSolved },
      bossDefeated: this.bossDefeated,
      character,
    };
  }

  load(d: SaveData): void {
    this.worldTime = d.worldTime ?? 0;
    this.dayTime = d.dayTime ?? 0.33;
    this.killed = { ...d.killed };
    this.quest = { ...(d.quest ?? { stage: 0, kills: 0 }) };
    this.flags = { ...d.flags };
    this.puzzleSolved = !!d.puzzle?.solved;
    this.bossDefeated = !!d.bossDefeated;
    this.checkpoint = d.checkpoint ?? 'cp_village';
  }
}
