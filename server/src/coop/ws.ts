/**
 * The co-op WebSocket: `wss://api.varesa.mom/ws` (docs/MULTIPLAYER.md).
 *
 * This layer only turns sockets into `RoomManager` calls, and guards the door:
 *  • the upgrade is refused unless the Origin is the game's;
 *  • the first message must be `auth` with a valid access token (the same check as the REST API)
 *    within `AUTH_TIMEOUT_MS`, else the socket is closed — tokens never go in the URL, where they
 *    would land in logs;
 *  • every message is size-limited and strictly parsed (`parseClientMsg`), and a socket sending more
 *    than `MSG_PER_SECOND` is cut off;
 *  • silent sockets (a phone that lost signal without closing) are found by ping/pong and closed.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { MAX_CLIENT_MESSAGE, parseClientMsg, PROTOCOL_VERSION, TICK_HZ, type ServerMsg } from '../../../shared/coop/protocol';
import type { Repos, UserDoc } from '../repo';
import { RoomManager, type Session } from './rooms';

export const AUTH_TIMEOUT_MS = 5000;
export const MSG_PER_SECOND = 40;
const HEARTBEAT_MS = 15_000;

export interface CoopDeps {
  repos: Repos;
  now(): number;
  corsOrigin: string;
  verifyToken(token: string): Promise<UserDoc | 'expired' | null>;
  clientIp(req: FastifyRequest): string;
  seed?: number | undefined;
}

export async function registerCoop(app: FastifyInstance, deps: CoopDeps): Promise<RoomManager> {
  await app.register(websocket, { options: { maxPayload: MAX_CLIENT_MESSAGE * 2 } });
  const rooms = new RoomManager({ repos: deps.repos, now: deps.now, seed: deps.seed, log: (msg, data) => app.log.info(data ?? {}, msg) });
  app.decorate('coopRooms', rooms);

  // one clock for every room
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    rooms.tick().finally(() => {
      ticking = false;
    });
  }, 1000 / TICK_HZ);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  app.get(
    '/ws',
    {
      websocket: true,
      // the door: only the game's origin may open a socket
      preValidation: async (req, reply) => {
        if (req.headers.origin !== deps.corsOrigin) await reply.code(403).send({ error: 'forbidden_origin' });
      },
    },
    (socket: WebSocket, req) => {
      const send = (msg: ServerMsg): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      };
      let session: Session | null = null;
      let alive = true;
      let windowStart = deps.now();
      let count = 0;
      const authTimer = setTimeout(() => {
        if (!session) {
          send({ t: 'err', code: 'auth_failed' });
          socket.close(4001, 'auth');
        }
      }, AUTH_TIMEOUT_MS);
      const beat = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
        return undefined;
      }, HEARTBEAT_MS);
      socket.on('pong', () => {
        alive = true;
      });

      socket.on('message', (raw: Buffer, isBinary: boolean) => {
        alive = true;
        // rate limit: a phone sends ~20 inputs a second; far more is a bug or an attack
        const t = deps.now();
        if (t - windowStart >= 1000) {
          windowStart = t;
          count = 0;
        }
        if (++count > MSG_PER_SECOND) {
          send({ t: 'err', code: 'too_many_messages' });
          socket.close(4008, 'rate');
          return;
        }
        const msg = isBinary ? null : parseClientMsg(raw.toString('utf8'));
        if (!msg) {
          send({ t: 'err', code: 'bad_message' });
          return;
        }
        if (!session) {
          if (msg.t !== 'auth') {
            send({ t: 'err', code: 'auth_failed' });
            socket.close(4001, 'auth');
            return;
          }
          if (msg.v !== PROTOCOL_VERSION) {
            send({ t: 'err', code: 'version' });
            socket.close(4002, 'version');
            return;
          }
          void deps.verifyToken(msg.token).then((user) => {
            if (!user || user === 'expired') {
              send({ t: 'err', code: 'auth_failed' });
              socket.close(4001, 'auth');
              return;
            }
            clearTimeout(authTimer);
            session = rooms.connect({ send, close: () => socket.close(4003, 'replaced') }, user);
            app.log.info({ user: user.username, ip: deps.clientIp(req) }, 'co-op tersambung');
          });
          return;
        }
        void rooms.handle(session, msg).catch((e: unknown) => app.log.error({ err: { name: (e as Error)?.name } }, 'co-op galat'));
      });

      socket.on('close', () => {
        clearTimeout(authTimer);
        clearInterval(beat);
        if (session) rooms.disconnect(session);
      });
    },
  );
  return rooms;
}
