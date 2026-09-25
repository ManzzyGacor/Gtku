/**
 * The MongoDB implementation of `Repos`, with the indexes the rules depend on:
 *
 *  • users.usernameLower **unique** — "Pemain" and "pemain" are the same name;
 *  • sessions.tokenHash unique, and a TTL index on expiresAt so dead sessions clean themselves up;
 *  • characters (userId, slot) unique — one document per character.
 *
 * The connection string is read by the caller from process.env and passed in; nothing here logs it.
 */
import { MongoClient, ObjectId, type Collection, type Db } from 'mongodb';
import { DuplicateError, type CharacterDoc, type Repos, type SessionDoc, type UserDoc } from './repo';

type UserRow = Omit<UserDoc, 'id'> & { _id: ObjectId };
type CharRow = CharacterDoc & { _id?: ObjectId };
type SessionRow = SessionDoc & { _id?: ObjectId };

const isDup = (e: unknown): boolean => (e as { code?: number })?.code === 11000;

export async function connectMongo(uri: string, dbName: string): Promise<{ repos: Repos; close(): Promise<void> }> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, appName: 'lentera-malam' });
  await client.connect();
  const db = client.db(dbName);
  await ensureIndexes(db);
  return { repos: mongoRepos(db), close: () => client.close() };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection('users').createIndex({ usernameLower: 1 }, { unique: true, name: 'username_unik' });
  await db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ family: 1 });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('characters').createIndex({ userId: 1, slot: 1 }, { unique: true });
}

const toUser = (r: UserRow): UserDoc => {
  const { _id, ...rest } = r;
  return { ...rest, id: _id.toHexString() };
};

const oid = (id: string): ObjectId | null => (ObjectId.isValid(id) ? new ObjectId(id) : null);

/** A row without its Mongo `_id`. */
function strip<T extends { _id?: ObjectId }>(r: T | null): Omit<T, '_id'> | null {
  if (!r) return null;
  const { _id, ...rest } = r;
  void _id;
  return rest;
}

export function mongoRepos(db: Db): Repos {
  const users: Collection<UserRow> = db.collection('users');
  const sessions: Collection<SessionRow> = db.collection('sessions');
  const characters: Collection<CharRow> = db.collection('characters');
  return {
    users: {
      async create(u) {
        try {
          const res = await users.insertOne({ ...u, _id: new ObjectId() });
          return { ...u, id: res.insertedId.toHexString() };
        } catch (e) {
          if (isDup(e)) throw new DuplicateError();
          throw e;
        }
      },
      async byLower(l) {
        const r = await users.findOne({ usernameLower: l });
        return r ? toUser(r) : null;
      },
      async byId(id) {
        const _id = oid(id);
        const r = _id ? await users.findOne({ _id }) : null;
        return r ? toUser(r) : null;
      },
      async touchLogin(id, at) {
        const _id = oid(id);
        if (_id) await users.updateOne({ _id }, { $set: { lastLogin: at } });
      },
      async setRole(l, role) {
        const r = await users.updateOne({ usernameLower: l }, { $set: { role } });
        return r.matchedCount > 0;
      },
    },
    sessions: {
      async create(s) {
        await sessions.insertOne({ ...s });
      },
      async byHash(h) {
        return strip(await sessions.findOne({ tokenHash: h }));
      },
      async revoke(h, at) {
        await sessions.updateOne({ tokenHash: h, revokedAt: null }, { $set: { revokedAt: at } });
      },
      async revokeFamily(f, at) {
        await sessions.updateMany({ family: f, revokedAt: null }, { $set: { revokedAt: at } });
      },
    },
    characters: {
      async get(userId, slot) {
        return strip(await characters.findOne({ userId, slot }));
      },
      async insert(doc) {
        try {
          await characters.insertOne({ ...doc });
        } catch (e) {
          if (isDup(e)) throw new DuplicateError();
          throw e;
        }
      },
      async replaceIfRev(userId, slot, baseRev, next) {
        // the revision check and the write are one atomic operation
        const r = await characters.findOneAndUpdate({ userId, slot, rev: baseRev }, { $set: next }, { returnDocument: 'after' });
        return strip(r);
      },
    },
    async ping() {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
  };
}
