/**
 * The API (docs/BACKEND.md): accounts, sessions, and the character save.
 *
 * `buildApp` takes its storage and its clock, so the test suite runs the real routes — real
 * validation, real hashing, real tokens, real rate limits — over `app.inject()` with in-memory
 * repositories. Production passes the MongoDB ones (`index.ts`).
 *
 * **Sessions.** A short-lived access token (JWT, 15 min) is returned in the JSON and kept **in
 * memory** by the game — never in localStorage. The long-lived refresh token (random 256-bit,
 * 30 days) travels only as an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/auth`, is
 * stored in the database only as a SHA-256 hash, and is **rotated** on every refresh: presenting an
 * already-rotated token revokes the whole login (someone copied it).
 *
 * **Roles** come from the database, decided here: the developer role is not something a client can
 * claim. The name reserved for it can only be registered with a code from server/.env, or be
 * promoted from the VPS with `npm run set-role`.
 */
import { createHash, randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import {
  MAX_SAVE_BYTES,
  MAX_SAVE_VERSION,
  isProtectedUsername,
  validEmail,
  validPassword,
  validUsername,
  type ApiErrorCode,
  type AuthResponse,
  type PublicUser,
  type SaveEnvelope,
  type UserRole,
} from '../../shared/api';
import { redact, type ServerConfig } from './config';
import { DuplicateError, type CharacterDoc, type Repos, type UserDoc } from './repo';
import { checkProgression, checkSaveIntegrity } from '../../shared/saveRules';
import { isGrant, parseDevAction } from '../../shared/devActions';
import { applyGrant } from './devGrants';

export const REFRESH_COOKIE = 'lm_refresh';
/** How long after a rotation the old refresh token is still accepted (two tabs refreshing at once). */
export const REFRESH_GRACE_MS = 20_000;

/**
 * argon2id with the OWASP-recommended floor (19 MiB, 2 passes). About 50 ms on this VPS — slow for
 * a guesser, invisible to a player, and small enough that a burst of logins cannot exhaust 4 GB.
 */
const ARGON = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

/** The one way a password becomes a stored hash (the API and the VPS scripts both use it). */
export const hashPassword = (password: string): Promise<string> => argon2.hash(password, ARGON);

export interface AppDeps {
  config: ServerConfig;
  repos: Repos;
  now?: (() => number) | undefined;
  /** Pino logging; off in tests. */
  logger?: boolean | undefined;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Every error leaves as `{ error: code }` — never a stack, never a driver message. */
const fail = (reply: FastifyReply, status: number, error: ApiErrorCode, extra: Record<string, unknown> = {}): FastifyReply =>
  reply.code(status).send({ error, ...extra });

const publicUser = (u: UserDoc): PublicUser => ({ username: u.username, role: u.role });

const envelope = (c: CharacterDoc): SaveEnvelope => ({ data: c.data, saveVersion: c.saveVersion, rev: c.rev, updatedAt: c.updatedAt.getTime() });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, repos } = deps;
  const now = deps.now ?? (() => Date.now());
  const app = Fastify({
    bodyLimit: MAX_SAVE_BYTES + 16 * 1024,
    trustProxy: false,
    // strict: an unknown field is an error (not silently dropped), and "1" is not the number 1
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
    logger: deps.logger
      ? {
          level: 'info',
          // tokens, cookies and passwords never reach a log line
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'body.password'],
        }
      : false,
  });

  // a hash of nothing, so a login for a name that does not exist costs the same as a wrong password
  const dummyHash = await argon2.hash(randomBytes(16).toString('hex'), ARGON);

  /** The real client IP: behind the tunnel every socket is loopback, and Cloudflare says who it was. */
  const clientIp = (req: FastifyRequest): string => {
    const cf = req.headers['cf-connecting-ip'];
    const loopback = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    return config.trustCfHeader && loopback && typeof cf === 'string' && cf.length < 64 ? cf : req.ip;
  };

  const loginTries = new SlidingLimiter(5, 60_000);


  await app.register(cors, {
    origin: (origin, cb) => cb(null, origin === config.corsOrigin),
    credentials: true,
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({ statusCode: 429, error: 'rate_limited' }),
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; validation?: unknown; message?: string; name?: string };
    if (e.statusCode === 429) return fail(reply, 429, 'rate_limited');
    if (e.validation || e.statusCode === 400) return fail(reply, 400, 'invalid_input');
    if (e.statusCode === 413) return fail(reply, 413, 'save_too_large');
    // any other client error (wrong content type, …) is the client's, not a 500 in our logs
    if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) return fail(reply, e.statusCode, 'invalid_input');
    // never echo internals; log them with anything that looks like a connection string removed
    req.log.error({ err: { name: e.name, message: redact(String(e.message ?? ''), [config.mongoUri]) } }, 'kesalahan server');
    return fail(reply, 500, 'server_error');
  });

  app.setNotFoundHandler((_req, reply) => fail(reply, 404, 'not_found'));

  // nothing this API answers may be cached (tokens, saves), sniffed, or framed
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  // ───────────────────────── tokens ─────────────────────────

  /** `sid` = the login (session family) the token belongs to: logging out ends the token too. */
  const issueAccess = async (u: UserDoc, sid: string): Promise<string> =>
    new SignJWT({ role: u.role, name: u.username, sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id)
      .setIssuer('lentera-malam')
      .setIssuedAt(Math.floor(now() / 1000))
      .setExpirationTime(Math.floor(now() / 1000) + config.accessTtl)
      .sign(config.jwtSecret);

  const setRefresh = (reply: FastifyReply, token: string): void => {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/auth',
      maxAge: config.refreshTtl,
    });
  };

  const newSession = async (reply: FastifyReply, userId: string, family = randomBytes(12).toString('hex')): Promise<string> => {
    const token = randomBytes(32).toString('base64url');
    await repos.sessions.create({
      tokenHash: sha256(token),
      userId,
      family,
      expiresAt: new Date(now() + config.refreshTtl * 1000),
      revokedAt: null,
      createdAt: new Date(now()),
    });
    setRefresh(reply, token);
    return family;
  };


  const authResponse = async (u: UserDoc, sid: string): Promise<AuthResponse> => ({ accessToken: await issueAccess(u, sid), expiresIn: config.accessTtl, user: publicUser(u) });

  /** The account behind a Bearer access token, or null (and a 401 already sent). */
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<UserDoc | null> => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) {
      fail(reply, 401, 'unauthorized');
      return null;
    }
    try {
      const { payload } = await jwtVerify(h.slice(7), config.jwtSecret, { issuer: 'lentera-malam', algorithms: ['HS256'], currentDate: new Date(now()) });
      const u = typeof payload.sub === 'string' ? await repos.users.byId(payload.sub) : null;
      // the login this token came from must still be alive (logout, theft revocation)
      const live = u && typeof payload.sid === 'string' ? await repos.sessions.familyActive(payload.sid, new Date(now())) : false;
      if (!u || !live) {
        fail(reply, 401, 'unauthorized');
        return null;
      }
      return u;
    } catch (e) {
      fail(reply, 401, (e as { code?: string }).code === 'ERR_JWT_EXPIRED' ? 'token_expired' : 'unauthorized');
      return null;
    }
  };

  /**
   * Cookie-authenticated endpoints refuse other origins outright. SameSite=Strict already keeps the
   * cookie off cross-site requests; this is the second lock (a browser always sends Origin on a
   * cross-origin POST).
   */
  const sameOriginOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.corsOrigin) {
      fail(reply, 403, 'forbidden_origin');
      return false;
    }
    return true;
  };

  // ───────────────────────── routes ─────────────────────────

  // rate limited: every call pings the database
  app.get('/health', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => ({ ok: true, db: (await repos.ping()) ? 'ok' : 'down' }));

  const usernameQuery = {
    querystring: { type: 'object', required: ['username'], properties: { username: { type: 'string', maxLength: 32 } }, additionalProperties: false },
  } as const;

  app.get<{ Querystring: { username: string } }>(
    '/auth/check-username',
    { schema: usernameQuery, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const name = req.query.username;
      if (!validUsername(name)) return { available: false, reason: 'invalid_username' };
      const lower = name.toLowerCase();
      if (isProtectedUsername(lower)) return { available: false, reason: 'username_reserved' };
      return (await repos.users.byLower(lower)) ? { available: false, reason: 'username_taken' } : { available: true };
    },
  );

  const registerSchema = {
    body: {
      type: 'object',
      required: ['username', 'password'],
      additionalProperties: false,
      properties: {
        username: { type: 'string', maxLength: 32 },
        password: { type: 'string', maxLength: 256 },
        email: { type: 'string', maxLength: 254 },
      },
    },
  } as const;

  app.post<{ Body: { username: string; password: string; email?: string } }>(
    '/auth/register',
    // five new accounts per IP per ten minutes
    { schema: registerSchema, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { username, password } = req.body;
      const email = req.body.email?.trim() || undefined;
      if (!validUsername(username)) return fail(reply, 400, 'invalid_username');
      if (!validPassword(password)) return fail(reply, 400, 'weak_password');
      if (email !== undefined && !validEmail(email)) return fail(reply, 400, 'invalid_email');
      const lower = username.toLowerCase();
      /*
       * Protected names (manzzy, admin, dev, moderator, gm, system) are refused outright, whether or
       * not they exist yet: the developer account is made on the VPS (`npm run create-dev-account`),
       * never by whoever registers the name first. Everyone who registers here is a player.
       */
      if (isProtectedUsername(lower)) return fail(reply, 403, 'username_reserved');
      const role: UserRole = 'player';
      const passwordHash = await argon2.hash(password, ARGON);
      let user: UserDoc;
      try {
        user = await repos.users.create({ username, usernameLower: lower, passwordHash, email, role, createdAt: new Date(now()), lastLogin: new Date(now()) });
      } catch (e) {
        if (e instanceof DuplicateError) return fail(reply, 409, 'username_taken');
        throw e;
      }
      const sid = await newSession(reply, user.id);
      return reply.code(201).send(await authResponse(user, sid));
    },
  );

  const loginSchema = {
    body: {
      type: 'object',
      required: ['username', 'password'],
      additionalProperties: false,
      properties: { username: { type: 'string', maxLength: 32 }, password: { type: 'string', maxLength: 256 } },
    },
  } as const;

  app.post<{ Body: { username: string; password: string } }>(
    '/auth/login',
    // 20 attempts a minute from one address (the plugin), and 5 a minute at one account from one
    // address (`loginTries`, below, which needs the parsed body to know the account)
    { schema: loginSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!loginTries.allow(`${clientIp(req)}|${String(req.body.username).toLowerCase()}`, now())) return fail(reply, 429, 'rate_limited');
      const lower = String(req.body.username).toLowerCase();
      const user = validUsername(req.body.username) ? await repos.users.byLower(lower) : null;
      // verify against something either way, so the timing does not reveal which names exist
      const ok = await argon2.verify(user?.passwordHash ?? dummyHash, String(req.body.password));
      if (!user || !ok) return fail(reply, 401, 'invalid_credentials');
      await repos.users.touchLogin(user.id, new Date(now()));
      const sid = await newSession(reply, user.id);
      return reply.send(await authResponse(user, sid));
    },
  );

  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!sameOriginOnly(req, reply)) return reply;
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return fail(reply, 401, 'unauthorized');
    const s = await repos.sessions.byHash(sha256(token));
    if (!s) return fail(reply, 401, 'unauthorized');
    if (s.revokedAt) {
      /*
       * A rotated token came back. Within a few seconds of its rotation that is a second tab (or a
       * retry) that raced the first one with the same cookie: give it a fresh token in the same
       * login. Any later, it was copied — end that whole login everywhere.
       */
      const grace = now() - s.revokedAt.getTime() <= REFRESH_GRACE_MS && (await repos.sessions.familyActive(s.family, new Date(now())));
      if (!grace) {
        await repos.sessions.revokeFamily(s.family, new Date(now()));
        reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
        return fail(reply, 401, 'unauthorized');
      }
    }
    if (s.expiresAt.getTime() <= now()) return fail(reply, 401, 'unauthorized');
    const user = await repos.users.byId(s.userId);
    if (!user) return fail(reply, 401, 'unauthorized');
    if (!s.revokedAt) await repos.sessions.revoke(s.tokenHash, new Date(now()));
    await newSession(reply, user.id, s.family);
    return reply.send(await authResponse(user, s.family));
  });

  app.post('/auth/logout', async (req, reply) => {
    if (!sameOriginOnly(req, reply)) return reply;
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      const s = await repos.sessions.byHash(sha256(token));
      if (s) await repos.sessions.revokeFamily(s.family, new Date(now()));
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    return publicUser(user);
  });

  // ───────────────────────── save ─────────────────────────


  app.get('/save', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const c = await repos.characters.get(user.id, 0);
    return c ? envelope(c) : reply.code(204).send();
  });

  const putSchema = {
    body: {
      type: 'object',
      required: ['data', 'baseRev'],
      additionalProperties: false,
      properties: {
        data: { type: 'object' },
        baseRev: { type: 'integer', minimum: 0 },
        // a real epoch-ms timestamp (2000–2100): anything else would be stored as an invalid date
        clientUpdatedAt: { type: 'number', minimum: 946_684_800_000, maximum: 4_102_444_800_000 },
      },
    },
  } as const;

  app.put<{ Body: { data: Record<string, unknown>; baseRev: number; clientUpdatedAt?: number } }>(
    '/save',
    { schema: putSchema, config: { rateLimit: { max: 12, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `save:${clientIp(req)}` } } },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return reply;
      const { data, baseRev } = req.body;
      if (Buffer.byteLength(JSON.stringify(data)) > MAX_SAVE_BYTES) return fail(reply, 413, 'save_too_large');
      const v = data.v;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail(reply, 400, 'invalid_input');
      if (v > MAX_SAVE_VERSION) return fail(reply, 422, 'unsupported_save_version');
      const hero = data.hero as { x?: unknown; y?: unknown; hp?: unknown } | undefined;
      if (!hero || ![hero.x, hero.y, hero.hp].every((n) => typeof n === 'number' && Number.isFinite(n))) return fail(reply, 400, 'invalid_input');
      const level = Math.max(1, Math.min(999, Math.floor(Number((data.character as { level?: unknown } | undefined)?.level ?? 1)) || 1));
      const at = new Date(now());
      const clientAt = typeof req.body.clientUpdatedAt === 'number' && Number.isFinite(req.body.clientUpdatedAt) ? new Date(req.body.clientUpdatedAt) : null;

      const current = await repos.characters.get(user.id, 0);
      /*
       * What the save may contain (shared/saveRules.ts). The account's role is the server's: a
       * player's save may not carry developer fields, may only hold real items in real amounts,
       * and may not jump further than play allows since the copy already here. A developer's save
       * is marked `devSave` by the server, whatever the client sent.
       */
      const dev = user.role === 'dev';
      const integrity = checkSaveIntegrity(data, dev);
      const progress = integrity.ok && !dev && current ? checkProgression(current.data, data, now() - current.updatedAt.getTime()) : integrity;
      if (!progress.ok) {
        req.log.warn({ user: user.username, reason: progress.reason, detail: progress.detail }, 'save ditolak');
        return fail(reply, 422, 'save_rejected', { reason: progress.reason, detail: progress.detail });
      }
      if (dev) data.devSave = true;
      const conflict = async (): Promise<FastifyReply> => {
        const latest = await repos.characters.get(user.id, 0);
        return fail(reply, 409, 'conflict', { current: latest ? envelope(latest) : null });
      };
      if ((current?.rev ?? 0) !== baseRev) return conflict();
      if (!current) {
        try {
          await repos.characters.insert({ userId: user.id, slot: 0, saveVersion: v, rev: 1, data, level, dev, updatedAt: at, clientUpdatedAt: clientAt, createdAt: at });
        } catch (e) {
          if (e instanceof DuplicateError) return conflict();
          throw e;
        }
        return { rev: 1, updatedAt: at.getTime() };
      }
      const next = await repos.characters.replaceIfRev(user.id, 0, baseRev, { saveVersion: v, rev: baseRev + 1, data, level, dev, updatedAt: at, clientUpdatedAt: clientAt });
      if (!next) return conflict();
      return { rev: next.rev, updatedAt: at.getTime() };
    },
  );

  // ───────────────────────── developer ─────────────────────────

  const devSchema = {
    body: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: { action: { type: 'object' }, save: { type: 'object' } },
    },
  } as const;

  /**
   * Every developer action (shared/devActions.ts). Only an account whose role **in the database**
   * is "dev" gets past the first check; everyone else is refused and the attempt is logged. Grants
   * are applied here, to the save, and handed back; session tools are authorised and logged.
   */
  app.post<{ Body: { action: unknown; save?: Record<string, unknown> } }>(
    '/dev/action',
    { schema: devSchema, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return reply;
      if (user.role !== 'dev') {
        req.log.warn({ user: user.username }, 'aksi pengembang ditolak: bukan akun pengembang');
        return fail(reply, 403, 'forbidden');
      }
      const action = parseDevAction(req.body.action);
      if (!action) return fail(reply, 400, 'invalid_input');
      req.log.info({ dev: user.username, action }, 'aksi pengembang');
      if (!isGrant(action)) return { ok: true };

      // the save to change: what the game holds right now, else what the server holds
      const current = await repos.characters.get(user.id, 0);
      const base = req.body.save ?? current?.data ?? null;
      if (base && !checkSaveIntegrity(base, true).ok) return fail(reply, 422, 'save_rejected');
      const result = applyGrant(base, action);
      if (!result.ok) return reply.code(409).send({ error: 'invalid_input', message: result.error });
      if (result.save === null) {
        await repos.characters.remove(user.id, 0);
        return { ok: true, note: result.note, save: null };
      }
      const data = result.save;
      const v = typeof data.v === 'number' ? data.v : MAX_SAVE_VERSION;
      const level = Number((data.character as { level?: number } | undefined)?.level ?? 1);
      const at = new Date(now());
      const stored = await repos.characters.overwrite(user.id, 0, { saveVersion: v, data, level, dev: true, updatedAt: at, clientUpdatedAt: null });
      return { ok: true, note: result.note, save: envelope(stored) };
    },
  );

  return app;
}

/**
 * At most `max` events per key in any `windowMs`. In memory: one process serves the API, and a
 * restart forgetting the counts is acceptable for a limit measured in minutes. Keys are pruned as
 * they are touched, and the whole map when it grows past a bound, so it cannot be used to fill RAM.
 */
export class SlidingLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    /** Most keys held at once. Beyond it, stale keys go, then the oldest. */
    private readonly maxKeys = 50_000,
  ) {}

  get size(): number {
    return this.hits.size;
  }

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    // delete first so the key moves to the end: the Map's order is then "least recently used first"
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.shrink(now);
    return true;
  }

  /**
   * Down to 90% of the cap: stale keys first, then the least recently used. It used to scan the whole
   * map on *every* call once the cap was passed — flooding it with distinct names made each login
   * attempt O(n), a CPU denial of service. Now the scan happens once per 10% of new keys.
   */
  private shrink(now: number): void {
    const target = Math.floor(this.maxKeys * 0.9);
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    for (const k of this.hits.keys()) {
      if (this.hits.size <= target) break;
      this.hits.delete(k);
    }
  }
}
