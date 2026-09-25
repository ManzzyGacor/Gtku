/**
 * Storage behind interfaces: `MongoRepos` in production, `MemoryRepos` in the tests. Routes only
 * ever see these, so the whole API is tested without a database — and the Mongo implementation is
 * a thin, reviewable mapping.
 */
import type { UserRole } from '../../shared/api';

export interface UserDoc {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  email?: string | undefined;
  role: UserRole;
  createdAt: Date;
  lastLogin: Date | null;
}

export interface SessionDoc {
  /** SHA-256 of the refresh token; the token itself is never stored. */
  tokenHash: string;
  userId: string;
  /** Every rotation of one login shares a family; reuse of a rotated token revokes the family. */
  family: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CharacterDoc {
  userId: string;
  slot: number;
  saveVersion: number;
  rev: number;
  data: unknown;
  /** Copied out of the save for queries and the admin view. */
  level: number;
  updatedAt: Date;
  clientUpdatedAt: Date | null;
  createdAt: Date;
}

export class DuplicateError extends Error {}

export interface Repos {
  users: {
    create(u: Omit<UserDoc, 'id'>): Promise<UserDoc>;
    byLower(usernameLower: string): Promise<UserDoc | null>;
    byId(id: string): Promise<UserDoc | null>;
    touchLogin(id: string, at: Date): Promise<void>;
    setRole(usernameLower: string, role: UserRole): Promise<boolean>;
  };
  sessions: {
    create(s: SessionDoc): Promise<void>;
    byHash(tokenHash: string): Promise<SessionDoc | null>;
    revoke(tokenHash: string, at: Date): Promise<void>;
    revokeFamily(family: string, at: Date): Promise<void>;
    /** Is any session of this login still usable (not revoked, not expired)? */
    familyActive(family: string, now: Date): Promise<boolean>;
  };
  characters: {
    get(userId: string, slot: number): Promise<CharacterDoc | null>;
    /** Insert rev 1 when there is none; DuplicateError if one appeared meanwhile. */
    insert(doc: CharacterDoc): Promise<void>;
    /** Replace only if the stored rev is `baseRev`; returns the new doc, or null on a lost race. */
    replaceIfRev(userId: string, slot: number, baseRev: number, next: Omit<CharacterDoc, 'userId' | 'slot' | 'createdAt'>): Promise<CharacterDoc | null>;
  };
  ping(): Promise<boolean>;
}

const key = (u: string, s: number): string => `${u}#${s}`;

/** In memory, for tests. Same semantics as Mongo, including the unique indexes. */
export function memoryRepos(): Repos {
  const users = new Map<string, UserDoc>();
  const sessions = new Map<string, SessionDoc>();
  const chars = new Map<string, CharacterDoc>();
  let n = 0;
  return {
    users: {
      async create(u) {
        for (const x of users.values()) if (x.usernameLower === u.usernameLower) throw new DuplicateError();
        const doc = { ...u, id: `u${++n}` };
        users.set(doc.id, doc);
        return { ...doc };
      },
      async byLower(l) {
        for (const x of users.values()) if (x.usernameLower === l) return { ...x };
        return null;
      },
      async byId(id) {
        const u = users.get(id);
        return u ? { ...u } : null;
      },
      async touchLogin(id, at) {
        const u = users.get(id);
        if (u) u.lastLogin = at;
      },
      async setRole(l, role) {
        for (const x of users.values())
          if (x.usernameLower === l) {
            x.role = role;
            return true;
          }
        return false;
      },
    },
    sessions: {
      async create(s) {
        sessions.set(s.tokenHash, { ...s });
      },
      async byHash(h) {
        const s = sessions.get(h);
        return s ? { ...s } : null;
      },
      async revoke(h, at) {
        const s = sessions.get(h);
        if (s && !s.revokedAt) s.revokedAt = at;
      },
      async revokeFamily(f, at) {
        for (const s of sessions.values()) if (s.family === f && !s.revokedAt) s.revokedAt = at;
      },
      async familyActive(f, now) {
        for (const s of sessions.values()) if (s.family === f && !s.revokedAt && s.expiresAt > now) return true;
        return false;
      },
    },
    characters: {
      async get(u, s) {
        const c = chars.get(key(u, s));
        return c ? structuredClone(c) : null;
      },
      async insert(doc) {
        if (chars.has(key(doc.userId, doc.slot))) throw new DuplicateError();
        chars.set(key(doc.userId, doc.slot), structuredClone(doc));
      },
      async replaceIfRev(u, s, baseRev, next) {
        const c = chars.get(key(u, s));
        if (!c || c.rev !== baseRev) return null;
        Object.assign(c, structuredClone(next));
        return structuredClone(c);
      },
    },
    async ping() {
      return true;
    },
  };
}
