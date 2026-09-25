/**
 * Co-op rooms (docs/MULTIPLAYER.md): the lobby, the fight, reconnecting, closing, and the loot.
 *
 * One `CoopSim` per fighting room, stepped at `TICK_HZ` by one timer for all rooms; snapshots go
 * out at `SNAP_HZ`. The connection layer (`ws.ts`) only turns sockets into calls on this class, so
 * everything here is tested with fake connections and a fake clock.
 *
 * Rules that matter:
 *  • **Private rooms** have a code; anyone with the code may join while the room is in the lobby.
 *    **Public rooms** are found by "quick" — never by, and never containing, a developer account.
 *  • A player who drops keeps their place for `RECONNECT_GRACE` seconds (the hero stands still and
 *    can be hit); `resume` with the room's reconnect token puts them back. After that they are gone.
 *  • A room with nobody connected for `EMPTY_ROOM_GRACE` seconds is closed. So is one whose fight
 *    ended and whose players left.
 *  • Stats come from each player's save **on the server**; loot is rolled **here** and written into
 *    that save before anyone is told about it.
 */
import { randomBytes } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  EMPTY_ROOM_GRACE,
  MAX_PLAYERS,
  RECONNECT_GRACE,
  SNAP_HZ,
  TICK_HZ,
  type ClientMsg,
  type CoopError,
  type LobbyPlayer,
  type RoomPhase,
  type ServerMsg,
} from '../../../shared/coop/protocol';
import { CoopSim, coopStats, mulberry32 } from '../../../shared/coop/sim';
import type { Repos, UserDoc } from '../repo';
import { add, addCoins, addExp, characterOf } from '../saveEdit';

/** What the room manager needs from a connection. */
export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

/** One connected, authenticated socket. */
export interface Session {
  conn: Conn;
  user: UserDoc;
  /** Set once in a room. */
  code: string | null;
  pid: number;
}

interface Member {
  pid: number;
  userId: string;
  name: string;
  dev: boolean;
  level: number;
  weapon: string | null;
  ready: boolean;
  session: Session | null;
  rtoken: string;
  goneAt: number | null;
}

interface Room {
  code: string;
  public: boolean;
  phase: RoomPhase;
  host: number;
  members: Map<number, Member>;
  sim: CoopSim | null;
  emptySince: number | null;
  ticks: number;
  nextPid: number;
  rewarded: boolean;
}

/** The co-op boss's loot: one piece of gear or a core, rolled per player. */
export const COOP_LOOT = {
  exp: 150,
  coins: 120,
  pool: ['sword_dawn', 'armor_emberplate', 'charm_still', 'boots_striding', 'ring_thorn', 'core_storm', 'core_frost'],
  rarity: [
    ['rare', 0.5],
    ['epic', 0.35],
    ['legendary', 0.13],
    ['mythic', 0.02],
  ] as [string, number][],
  shards: 2,
};

export interface RoomDeps {
  repos: Repos;
  now(): number;
  seed?: number | undefined;
  log?: ((msg: string, data?: Record<string, unknown>) => void) | undefined;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly byUser = new Map<string, Session>();
  private readonly rand: () => number;

  constructor(private readonly deps: RoomDeps) {
    this.rand = mulberry32(deps.seed ?? (Date.now() & 0x7fffffff));
  }

  // ───────────────────────── connections ─────────────────────────

  /** A socket authenticated as `user`. One live socket per account: a newer one replaces the older. */
  connect(conn: Conn, user: UserDoc): Session {
    const old = this.byUser.get(user.id);
    if (old && old.conn !== conn) {
      this.detach(old);
      old.conn.close();
    }
    const s: Session = { conn, user, code: null, pid: 0 };
    this.byUser.set(user.id, s);
    conn.send({ t: 'hello', you: 0, name: user.username, dev: user.role === 'dev' });
    return s;
  }

  /** The socket closed (or dropped): the player's place is kept for a while. */
  disconnect(s: Session): void {
    this.detach(s);
    if (this.byUser.get(s.user.id) === s) this.byUser.delete(s.user.id);
  }

  private detach(s: Session): void {
    const room = s.code ? this.rooms.get(s.code) : undefined;
    const m = room?.members.get(s.pid);
    if (!room || !m || m.session !== s) return;
    m.session = null;
    m.goneAt = this.deps.now();
    const p = room.sim?.players.get(m.pid);
    if (p) p.connected = false;
    this.broadcastRoom(room);
  }

  async handle(s: Session, msg: ClientMsg): Promise<void> {
    switch (msg.t) {
      case 'create':
        return this.create(s, false);
      case 'quick':
        return this.quick(s);
      case 'join':
        return this.join(s, msg.code);
      case 'resume':
        return this.resume(s, msg.code, msg.rtoken);
      case 'ready':
        return this.ready(s, msg.on);
      case 'start':
        return this.start(s);
      case 'leave':
        return this.leave(s);
      case 'in': {
        const room = s.code ? this.rooms.get(s.code) : undefined;
        room?.sim?.setInput(s.pid, { x: msg.x, y: msg.y, a: msg.a, b: msg.b, s: msg.s });
        return undefined;
      }
      case 'ping':
        s.conn.send({ t: 'pong', c: msg.c, s: this.deps.now() });
        return undefined;
      default:
        return undefined;
    }
  }

  private err(s: Session, code: CoopError): void {
    s.conn.send({ t: 'err', code });
  }

  // ───────────────────────── rooms ─────────────────────────

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(this.rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
      if (!this.rooms.has(c)) return c;
    }
  }

  /** Level and weapon from the save the server holds: the only source of a player's co-op strength. */
  private async statsOf(user: UserDoc): Promise<{ level: number; weapon: string | null }> {
    const c = await this.deps.repos.characters.get(user.id, 0);
    const ch = (c?.data as { character?: { level?: unknown; inventory?: { equipped?: { weapon?: { rarity?: unknown } } } } } | undefined)?.character;
    const level = typeof ch?.level === 'number' ? ch.level : 1;
    const rarity = ch?.inventory?.equipped?.weapon?.rarity;
    return { level, weapon: typeof rarity === 'string' ? rarity : null };
  }

  private async enter(s: Session, room: Room): Promise<void> {
    const st = await this.statsOf(s.user);
    const pid = room.nextPid++;
    const m: Member = {
      pid,
      userId: s.user.id,
      name: s.user.username,
      dev: s.user.role === 'dev',
      level: st.level,
      weapon: st.weapon,
      ready: false,
      session: s,
      rtoken: randomBytes(18).toString('base64url'),
      goneAt: null,
    };
    room.members.set(pid, m);
    if (room.members.size === 1) room.host = pid;
    room.emptySince = null;
    s.code = room.code;
    s.pid = pid;
    this.deps.log?.('masuk room', { code: room.code, user: s.user.username, public: room.public });
    this.broadcastRoom(room);
  }

  private makeRoom(isPublic: boolean): Room {
    const room: Room = { code: this.newCode(), public: isPublic, phase: 'lobby', host: 0, members: new Map(), sim: null, emptySince: null, ticks: 0, nextPid: 1, rewarded: false };
    this.rooms.set(room.code, room);
    return room;
  }

  private async create(s: Session, isPublic: boolean): Promise<void> {
    if (s.code) return this.err(s, 'already_in_room');
    await this.enter(s, this.makeRoom(isPublic));
  }

  /** A public room with space and still in the lobby, or a new one. Never for a developer. */
  private async quick(s: Session): Promise<void> {
    if (s.code) return this.err(s, 'already_in_room');
    if (s.user.role === 'dev') return this.err(s, 'dev_private_only');
    for (const room of this.rooms.values())
      if (room.public && room.phase === 'lobby' && room.members.size < MAX_PLAYERS) return this.enter(s, room);
    return this.create(s, true);
  }

  private async join(s: Session, code: string): Promise<void> {
    if (s.code) return this.err(s, 'already_in_room');
    const room = this.rooms.get(code);
    if (!room) return this.err(s, 'room_not_found');
    if (room.public && s.user.role === 'dev') return this.err(s, 'dev_private_only');
    if (room.phase !== 'lobby') return this.err(s, 'room_started');
    if (room.members.size >= MAX_PLAYERS) return this.err(s, 'room_full');
    await this.enter(s, room);
  }

  /** Back into the room after a dropped connection, with the token the room handed out. */
  private async resume(s: Session, code: string, rtoken: string): Promise<void> {
    const room = this.rooms.get(code);
    const m = room && [...room.members.values()].find((x) => x.rtoken === rtoken && x.userId === s.user.id);
    if (!room || !m) return this.err(s, 'resume_failed');
    if (m.session && m.session !== s) m.session.conn.close();
    m.session = s;
    m.goneAt = null;
    room.emptySince = null;
    s.code = room.code;
    s.pid = m.pid;
    const p = room.sim?.players.get(m.pid);
    if (p) p.connected = true;
    this.broadcastRoom(room);
    return undefined;
  }

  private ready(s: Session, on: boolean): void {
    const room = s.code ? this.rooms.get(s.code) : undefined;
    const m = room?.members.get(s.pid);
    if (!room || !m || room.phase !== 'lobby') return;
    m.ready = on;
    this.broadcastRoom(room);
  }

  private start(s: Session): void {
    const room = s.code ? this.rooms.get(s.code) : undefined;
    if (!room || room.phase !== 'lobby') return;
    if (room.host !== s.pid) return this.err(s, 'not_host');
    const present = [...room.members.values()].filter((m) => m.session);
    if (present.some((m) => !m.ready && m.pid !== room.host)) return this.err(s, 'not_ready');
    room.sim = new CoopSim(Math.floor(this.rand() * 2 ** 31));
    for (const m of room.members.values()) {
      const p = room.sim.addPlayer(m.pid, coopStats(m.level, m.weapon));
      p.connected = !!m.session;
    }
    room.sim.begin();
    room.phase = 'fight';
    this.deps.log?.('pertarungan co-op dimulai', { code: room.code, players: room.members.size });
    this.broadcastRoom(room);
  }

  private leave(s: Session): void {
    const room = s.code ? this.rooms.get(s.code) : undefined;
    s.code = null;
    if (!room) return;
    room.members.delete(s.pid);
    room.sim?.removePlayer(s.pid);
    if (room.host === s.pid) room.host = room.members.keys().next().value ?? 0;
    if (room.members.size === 0) this.rooms.delete(room.code);
    else this.broadcastRoom(room);
  }

  private broadcastRoom(room: Room): void {
    const players: LobbyPlayer[] = [...room.members.values()].map((m) => ({
      id: m.pid,
      name: m.name,
      level: m.level,
      ready: m.ready,
      connected: !!m.session,
      host: m.pid === room.host,
    }));
    for (const m of room.members.values())
      m.session?.conn.send({ t: 'room', code: room.code, public: room.public, phase: room.phase, players, rtoken: m.rtoken, you: m.pid });
  }

  // ───────────────────────── time ─────────────────────────

  /** One server tick for every room. `snapEvery` ticks between snapshots. */
  async tick(dt = 1 / TICK_HZ): Promise<void> {
    const now = this.deps.now();
    const snapEvery = Math.max(1, Math.round(TICK_HZ / SNAP_HZ));
    const finished: Room[] = [];
    // (deleting from a Map while iterating it is well defined in JavaScript)
    for (const room of this.rooms.values()) {
      // players whose grace ran out
      for (const m of room.members.values())
        if (!m.session && m.goneAt !== null && now - m.goneAt > RECONNECT_GRACE * 1000) {
          room.members.delete(m.pid);
          room.sim?.removePlayer(m.pid);
          if (room.host === m.pid) room.host = room.members.keys().next().value ?? 0;
          this.broadcastRoom(room);
        }
      // empty rooms
      const connected = [...room.members.values()].some((m) => m.session);
      if (!connected) {
        room.emptySince ??= now;
        if (room.members.size === 0 || now - room.emptySince > EMPTY_ROOM_GRACE * 1000) {
          this.rooms.delete(room.code);
          this.deps.log?.('room ditutup', { code: room.code });
          continue;
        }
      } else room.emptySince = null;

      if (room.phase !== 'fight' || !room.sim) continue;
      room.sim.step(dt);
      room.ticks++;
      if (room.ticks % snapEvery === 0 || room.sim.outcome) this.snapshot(room);
      if (room.sim.outcome && !room.rewarded) {
        room.rewarded = true;
        room.phase = room.sim.outcome;
        finished.push(room);
      }
    }
    // rewards touch the database: all rooms that ended this tick, in parallel
    await Promise.all(
      finished.map(async (room) => {
        await this.finish(room, room.phase === 'won');
        this.broadcastRoom(room);
      }),
    );
  }

  private snapshot(room: Room): void {
    const sim = room.sim!;
    const p = sim.snapPlayers();
    const b = sim.snapBoss();
    const z = sim.snapThings();
    const e = sim.drainEvents();
    for (const m of room.members.values()) {
      const lastSeq = sim.players.get(m.pid)?.lastSeq ?? 0;
      m.session?.conn.send({ t: 'snap', k: sim.tick, ack: lastSeq, p, b, z, e });
    }
  }

  /**
   * The end of a fight. On a win, every player in the room gets loot rolled here and written into
   * their save on the server first; then they are told, with the new save, so the game adopts it.
   */
  private async finish(room: Room, won: boolean): Promise<void> {
    await Promise.all(
      [...room.members.values()].map(async (m) => {
        if (!won) {
          m.session?.conn.send({ t: 'result', won: false, exp: 0, coins: 0, items: [], save: null });
          return;
        }
        const item = COOP_LOOT.pool[Math.floor(this.rand() * COOP_LOOT.pool.length) % COOP_LOOT.pool.length];
        let r = this.rand();
        let rarity = 'rare';
        for (const [id, w] of COOP_LOOT.rarity) {
          if (r < w) {
            rarity = id;
            break;
          }
          r -= w;
        }
        const items = [
          { id: item, rarity, count: 1 },
          { id: 'shard_dawn', rarity: 'uncommon', count: COOP_LOOT.shards },
        ];
        const saved = await this.award(m, items);
        this.deps.log?.('loot co-op', { user: m.name, item, rarity, saved: !!saved });
        m.session?.conn.send({ t: 'result', won: true, exp: COOP_LOOT.exp, coins: COOP_LOOT.coins, items, save: saved });
      }),
    );
  }

  /** Write the loot into the player's server save. Null when they have no save on the server yet. */
  private async award(m: Member, items: { id: string; rarity: string; count: number }[]): Promise<{ data: unknown; rev: number } | null> {
    const repo = this.deps.repos.characters;
    const doc = await repo.get(m.userId, 0);
    if (!doc) return null;
    const data = structuredClone(doc.data) as Record<string, unknown>;
    const c = characterOf(data);
    addExp(c, COOP_LOOT.exp);
    addCoins(c, COOP_LOOT.coins);
    for (const it of items) add(c, it.id, it.rarity, it.count);
    data.character = c;
    if (m.dev) data.devSave = true;
    const stored = await repo.overwrite(m.userId, 0, {
      saveVersion: doc.saveVersion,
      data,
      level: c.level,
      dev: doc.dev ?? m.dev,
      updatedAt: new Date(this.deps.now()),
      clientUpdatedAt: null,
    });
    return { data: stored.data, rev: stored.rev };
  }
}
