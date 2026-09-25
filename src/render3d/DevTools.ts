/**
 * The developer menu's actions, against the live game.
 *
 * Every button in `ui/DevMenu.ts` ends up here, and every one of them goes through the same doors
 * the game itself uses — `inventory.add`, `character.unlock`, `applySheet`, `combat.devSpawn`,
 * `saveNow` — so a test done with the developer menu tests the real thing rather than a shortcut
 * around it. Each action returns a short sentence for the menu's status line, so the player can
 * see that the tap did something.
 */
import type { Game3D } from './Game3D';
import type { DevActions } from '../ui/DevMenu';
import { ELEMENTS, type ElementId } from '../core/combat/elements';
import { EQUIP_SLOTS, ITEMS, RARITIES, itemDef, type Rarity } from '../core/items/items';
import { MAX_LEVEL } from '../core/progression';
import { WEATHER, WEATHER_IDS, type Weather } from '../core/systems/weather';
import { findStandable } from '../core/saveMigrate';
import { wipeSave } from '../core/save';
import { DUMMY_TILE } from '../core/systems/tutorial';
import { WORLD_EVENT_IDS, WORLD_EVENTS, type WorldEventId } from '../core/systems/worldEvents';

const KIND_LABEL: Record<string, string> = {
  weapon: 'Senjata',
  helmet: 'Kepala',
  armor: 'Badan',
  gloves: 'Tangan',
  boots: 'Kaki',
  accessory: 'Aksesori',
  lantern: 'Inti Lentera',
  consumable: 'Ramuan',
  material: 'Bahan',
};

const TIMES = { pagi: 0.3, siang: 0.5, sore: 0.72, malam: 0.95 } as const;

/** Tile to the pixel at its centre. */
const t = (tx: number, ty: number): { x: number; y: number } => ({ x: tx * 16 + 8, y: ty * 16 + 8 });

export function buildDevActions(game: Game3D, reload: () => void): DevActions {
  const ch = game.character;

  const give = (id: string, rarity: Rarity, count = 1): number => ch.inventory.add(id, count, rarity).added;

  const teleportTargets = (): { id: string; label: string; x: number; y: number }[] => {
    const m = game.world.markers;
    const cp = (id: string): { x: number; y: number } => m.checkpoints.find((c) => c.id === id) ?? m.playerStart;
    const out = [
      { id: 'start', label: 'Titik mulai', ...m.playerStart },
      { id: 'lantern', label: 'Lentera Agung', ...m.lantern },
      { id: 'dummy', label: 'Boneka latihan', ...t(DUMMY_TILE.tx - 2, DUMMY_TILE.ty) },
      { id: 'cp_village', label: 'Shrine Ravenhollow', ...cp('cp_village') },
      { id: 'cp_forest', label: 'Shrine Hutan Noctis', ...cp('cp_forest') },
      { id: 'cp_cave', label: 'Shrine Gua Lumen', ...cp('cp_cave') },
      { id: 'puzzle', label: 'Ruang puzzle batu', ...t(m.puzzle.rock.tx - 2, m.puzzle.rock.ty) },
      { id: 'bossdoor', label: 'Pintu arena boss', ...t(m.boss.door.tx - 2, m.boss.door.ty + 1) },
      { id: 'arena', label: 'Dalam arena boss', ...t(m.boss.arena.x0 + 4, Math.round((m.boss.arena.y0 + m.boss.arena.y1) / 2)) },
    ];
    // every chest, numbered west to east, so all of them can be reached for testing
    const chests: { x: number; y: number }[] = [];
    for (let cy = 0; cy < game.world.heightTiles / 16; cy++)
      for (let cx = 0; cx < game.world.widthTiles / 16; cx++)
        for (const p of game.world.chunk(cx, cy).props) if (p.type === 'chest') chests.push({ x: p.x, y: p.y });
    chests.sort((a, b) => a.x - b.x);
    chests.forEach((c, i) => out.push({ id: `chest${i}`, label: `Peti ${i + 1}`, x: c.x + 16, y: c.y }));
    return out;
  };

  return {
    items: () => Object.values(ITEMS).map((d) => ({ id: d.id, name: d.name, kind: KIND_LABEL[d.kind] ?? d.kind })),
    rarities: () => RARITIES.map((r) => ({ id: r.id, label: r.label })),
    giveItem: (id, rarity, count) => {
      const def = itemDef(id);
      if (!def) return 'Item tidak dikenal.';
      const n = give(id, rarity as Rarity, count);
      game.saveNow(true);
      return n > 0 ? `${def.name} (${rarity}) masuk tas.` : 'Tas penuh.';
    },
    giveAllCores: () => {
      let n = 0;
      for (const def of Object.values(ITEMS)) if (def.kind === 'lantern') n += give(def.id, def.rarity);
      game.saveNow(true);
      return `${n} Inti Lentera masuk tas.`;
    },
    giveKit: () => {
      // the best defined item for each slot kind, at Legendary
      let n = 0;
      for (const slot of EQUIP_SLOTS) {
        if (slot.id === 'accessory2' || slot.kind === 'lantern') continue;
        // the last-defined item of each kind is the strongest; a reverse scan, not findLast (ES2023)
      let pick: (typeof ITEMS)[string] | undefined;
      for (const d of Object.values(ITEMS)) if (d.kind === slot.kind) pick = d;
        if (pick) n += give(pick.id, 'legendary');
      }
      game.saveNow(true);
      return `${n} perlengkapan Legendaris masuk tas. Pakai dari panel Karakter.`;
    },
    giveCoins: (n) => {
      ch.addCoins(n);
      game.saveNow(true);
      return `Koin: ${ch.coins}`;
    },

    elements: () =>
      (Object.keys(ELEMENTS) as ElementId[])
        .filter((id) => ELEMENTS[id].implemented)
        .map((id) => ({ id, name: ELEMENTS[id].name, unlocked: ch.unlocked.includes(id) })),
    unlockAllElements: () => {
      for (const id of Object.keys(ELEMENTS) as ElementId[]) ch.unlock(id);
      game.applySheet();
      game.saveNow(true);
      return `Terbuka: ${ch.unlocked.map((id) => ELEMENTS[id].name).join(', ')}`;
    },
    primary: () => ch.primary,
    secondary: () => ch.secondary,
    setElement: (slot, id) => {
      const ok = ch.setElement(slot, id as ElementId | null);
      game.applySheet();
      game.saveNow(true);
      if (!ok) return 'Elemen itu belum terbuka.';
      return `Primer: ${ch.primary ? ELEMENTS[ch.primary].name : '-'}, sekunder: ${ch.secondary ? ELEMENTS[ch.secondary].name : '-'}`;
    },

    level: () => ({ level: ch.level, exp: ch.exp, need: ch.expNeeded }),
    setLevel: (level) => {
      if (!Number.isFinite(level)) return 'Angka tidak sah.';
      ch.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
      ch.exp = 0;
      game.applySheet();
      game.hero.heal(game.hero.maxHp);
      game.saveNow(true);
      return `Level ${ch.level}. HP maks ${game.hero.maxHp}, ATK ${ch.stats.atk.toFixed(0)}.`;
    },
    addExp: (n) => {
      game.gainExp(n);
      return `Level ${ch.level}, EXP ${ch.exp}/${ch.expNeeded || '-'}`;
    },

    spawn: (kind) => {
      // a little in front of the hero, on ground they can reach
      const a = game.hero.aim;
      const spot = findStandable(game.world, game.hero.x + Math.cos(a) * 48, game.hero.y + Math.sin(a) * 48) ?? { x: game.hero.x + 48, y: game.hero.y };
      if (kind === 'dummy') {
        const d = game.combat.addDummy(spot.x, spot.y);
        d.spawnId = `dev_dummy_${Math.round(spot.x)}`;
        return 'Boneka latihan dimunculkan.';
      }
      const made = game.combat.devSpawn(kind, spot.x, spot.y);
      return `${made.length} musuh dimunculkan.`;
    },
    clearSpawns: () => `${game.combat.devClear()} dihapus.`,

    teleports: () => teleportTargets().map((dest) => ({ id: dest.id, label: dest.label })),
    teleport: (id) => {
      const target = teleportTargets().find((dest) => dest.id === id);
      if (!target) return 'Tujuan tidak dikenal.';
      const spot = findStandable(game.world, target.x, target.y);
      if (!spot) return 'Tidak ada tempat berdiri di sana.';
      game.teleport(spot.x, spot.y);
      return `Pindah ke ${target.label}.`;
    },

    setTime: (which) => {
      game.setTimeOfDay(TIMES[which]);
      return `Jam: ${which}.`;
    },
    weathers: () => WEATHER_IDS.map((id) => ({ id, label: WEATHER[id].label })),
    weather: () => game.currentWeather,
    setWeather: (id) => {
      if (!(id in WEATHER)) return 'Cuaca tidak dikenal.';
      game.setWeather(id as Weather);
      return `Cuaca: ${WEATHER[id as Weather].label}.`;
    },

    worldEvents: () => WORLD_EVENT_IDS.map((id) => ({ id, label: WORLD_EVENTS[id].name })),
    activeEvent: () => game.events.active?.id ?? null,
    startEvent: (id) => {
      if (id !== null && !(id in WORLD_EVENTS)) return 'Event tidak dikenal.';
      return game.devEvent(id as WorldEventId | null);
    },

    godMode: () => game.hero.invincible,
    setGodMode: (on) => {
      game.hero.invincible = on;
      return on ? 'Kebal: nyala. Serangan tetap terasa, tapi HP tidak berkurang.' : 'Kebal: mati.';
    },
    heal: () => {
      game.hero.heal(game.hero.maxHp);
      return `HP ${game.hero.hp}/${game.hero.maxHp}`;
    },
    resetCutscenes: () => {
      game.state.cutscenesSeen = [];
      game.saveNow(true);
      return 'Status cutscene direset. Prolog akan diputar lagi di Game Baru.';
    },
    resetSave: () => {
      wipeSave();
      reload();
      return 'Save dihapus.';
    },
  };
}
