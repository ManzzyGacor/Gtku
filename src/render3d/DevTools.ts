/**
 * The developer panel's actions, against the live game — **each one asked of the server first**.
 *
 * The panel only exists for an account the server calls "dev" (see `boot3d.ts`), but that is not
 * the lock; this is. Every button sends its action to `POST /dev/action`
 * (shared/devActions.ts), where the server checks the account's role in the database, validates
 * the action, and logs it:
 *
 *  • **grants** (items, cores, kit, coins, level, EXP, elements, stats, cutscene reset, save reset)
 *    are *applied by the server* to the save and returned — the game then adopts the server's save.
 *    There is no code path here that adds an item to the bag by itself.
 *  • **session tools** (god mode, teleport, time, weather, spawns, heal, events, reaction log) run
 *    locally only after the server said yes.
 *
 * Offline, nothing happens: the answer is "server tidak bisa dihubungi".
 */
import type { Game3D } from './Game3D';
import type { DevActions, Reply } from '../ui/DevMenu';
import type { DevAction } from '../../shared/devActions';
import type { SaveData } from '../core/state/GameState';
import { ELEMENTS, type ElementId } from '../core/combat/elements';
import { ITEMS, RARITIES } from '../core/items/items';
import { MAX_LEVEL } from '../core/progression';
import { WEATHER, WEATHER_IDS, type Weather } from '../core/systems/weather';
import { WORLD_EVENT_IDS, WORLD_EVENTS, type WorldEventId } from '../core/systems/worldEvents';
import { findStandable } from '../core/saveMigrate';
import { DUMMY_TILE } from '../core/systems/tutorial';

/** The server side of the panel: `POST /dev/action`. Implemented in main.ts with the account's token. */
export interface DevServer {
  act(action: DevAction, save?: SaveData): Promise<{ ok: true; note?: string | undefined; save?: { data: SaveData; rev: number } | null | undefined } | { ok: false; message: string }>;
}

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

const elementName = (id: ElementId | null): string => (id ? ELEMENTS[id].name : '-');

/** Tile to the pixel at its centre. */
const t = (tx: number, ty: number): { x: number; y: number } => ({ x: tx * 16 + 8, y: ty * 16 + 8 });

export function buildDevActions(game: Game3D, server: DevServer, reload: () => void): DevActions {
  const ch = game.character;

  /** A grant: the server changes the save, the game takes the server's save. */
  const grant = async (action: DevAction): Promise<string> => {
    const r = await server.act(action, game.snapshotSave());
    if (!r.ok) return r.message;
    if (r.save === null) {
      reload();
      return r.note ?? 'Selesai.';
    }
    if (r.save) game.adoptSave(r.save.data);
    return r.note ?? 'Selesai.';
  };

  /** A session tool: the server says yes (and logs it), then it runs here. */
  const tool = async (action: DevAction, run: () => string): Promise<string> => {
    const r = await server.act(action);
    return r.ok ? run() : r.message;
  };

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
    giveItem: (id, rarity, count) => grant({ type: 'give_item', item: id, rarity: rarity as never, count }),
    giveAllCores: () => grant({ type: 'give_all_cores' }),
    giveKit: () => grant({ type: 'give_kit' }),
    giveCoins: (n) => grant({ type: 'set_coins', amount: Math.max(0, Math.min(99_999_999, ch.coins + n)) }),

    elements: () =>
      (Object.keys(ELEMENTS) as ElementId[]).filter((id) => ELEMENTS[id].implemented).map((id) => ({ id, name: ELEMENTS[id].name, unlocked: ch.unlocked.includes(id) })),
    unlockAllElements: () => grant({ type: 'unlock_elements' }),
    primary: () => ch.primary,
    secondary: () => ch.secondary,
    setElement: (slot, id): Reply => {
      const next = { primary: ch.primary, secondary: ch.secondary, [slot]: id as ElementId | null };
      // the same element cannot sit in both hands: the other hand lets go of it
      if (next.primary && next.primary === next.secondary) next[slot === 'primary' ? 'secondary' : 'primary'] = null;
      return grant({ type: 'set_elements', primary: next.primary as never, secondary: next.secondary as never }).then(
        (msg) => `${msg} Primer: ${elementName(ch.primary)}, sekunder: ${elementName(ch.secondary)}.`,
      );
    },

    level: () => ({ level: ch.level, exp: ch.exp, need: ch.expNeeded }),
    setLevel: (level) => (Number.isFinite(level) ? grant({ type: 'set_level', level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) }) : 'Angka tidak sah.'),
    addExp: (n) => grant({ type: 'add_exp', amount: n }),
    stats: () => ({ ...ch.devStats }) as Record<string, number>,
    setStats: (stats) => {
      // the server merges and drops zeros: send every stat so "reset" clears the lot
      const all: Record<string, number> = {};
      for (const k of Object.keys(ch.devStats)) all[k] = 0;
      return grant({ type: 'set_stats', stats: { ...all, ...stats } });
    },

    spawn: (kind) =>
      tool({ type: 'spawn', kind }, () => {
        const a = game.hero.aim;
        const spot = findStandable(game.world, game.hero.x + Math.cos(a) * 48, game.hero.y + Math.sin(a) * 48) ?? { x: game.hero.x + 48, y: game.hero.y };
        if (kind === 'dummy') {
          const d = game.combat.addDummy(spot.x, spot.y);
          d.spawnId = `dev_dummy_${Math.round(spot.x)}`;
          return 'Boneka latihan dimunculkan.';
        }
        return `${game.combat.devSpawn(kind, spot.x, spot.y).length} musuh dimunculkan.`;
      }),
    clearSpawns: () => tool({ type: 'clear_spawns' }, () => `${game.combat.devClear()} dihapus.`),

    teleports: () => teleportTargets().map((dest) => ({ id: dest.id, label: dest.label })),
    teleport: (id) =>
      tool({ type: 'teleport', to: id }, () => {
        const target = teleportTargets().find((dest) => dest.id === id);
        const spot = target && findStandable(game.world, target.x, target.y);
        if (!target || !spot) return 'Tujuan tidak dikenal.';
        game.teleport(spot.x, spot.y);
        return `Pindah ke ${target.label}.`;
      }),

    setTime: (which) =>
      tool({ type: 'time', to: which }, () => {
        game.setTimeOfDay(TIMES[which]);
        return `Jam: ${which}.`;
      }),
    weathers: () => WEATHER_IDS.map((id) => ({ id, label: WEATHER[id].label })),
    weather: () => game.currentWeather,
    setWeather: (id) =>
      id in WEATHER
        ? tool({ type: 'weather', to: id }, () => {
            game.setWeather(id as Weather);
            return `Cuaca: ${WEATHER[id as Weather].label}.`;
          })
        : 'Cuaca tidak dikenal.',
    worldEvents: () => WORLD_EVENT_IDS.map((id) => ({ id, label: WORLD_EVENTS[id].name })),
    activeEvent: () => game.events.active?.id ?? null,
    startEvent: (id) => (id !== null && !(id in WORLD_EVENTS) ? 'Event tidak dikenal.' : tool({ type: 'event', id }, () => game.devEvent(id as WorldEventId | null))),

    godMode: () => game.hero.invincible,
    setGodMode: (on) =>
      tool({ type: 'god', on }, () => {
        game.hero.invincible = on;
        return on ? 'Kebal: nyala. Serangan tetap terasa, tapi HP tidak berkurang.' : 'Kebal: mati.';
      }),
    heal: () =>
      tool({ type: 'heal' }, () => {
        game.hero.heal(game.hero.maxHp);
        return `HP ${game.hero.hp}/${game.hero.maxHp}`;
      }),
    resetCutscenes: () => grant({ type: 'reset_cutscenes' }),
    resetSave: () => grant({ type: 'reset_save' }),
  };
}
