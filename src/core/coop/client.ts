/**
 * The game's side of co-op (docs/MULTIPLAYER.md): one WebSocket to the server, and the three things
 * that make a 50–150 ms mobile connection feel local.
 *
 *  • **Input, sparingly.** Stick/aim/buttons are quantised and sent only when they change, plus a
 *    heartbeat every `HEARTBEAT_S` — never more than `INPUT_HZ` a second. On a phone that is a few
 *    hundred bytes a second up.
 *  • **Prediction** for your own hero: every input is also applied locally with the *same*
 *    movement code the server runs (`stepMovement`). When a snapshot says which input it has
 *    applied (`ack`), the prediction restarts from the server's position and replays the inputs
 *    the server has not seen yet. Small disagreements are eased out, large ones snap.
 *  • **Interpolation** for everyone else and the boss: drawn `INTERP_DELAY` behind the newest
 *    snapshot, between the two snapshots around that moment, so movement is smooth at 10 snapshots
 *    a second and a late packet does not make anyone jump.
 *
 * And it **reconnects**: a dropped socket (lift, tunnel, network switch) is retried with backoff
 * and `resume`d into the same room with the room's token, within the server's grace time.
 *
 * Pure: the socket, the clock and the token come in as dependencies, so tests run it against the
 * real server.
 */
import {
  BTN_DODGE,
  INPUT_HZ,
  INTERP_DELAY,
  PROTOCOL_VERSION,
  RECONNECT_GRACE,
  type ClientMsg,
  type CoopError,
  type LobbyPlayer,
  type RoomPhase,
  type ServerMsg,
  type SnapBoss,
  type SnapEvent,
  type SnapPlayer,
  type SnapThing,
} from '../../../shared/coop/protocol';
import { stepMovement, type Input, type MoveState } from '../../../shared/coop/sim';

/** What the browser's WebSocket (and the `ws` package in tests) both offer. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', fn: () => void): void;
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
}

export interface CoopDeps {
  url: string;
  makeSocket(url: string): SocketLike;
  /** A valid access token (refreshed as needed), or null when the account session is gone. */
  token(): Promise<string | null>;
  /** Seconds. */
  now(): number;
  later(fn: () => void, ms: number): void;
}

export type CoopStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'closed';

export interface RoomView {
  code: string;
  public: boolean;
  phase: RoomPhase;
  players: LobbyPlayer[];
  you: number;
}

export interface Result {
  won: boolean;
  exp: number;
  coins: number;
  items: { id: string; rarity: string; count: number }[];
  save: { data: unknown; rev: number } | null;
}

/** What the renderer draws for one player this frame. */
export interface DrawPlayer {
  id: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  state: number;
  you: boolean;
}

interface Snap {
  at: number;
  p: SnapPlayer[];
  b: SnapBoss | null;
  z: SnapThing[];
}

export const HEARTBEAT_S = 0.25;
/** Past this, a prediction error is snapped rather than eased. */
const SNAP_ERROR = 40;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const findPlayer = (list: SnapPlayer[], id: number): SnapPlayer | undefined => {
  for (const p of list) if (p[0] === id) return p;
  return undefined;
};
const lerpAngle = (a: number, b: number, t: number): number => {
  let d = b - a;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return a + d * t;
};

export class CoopClient {
  status: CoopStatus = 'idle';
  room: RoomView | null = null;
  lastError: CoopError | null = null;
  result: Result | null = null;
  /** Fired whenever anything the panel shows changes. */
  onChange: () => void = () => undefined;
  /** Damage numbers and the like, as they arrive. */
  onEvents: (events: SnapEvent[]) => void = () => undefined;
  /** Round-trip time, seconds (smoothed). */
  rtt = 0;

  private socket: SocketLike | null = null;
  private rtoken = '';
  private wantRoom: ClientMsg | null = null;
  private retries = 0;
  private droppedAt = 0;
  private closing = false;

  // input
  private seq = 0;
  private lastSent: Input | null = null;
  private lastSentAt = -1;
  private sentThisSecond = 0;
  private secondStart = 0;
  /** Inputs the server has not acknowledged yet, with how long each was held. */
  private pending: { input: Input; dt: number; roll: boolean }[] = [];
  private held: Input = { x: 0, y: 0, a: 0, b: 0, s: 0 };

  // state
  private snaps: Snap[] = [];
  private me: MoveState = { x: 0, y: 0, rollT: 0, rollCd: 0, rollDx: 0, rollDy: 0, downed: false };
  private server: { x: number; y: number } | null = null;
  /** Visual offset still being eased out after a correction. */
  private errX = 0;
  private errY = 0;
  private prevButtons = 0;

  constructor(private readonly deps: CoopDeps) {}

  // ───────────────────────── connection ─────────────────────────

  /** Connect (if needed), then run `msg` (create / quick / join). */
  go(msg: ClientMsg): void {
    this.wantRoom = msg;
    this.result = null;
    this.lastError = null;
    if (this.status === 'online') this.send(msg);
    else this.open();
  }

  private open(): void {
    this.closing = false;
    this.status = this.room ? 'reconnecting' : 'connecting';
    this.onChange();
    let ws: SocketLike;
    try {
      ws = this.deps.makeSocket(this.deps.url);
    } catch {
      this.dropped();
      return;
    }
    this.socket = ws;
    ws.addEventListener('open', () => {
      void this.deps.token().then((token) => {
        if (!token) {
          this.fail('auth_failed');
          return;
        }
        this.send({ t: 'auth', token, v: PROTOCOL_VERSION });
      });
    });
    ws.addEventListener('message', (ev) => this.receive(String(ev.data)));
    // a failed connect is followed by 'close', which is where the retry happens; this only keeps
    // the error from being reported as unhandled
    ws.addEventListener('error', () => undefined);
    ws.addEventListener('close', () => {
      // only the socket in use counts: an old one closing late must not trigger a reconnect
      if (this.socket === ws) this.dropped();
    });
  }

  private dropped(): void {
    this.socket = null;
    if (this.closing || this.status === 'closed') return;
    const t = this.deps.now();
    if (this.status === 'online') {
      this.droppedAt = t;
      this.retries = 0;
    }
    // back into the room within the server's grace time, with backoff; after that, give up
    if (this.room && t - this.droppedAt < RECONNECT_GRACE - 2) {
      this.status = 'reconnecting';
      this.onChange();
      const wait = Math.min(8000, 500 * 2 ** this.retries++);
      this.deps.later(() => {
        if (!this.closing) this.open();
      }, wait);
      return;
    }
    this.status = 'closed';
    if (this.room && this.room.phase === 'fight') this.lastError = 'resume_failed';
    this.onChange();
  }

  private fail(code: CoopError): void {
    this.lastError = code;
    this.leave();
  }

  /** Leave the room and close the connection. */
  leave(): void {
    if (this.socket && this.status === 'online') this.send({ t: 'leave' });
    this.closing = true;
    this.socket?.close();
    this.socket = null;
    this.room = null;
    this.snaps = [];
    this.pending = [];
    this.status = 'closed';
    this.onChange();
  }

  ready(on: boolean): void {
    this.send({ t: 'ready', on });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  private send(msg: ClientMsg): void {
    this.socket?.send(JSON.stringify(msg));
  }

  // ───────────────────────── receiving ─────────────────────────

  private receive(text: string): void {
    let m: ServerMsg;
    try {
      m = JSON.parse(text) as ServerMsg;
    } catch {
      return;
    }
    switch (m.t) {
      case 'hello':
        this.status = 'online';
        this.retries = 0;
        if (this.room && this.rtoken) this.send({ t: 'resume', code: this.room.code, rtoken: this.rtoken });
        else if (this.wantRoom) this.send(this.wantRoom);
        this.wantRoom = null;
        this.onChange();
        break;
      case 'room': {
        const entering = !this.room || this.room.phase !== m.phase;
        this.room = { code: m.code, public: m.public, phase: m.phase, players: m.players, you: m.you };
        this.rtoken = m.rtoken;
        if (entering && m.phase === 'fight') {
          this.snaps = [];
          this.pending = [];
          this.server = null;
        }
        this.onChange();
        break;
      }
      case 'snap':
        this.snapshot(m.ack, { at: this.deps.now(), p: m.p, b: m.b, z: m.z });
        if (m.e.length) this.onEvents(m.e);
        break;
      case 'result':
        this.result = { won: m.won, exp: m.exp, coins: m.coins, items: m.items, save: m.save };
        this.onChange();
        break;
      case 'err':
        this.lastError = m.code;
        if (m.code === 'auth_failed' || m.code === 'version' || m.code === 'resume_failed') {
          this.room = null;
          this.leave();
          this.lastError = m.code;
        }
        this.onChange();
        break;
      case 'pong':
        this.rtt = this.rtt ? this.rtt * 0.8 + (this.deps.now() - m.c) * 0.2 : this.deps.now() - m.c;
        break;
      default:
        break;
    }
  }

  private snapshot(ack: number, snap: Snap): void {
    this.snaps.push(snap);
    // a second of history is plenty for interpolation
    while (this.snaps.length > 12) this.snaps.shift();
    const mine = snap.p.find((p) => p[0] === this.room?.you);
    if (!mine) return;
    // reconcile: start from where the server says we are, replay what it has not seen yet
    const before = { x: this.me.x, y: this.me.y };
    this.server = { x: mine[1], y: mine[2] };
    this.me.x = mine[1];
    this.me.y = mine[2];
    this.me.downed = mine[6] === 4;
    this.pending = this.pending.filter((p) => p.input.s > ack);
    for (const p of this.pending) stepMovement(this.me, p.input, p.roll, p.dt);
    const ex = before.x - this.me.x;
    const ey = before.y - this.me.y;
    if (Math.hypot(ex, ey) < SNAP_ERROR) {
      this.errX += ex;
      this.errY += ey;
    } else {
      this.errX = 0;
      this.errY = 0;
    }
  }

  // ───────────────────────── every frame ─────────────────────────

  /**
   * One frame of local input: predict our own movement and send the input when it changed (or the
   * heartbeat is due). `x`, `y` are the stick (−1..1), `aimDeg` degrees, `buttons` BTN_* bits.
   */
  frame(dt: number, x: number, y: number, aimDeg: number, buttons: number): void {
    if (this.status !== 'online' || this.room?.phase !== 'fight') return;
    const next: Input = { x: Math.round(Math.max(-1, Math.min(1, x)) * 100), y: Math.round(Math.max(-1, Math.min(1, y)) * 100), a: Math.round(aimDeg) % 360, b: buttons, s: 0 };
    const t = this.deps.now();
    if (t - this.secondStart >= 1) {
      this.secondStart = t;
      this.sentThisSecond = 0;
    }
    const changed = !this.lastSent || next.x !== this.lastSent.x || next.y !== this.lastSent.y || next.a !== this.lastSent.a || next.b !== this.lastSent.b;
    const due = t - this.lastSentAt >= HEARTBEAT_S;
    const roll = (buttons & BTN_DODGE) !== 0 && (this.prevButtons & BTN_DODGE) === 0;
    this.prevButtons = buttons;
    if ((changed || due) && this.sentThisSecond < INPUT_HZ) {
      next.s = ++this.seq;
      this.send({ t: 'in', s: next.s, x: next.x, y: next.y, a: next.a, b: next.b });
      this.lastSent = next;
      this.lastSentAt = t;
      this.sentThisSecond++;
      this.pending.push({ input: next, dt: 0, roll });
      this.held = next;
    } else if (!this.pending.length) {
      this.pending.push({ input: this.held, dt: 0, roll: false });
    }
    // predict with the input the server will be applying
    const cur = this.pending[this.pending.length - 1];
    cur.dt += dt;
    stepMovement(this.me, cur.input, roll && cur.dt === dt, dt);
    // ease the correction out over about a fifth of a second
    const k = Math.min(1, dt * 5);
    this.errX -= this.errX * k;
    this.errY -= this.errY * k;
    if (this.pending.length > 64) this.pending.splice(0, this.pending.length - 64);
  }

  // buffers `draw()` fills every frame instead of allocating (CLAUDE.md: allocation per frame is a bug)
  private readonly drawOut: { players: DrawPlayer[]; boss: SnapBoss | null; things: SnapThing[] } = { players: [], boss: null, things: [] };
  private readonly drawPool: DrawPlayer[] = [];
  private readonly drawBoss: SnapBoss = [0, 0, 0, 0, 0, 0, 0, 0];

  /**
   * Where to draw everyone this frame: you predicted, the others interpolated. The returned object
   * and its arrays are reused frame to frame — read it, do not keep it.
   */
  draw(): { players: DrawPlayer[]; boss: SnapBoss | null; things: SnapThing[] } {
    const out = this.drawOut;
    out.players.length = 0;
    out.boss = null;
    out.things = [];
    if (!this.snaps.length || !this.room) return out;
    const renderAt = this.deps.now() - INTERP_DELAY;
    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++)
      if (this.snaps[i].at <= renderAt && this.snaps[i + 1].at >= renderAt) {
        a = this.snaps[i];
        b = this.snaps[i + 1];
        break;
      }
    const t = b.at > a.at ? Math.max(0, Math.min(1, (renderAt - a.at) / (b.at - a.at))) : 1;
    const newest = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < newest.p.length; i++) {
      const p = newest.p[i];
      const d = this.drawPool[i] ?? (this.drawPool[i] = { id: 0, x: 0, y: 0, aim: 0, hp: 0, maxHp: 0, state: 0, you: false });
      d.id = p[0];
      d.hp = p[4];
      d.maxHp = p[5];
      d.you = p[0] === this.room.you;
      if (d.you) {
        d.x = this.me.x + this.errX;
        d.y = this.me.y + this.errY;
        d.aim = p[3];
        d.state = p[6];
      } else {
        const pa = findPlayer(a.p, p[0]) ?? p;
        const pb = findPlayer(b.p, p[0]) ?? p;
        d.x = lerp(pa[1], pb[1], t);
        d.y = lerp(pa[2], pb[2], t);
        d.aim = lerpAngle(pa[3], pb[3], t);
        d.state = pb[6];
      }
      out.players.push(d);
    }
    if (a.b && b.b) {
      const boss = this.drawBoss;
      for (let i = 0; i < 8; i++) boss[i] = b.b[i];
      boss[0] = lerp(a.b[0], b.b[0], t);
      boss[1] = lerp(a.b[1], b.b[1], t);
      boss[2] = lerpAngle(a.b[2], b.b[2], t);
      out.boss = boss;
    } else out.boss = newest.b;
    out.things = newest.z;
    return out;
  }

  /** Our own predicted position (for the camera). */
  get myPosition(): { x: number; y: number } {
    return { x: this.me.x + this.errX, y: this.me.y + this.errY };
  }

  /** Where the server last put us, for tests and the report. */
  get serverPosition(): { x: number; y: number } | null {
    return this.server;
  }

  ping(): void {
    this.send({ t: 'ping', c: this.deps.now() });
  }
}
