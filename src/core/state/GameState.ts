/** Persistent game state (pure data + helpers). Serialised to localStorage by `save.ts`. */

export interface QuestState {
  /** 0 = not started, 1 = talk to elder done / hunting, 2 = boss, 3 = return, 4 = complete */
  stage: number;
  kills: number;
}

export interface SaveData {
  v: 1;
  hero: { x: number; y: number; hp: number };
  checkpoint: string;
  worldTime: number;
  dayTime: number;
  killed: Record<string, number>;
  quest: QuestState;
  flags: Record<string, boolean>;
  puzzle: { solved: boolean };
  bossDefeated: boolean;
}

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

  toJSON(hero: { x: number; y: number; hp: number }): SaveData {
    return {
      v: 1,
      hero: { x: Math.round(hero.x), y: Math.round(hero.y), hp: hero.hp },
      checkpoint: this.checkpoint,
      worldTime: this.worldTime,
      dayTime: this.dayTime,
      killed: { ...this.killed },
      quest: { ...this.quest },
      flags: { ...this.flags },
      puzzle: { solved: this.puzzleSolved },
      bossDefeated: this.bossDefeated,
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
