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
  validEmail,
  validPassword,
  validUsername,
  type ApiErrorCode,
  type AuthResponse,
  type PublicUser,
  type SaveEnvelope,
  type UserRole,
} from '../../shared/api';
import { DEV_USERNAME, redact, type ServerConfig } from './config';
import { DuplicateError, type CharacterDoc, type Repos, type UserDoc } from './repo';

export const REFRESH_COOKIE = 'lm_refresh';

/**
 * argon2id with the OWASP-recommended floor (19 MiB, 2 passes). About 50 ms on this VPS — slow for
 * a guesser, invisible to a player, and small enough that a burst of logins cannot exhaust 4 GB.
 */
const ARGON = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

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
    // never echo internals; log them with anything that looks like a connection string removed
    req.log.error({ err: { name: e.name, message: redact(String(e.message ?? ''), [config.mongoUri]) } }, 'kesalahan server');
    return fail(reply, 500, 'server_error');
  });

  // ───────────────────────── tokens ─────────────────────────

  const issueAccess = async (u: UserDoc): Promise<string> =>
    new SignJWT({ role: u.role, name: u.username })
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

  const newSession = async (reply: FastifyReply, userId: string, family = randomBytes(12).toString('hex')): Promise<void> => {
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
  };


  const authResponse = async (u: UserDoc): Promise<AuthResponse> => ({ accessToken: await issueAccess(u), expiresIn: config.accessTtl, user: publicUser(u) });

  /** The account behind a Bearer access token, or null (and a 401 already sent). */
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<UserDoc | null> => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) {
      fail(reply, 401, 'unauthorized');
      return null;
    }
    try {
      const { payload } = await jwtVerify(h.slice(7), config.jwtSecret, { issuer: 'lentera-malam', currentDate: new Date(now()) });
      const u = typeof payload.sub === 'string' ? await repos.users.byId(payload.sub) : null;
      if (!u) {
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

  app.get('/health', async () => ({ ok: true, db: (await repos.ping()) ? 'ok' : 'down' }));

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
      if (lower === DEV_USERNAME) return { available: false, reason: 'username_reserved' };
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
        devSetupCode: { type: 'string', maxLength: 128 },
      },
    },
  } as const;

  app.post<{ Body: { username: string; password: string; email?: string; devSetupCode?: string } }>(
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
      let role: UserRole = 'player';
      if (lower === DEV_USERNAME) {
        // the developer name: only with the setup code from server/.env, compared in constant time
        const code = req.body.devSetupCode ?? '';
        if (!config.devSetupCode || sha256(code) !== sha256(config.devSetupCode)) return fail(reply, 403, 'username_reserved');
        role = 'dev';
      }
      const passwordHash = await argon2.hash(password, ARGON);
      let user: UserDoc;
      try {
        user = await repos.users.create({ username, usernameLower: lower, passwordHash, email, role, createdAt: new Date(now()), lastLogin: new Date(now()) });
      } catch (e) {
        if (e instanceof DuplicateError) return fail(reply, 409, 'username_taken');
        throw e;
      }
      await newSession(reply, user.id);
      return reply.code(201).send(await authResponse(user));
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
      await newSession(reply, user.id);
      return reply.send(await authResponse(user));
    },
  );

  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!sameOriginOnly(req, reply)) return reply;
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return fail(reply, 401, 'unauthorized');
    const s = await repos.sessions.byHash(sha256(token));
    if (!s) return fail(reply, 401, 'unauthorized');
    if (s.revokedAt) {
      // a rotated token came back: it was copied. End that whole login everywhere.
      await repos.sessions.revokeFamily(s.family, new Date(now()));
      reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      return fail(reply, 401, 'unauthorized');
    }
    if (s.expiresAt.getTime() <= now()) return fail(reply, 401, 'unauthorized');
    const user = await repos.users.byId(s.userId);
    if (!user) return fail(reply, 401, 'unauthorized');
    await repos.sessions.revoke(s.tokenHash, new Date(now()));
    await newSession(reply, user.id, s.family);
    return reply.send(await authResponse(user));
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
        clientUpdatedAt: { type: 'number' },
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
      const conflict = async (): Promise<FastifyReply> => {
        const latest = await repos.characters.get(user.id, 0);
        return fail(reply, 409, 'conflict', { current: latest ? envelope(latest) : null });
      };
      if ((current?.rev ?? 0) !== baseRev) return conflict();
      if (!current) {
        try {
          await repos.characters.insert({ userId: user.id, slot: 0, saveVersion: v, rev: 1, data, level, updatedAt: at, clientUpdatedAt: clientAt, createdAt: at });
        } catch (e) {
          if (e instanceof DuplicateError) return conflict();
          throw e;
        }
        return { rev: 1, updatedAt: at.getTime() };
      }
      const next = await repos.characters.replaceIfRev(user.id, 0, baseRev, { saveVersion: v, rev: baseRev + 1, data, level, updatedAt: at, clientUpdatedAt: clientAt });
      if (!next) return conflict();
      return { rev: next.rev, updatedAt: at.getTime() };
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
  ) {}

  allow(key: string, now: number): boolean {
    if (this.hits.size > 50_000) this.prune(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}
