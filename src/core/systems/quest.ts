/** Quest logic (pure). One quest, "Cahaya untuk Desa", driven by `state.quest.stage`. */
import { KILLS_NEEDED, type GameState } from '../state/GameState';
import { EXP_REWARDS } from '../progression';

export const QUEST_TITLE = 'Cahaya untuk Desa';

export type QuestEvent =
  | { type: 'talk-elder' }
  | { type: 'kill'; kind: string }
  | { type: 'boss-defeated' }
  | { type: 'return-crystal' };

export interface QuestResult {
  changed: boolean;
  /** Something to tell the player (toast). */
  message?: string;
  /** The Great Lantern should light up now. */
  lightLantern?: boolean;
  /**
   * What the stage pays out (Batch 4). Data rather than code in the renderer, so the rewards are
   * part of the quest definition and can be checked by a test — the plan wants quests
   * data-driven with objectives and rewards.
   */
  reward?: QuestReward | undefined;
}

export interface QuestReward {
  exp?: number | undefined;
  items?: { id: string; count?: number }[] | undefined;
}

/** Stage machine: 0 not started → 1 hunt → 2 boss → 3 return → 4 complete. */
export function advanceQuest(state: GameState, ev: QuestEvent): QuestResult {
  const q = state.quest;
  switch (ev.type) {
    case 'talk-elder':
      if (q.stage === 0) {
        q.stage = 1;
        // The elder does not send you into the forest empty-handed.
        return {
          changed: true,
          message: `Quest baru: ${QUEST_TITLE}`,
          reward: { exp: EXP_REWARDS.questStage, items: [{ id: 'sword_village' }, { id: 'potion_small', count: 2 }] },
        };
      }
      return { changed: false };
    case 'kill':
      if (q.stage === 1 && (ev.kind === 'slime' || ev.kind === 'archer')) {
        q.kills = Math.min(KILLS_NEEDED, q.kills + 1);
        if (q.kills >= KILLS_NEEDED) {
          q.stage = 2;
          return {
            changed: true,
            message: 'Monster hutan sudah cukup. Menujulah ke Gua Kelam!',
            reward: { exp: EXP_REWARDS.questStage, items: [{ id: 'boots_soft' }] },
          };
        }
        return { changed: true };
      }
      return { changed: false };
    case 'boss-defeated':
      if (q.stage <= 2) {
        q.stage = 3;
        return {
          changed: true,
          message: 'Kristal Fajar didapat! Bawa ke Tetua Wulan.',
          reward: { exp: EXP_REWARDS.questStage, items: [{ id: 'shard_dawn', count: 3 }] },
        };
      }
      return { changed: false };
    case 'return-crystal':
      if (q.stage === 3) {
        q.stage = 4;
        state.flags.lanternLit = true;
        return {
          changed: true,
          message: 'Quest selesai: Lentera Agung menyala!',
          lightLantern: true,
          // The village's thanks: the elder's own woven vest, and a ring for the road ahead.
          reward: { exp: EXP_REWARDS.questStage * 2, items: [{ id: 'armor_woven' }, { id: 'ring_thorn' }] },
        };
      }
      return { changed: false };
  }
}

/** HUD tracker lines for the current stage. */
export function trackerLines(state: GameState): string[] {
  const q = state.quest;
  switch (q.stage) {
    case 0:
      return ['! Temui Tetua Wulan di plaza'];
    case 1:
      return [QUEST_TITLE, `Kalahkan monster hutan ${q.kills}/${KILLS_NEEDED}`];
    case 2:
      return [QUEST_TITLE, 'Kalahkan Kolosus Kelam', 'di Gua Kelam (timur)'];
    case 3:
      return [QUEST_TITLE, 'Serahkan Kristal Fajar', 'ke Tetua Wulan'];
    default:
      return [];
  }
}

export type NpcId = 'wulan' | 'rengga' | 'mita' | 'jagat';

export interface DialogueScript {
  lines: string[];
  /** Quest event to fire when the dialogue finishes. */
  onDone?: QuestEvent;
}

/** What each NPC says right now (Indonesian, short lines that fit two-per-page). */
export function dialogueFor(npc: NpcId, state: GameState): DialogueScript {
  const q = state.quest;
  switch (npc) {
    case 'wulan':
      if (q.stage === 0)
        return {
          lines: [
            'Arka, Lentera Agung padam sejak Kolosus Kelam bangun di dasar Gua Kelam.',
            'Tanpa cahayanya, hewan hutan menjadi buas dan malam terasa makin panjang.',
            'Bawa pedang pemantikmu. Kalahkan 6 monster di hutan untuk mengasah diri.',
            'Setelah itu, masuki Gua Kelam dan kalahkan Kolosus. Bawa pulang Kristal Fajar.',
            'Ketuk tombol serang berulang untuk kombo tiga pukulan. Berguling untuk menghindar!',
          ],
          onDone: { type: 'talk-elder' },
        };
      if (q.stage === 1)
        return { lines: [`Kamu sudah mengalahkan ${q.kills} dari ${KILLS_NEEDED} monster hutan.`, 'Teruslah, Arka. Hutan Bisik ada di sebelah timur desa.'] };
      if (q.stage === 2)
        return {
          lines: [
            'Gua Kelam ada di ujung timur hutan. Di dalamnya ada batu ukir dan pelat di lantai.',
            'Dorong batu itu ke pelat agar gerbang terbuka.',
            'Kolosus lemah setelah menghantam tanah. Hindari gelombang kejutnya dengan berguling!',
          ],
        };
      if (q.stage === 3)
        return {
          lines: [
            'Itu... Kristal Fajar! Cahayanya masih hangat.',
            'Terima kasih, Arka. Mari kita nyalakan Lentera Agung kembali.',
          ],
          onDone: { type: 'return-crystal' },
        };
      return {
        lines: [
          'Lihatlah, desa kembali terang. Kamulah pahlawan Desa Lentera.',
          'Jelajahilah hutan dan gua sesukamu. Masih banyak rahasia di sana.',
        ],
      };

    case 'rengga':
      if (q.stage >= 4) return { lines: ['Pedangmu berkilau lagi! Aku bangga padamu, Nak.', 'Istirahatlah di dekat Lentera Agung untuk menyimpan progresmu.'] };
      return {
        lines: [
          'Hati-hati di luar sana! Lendir Lumut menerkam setelah berkedip merah.',
          'Pemanah Duri suka menjaga jarak. Dekati lalu tebas sebelum ia menembak!',
          'Datangi altar berapi atau Lentera Agung untuk menyembuhkan diri dan menyimpan progres.',
        ],
      };

    case 'mita':
      if (q.stage >= 3) return { lines: ['Kamu benar-benar mengalahkan raksasa batu itu?! Keren banget!'] };
      return {
        lines: [
          'Kak, aku pernah mengintip ke Gua Kelam. Ada batu berukir di lantai!',
          'Ada pelat bercahaya juga. Mungkin batunya harus didorong ke sana.',
          'Kalau batunya macet, keluar dari ruangan dulu. Batunya akan kembali!',
        ],
      };

    case 'jagat':
      if (q.stage >= 3 || state.bossDefeated) return { lines: ['Gua ini akhirnya tenang. Terima kasih, Pahlawan.'] };
      return {
        lines: [
          'Berhenti! Di balik gerbang itu tidur Kolosus Kelam.',
          'Ia menembakkan batu dan menghantam tanah. Berguling tepat saat gelombang kejut mendekat!',
          'Kalau kelelawar datang, gunakan Ledakan Fajar untuk menyapu mereka semua.',
        ],
      };
  }
}
